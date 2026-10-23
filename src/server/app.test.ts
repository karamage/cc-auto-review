import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { memoryDeps } from "./store/memory.ts";
import { createApp } from "./app.ts";
import { FakeCommandRunner } from "./exec.ts";
import { GitHubClient } from "./github/client.ts";
import { BunFileReader, ReviewRunner } from "./reviewer/runner.ts";
import { Translator } from "./reviewer/translate.ts";
import { SnapshotManager } from "./snapshot/manager.ts";

// serveStatic の root/path 指定を検証するため、実ビルド成果物には依存せず
// ダミーのクライアントディレクトリを用意する
let clientDir: string;

beforeAll(async () => {
  clientDir = await mkdtemp(join(tmpdir(), "advw-client-"));
  await writeFile(join(clientDir, "index.html"), "<!doctype html><html><body>app</body></html>");
  await mkdir(join(clientDir, "assets"));
  await writeFile(join(clientDir, "assets", "app.js"), "console.log('hi');");
});

afterAll(async () => {
  await rm(clientDir, { recursive: true, force: true });
});

function app() {
  const runner = new FakeCommandRunner({});
  return createApp({
    github: new GitHubClient(runner),
    snapshots: new SnapshotManager(new GitHubClient(runner), "/tmp/advw"),
    reviewer: new ReviewRunner(runner, new BunFileReader(), "remote-read"),
    remoteReadCommand: "remote-read",
    translator: new Translator(runner, new BunFileReader()),
    clientDir,
    ...memoryDeps(),
  });
}

test("未知のパスは index.html にフォールバックする（SPA ルーティング）", async () => {
  const res = await app().request("/some/unknown/route");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(await res.text()).toContain("app");
});

test("既知の静的ファイルはそのまま配信される", async () => {
  const res = await app().request("/assets/app.js");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("javascript");
});
