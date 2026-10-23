import { expect, test } from "bun:test";
import { parseUnifiedDiff, unquoteGitPath } from "./parse.ts";

const MODIFIED = `diff --git a/src/a.ts b/src/a.ts
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

test("変更ファイルの hunk と行番号を解析する", () => {
  const files = parseUnifiedDiff(MODIFIED);
  expect(files).toHaveLength(1);

  const file = files[0]!;
  expect(file.path).toBe("src/a.ts");
  expect(file.status).toBe("modified");
  expect(file.isBinary).toBe(false);
  expect(file.hunks).toHaveLength(1);

  const hunk = file.hunks[0]!;
  expect(hunk.oldStart).toBe(1);
  expect(hunk.oldLines).toBe(4);
  expect(hunk.newStart).toBe(1);
  expect(hunk.newLines).toBe(5);

  expect(hunk.lines).toEqual([
    { type: "context", content: "const a = 1;", oldLine: 1, newLine: 1 },
    { type: "del", content: "const b = 2;", oldLine: 2, newLine: null },
    { type: "add", content: "const b = 3;", oldLine: null, newLine: 2 },
    { type: "add", content: "const c = 4;", oldLine: null, newLine: 3 },
    { type: "context", content: "const d = 5;", oldLine: 3, newLine: 4 },
  ]);
});

test("新規ファイルを added として解析する", () => {
  const patch = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
`;
  const files = parseUnifiedDiff(patch);
  expect(files[0]!.status).toBe("added");
  expect(files[0]!.path).toBe("src/new.ts");
  expect(files[0]!.hunks[0]!.lines.map((l) => l.newLine)).toEqual([1, 2]);
});

test("削除ファイルを deleted として解析する", () => {
  const patch = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index 3333333..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const x = 1;
-export const y = 2;
`;
  const files = parseUnifiedDiff(patch);
  expect(files[0]!.status).toBe("deleted");
  expect(files[0]!.hunks[0]!.lines.every((l) => l.type === "del")).toBe(true);
});

test("rename を解析し、新旧のパスを保持する", () => {
  const patch = `diff --git a/src/old.ts b/src/new.ts
similarity index 90%
rename from src/old.ts
rename to src/new.ts
index 1111111..2222222 100644
--- a/src/old.ts
+++ b/src/new.ts
@@ -1,2 +1,2 @@
 const a = 1;
-const b = 2;
+const b = 3;
`;
  const files = parseUnifiedDiff(patch);
  expect(files[0]!.status).toBe("renamed");
  expect(files[0]!.oldPath).toBe("src/old.ts");
  expect(files[0]!.path).toBe("src/new.ts");
});

test("バイナリファイルを isBinary で表し、hunk を持たない", () => {
  const patch = `diff --git a/logo.png b/logo.png
index 1111111..2222222 100644
Binary files a/logo.png and b/logo.png differ
`;
  const files = parseUnifiedDiff(patch);
  expect(files[0]!.isBinary).toBe(true);
  expect(files[0]!.hunks).toHaveLength(0);
});

test("複数ファイル・複数 hunk を解析する", () => {
  const patch = `${MODIFIED}diff --git a/src/b.ts b/src/b.ts
index 4444444..5555555 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -10,3 +10,3 @@
 x
-y
+z
@@ -50,2 +50,3 @@
 p
+q
`;
  const files = parseUnifiedDiff(patch);
  expect(files.map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
  expect(files[1]!.hunks).toHaveLength(2);
  expect(files[1]!.hunks[1]!.newStart).toBe(50);
});

test("行数省略形の hunk ヘッダ（@@ -1 +1 @@）を 1 行として扱う", () => {
  const patch = `diff --git a/a.txt b/a.txt
index 1111111..2222222 100644
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-old
+new
`;
  const hunk = parseUnifiedDiff(patch)[0]!.hunks[0]!;
  expect(hunk.oldLines).toBe(1);
  expect(hunk.newLines).toBe(1);
});

test("末尾改行なしマーカー（\\\\ No newline at end of file）を行として数えない", () => {
  const patch = `diff --git a/a.txt b/a.txt
index 1111111..2222222 100644
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`;
  const hunk = parseUnifiedDiff(patch)[0]!.hunks[0]!;
  expect(hunk.lines).toHaveLength(2);
  expect(hunk.lines.map((l) => l.type)).toEqual(["del", "add"]);
});

test("空文字列を渡すと空配列を返す", () => {
  expect(parseUnifiedDiff("")).toEqual([]);
});

test("unquoteGitPath は C 形式の引用を解いて UTF-8 に戻す", () => {
  expect(unquoteGitPath('"\\350\\250\\255\\350\\250\\210.md"')).toBe("設計.md");
  expect(unquoteGitPath("plain.md")).toBe("plain.md");
  expect(unquoteGitPath('"a b.md"')).toBe("a b.md");
  expect(unquoteGitPath('"tab\\there.md"')).toBe("tab\there.md");
});

test("非 ASCII パス（引用形式）でもファイル境界を取りこぼさない", () => {
  const patch = `diff --git a/plain.md b/plain.md
index 1111111..2222222 100644
--- a/plain.md
+++ b/plain.md
@@ -1,1 +1,2 @@
 keep
+added
diff --git "a/\\350\\250\\255\\350\\250\\210.md" "b/\\350\\250\\255\\350\\250\\210.md"
index 3333333..4444444 100644
--- "a/\\350\\250\\255\\350\\250\\210.md"
+++ "b/\\350\\250\\255\\350\\250\\210.md"
@@ -1,1 +1,2 @@
 keep
+added
`;
  const files = parseUnifiedDiff(patch);
  expect(files.map((f) => f.path)).toEqual(["plain.md", "設計.md"]);
  // 2 つ目が 1 つ目に吸収されていないこと
  expect(files[0]!.hunks).toHaveLength(1);
  expect(files[1]!.hunks).toHaveLength(1);
  // --- / +++ の行が差分行として数えられていないこと
  expect(files[0]!.hunks[0]!.lines).toHaveLength(2);
});

test("スペースを含むパスを --- / +++ 行から正しく取る", () => {
  const patch = `diff --git a/my dir/a b.ts b/my dir/a b.ts
index 1111111..2222222 100644
--- a/my dir/a b.ts	
+++ b/my dir/a b.ts	
@@ -1,1 +1,2 @@
 keep
+added
`;
  expect(parseUnifiedDiff(patch)[0]!.path).toBe("my dir/a b.ts");
});

test("hunk 内の空行（先頭スペースが落ちた形）を context 行として数える", () => {
  // 一部のツールは空の context 行から末尾スペースを取り除く
  const patch =
    "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,3 +1,4 @@\n x\n\n y\n+z\n";
  const hunk = parseUnifiedDiff(patch)[0]!.hunks[0]!;
  expect(hunk.lines.map((l) => l.type)).toEqual(["context", "context", "context", "add"]);
  // 空行を落とすと以降の newLine がずれる。z が 4 行目であること
  expect(hunk.lines[3]!.newLine).toBe(4);
});

test("末尾の改行で余分な context 行を作らない", () => {
  const files = parseUnifiedDiff(MODIFIED);
  expect(files[0]!.hunks[0]!.lines).toHaveLength(5);
});
