import { inJapanese, memoryDeps } from "../store/memory.ts";
import { expect, test } from "bun:test";
import { defaultSettings, type Settings } from "../../shared/settings.ts";
import type { ReviewStreamEvent } from "../../shared/types.ts";
import { createApp } from "../app.ts";
import { diffDigest } from "../diff/digest.ts";
import { parseUnifiedDiff } from "../diff/parse.ts";
import { FakeCommandRunner, ok } from "../exec.ts";
import { GitHubClient } from "../github/client.ts";
import { ReviewRunner, type FileReader } from "../reviewer/runner.ts";
import { Translator } from "../reviewer/translate.ts";
import { SnapshotManager, type SnapshotFs } from "../snapshot/manager.ts";
import { attachComments } from "./review.ts";
import { bunStaticFiles } from "../runtime/bun.ts";

const PR_FIELDS =
  "number,title,author,headRefName,baseRefName,additions,deletions,changedFiles,updatedAt,url";

const RAW_PR = {
  number: 12,
  title: "認証を直す",
  author: { login: "alice" },
  headRefName: "fix-auth",
  baseRefName: "main",
  additions: 3,
  deletions: 1,
  changedFiles: 1,
  updatedAt: "2026-07-20T10:00:00Z",
  url: "https://github.com/o/r/pull/12",
  headRefOid: "abc123",
  baseRefOid: "base999",
  body: "ログイン時の権限チェック漏れを直す",
};

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
`;

class StubFileReader implements FileReader {
  removed: string[] = [];
  constructor(private readonly content: string) {}
  async read(): Promise<string> {
    return this.content;
  }
  async remove(path: string): Promise<void> {
    this.removed.push(path);
  }
}

/** SSE のレスポンス本文を ReviewStreamEvent の配列に戻す */
async function readEvents(res: Response): Promise<ReviewStreamEvent[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as ReviewStreamEvent);
}

/** 実ファイルを作らずに、書き込みと削除を記録する */
class MemoryFs implements SnapshotFs {
  written = new Map<string, string>();
  removed: string[] = [];
  made: string[] = [];
  async write(path: string, content: string): Promise<void> {
    this.written.set(path, content);
  }
  async makeDir(path: string): Promise<void> {
    this.made.push(path);
  }
  async removeDir(path: string): Promise<void> {
    this.removed.push(path);
  }
  async list(): Promise<string[]> {
    return [];
  }
}

const ROOT = "/tmp/advw/pr-o-r-12-1000";
const RAW = "gh api -H Accept: application/vnd.github.raw";
const NOT_FOUND = { stderr: "gh: Not Found (HTTP 404)", exitCode: 1 };
const REVIEW_COMMENTS = "gh api --paginate repos/o/r/pulls/12/comments --jq .[]";
const ISSUE_COMMENTS = "gh api --paginate repos/o/r/issues/12/comments --jq .[]";
const REVIEWS = "gh api --paginate repos/o/r/pulls/12/reviews --jq .[]";

/** レビュー開始リクエストは、クライアントが見ている diff の head SHA を必ず添える */
function startReview(
  app: ReturnType<typeof createApp>,
  headSha = "abc123",
  extra: Record<string, unknown> = {},
): Response | Promise<Response> {
  return app.request("/api/repos/o/r/pulls/12/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ headSha, ...extra }),
  });
}

function buildApp(
  findingsJson: string,
  extra: Record<string, Partial<import("../exec.ts").CommandResult>> = {},
  settings: Settings = defaultSettings(),
) {
  const runner = new FakeCommandRunner({
    [`gh pr view 12 --repo o/r --json ${PR_FIELDS},headRefOid,baseRefOid,body,labels`]: ok(
      JSON.stringify(RAW_PR),
    ),
    "gh pr diff 12 --repo o/r": ok(PATCH),
    [REVIEW_COMMENTS]: ok(""),
    [ISSUE_COMMENTS]: ok(""),
    [REVIEWS]: ok(""),
    [`${RAW} repos/o/r/contents/src/a.ts?ref=abc123`]: ok("const a = 1;\nconst b = 3;\n"),
    [`${RAW} repos/o/r/contents/CLAUDE.md?ref=base999`]: ok("# 規約\n"),
    [`${RAW} repos/o/r/contents/AGENTS.md?ref=base999`]: NOT_FOUND,
    [`${RAW} repos/o/r/contents/REVIEW.md?ref=base999`]: NOT_FOUND,
    ...extra,
  });
  const files = new StubFileReader(findingsJson);
  const fs = new MemoryFs();
  const github = new GitHubClient(runner);
  const app = inJapanese(
    createApp({
      github,
      snapshots: new SnapshotManager(github, "/tmp/advw", fs, () => 1000),
      reviewer: new ReviewRunner(runner, files, "remote-read"),
      remoteReadCommand: "remote-read",
      translator: new Translator(runner, files),
      clientDir: "./dist/client",
      staticFiles: bunStaticFiles,
      ...memoryDeps(settings),
    }),
  );
  return { app, runner, files, fs };
}

/** claude の呼び出しはプロンプト全文がキーになるため、動的に応答する */
function stubClaude(runner: FakeCommandRunner, onCall: (cmd: string[]) => void = () => {}): void {
  const original = runner.run.bind(runner);
  runner.run = async (cmd, opts) => {
    if (cmd[0] !== "claude") return original(cmd, opts);
    runner.calls.push(cmd);
    runner.cwds.push(opts?.cwd);
    runner.envs.push(opts?.env);
    onCall(cmd);
    return ok("");
  };
}

test("snapshot_ready → reviewing → findings の順にイベントを流す", async () => {
  const findingsJson = JSON.stringify({
    findings: [{ path: "src/a.ts", line: 2, severity: "blocker", title: "題", body: "本文" }],
  });
  const { app, runner } = buildApp(findingsJson);
  stubClaude(runner);

  const res = await startReview(app);
  expect(res.status).toBe(200);

  const events = await readEvents(res);
  expect(events.map((e) => e.type)).toEqual(["snapshot_ready", "reviewing", "findings"]);

  const last = events[2] as Extract<ReviewStreamEvent, { type: "findings" }>;
  expect(last.findings).toHaveLength(1);
  expect(last.findings[0]!.anchor).toBe("line");
});

test("diff 外を指す指摘は降格された状態で流れる", async () => {
  const findingsJson = JSON.stringify({
    findings: [{ path: "src/a.ts", line: 999, severity: "nit", title: "題", body: "本文" }],
  });
  const { app, runner } = buildApp(findingsJson);
  stubClaude(runner);

  const events = await readEvents(await startReview(app));
  const last = events.at(-1) as Extract<ReviewStreamEvent, { type: "findings" }>;
  expect(last.findings[0]!.anchor).toBe("summary");
  expect(last.findings[0]!.reason).toContain("diff に含まれていない");
});

test("clone せず、変更ファイルと規約ファイルだけを head 時点の内容で置く", async () => {
  const { app, runner, fs } = buildApp(JSON.stringify({ findings: [] }));
  stubClaude(runner);

  await readEvents(await startReview(app));

  expect([...fs.written.keys()].sort()).toEqual([
    `${ROOT}/pr.diff`,
    `${ROOT}/repo/CLAUDE.md`,
    `${ROOT}/repo/src/a.ts`,
  ]);
  expect(fs.written.get(`${ROOT}/pr.diff`)).toBe(PATCH);
  // ローカルの git には一切触れない
  expect(runner.calls.some((c) => c[0] === "git")).toBe(false);
  // claude は作業ディレクトリで、読む先のリポジトリとコミットを環境変数で固定して走る
  const claudeIndex = runner.calls.findIndex((c) => c[0] === "claude");
  expect(runner.cwds[claudeIndex]).toBe(`${ROOT}/repo`);
  expect(runner.envs[claudeIndex]).toEqual({
    CC_AUTO_REVIEW_REPO: "o/r",
    CC_AUTO_REVIEW_HEAD_SHA: "abc123",
    CC_AUTO_REVIEW_BASE_SHA: "base999",
  });
});

test("変更ファイルの取得に失敗したら error イベントを流し、作業ディレクトリを消す", async () => {
  const { app, fs } = buildApp("{}", {
    [`${RAW} repos/o/r/contents/src/a.ts?ref=abc123`]: {
      stderr: "gh: Bad credentials (HTTP 401)",
      exitCode: 1,
    },
  });
  const events = await readEvents(await startReview(app));
  const last = events.at(-1) as Extract<ReviewStreamEvent, { type: "error" }>;
  expect(last.type).toBe("error");
  expect(last.message).toBe("o/r の src/a.ts を取得できませんでした");
  expect(fs.removed).toContain(ROOT);
});

test("クライアントの head SHA が古ければファイルを取得せずエラーにする", async () => {
  const { app, fs } = buildApp("{}");
  const events = await readEvents(await startReview(app, "oldsha"));
  const last = events.at(-1) as Extract<ReviewStreamEvent, { type: "error" }>;
  expect(last.type).toBe("error");
  expect(last.message).toBe(
    "この PR は表示後に更新されています。ページを再読み込みしてからレビューしてください。",
  );
  // 古い diff に対して指摘を紐づけない
  expect(fs.written.size).toBe(0);
});

test("headSha が無いリクエストは 400 を返す", async () => {
  const { app } = buildApp("{}");
  const res = await app.request("/api/repos/o/r/pulls/12/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(400);
});

test("レビューが終わったら作業ディレクトリを破棄する", async () => {
  const { app, runner, fs } = buildApp(JSON.stringify({ findings: [] }));
  stubClaude(runner);

  await readEvents(await startReview(app));
  expect(fs.removed).toEqual([ROOT]);
});

test("PR 番号が不正なら 400 を返す", async () => {
  const { app } = buildApp("{}");
  const res = await app.request("/api/repos/o/r/pulls/abc/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ headSha: "abc123" }),
  });
  expect(res.status).toBe(400);
});

test("追加のレビュー指示を claude のプロンプトに渡す", async () => {
  const { app, runner } = buildApp(JSON.stringify({ findings: [] }));
  let prompt = "";
  stubClaude(runner, (cmd) => {
    prompt = cmd[2] ?? "";
  });

  await readEvents(
    await app.request("/api/repos/o/r/pulls/12/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ headSha: "abc123", instructions: "N+1 クエリを重点的に見て" }),
    }),
  );

  expect(prompt).toContain("## Additional instructions for this review");
  // PR の説明文も文脈として渡す
  expect(prompt).toContain("ログイン時の権限チェック漏れを直す");
  expect(prompt).toContain("N+1 クエリを重点的に見て");
});

test("既存のコメントと作成者の返信をプロンプトに渡す", async () => {
  const { app, runner } = buildApp(JSON.stringify({ findings: [] }), {
    [REVIEW_COMMENTS]: ok(
      JSON.stringify({
        id: 1,
        user: { login: "me" },
        body: "null チェックが抜けています",
        path: "src/a.ts",
        line: 2,
        side: "RIGHT",
        created_at: "2026-10-01T00:00:00Z",
        html_url: "https://github.com/o/r/pull/12#discussion_r1",
      }),
    ),
    [ISSUE_COMMENTS]: ok(
      JSON.stringify({
        id: 2,
        user: { login: "alice" },
        body: "呼び出し側で保証しているので不要です",
        created_at: "2026-10-02T00:00:00Z",
        html_url: "https://github.com/o/r/pull/12#issuecomment-2",
      }),
    ),
  });
  let prompt = "";
  stubClaude(runner, (cmd) => {
    prompt = cmd[2] ?? "";
  });

  await readEvents(await startReview(app));

  expect(prompt).toContain("## Existing review comments and replies");
  expect(prompt).toContain("me (src/a.ts:2)");
  expect(prompt).toContain("呼び出し側で保証しているので不要です");
});

test("レビュー本文（総評）も、やり取りとしてプロンプトに渡す", async () => {
  const { app, runner } = buildApp(JSON.stringify({ findings: [] }), {
    [REVIEWS]: ok(
      [
        JSON.stringify({
          id: 10,
          user: { login: "me" },
          body: "エラー処理をまとめて見直してください",
          state: "CHANGES_REQUESTED",
          submitted_at: "2026-10-01T00:00:00Z",
          html_url: "https://github.com/o/r/pull/12#pullrequestreview-10",
        }),
        JSON.stringify({
          id: 11,
          user: { login: "bob" },
          body: "",
          state: "APPROVED",
          submitted_at: "2026-10-02T00:00:00Z",
          html_url: "https://github.com/o/r/pull/12#pullrequestreview-11",
        }),
      ].join("\n"),
    ),
  });
  let prompt = "";
  stubClaude(runner, (cmd) => {
    prompt = cmd[2] ?? "";
  });

  await readEvents(await startReview(app));

  expect(prompt).toContain("［レビュー: 変更を要求］");
  expect(prompt).toContain("エラー処理をまとめて見直してください");
  // 本文の無い承認だけのレビューは載せない
  expect(prompt).not.toContain("bob（");
});

test("attachComments は判定に元のコメントを結び付け、実在しない ID と重複を捨てる", () => {
  const comment = {
    id: 5,
    author: "me",
    body: "危ない",
    path: "src/a.ts",
    line: 2,
    side: "RIGHT" as const,
    createdAt: "2026-10-01T00:00:00Z",
    url: "u",
  };
  expect(
    attachComments(
      [
        { commentId: 5, status: "fixed", evidence: "直っている" },
        { commentId: 5, status: "unfixed", evidence: "二度目" },
        { commentId: 99, status: "unfixed", evidence: "無いコメント" },
      ],
      [comment],
    ),
  ).toEqual([{ status: "fixed", evidence: "直っている", comment }]);
});

test("画面で選んだモデルを claude の --model に渡す。選ばなければ付けない", async () => {
  const { app, runner } = buildApp(JSON.stringify({ findings: [] }));
  stubClaude(runner);

  await readEvents(await startReview(app, "abc123", { model: "sonnet" }));
  await readEvents(await startReview(app));

  const claudeCalls = runner.calls.filter((c) => c[0] === "claude");
  expect(claudeCalls[0]!.slice(-2)).toEqual(["--model", "sonnet"]);
  expect(claudeCalls[1]).not.toContain("--model");
});

test("決めた別名以外のモデルは、claude を起動せずに 400 で断る", async () => {
  const { app, runner } = buildApp(JSON.stringify({ findings: [] }));
  stubClaude(runner);

  const res = await startReview(app, "abc123", { model: "--dangerously-skip-permissions" });
  expect(res.status).toBe(400);
  expect(runner.calls.some((c) => c[0] === "claude")).toBe(false);
});

test("選んだプロファイルのチームの指示とツールで claude を起動する。知らないものは既定に倒す", async () => {
  const settings = defaultSettings();
  settings.profiles.push({
    ...settings.profiles[0]!,
    id: "docs",
    name: "Docs",
    instructions: "Check the glossary first",
    allowedTools: ["Skill"],
  });
  const { app, runner } = buildApp(JSON.stringify({ findings: [] }), {}, settings);
  stubClaude(runner);

  await readEvents(await startReview(app, "abc123", { profileId: "docs" }));
  await readEvents(await startReview(app, "abc123", { profileId: "nope" }));

  const claudeCalls = runner.calls.filter((c) => c[0] === "claude");
  expect(claudeCalls[0]![2]).toContain("Check the glossary first");
  expect(claudeCalls[0]!.join(" ")).toContain(",Skill");
  expect(claudeCalls[1]![2]).not.toContain("Check the glossary first");
  expect(claudeCalls[1]!.join(" ")).not.toContain("Skill");
});

test("モデルを選ばなければ設定の既定のモデルを使い、null なら claude の設定に任せる", async () => {
  const settings = { ...defaultSettings(), defaultModel: "opus" as const };
  const { app, runner } = buildApp(JSON.stringify({ findings: [] }), {}, settings);
  stubClaude(runner);

  await readEvents(await startReview(app));
  await readEvents(await startReview(app, "abc123", { model: null }));

  const claudeCalls = runner.calls.filter((c) => c[0] === "claude");
  expect(claudeCalls[0]!.slice(-2)).toEqual(["--model", "opus"]);
  expect(claudeCalls[1]).not.toContain("--model");
});

const WORKFLOW_PATCH = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index 1111111..2222222 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -1,2 +1,2 @@
 name: ci
-on: push
+on: pull_request_target
`;

