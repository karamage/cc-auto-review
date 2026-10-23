import { expect, test } from "bun:test";
import type { Finding } from "../../shared/types.ts";
import { parseUnifiedDiff } from "./parse.ts";
import { anchorFindings, buildCommentableLines } from "./anchor.ts";

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,5 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;
`;

const FILES = parseUnifiedDiff(PATCH);

function finding(overrides: Partial<Finding>): Finding {
  return {
    id: "f1",
    path: "src/a.ts",
    line: 2,
    severity: "should",
    title: "題",
    body: "本文",
    trigger: "",
    impact: "",
    ...overrides,
  };
}

test("追加行と context 行がコメント可能な行になる", () => {
  const map = buildCommentableLines(FILES);
  // 変更後: 1=context, 2=add, 3=add, 4=context
  expect([...(map.get("src/a.ts") ?? [])].sort((x, y) => x - y)).toEqual([1, 2, 3, 4]);
});

test("削除行しか持たない行番号はコメント可能に含まれない", () => {
  const patch = `diff --git a/src/x.ts b/src/x.ts
index 1111111..2222222 100644
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,2 +1,1 @@
 keep
-gone
`;
  const map = buildCommentableLines(parseUnifiedDiff(patch));
  expect([...(map.get("src/x.ts") ?? [])]).toEqual([1]);
});

test("diff 内の行を指す指摘は line アンカーになる", () => {
  const [result] = anchorFindings([finding({ line: 3 })], FILES);
  expect(result!.anchor).toBe("line");
  expect(result!.reason).toBeNull();
});

test("diff 外の行を指す指摘は summary に降格し理由が付く", () => {
  const [result] = anchorFindings([finding({ line: 99 })], FILES);
  expect(result!.anchor).toBe("summary");
  expect(result!.reason).toBe(
    "src/a.ts:99 はこの PR の diff に含まれていないため、レビュー本文にまとめました",
  );
});

test("行が未指定の指摘は summary に降格する", () => {
  const [result] = anchorFindings([finding({ line: null })], FILES);
  expect(result!.anchor).toBe("summary");
  expect(result!.reason).toBe("行が指定されていないため、レビュー本文にまとめました");
});

test("変更されていないファイルを指す指摘は summary に降格する", () => {
  const [result] = anchorFindings([finding({ path: "src/other.ts", line: 5 })], FILES);
  expect(result!.anchor).toBe("summary");
  expect(result!.reason).toBe(
    "src/other.ts はこの PR の変更ファイルに含まれていないため、レビュー本文にまとめました",
  );
});

test("バイナリファイルを指す指摘は summary に降格する", () => {
  const patch = `diff --git a/logo.png b/logo.png
index 1111111..2222222 100644
Binary files a/logo.png and b/logo.png differ
`;
  const [result] = anchorFindings(
    [finding({ path: "logo.png", line: 1 })],
    parseUnifiedDiff(patch),
  );
  expect(result!.anchor).toBe("summary");
  expect(result!.reason).toBe("logo.png はバイナリファイルのため、レビュー本文にまとめました");
});

test("入力の順序を保ったまま返す", () => {
  const results = anchorFindings(
    [finding({ id: "a", line: 2 }), finding({ id: "b", line: 99 }), finding({ id: "c", line: 3 })],
    FILES,
  );
  expect(results.map((r) => r.finding.id)).toEqual(["a", "b", "c"]);
  expect(results.map((r) => r.anchor)).toEqual(["line", "summary", "line"]);
});

test("line アンカーになった指摘の reason は必ず null、summary は必ず非 null", () => {
  const results = anchorFindings(
    [finding({ id: "a", line: 2 }), finding({ id: "b", line: 99 })],
    FILES,
  );
  expect(results[0]!.reason).toBeNull();
  expect(results[1]!.reason).not.toBeNull();
});

test("英語の画面には、本文にまとめた理由も英語で返す", () => {
  const [result] = anchorFindings([finding({ line: null })], FILES, "en");
  expect(result?.reason).toBe("Moved to the review body because no line was given");
});
