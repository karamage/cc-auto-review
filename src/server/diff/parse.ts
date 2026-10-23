import type { DiffFile, DiffHunk } from "../../shared/types.ts";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const ESCAPES: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, "\\": 92 };

/**
 * git が非 ASCII やスペースを含むパスに使う C 形式の引用を解く。
 * 例: "a/\350\250\255.md" → a/設計.md
 * 引用されていなければそのまま返す。
 */
export function unquoteGitPath(token: string): string {
  if (!token.startsWith('"') || !token.endsWith('"')) return token;

  const inner = token.slice(1, -1);
  const bytes: number[] = [];
  const encoder = new TextEncoder();

  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i] as string;
    if (ch !== "\\") {
      bytes.push(...encoder.encode(ch));
      continue;
    }
    const next = inner[i + 1] as string;
    if (next >= "0" && next <= "7") {
      // 8 進 3 桁で 1 バイトを表す。UTF-8 の各バイトがこの形で並ぶ
      bytes.push(Number.parseInt(inner.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      bytes.push(ESCAPES[next] ?? next.charCodeAt(0));
      i += 1;
    }
  }

  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** "--- a/path" / "+++ b/path" からパスを取る。/dev/null なら null */
function pathFromMarker(raw: string): string | null {
  // 末尾にタブ区切りのタイムスタンプが付くことがある
  const token = raw.slice(4).split("\t")[0] as string;
  const unquoted = unquoteGitPath(token);
  if (unquoted === "/dev/null") return null;
  return unquoted.replace(/^[ab]\//, "");
}

export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const closeHunk = (): void => {
    if (file !== null && hunk !== null) file.hunks.push(hunk);
    hunk = null;
  };
  const closeFile = (): void => {
    closeHunk();
    if (file !== null) files.push(file);
    file = null;
  };

  const lines = patch.split("\n");
  // split の副産物である末尾の空要素だけを落とす。hunk 内の空行は下で context として扱う
  if (lines.at(-1) === "") lines.pop();

  for (const raw of lines) {
    // パスが読めるかに関わらず、必ずここでファイルを区切る。
    // 取りこぼすと次のファイルの hunk が前のファイルに吸収される
    if (raw.startsWith("diff --git ")) {
      closeFile();
      const tokens = raw.slice("diff --git ".length).match(/"(?:\\.|[^"])*"|\S+/g) ?? [];
      const provisional = tokens.at(-1);
      file = {
        path:
          provisional === undefined
            ? "(unknown)"
            : unquoteGitPath(provisional).replace(/^[ab]\//, ""),
        oldPath: null,
        status: "modified",
        hunks: [],
        isBinary: false,
      };
      continue;
    }
    if (file === null) continue;

    if (raw.startsWith("new file mode")) {
      file.status = "added";
      continue;
    }
    if (raw.startsWith("deleted file mode")) {
      file.status = "deleted";
      continue;
    }
    if (raw.startsWith("rename from ")) {
      file.oldPath = unquoteGitPath(raw.slice("rename from ".length));
      file.status = "renamed";
      continue;
    }
    if (raw.startsWith("rename to ")) {
      file.path = unquoteGitPath(raw.slice("rename to ".length));
      continue;
    }
    if (raw.startsWith("Binary files ")) {
      file.isBinary = true;
      continue;
    }
    // hunk に入る前の --- / +++ がパスの正。スペースを含むパスも曖昧にならない
    if (hunk === null && raw.startsWith("--- ")) {
      const path = pathFromMarker(raw);
      if (path !== null && file.status === "renamed") file.oldPath = path;
      continue;
    }
    if (hunk === null && raw.startsWith("+++ ")) {
      const path = pathFromMarker(raw);
      if (path !== null) file.path = path;
      continue;
    }

    const h = HUNK_HEADER.exec(raw);
    if (h !== null) {
      closeHunk();
      oldLine = Number(h[1]);
      newLine = Number(h[3]);
      hunk = {
        header: raw,
        oldStart: oldLine,
        oldLines: h[2] === undefined ? 1 : Number(h[2]),
        newStart: newLine,
        newLines: h[4] === undefined ? 1 : Number(h[4]),
        lines: [],
      };
      continue;
    }

    // hunk に入る前のメタ行（index / mode / similarity）は読み飛ばす
    if (hunk === null) continue;
    // 末尾改行なしマーカーは行として数えない
    if (raw.startsWith("\\")) continue;

    if (raw.startsWith("+")) {
      hunk.lines.push({ type: "add", content: raw.slice(1), oldLine: null, newLine });
      newLine += 1;
    } else if (raw.startsWith("-")) {
      hunk.lines.push({ type: "del", content: raw.slice(1), oldLine, newLine: null });
      oldLine += 1;
    } else {
      // " x" の通常形に加え、空の context 行から末尾スペースが落ちた "" もここで拾う。
      // 落とすと以降の行番号が 1 つずつずれる
      hunk.lines.push({ type: "context", content: raw.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }

  closeFile();
  return files;
}