test("リスクの判定を頼まれ、CI の設定を変える PR なら、AI を呼ばずに high として返す", async () => {
  const { app, runner } = buildApp(JSON.stringify({ findings: [] }), {
    "gh pr diff 12 --repo o/r": ok(WORKFLOW_PATCH),
  });
  const claude: string[][] = [];
  stubClaude(runner, (cmd) => claude.push(cmd));

  const events = await readEvents(await startReview(app, "abc123", { assessRisk: true }));
  expect(events.map((e) => e.type)).toEqual(["findings"]);
  const last = events[0] as Extract<ReviewStreamEvent, { type: "findings" }>;
  expect(last.risk?.level).toBe("high");
  expect(last.risk?.reasons[0]).toContain(".github/workflows/ci.yml");
  expect(last.descriptionLang).toBe("ja");
  // 次の回で中身が変わったかを見られるよう、AI を呼ばなかった回でも要約を返す
  expect(last.digest).toBe(diffDigest(parseUnifiedDiff(WORKFLOW_PATCH)));
  expect(claude).toHaveLength(0);
});

test("自動判断のラベルが付いた PR は、CI の設定を変えていても AI レビューまで進め、そのことを返す", async () => {
  const { app, runner } = buildApp(JSON.stringify({ findings: [] }), {
    [`gh pr view 12 --repo o/r --json ${PR_FIELDS},headRefOid,baseRefOid,body,labels`]: ok(
      JSON.stringify({ ...RAW_PR, labels: [{ name: "auto-judge" }] }),
    ),
    "gh pr diff 12 --repo o/r": ok(WORKFLOW_PATCH),
    [`${RAW} repos/o/r/contents/.github/workflows/ci.yml?ref=abc123`]: ok("name: ci\n"),
  });
  const claude: string[][] = [];
  stubClaude(runner, (cmd) => claude.push(cmd));

  const events = await readEvents(await startReview(app, "abc123", { assessRisk: true }));
  const last = events.at(-1) as Extract<ReviewStreamEvent, { type: "findings" }>;
  expect(claude).toHaveLength(1);
  expect(last.autoJudge).toBe(true);
  // リスクの判定は見せる
  expect(last.risk?.level).toBe("high");
});

