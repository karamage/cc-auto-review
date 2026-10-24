import { expect, test } from "bun:test";
import { FakeCommandRunner, ok } from "./exec.ts";
import { findAvailablePort, runPreflight } from "./preflight.ts";

const ALL_OK = {
  "gh --version": ok("gh version 2.60.0\n"),
  "gh auth status": ok("Logged in to github.com\n"),
  "claude --version": ok("2.0.0\n"),
};

test("すべて揃っていれば ok を返す（git リポジトリの中でなくてよい）", async () => {
  const result = await runPreflight(new FakeCommandRunner(ALL_OK));
  expect(result.ok).toBe(true);
  expect(result.messages).toEqual([]);
});

test("gh が無ければインストール方法を案内する", async () => {
  const runner = new FakeCommandRunner({
    ...ALL_OK,
    "gh --version": { stdout: "", stderr: "command not found", exitCode: 127 },
  });
  const result = await runPreflight(runner, "ja");
  expect(result.ok).toBe(false);
  expect(result.messages[0]).toContain("gh コマンドが見つかりません");
  expect(result.messages[0]).toContain("brew install gh");
});

test("gh が未認証なら gh auth login を案内する", async () => {
  const runner = new FakeCommandRunner({
    ...ALL_OK,
    "gh auth status": { stdout: "", stderr: "not logged in", exitCode: 1 },
  });
  const result = await runPreflight(runner, "ja");
  expect(result.ok).toBe(false);
  expect(result.messages[0]).toContain("gh auth login");
});

test("claude が無ければインストール方法を案内する", async () => {
  const runner = new FakeCommandRunner({
    ...ALL_OK,
    "claude --version": { stdout: "", stderr: "command not found", exitCode: 127 },
  });
  const result = await runPreflight(runner, "ja");
  expect(result.ok).toBe(false);
  expect(result.messages[0]).toContain("claude コマンドが見つかりません");
});

test("問題が複数あればすべて報告する", async () => {
  const runner = new FakeCommandRunner({
    ...ALL_OK,
    "gh auth status": { stdout: "", stderr: "", exitCode: 1 },
    "claude --version": { stdout: "", stderr: "", exitCode: 127 },
  });
  const result = await runPreflight(runner, "ja");
  expect(result.messages).toHaveLength(2);
});

test("使用中のポートを避けて空きを返す", async () => {
  const used = new Set([4711, 4712]);
  expect(await findAvailablePort(4711, async (port) => !used.has(port))).toBe(4713);
});

test("最初のポートが空いていればそれを使う", async () => {
  expect(await findAvailablePort(4711, async () => true)).toBe(4711);
});
