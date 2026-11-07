import { expect, test } from "bun:test";
import { FakeCommandRunner } from "./exec.ts";
import { appleScriptString, OsSystemActions } from "./system.ts";

test("AppleScript の文字列に、引用符とバックスラッシュを逃がして埋め込む", () => {
  expect(appleScriptString('say "hi" \\ bye')).toBe('"say \\"hi\\" \\\\ bye"');
});

test("Linux では notify-send で通知し、タイトルが - で始まってもオプションにしない", async () => {
  const cmd = "notify-send --app-name=CC Auto Review -- -title body";
  const runner = new FakeCommandRunner({ [cmd]: {} });
  await new OsSystemActions(runner, "linux").notify("-title", "body");
  expect(runner.calls).toEqual([
    ["notify-send", "--app-name=CC Auto Review", "--", "-title", "body"],
  ]);
});

test("notify-send が無くても通知で失敗しない", async () => {
  const runner = new FakeCommandRunner({
    "notify-send --app-name=CC Auto Review -- t b": { exitCode: 127 },
  });
  await expect(new OsSystemActions(runner, "linux").notify("t", "b")).resolves.toBeUndefined();
});

test("macOS では osascript で通知する", async () => {
  const cmd = 'osascript -e display notification "b" with title "t"';
  const runner = new FakeCommandRunner({ [cmd]: {} });
  await new OsSystemActions(runner, "darwin").notify("t", "b");
  expect(runner.calls[0]?.[0]).toBe("osascript");
});

test("Linux では xdg-open で URL を開く", async () => {
  const runner = new FakeCommandRunner({ "xdg-open https://example.com": {} });
  await new OsSystemActions(runner, "linux").openUrl("https://example.com");
  expect(runner.calls).toEqual([["xdg-open", "https://example.com"]]);
});
