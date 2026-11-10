import { expect, test } from "bun:test";
import { createApp } from "../app.ts";
import { FakeCommandRunner } from "../exec.ts";
import { GitHubClient } from "../github/client.ts";
import { BunFileReader, ReviewRunner } from "../reviewer/runner.ts";
import { Translator } from "../reviewer/translate.ts";
import { bunStaticFiles } from "../runtime/bun.ts";
import { SnapshotManager } from "../snapshot/manager.ts";
import { inJapanese, memoryDeps } from "../store/memory.ts";

function buildApp() {
  const runner = new FakeCommandRunner({});
  const deps = memoryDeps();
  const app = inJapanese(
    createApp({
      github: new GitHubClient(runner),
      snapshots: new SnapshotManager(new GitHubClient(runner), "/tmp/ccar"),
      reviewer: new ReviewRunner(runner, new BunFileReader(), "remote-read"),
      remoteReadCommand: "remote-read",
      translator: new Translator(runner, new BunFileReader()),
      clientDir: "./dist/client",
      staticFiles: bunStaticFiles,
      ...deps,
    }),
  );
  return { app, deps };
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

test("書き足して、一覧に載り、直して、消せる", async () => {
  const { app } = buildApp();
  const created = await app.request("/api/learnings", json("POST", { repo: "O/R", text: "学び" }));
  expect(created.status).toBe(200);
  const item = (await created.json()) as { id: number; repo: string; status: string };
  expect(item).toMatchObject({ repo: "o/r", status: "active" });

  const list = (await (await app.request("/api/learnings")).json()) as { learnings: unknown[] };
  expect(list.learnings).toHaveLength(1);

  const updated = await app.request(
    `/api/learnings/${item.id}`,
    json("PUT", { text: "直した", pinned: true }),
  );
  expect(await updated.json()).toMatchObject({ text: "直した", pinned: true });

  expect((await app.request(`/api/learnings/${item.id}`, { method: "DELETE" })).status).toBe(204);
  expect((await app.request(`/api/learnings/${item.id}`, { method: "DELETE" })).status).toBe(404);
});

test("候補を採用できる", async () => {
  const { app, deps } = buildApp();
  await deps.learnings.addCandidates("o/r", 1, ["候補"]);
  const [candidate] = await deps.learnings.list();
  const res = await app.request(`/api/learnings/${candidate!.id}`, json("PUT", { adopt: true }));
  expect(await res.json()).toMatchObject({ status: "active", inPrompt: true });
});

test("入力の誤りは日本語のメッセージで 400 を返す", async () => {
  const { app } = buildApp();
  const empty = await app.request("/api/learnings", json("POST", { repo: "o/r", text: " " }));
  expect(empty.status).toBe(400);
  expect(((await empty.json()) as { message: string }).message).toBe("学びの本文が空です");
  for (const body of [{ repo: "o/r" }, { repo: 1, text: "a" }, null]) {
    expect((await app.request("/api/learnings", json("POST", body))).status).toBe(400);
  }
  for (const body of [{}, { text: 1 }, { pinned: "yes" }, { adopt: 1 }, null]) {
    expect((await app.request("/api/learnings/1", json("PUT", body))).status).toBe(400);
  }
  expect((await app.request("/api/learnings/abc", json("PUT", { pinned: true }))).status).toBe(404);
});

test("リセットは repo ごと、または全部を消す", async () => {
  const { app, deps } = buildApp();
  await deps.learnings.add("o/a", "1");
  await deps.learnings.add("o/b", "2");
  await deps.learnings.add("o/c", "3");
  const one = await app.request("/api/learnings/reset", json("POST", { repo: "o/a" }));
  expect(await one.json()).toEqual({ removed: 1 });
  const all = await app.request("/api/learnings/reset", json("POST", {}));
  expect(await all.json()).toEqual({ removed: 2 });
  expect((await app.request("/api/learnings/reset", json("POST", { repo: 1 }))).status).toBe(400);
});