test("skip-ai-review ラベルが付いた PR は、完全自動運転の回なら AI を呼ばずに見送ったと返す", async () => {
  const { app, runner } = buildApp(JSON.stringify({ findings: [] }), {
    [`gh pr view 12 --repo o/r --json ${PR_FIELDS},headRefOid,baseRefOid,body,labels`]: ok(
      JSON.stringify({ ...RAW_PR, labels: [{ name: "skip-ai-review" }, { name: "auto-judge" }] }),
    ),
  });
  const claude: string[][] = [];
  stubClaude(runner, (cmd) => claude.push(cmd));

  const events = await readEvents(await startReview(app, "abc123", { assessRisk: true }));
  expect(events.map((e) => e.type)).toEqual(["findings"]);
  const last = events[0] as Extract<ReviewStreamEvent, { type: "findings" }>;
  expect(last.skipped).toBe(true);
  expect(last.findings).toEqual([]);
  expect(claude).toHaveLength(0);
});

test("skip-ai-review ラベルが付いていても、人が画面から走らせたならレビューする", async () => {
  const { app, runner } = buildApp(JSON.stringify({ findings: [] }), {
    [`gh pr view 12 --repo o/r --json ${PR_FIELDS},headRefOid,baseRefOid,body,labels`]: ok(
      JSON.stringify({ ...RAW_PR, labels: [{ name: "skip-ai-review" }] }),
    ),
  });
  const claude: string[][] = [];
  stubClaude(runner, (cmd) => claude.push(cmd));

  const events = await readEvents(await startReview(app));
  const last = events.at(-1) as Extract<ReviewStreamEvent, { type: "findings" }>;
  expect(claude).toHaveLength(1);
  expect(last.skipped).toBeUndefined();
});

