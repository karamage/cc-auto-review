import { expect, test } from "bun:test";
import { FakeCommandRunner, ok } from "../exec.ts";
import type { FileReader } from "./runner.ts";
import { buildTranslatePrompt, parseTranslations, Translator } from "./translate.ts";

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

test("プロンプトに原文と件数と出力先が含まれる", () => {
  const prompt = buildTranslatePrompt(["危ない", "テストが無い"], "/tmp/out.json", "en");
  expect(prompt).toContain("危ない");
  expect(prompt).toContain("テストが無い");
  expect(prompt).toContain("2 件");
  expect(prompt).toContain("/tmp/out.json");
  expect(prompt).toContain("英語に翻訳");
});

test("日本語へ訳すこともできる", () => {
  expect(buildTranslatePrompt(["Dangerous"], "/tmp/out.json", "ja")).toContain("日本語に翻訳");
});

test("texts を順序どおり取り出す", () => {
  expect(parseTranslations(JSON.stringify({ texts: ["a", "b"] }), 2)).toEqual(["a", "b"]);
});

test("件数が合わなければ失敗させる", () => {
  expect(() => parseTranslations(JSON.stringify({ texts: ["a"] }), 2)).toThrow(
    "翻訳結果の件数が一致しません",
  );
});

test("texts が無ければ失敗させる", () => {
  expect(() => parseTranslations(JSON.stringify({ result: "a" }), 1)).toThrow(
    "翻訳結果に texts 配列が含まれていません",
  );
});

test("空配列なら claude を呼ばない", async () => {
  const runner = new FakeCommandRunner({});
  const files = new StubFileReader("{}");
  expect(await new Translator(runner, files).translate([], "en")).toEqual([]);
  expect(runner.calls).toEqual([]);
});

test("結果ファイルは成功しても消す", async () => {
  const runner = new FakeCommandRunner({});
  const files = new StubFileReader(JSON.stringify({ texts: ["danger"] }));
  const original = runner.run.bind(runner);
  runner.run = async (cmd, opts) => (cmd[0] === "claude" ? ok("") : original(cmd, opts));

  const translator = new Translator(runner, files, 1000, () => 1000);
  expect(await translator.translate(["危ない"], "en")).toEqual(["danger"]);
  expect(files.removed).toHaveLength(1);
});

test("claude が異常終了したら stderr を detail に含めて投げる", async () => {
  const runner = new FakeCommandRunner({});
  const files = new StubFileReader("{}");
  const original = runner.run.bind(runner);
  runner.run = async (cmd, opts) =>
    cmd[0] === "claude"
      ? { stdout: "", stderr: "not found", exitCode: 127, timedOut: false }
      : original(cmd, opts);

  expect(new Translator(runner, files).translate(["危ない"], "en")).rejects.toThrow(
    "翻訳の実行に失敗しました（終了コード 127）",
  );
});
