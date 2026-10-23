import { expect, test } from "bun:test";
import {
  type AnchoredFinding,
  type Finding,
  isReviewModel,
  nextReviewModel,
  parsePRInput,
} from "./types.ts";

test("Finding と AnchoredFinding が組み立てられる", () => {
  const finding: Finding = {
    id: "f1",
    path: "src/a.ts",
    line: 12,
    severity: "blocker",
    title: "null 参照",
    body: "user が null のとき落ちます",
    trigger: "未ログインで開いたとき",
    impact: "画面が真っ白になる",
  };
  const anchored: AnchoredFinding = { finding, anchor: "line", reason: null };
  expect(anchored.finding.severity).toBe("blocker");
  expect(anchored.anchor).toBe("line");
});

test("nextReviewModel は既定から各モデルを順に巡って既定に戻る", () => {
  expect(nextReviewModel(null)).toBe("opus");
  expect(nextReviewModel("opus")).toBe("sonnet");
  expect(nextReviewModel("sonnet")).toBe("haiku");
  expect(nextReviewModel("haiku")).toBeNull();
});

test("isReviewModel は決めた別名だけを通す", () => {
  expect(isReviewModel("sonnet")).toBe(true);
  expect(isReviewModel("claude-opus-5-5")).toBe(false);
  expect(isReviewModel(null)).toBe(false);
});

test("parsePRInput は PR の URL と owner/repo#番号 を読む", () => {
  const ref = { repo: "octo/hello.js", number: 42 };
  expect(parsePRInput("https://github.com/octo/hello.js/pull/42")).toEqual(ref);
  expect(parsePRInput("  https://github.com/octo/hello.js/pull/42/files?w=1#diff  ")).toEqual(ref);
  expect(parsePRInput("github.com/octo/hello.js/pull/42")).toEqual(ref);
  expect(parsePRInput("octo/hello.js#42")).toEqual(ref);
});

test("parsePRInput は PR 以外の指定を null にする", () => {
  expect(parsePRInput("")).toBeNull();
  expect(parsePRInput("https://github.com/octo/hello/issues/42")).toBeNull();
  expect(parsePRInput("https://github.com/octo/hello/pull/")).toBeNull();
  expect(parsePRInput("https://github.com/octo/hello/pull/0")).toBeNull();
  expect(parsePRInput("https://example.com/octo/hello/pull/42")).toBeNull();
  expect(parsePRInput("https://github.com/../hello/pull/42")).toBeNull();
  expect(parsePRInput("https://github.com/octo/hello/pull/42x")).toBeNull();
});