test("ラベルが無ければ autoJudge は false", async () => {
  const { app, runner } = buildApp(
    JSON.stringify({ findings: [], risk: { level: "low", reasons: [] } }),
  );
  stubClaude(runner);

  const events = await readEvents(await startReview(app, "abc123", { assessRisk: true }));
  const last = events.at(-1) as Extract<ReviewStreamEvent, { type: "findings" }>;
  expect(last.autoJudge).toBe(false);
});

test("リスクの判定を頼むと、プロンプトに判定の節が入り、AI の判定を返す", async () => {
  const { app, runner } = buildApp(
    JSON.stringify({ findings: [], risk: { level: "low", reasons: ["文言だけ"] } }),
  );
  let prompt = "";
  stubClaude(runner, (cmd) => {
    prompt = cmd.join("\n");
  });

  const events = await readEvents(await startReview(app, "abc123", { assessRisk: true }));
  const last = events.at(-1) as Extract<ReviewStreamEvent, { type: "findings" }>;
  expect(last.risk).toEqual({ level: "low", reasons: ["文言だけ"] });
  expect(prompt).toContain("## Risk assessment");
});

test("リスクの判定を頼んだのに AI が書かなければ、人に回すよう high にする", async () => {
  const { app, runner } = buildApp(JSON.stringify({ findings: [] }));
  stubClaude(runner);

  const events = await readEvents(await startReview(app, "abc123", { assessRisk: true }));
  const last = events.at(-1) as Extract<ReviewStreamEvent, { type: "findings" }>;
  expect(last.risk?.level).toBe("high");
});

