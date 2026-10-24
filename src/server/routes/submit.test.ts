import { inJapanese, memoryDeps } from "../store/memory.ts";
import { expect, test } from "bun:test";
import { createApp } from "../app.ts";
import { FakeCommandRunner, ok } from "../exec.ts";
import { GitHubClient } from "../github/client.ts";
import { BunFileReader, ReviewRunner, type FileReader } from "../reviewer/runner.ts";
import { Translator } from "../reviewer/translate.ts";
import { SnapshotManager } from "../snapshot/manager.ts";
import { parseSubmitRequest } from "./submit.ts";
import { bunStaticFiles } from "../runtime/bun.ts";

const SUBMIT_CMD = "gh api --method POST repos/o/r/pulls/12/reviews --input -";
const STATE_CMD = "gh pr view 12 --repo o/r --json state,headRefOid,author,labels";

/** 投稿直前に確かめる PR の現在の head */
function prState(headRefOid: string, labels: string[] = []) {
  return ok(
    JSON.stringify({
      state: "OPEN",
      headRefOid,
      author: { login: "alice" },
      labels: labels.map((name) => ({ name })),
    }),
  );
}

/** 英訳の結果ファイルを、実際に書き出さずに返す */
class StubFileReader implements FileReader {
  constructor(private readonly content: string) {}
  async read(): Promise<string> {
    return this.content;
  }
  async remove(): Promise<void> {}
}

function appWith(
  responses: Record<string, Partial<import("../exec.ts").CommandResult>>,
  translationJson = "{}",
) {
  const runner = new FakeCommandRunner({ [STATE_CMD]: prState("abc123"), ...responses });
  const app = inJapanese(
    createApp({
      github: new GitHubClient(runner),
      snapshots: new SnapshotManager(new GitHubClient(runner), "/tmp/advw"),
      reviewer: new ReviewRunner(runner, new BunFileReader(), "remote-read"),
      remoteReadCommand: "remote-read",
      translator: new Translator(runner, new StubFileReader(translationJson)),
      clientDir: "./dist/client",
      staticFiles: bunStaticFiles,
      ...memoryDeps(),
    }),
  );
  return { app, runner };
}

function post(app: ReturnType<typeof createApp>, body: unknown): Response | Promise<Response> {
  return app.request("/api/repos/o/r/pulls/12/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("採用したコメントを gh 経由で 1 回だけ投稿する", async () => {
  const { app, runner } = appWith({
    [SUBMIT_CMD]: ok(
      JSON.stringify({
        id: 99,
        html_url: "https://github.com/o/r/pull/12#pullrequestreview-99",
        submitted_at: "2026-10-06T01:00:00Z",
      }),
    ),
  });
  const res = await post(app, {
    event: "REQUEST_CHANGES",
    body: "総評",
    commitId: "abc123",
    comments: [{ findingId: "f1", path: "src/a.ts", line: 2, body: "危ない", anchor: "line" }],
  });

  expect(res.status).toBe(200);
  // 投稿できたことを画面に残せるよう、GitHub 上のレビューの場所と時刻を返す
  expect(await res.json()).toEqual({
    review: {
      url: "https://github.com/o/r/pull/12#pullrequestreview-99",
      submittedAt: "2026-10-06T01:00:00Z",
    },
  });
  // 投稿の直前に head を確かめてから、1 回だけ投稿する
  expect(runner.calls.map((c) => c.join(" "))).toEqual([STATE_CMD, SUBMIT_CMD]);
  expect(JSON.parse(runner.stdins.at(-1) as string)).toEqual({
    event: "REQUEST_CHANGES",
    body: "総評",
    commit_id: "abc123",
    comments: [{ path: "src/a.ts", body: "危ない", line: 2, side: "RIGHT" }],
  });
});

test("本文が空でもコメントがあれば既定の本文を補って投稿する", async () => {
  // GitHub は APPROVE 以外で body 必須。空のまま送ると 422 になる
  const { app, runner } = appWith({ [SUBMIT_CMD]: ok("{}") });
  const res = await post(app, {
    event: "COMMENT",
    body: "",
    commitId: "abc123",
    language: "ja",
    comments: [{ findingId: "f1", path: "src/a.ts", line: 2, body: "危ない", anchor: "line" }],
  });

  expect(res.status).toBe(200);
  expect(JSON.parse(runner.stdins.at(-1) as string).body).toBe("AI レビューの指摘 1 件です。");
});

