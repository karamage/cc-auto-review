import { createHash } from "node:crypto";
import { isUnreviewedPath } from "../../shared/risk.ts";
import { DEFAULT_IGNORED_PATHS } from "../../shared/settings.ts";
import type { DiffFile } from "../../shared/types.ts";

/**
 * PR の変更の中身の要約。前回の AI レビューから、レビューし直す意味のある変更があったかを見るのに使う。
 * 追加・削除した行の本文だけを、ファイルごとに順に数える。行番号・hunk の区切り・前後の文脈は数えないので、
 * base を取り込んだだけのマージや、中身を変えない rebase では変わらない。
 * 人がレビューしないファイル（ロックファイル・ビルドの成果物）は数えない。
 * バイナリは中身が diff に出ないので、変わっても要約は変わらない
 */
export function diffDigest(
  files: readonly DiffFile[],
  ignoredPaths: readonly string[] = DEFAULT_IGNORED_PATHS,
): string {
  const hash = createHash("sha256");
  const sorted = files
    .filter((file) => !isUnreviewedPath(file.path, ignoredPaths))
    .sort((a, b) => a.path.localeCompare(b.path));
  for (const file of sorted) {
    hash.update(`F\0${file.status}\0${file.oldPath ?? ""}\0${file.path}\0${file.isBinary}\n`);
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type === "add") hash.update(`+${line.content}\n`);
        if (line.type === "del") hash.update(`-${line.content}\n`);
      }
    }
  }
  return hash.digest("hex");
}
