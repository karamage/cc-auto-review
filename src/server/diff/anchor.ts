import type { Lang } from "../../shared/i18n.ts";
import type { AnchoredFinding, DiffFile, Finding } from "../../shared/types.ts";

/**
 * 変更後ファイル側の行番号のうち、GitHub に行コメントを付けられるものを集める。
 * 追加行と context 行が対象。削除行は変更後の行番号を持たないので含まれない。
 */
export function buildCommentableLines(files: DiffFile[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const file of files) {
    if (file.isBinary) continue;
    const lines = new Set<number>();
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.newLine !== null) lines.add(line.newLine);
      }
    }
    map.set(file.path, lines);
  }
  return map;
}

/** 行コメントにできず、レビュー本文にまとめた理由。画面にそのまま出す */
const DEMOTED = {
  ja: {
    binary: (path: string) => `${path} はバイナリファイルのため、レビュー本文にまとめました`,
    notInPR: (path: string) =>
      `${path} はこの PR の変更ファイルに含まれていないため、レビュー本文にまとめました`,
    noLine: "行が指定されていないため、レビュー本文にまとめました",
    notInDiff: (where: string) =>
      `${where} はこの PR の diff に含まれていないため、レビュー本文にまとめました`,
  },
  en: {
    binary: (path: string) => `Moved to the review body because ${path} is a binary file`,
    notInPR: (path: string) =>
      `Moved to the review body because ${path} is not among the files this PR changes`,
    noLine: "Moved to the review body because no line was given",
    notInDiff: (where: string) =>
      `Moved to the review body because ${where} is not part of this PR's diff`,
  },
} satisfies Record<Lang, unknown>;

export function anchorFindings(
  findings: Finding[],
  files: DiffFile[],
  lang: Lang = "ja",
): AnchoredFinding[] {
  const text = DEMOTED[lang];
  const commentable = buildCommentableLines(files);
  const binaryPaths = new Set(files.filter((f) => f.isBinary).map((f) => f.path));

  return findings.map((finding) => {
    if (binaryPaths.has(finding.path)) {
      return {
        finding,
        anchor: "summary",
        reason: text.binary(finding.path),
      };
    }

    const lines = commentable.get(finding.path);
    if (lines === undefined) {
      return {
        finding,
        anchor: "summary",
        reason: text.notInPR(finding.path),
      };
    }

    if (finding.line === null) {
      return {
        finding,
        anchor: "summary",
        reason: text.noLine,
      };
    }

    if (!lines.has(finding.line)) {
      return {
        finding,
        anchor: "summary",
        reason: text.notInDiff(`${finding.path}:${finding.line}`),
      };
    }

    return { finding, anchor: "line", reason: null };
  });
}