test("リスクの判定を頼まなければ、判定の節を入れず risk は null", async () => {
  const { app, runner } = buildApp(JSON.stringify({ findings: [] }));
  let prompt = "";
  stubClaude(runner, (cmd) => {
    prompt = cmd.join("\n");
  });

  const events = await readEvents(await startReview(app));
  const last = events.at(-1) as Extract<ReviewStreamEvent, { type: "findings" }>;
  expect(last.risk).toBeNull();
  expect(prompt).not.toContain("## Risk assessment");
});

const MENTION = {
  id: 3,
  user: { login: "bob" },
  body: "@acme/security please take a look",
  created_at: "2026-10-20T00:00:00Z",
  html_url: "https://github.com/o/r/pull/12#issuecomment-3",
};

function routedSettings(): Settings {
  const settings = defaultSettings();
  settings.autopilot.routing = [
    { repo: "", label: "", mention: "@acme/security", profileId: "security" },
  ];
  return settings;
}

test("完全自動運転の回で、コメントがルーティングのメンションに当たれば、そのプロファイルでレビューして返す", async () => {
  const { app, runner } = buildApp(
    JSON.stringify({ findings: [], risk: { level: "low", reasons: [] } }),
    { [ISSUE_COMMENTS]: ok(JSON.stringify(MENTION)) },
    routedSettings(),
  );
  let prompt = "";
  stubClaude(runner, (cmd) => {
    prompt = cmd[2] ?? "";
  });

  const events = await readEvents(await startReview(app, "abc123", { assessRisk: true }));
  const last = events.at(-1) as Extract<ReviewStreamEvent, { type: "findings" }>;
  expect(prompt).toContain("application security reviewer");
  expect(last.profileId).toBe("security");
});

