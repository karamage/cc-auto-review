import { expect, test } from "bun:test";
import { appleScriptString } from "./system.ts";

test("AppleScript の文字列に、引用符とバックスラッシュを逃がして埋め込む", () => {
  expect(appleScriptString('say "hi" \\ bye')).toBe('"say \\"hi\\" \\\\ bye"');
});
