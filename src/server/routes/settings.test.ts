import { expect, test } from "bun:test";
import { defaultSettings } from "../../shared/settings.ts";
import { createApp } from "../app.ts";
import { FakeCommandRunner } from "../exec.ts";
import { GitHubClient } from "../github/client.ts";
import { BunFileReader, ReviewRunner } from "../reviewer/runner.ts";
import { Translator } from "../reviewer/translate.ts";
import { SnapshotManager } from "../snapshot/manager.ts";
import { memoryDeps } from "../store/memory.ts";

function buildApp(token: string | null = null) {
  const runner = new FakeCommandRunner({});
  const deps = memoryDeps();
  const app = createApp({
    github: new GitHubClient(runner),
    snapshots: new SnapshotManager(new GitHubClient(runner), "/tmp/ccar"),
    reviewer: new ReviewRunner(runner, new BunFileReader(), "remote-read"),
    remoteReadCommand: "remote-read",
    translator: new Translator(runner, new BunFileReader()),
    clientDir: "./dist/client",
    token,
    ...deps,
  });
  return { app, ...deps };
}

const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

test("設定を読み、検証してから保存する", async () => {
  const { app } = buildApp();
  expect(await (await app.request("/api/settings")).json()).toEqual(defaultSettings());

  const res = await app.request(
    "/api/settings",
    json({ ...defaultSettings(), timeoutMinutes: 999 }, "PUT"),
  );
  expect(res.status).toBe(200);
  expect(((await res.json()) as { timeoutMinutes: number }).timeoutMinutes).toBe(60);
  expect(
    ((await (await app.request("/api/settings")).json()) as { timeoutMinutes: number })
      .timeoutMinutes,
  ).toBe(60);
});

test("保存前の設定で、プロファイルのプロンプトを確かめられる", async () => {
  const { app } = buildApp();
  const settings = defaultSettings();
  settings.profiles[0]!.instructions = "Check the glossary";
  const res = await app.request("/api/settings/preview", json({ settings, profileId: "standard" }));
  const { prompt } = (await res.json()) as { prompt: string };
  expect(prompt).toContain("Check the glossary");
  expect(prompt).toContain("remote-read cat <path>");
});

test("画面の状態は決めたキーだけを保存する", async () => {
  const { app, state } = buildApp();
  expect((await app.request("/api/state/sessions", { method: "PUT", body: "{}" })).status).toBe(
    204,
  );
  expect(state.data.get("sessions")).toBe("{}");
  expect(await (await app.request("/api/state/sessions")).json()).toEqual({ data: "{}" });
  expect((await app.request("/api/state/../../etc", { method: "PUT", body: "x" })).status).toBe(
    404,
  );
  expect((await app.request("/api/state/other")).status).toBe(404);
});

test("外部の URL は http(s) だけを開き、通知は OS に頼む", async () => {
  const { app, system } = buildApp();
  expect(
    (await app.request("/api/system/open", json({ url: "https://github.com/o/r/pull/1" }))).status,
  ).toBe(204);
  expect((await app.request("/api/system/open", json({ url: "file:///etc/passwd" }))).status).toBe(
    400,
  );
  expect(system.opened).toEqual(["https://github.com/o/r/pull/1"]);

  await app.request("/api/system/notify", json({ title: "T", body: "B" }));
  expect(system.notified).toEqual([{ title: "T", body: "B" }]);
});

test("合言葉があれば、ヘッダに載せたリクエストだけを通す", async () => {
  const { app } = buildApp("secret");
  expect((await app.request("/api/settings")).status).toBe(403);
  expect(
    (await app.request("/api/settings", { headers: { "x-cc-auto-review-token": "wrong" } })).status,
  ).toBe(403);
  expect(
    (await app.request("/api/settings", { headers: { "x-cc-auto-review-token": "secret" } }))
      .status,
  ).toBe(200);
});