test("ラベルでもルーティングでき、手で走らせた回はルーティングしない", async () => {
  const settings = defaultSettings();
  settings.autopilot.routing = [
    { repo: "", label: "security", mention: "", profileId: "security" },
  ];
  const { app, runner } = buildApp(
    JSON.stringify({ findings: [], risk: { level: "low", reasons: [] } }),
    {
      [`gh pr view 12 --repo o/r --json ${PR_FIELDS},headRefOid,baseRefOid,body,labels`]: ok(
        JSON.stringify({ ...RAW_PR, labels: [{ name: "security" }] }),
      ),
    },
    settings,
  );
  const prompts: string[] = [];
  stubClaude(runner, (cmd) => prompts.push(cmd[2] ?? ""));

  const auto = await readEvents(await startReview(app, "abc123", { assessRisk: true }));
  const manual = await readEvents(await startReview(app));
  expect(prompts[0]).toContain("application security reviewer");
  expect(prompts[1]).not.toContain("application security reviewer");
  expect((auto.at(-1) as Extract<ReviewStreamEvent, { type: "findings" }>).profileId).toBe(
    "security",
  );
  expect((manual.at(-1) as Extract<ReviewStreamEvent, { type: "findings" }>).profileId).toBe(
    "standard",
  );
});

test("規模の上限を 0 にすると、大きな PR でも AI レビューまで進める", async () => {
  const added = Array.from({ length: 1200 }, (_, i) => `+const c${i} = ${i};`).join("\n");
  const big = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1201 @@
 const a = 1;
${added}
`;
  const settings = defaultSettings();
  settings.autopilot.maxChangedLines = 0;
  const { app, runner } = buildApp(
    JSON.stringify({ findings: [], risk: { level: "low", reasons: [] } }),
    { "gh pr diff 12 --repo o/r": ok(big) },
    settings,
  );
  const claude: string[][] = [];
  stubClaude(runner, (cmd) => claude.push(cmd));

  const events = await readEvents(await startReview(app, "abc123", { assessRisk: true }));
  const last = events.at(-1) as Extract<ReviewStreamEvent, { type: "findings" }>;
  expect(claude).toHaveLength(1);
  expect(last.risk?.level).toBe("low");
});
