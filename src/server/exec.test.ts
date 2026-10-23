import { expect, test } from "bun:test";
import { BunCommandRunner, FakeCommandRunner, ok } from "./exec.ts";

test("FakeCommandRunner は登録した応答を返し、呼び出しを記録する", async () => {
  const runner = new FakeCommandRunner({ "echo hi": ok("hi\n") });
  const result = await runner.run(["echo", "hi"]);
  expect(result.stdout).toBe("hi\n");
  expect(result.exitCode).toBe(0);
  expect(runner.calls).toEqual([["echo", "hi"]]);
});

test("FakeCommandRunner は未登録のコマンドで例外を投げる", async () => {
  const runner = new FakeCommandRunner({});
  await expect(runner.run(["gh", "pr", "list"])).rejects.toThrow(
    "FakeCommandRunner: unregistered command: gh pr list",
  );
});

test("FakeCommandRunner は渡された stdin と cwd を記録する", async () => {
  const runner = new FakeCommandRunner({ "gh api": ok("{}") });
  await runner.run(["gh", "api"], { stdin: '{"a":1}', cwd: "/repo" });
  expect(runner.stdins).toEqual(['{"a":1}']);
  expect(runner.cwds).toEqual(["/repo"]);
});

test("BunCommandRunner は標準出力と終了コードを返す", async () => {
  const runner = new BunCommandRunner();
  const result = await runner.run(["echo", "hello"]);
  expect(result.stdout.trim()).toBe("hello");
  expect(result.exitCode).toBe(0);
  expect(result.timedOut).toBe(false);
});

test("BunCommandRunner は stdin を子プロセスに渡す", async () => {
  const runner = new BunCommandRunner();
  const result = await runner.run(["cat"], { stdin: "from stdin" });
  expect(result.stdout).toBe("from stdin");
});

test("BunCommandRunner はタイムアウトで timedOut を立てる", async () => {
  const runner = new BunCommandRunner();
  const result = await runner.run(["sleep", "5"], { timeoutMs: 100 });
  expect(result.timedOut).toBe(true);
});

test("BunCommandRunner は実行ファイルが無い場合、例外ではなく終了コード 127 を返す", async () => {
  const runner = new BunCommandRunner();
  const result = await runner.run(["definitely-not-a-real-command-xyz"]);
  expect(result.exitCode).toBe(127);
  expect(result.stderr).not.toBe("");
});
