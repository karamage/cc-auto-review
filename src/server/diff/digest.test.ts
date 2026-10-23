import { expect, test } from "bun:test";
import { diffDigest } from "./digest.ts";
import { parseUnifiedDiff } from "./parse.ts";

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,3 +10,3 @@ function a() {
 const x = 1;
-const y = 2;
+const y = 3;
 const z = 4;
`;

/** base を取り込んで、同じ変更の位置と前後の行がずれた diff */
const MERGED_BASE = `diff --git a/src/a.ts b/src/a.ts
index 3333333..4444444 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -20,3 +20,3 @@ function a() {
 const x = 10;
-const y = 2;
+const y = 3;
 const z = 4;
`;

const LOCK = `diff --git a/bun.lock b/bun.lock
index 5555555..6666666 100644
--- a/bun.lock
+++ b/bun.lock
@@ -1,1 +1,1 @@
-"a": "1.0.0"
+"a": "1.0.1"
`;

function digest(patch: string): string {
  return diffDigest(parseUnifiedDiff(patch));
}

test("変更の位置や前後の行がずれただけなら、要約は変わらない", () => {
  expect(digest(MERGED_BASE)).toBe(digest(PATCH));
});

test("追加・削除した行の中身が変われば、要約も変わる", () => {
  expect(digest(PATCH.replace("+const y = 3;", "+const y = 5;"))).not.toBe(digest(PATCH));
  expect(digest(PATCH.replaceAll("src/a.ts", "src/b.ts"))).not.toBe(digest(PATCH));
});

test("ロックファイルの変更は数えない", () => {
  expect(digest(PATCH + LOCK)).toBe(digest(PATCH));
});
