import { expect, test } from "bun:test";
import { parseCliArgs } from "./cli.ts";

const RUN: ReturnType<typeof parseCliArgs> = {
  kind: "run",
  port: null,
  desktop: false,
  clientDir: null,
  lang: null,
};

test("何も指定しなければ既定で起動する", () => {
  expect(parseCliArgs([])).toEqual(RUN);
});

test("--desktop、--port、--client-dir、--lang を読む", () => {
  expect(
    parseCliArgs(["--desktop", "--port", "0", "--client-dir=/app/ui", "--lang", "ja"]),
  ).toEqual({ kind: "run", port: 0, desktop: true, clientDir: "/app/ui", lang: "ja" });
});

test("--port の値が不正ならエラー", () => {
  expect(parseCliArgs(["--port", "abc"]).kind).toBe("error");
  expect(parseCliArgs(["--port", "70000"]).kind).toBe("error");
  expect(parseCliArgs(["--port"]).kind).toBe("error");
});

test("--lang の値が不正ならエラー", () => {
  expect(parseCliArgs(["--lang", "fr"]).kind).toBe("error");
});

test("先に --lang ja があれば、エラーは日本語で書く", () => {
  const result = parseCliArgs(["--lang", "ja", "--unknown"]);
  expect(result.kind === "error" && result.message).toContain("知らないオプション");
});

test("-h / --help は使い方を出す", () => {
  expect(parseCliArgs(["-h"]).kind).toBe("help");
  expect(parseCliArgs(["--help"]).kind).toBe("help");
});
