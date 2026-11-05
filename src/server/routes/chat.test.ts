import { expect, test } from "bun:test";
import { defaultSettings } from "../../shared/settings.ts";
import type { ChatStreamEvent } from "../../shared/types.ts";
import { createApp } from "../app.ts";
import { FakeCommandRunner, ok } from "../exec.ts";
import { GitHubClient } from "../github/client.ts";
import { type FileReader, ReviewRunner } from "../reviewer/runner.ts";
import { Translator } from "../reviewer/translate.ts";
import { bunStaticFiles } from "../runtime/bun.ts";
import { type SnapshotFs, SnapshotManager } from "../snapshot/manager.ts";
import { inJapanese, memoryDeps } from "../store/memory.ts";

const PR_FIELDS =
  "number,title,author,headRefName,baseRefName,additions,deletions,changedFiles,updatedAt,url";
const RAW = "gh api -H Accept: application/vnd.github.raw";
const NOT_FOUND = { stderr: "gh: Not Found (HTTP 404)", exitCode: 1 };
const ROOT = "/tmp/advw/pr-o-r-12-1000";
const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
 const a = 1;
-const b = 2;
+const b = 3;
`;

class QueueFileReader implements FileReader {
  removed: string[] = [];
  constructor(private readonly contents: string[]) {}
  async read(): Promise<string> {
    return this.contents.shift() ?? "";
  }
  async remove(path: string): Promise<void> {
    this.removed.push(path);
  }
}

class MemoryFs implements SnapshotFs {
  removed: string[] = [];
  async write(): Promise<void> {}
  async makeDir(): Promise<void> {}
  async removeDir(path: string): Promise<void> {
    this.removed.push(path);
  }
  async list(): Promise<string[]> {
    return [];
  }
}

function buildApp(contents: string[]) {
  const runner = new FakeCommandRunner({
    [`gh pr view 12 --repo o/r --json ${PR_FIELDS},headRefOid,baseRefOid,body,labels,isDraft`]: ok(
      JSON.stringify({
        number: 12,
        title: "認証を直す",
        author: { login: "alice" },
        headRefName: "fix-auth",
        baseRefName: "main",
        additions: 1,
        deletions: 1,
        changedFiles: 1,
        updatedAt: "2026-07-20T10:00:00Z",
        url: "https://github.com/o/r/pull/12",
        headRefOid: "abc123",
        baseRefOid: "base999",
        body: "説明",
      }),
    ),
    "gh pr diff 12 --repo o/r": ok(PATCH),
    [`${RAW} repos/o/r/contents/src/a.ts?ref=abc123`]: ok("const a = 1;\nconst b = 3;\n"),
    [`${RAW} repos/o/r/contents/CLAUDE.md?ref=base999`]: NOT_FOUND,
    [`${RAW} repos/o/r/contents/AGENTS.md?ref=base999`]: NOT_FOUND,
    [`${RAW} repos/o/r/contents/REVIEW.md?ref=base999`]: NOT_FOUND,
  });
  const claudeCalls: string[][] = [];
  const claudeCwds: (string | undefined)[] = [];
  const original = runner.run.bind(runner);
  runner.run = async (cmd, opts) => {
    if (cmd[0] !== "claude") return await original(cmd, opts);
    claudeCalls.push(cmd);
    claudeCwds.push(opts?.cwd);
    return ok("");
  };
  const files = new QueueFileReader(contents);
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
      ...memoryDeps(defaultSettings()),
    }),
  );
  return { app, fs, files, claudeCalls, claudeCwds };
}

function ask(app: ReturnType<typeof buildApp>["app"], extra: Record<string, unknown> = {}) {
  return app.request("/api/repos/o/r/pulls/12/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      headSha: "abc123",
      question: "安全ですか",
      reference: null,
      history: [],
      findings: [],
      model: "default",
      profileId: null,
      ...extra,
    }),
  });
}

async function readEvents(res: Response): Promise<ChatStreamEvent[]> {
  return (await res.text())
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as ChatStreamEvent);
}

test("回答と、diff に対応づけた指摘案を返し、作業ディレクトリを消す", async () => {
  const { app, fs, files, claudeCalls, claudeCwds } = buildApp([
    JSON.stringify({
      answer: "問題があります",
      proposedFindings: [
        { path: "src/a.ts", line: 2, severity: "nit", title: "題", body: "本文" },
        { path: "src/a.ts", line: 999, severity: "nit", title: "外", body: "本文" },
      ],
    }),
  ]);

  const events = await readEvents(await ask(app));

  expect(events.map((e) => e.type)).toEqual(["snapshot_ready", "answering", "answer"]);
  const last = events[2] as Extract<ChatStreamEvent, { type: "answer" }>;
  expect(last.answer).toBe("問題があります");
  expect(last.proposals.map((p) => p.anchor)).toEqual(["line", "summary"]);
  expect(claudeCwds[0]).toBe(`${ROOT}/repo`);
  const args = claudeCalls[0]?.join(" ");
  expect(args).toContain(`Read,Grep,Glob,Edit(/${ROOT}/chat.json),Bash(remote-read:*)`);
  expect(args).toContain(`--add-dir ${ROOT}`);
  expect(args).toContain("--permission-mode dontAsk");
  expect(files.removed).toEqual([`${ROOT}/chat.json`]);
  expect(fs.removed).toEqual([ROOT]);
});

test("結果の形が崩れていれば 1 回だけ再実行する", async () => {
  const { app, claudeCalls } = buildApp(["壊れた結果", JSON.stringify({ answer: "回答" })]);
  const events = await readEvents(await ask(app));
  expect(events.at(-1)?.type).toBe("answer");
  expect(claudeCalls).toHaveLength(2);
});

test("再実行しても読めなければ error を返し、作業ディレクトリを消す", async () => {
  const { app, fs, claudeCalls } = buildApp(["壊れた結果", "壊れた結果"]);
  const events = await readEvents(await ask(app));
  expect(events.at(-1)?.type).toBe("error");
  expect(claudeCalls).toHaveLength(2);
  expect(fs.removed).toEqual([ROOT]);
});

test("head がずれていれば AI を呼ばずに error を返す", async () => {
  const { app, claudeCalls } = buildApp([]);
  const events = await readEvents(await ask(app, { headSha: "old" }));
  expect(events.map((e) => e.type)).toEqual(["error"]);
  expect(claudeCalls).toHaveLength(0);
});

test.each([
  ["空の質問", { question: "   " }],
  ["headSha なし", { headSha: "" }],
  ["知らないモデル", { model: "unknown" }],
])("%s は 400 を返す", async (_name, extra) => {
  const { app } = buildApp([]);
  expect((await ask(app, extra)).status).toBe(400);
});

test("不正な引用と履歴は捨てて実行する", async () => {
  const { app, claudeCalls } = buildApp([JSON.stringify({ answer: "回答" })]);
  await readEvents(
    await ask(app, {
      reference: { kind: "line", path: "a.ts", line: -1, side: "RIGHT" },
      history: [{ role: "system", text: "混入した発言" }],
    }),
  );
  const prompt = claudeCalls[0]?.[2] ?? "";
  expect(prompt).not.toContain("Referenced location");
  expect(prompt).not.toContain("混入した発言");
});