test("完全自動運転の投稿は、直前に skip-ai-review ラベルが付いていれば 409 と印を返して投稿しない", async () => {
  const { app, runner } = appWith({ [STATE_CMD]: prState("abc123", ["skip-ai-review"]) });
  const res = await post(app, {
    event: "APPROVE",
    body: "",
    commitId: "abc123",
    comments: [],
    autopilot: true,
  });

  expect(res.status).toBe(409);
  expect(((await res.json()) as { code?: string }).code).toBe("skip-review");
  expect(runner.calls.map((c) => c.join(" "))).toEqual([STATE_CMD]);
});

test("人が画面から投稿するときは、skip-ai-review ラベルが付いていても投稿する", async () => {
  const { app } = appWith({
    [STATE_CMD]: prState("abc123", ["skip-ai-review"]),
    [SUBMIT_CMD]: ok(
      JSON.stringify({ id: 1, html_url: null, submitted_at: "2026-10-06T01:00:00Z" }),
    ),
  });
  const res = await post(app, { event: "APPROVE", body: "", commitId: "abc123", comments: [] });
  expect(res.status).toBe(200);
});

test("event が不正なら 400 を返し、gh を呼ばない", async () => {
  const { app, runner } = appWith({});
  const res = await post(app, { event: "MERGE", body: "", commitId: "abc123", comments: [] });
  expect(res.status).toBe(400);
  expect((await res.json()).message).toBe("レビュー種別（event）が不正です");
  expect(runner.calls).toEqual([]);
});

test("commitId が無ければ 400 を返す", async () => {
  const { app } = appWith({});
  const res = await post(app, { event: "APPROVE", body: "LGTM", comments: [] });
  expect(res.status).toBe(400);
  expect((await res.json()).message).toBe("対象コミット（commitId）が指定されていません");
});

test("本文もコメントも空の COMMENT は 400 で弾く", async () => {
  const { app } = appWith({});
  const res = await post(app, { event: "COMMENT", body: "  ", commitId: "abc123", comments: [] });
  expect(res.status).toBe(400);
  expect((await res.json()).message).toBe("本文もコメントも空のレビューは投稿できません");
});

test("本文もコメントも空でも APPROVE は通す", async () => {
  const { app } = appWith({ [SUBMIT_CMD]: ok("{}") });
  const res = await post(app, { event: "APPROVE", body: "", commitId: "abc123", comments: [] });
  expect(res.status).toBe(200);
});

test("gh が 422 を返したら 500 と detail を返す", async () => {
  const { app } = appWith({
    [SUBMIT_CMD]: { stdout: "", stderr: "HTTP 422: line must be part of the diff", exitCode: 1 },
  });
  const res = await post(app, {
    event: "APPROVE",
    body: "LGTM",
    commitId: "abc123",
    comments: [],
  });
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({
    message: "レビューの投稿に失敗しました",
    detail: "HTTP 422: line must be part of the diff",
  });
});

test("parseSubmitRequest は空のコメント本文を弾く", () => {
  expect(() =>
    parseSubmitRequest({
      event: "COMMENT",
      body: "総評",
      commitId: "abc123",
      comments: [{ findingId: "f1", path: "a.ts", line: 1, body: "   ", anchor: "line" }],
    }),
  ).toThrow("1 件目のコメント本文が空です");
});

test("parseSubmitRequest は anchor の不正を弾く", () => {
  expect(() =>
    parseSubmitRequest({
      event: "COMMENT",
      body: "総評",
      commitId: "abc123",
      comments: [{ findingId: "f1", path: "a.ts", line: 1, body: "本文", anchor: "file" }],
    }),
  ).toThrow("1 件目のコメントの anchor が不正です");
});

test("language が en なら英訳してから投稿する", async () => {
  const { app, runner } = appWith(
    { [SUBMIT_CMD]: ok("{}") },
    JSON.stringify({ texts: ["Overall looks good", "This can be null"] }),
  );
  const original = runner.run.bind(runner);
  runner.run = async (cmd, opts) => (cmd[0] === "claude" ? ok("") : original(cmd, opts));

  const res = await post(app, {
    event: "COMMENT",
    body: "全体として良いです",
    commitId: "abc123",
    language: "en",
    sourceLanguage: "ja",
    comments: [
      { findingId: "f1", path: "src/a.ts", line: 2, body: "null になり得ます", anchor: "line" },
    ],
  });

  expect(res.status).toBe(200);
  const payload = JSON.parse(runner.stdins.at(-1) as string);
  expect(payload.body).toBe("Overall looks good");
  expect(payload.comments[0].body).toBe("This can be null");
});

test("英訳の件数がずれたら投稿しない", async () => {
  const { app, runner } = appWith(
    { [SUBMIT_CMD]: ok("{}") },
    JSON.stringify({ texts: ["only one"] }),
  );
  const original = runner.run.bind(runner);
  runner.run = async (cmd, opts) => (cmd[0] === "claude" ? ok("") : original(cmd, opts));

  const res = await post(app, {
    event: "COMMENT",
    body: "総評",
    commitId: "abc123",
    language: "en",
    sourceLanguage: "ja",
    comments: [{ findingId: "f1", path: "src/a.ts", line: 2, body: "危ない", anchor: "line" }],
  });

  expect(res.status).toBe(500);
  expect(runner.calls.map((c) => c.join(" "))).not.toContain(SUBMIT_CMD);
});

test("language が en でも日本語のまま投稿されない（claude を必ず経由する）", async () => {
  const { app, runner } = appWith(
    { [SUBMIT_CMD]: ok("{}") },
    JSON.stringify({ texts: ["Overall looks good"] }),
  );
  let translated = false;
  const original = runner.run.bind(runner);
  runner.run = async (cmd, opts) => {
    if (cmd[0] !== "claude") return original(cmd, opts);
    translated = true;
    return ok("");
  };

  await post(app, {
    event: "COMMENT",
    body: "全体として良いです",
    commitId: "abc123",
    language: "en",
    sourceLanguage: "ja",
    comments: [],
  });

  expect(translated).toBe(true);
});

test("language の指定が無ければ en として扱う", () => {
  const request = parseSubmitRequest({
    event: "COMMENT",
    body: "総評",
    commitId: "abc123",
    comments: [],
  });
  expect(request.language).toBe("en");
});

test("language が未知の値なら en に倒す", () => {
  const request = parseSubmitRequest({
    event: "COMMENT",
    body: "総評",
    commitId: "abc123",
    comments: [],
    language: "fr",
  });
  expect(request.language).toBe("en");
});

test("lgtm の指定が無ければ画像を添えない", () => {
  const request = parseSubmitRequest({
    event: "APPROVE",
    body: "",
    commitId: "abc123",
    comments: [],
  });
  expect(request.lgtm).toBe("none");
});

test("lgtm に一覧にない画像を指定したら弾く", () => {
  expect(() =>
    parseSubmitRequest({
      event: "APPROVE",
      body: "",
      commitId: "abc123",
      comments: [],
      lgtm: 1,
    }),
  ).toThrow("LGTM 画像（lgtm）の指定が不正です");
});

test("レビューした後に head が変わっていたら 409 を返し、投稿しない", async () => {
  const { app, runner } = appWith({ [STATE_CMD]: prState("def456"), [SUBMIT_CMD]: ok("{}") });
  const res = await post(app, {
    event: "APPROVE",
    body: "",
    commitId: "abc123",
    comments: [],
  });

  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.message).toContain("投稿は取りやめました");
  expect(body.detail).toBe("レビューしたコミット abc123 / 現在の head def456");
  expect(runner.calls.map((c) => c.join(" "))).not.toContain(SUBMIT_CMD);
});

test("英語で書いた指摘を英語で投稿するなら訳さない", async () => {
  const { app, runner } = appWith({ [SUBMIT_CMD]: ok("{}") });
  const res = await post(app, {
    event: "COMMENT",
    body: "Looks good overall",
    commitId: "abc123",
    language: "en",
    sourceLanguage: "en",
    comments: [],
  });

  expect(res.status).toBe(200);
  expect(runner.calls.some((c) => c[0] === "claude")).toBe(false);
  expect(JSON.parse(runner.stdins.at(-1) as string).body).toBe("Looks good overall");
});

test("英語で書いた指摘を日本語で投稿するなら、日本語に訳す", async () => {
  const { app, runner } = appWith(
    { [SUBMIT_CMD]: ok("{}") },
    JSON.stringify({ texts: ["全体として良いです"] }),
  );
  const prompts: string[] = [];
  const original = runner.run.bind(runner);
  runner.run = async (cmd, opts) => {
    if (cmd[0] !== "claude") return original(cmd, opts);
    prompts.push(cmd[2] as string);
    return ok("");
  };

  await post(app, {
    event: "COMMENT",
    body: "Looks good overall",
    commitId: "abc123",
    language: "ja",
    sourceLanguage: "en",
    comments: [],
  });

  expect(prompts[0]).toContain("日本語に翻訳");
  expect(JSON.parse(runner.stdins.at(-1) as string).body).toBe("全体として良いです");
});

test("Accept-Language が英語なら、入力の誤りを英語で返す", async () => {
  const { app } = appWith({});
  const res = await app.request("/api/repos/o/r/pulls/12/submit", {
    method: "POST",
    headers: { "content-type": "application/json", "accept-language": "en" },
    body: JSON.stringify({ event: "COMMENT", body: "", commitId: "abc123", comments: [] }),
  });

  expect(res.status).toBe(400);
  expect((await res.json()).message).toBe(
    "A review with neither a body nor comments cannot be posted",
  );
});
