import type { CSSProperties } from "react";
import { type DiffFile, SEVERITIES } from "../../shared/types.ts";
import { splitPath } from "../format.ts";
import { t } from "../i18n.ts";
import { lineItemsFor, type DraftState } from "../state/draft.ts";

export function fileAnchorId(path: string): string {
  return `file-${encodeURIComponent(path)}`;
}

/** 変更ファイルの索引。長い diff の中で、指摘のあるファイルへ直接飛べるようにする */
export function FileIndex({ files, draft }: { files: DiffFile[]; draft: DraftState }) {
  return (
    <nav
      className="file-index"
      aria-labelledby="file-index-heading"
      // ファイルが少ないときに空白を残さないよう、最小の高さを行数に合わせる
      style={{ "--rows": files.length } as CSSProperties}
    >
      <h2 id="file-index-heading">
        {t().changedFiles} <span className="muted">{files.length}</span>
      </h2>
      <ol>
        {files.map((file) => {
          const { dir, name } = splitPath(file.path);
          // 同名ファイル（en/common.json と ja/common.json など）を見分けられるよう、直上のディレクトリまで出す
          const parent = dir.split("/").filter(Boolean).at(-1);
          const items = lineItemsFor(draft, file.path);
          return (
            <li key={file.path}>
              <a href={`#${fileAnchorId(file.path)}`} title={file.path}>
                <span className="file-index-name">
                  {parent === undefined ? null : <span className="file-index-dir">{parent}/</span>}
                  {name}
                </span>
                <span className="file-index-marks">
                  {SEVERITIES.map((severity) => {
                    const count = items.filter(
                      (i) => i.anchored.finding.severity === severity,
                    ).length;
                    return count === 0 ? null : (
                      <span key={severity} className="mark" data-severity={severity}>
                        {count}
                        <span className="visually-hidden">
                          {t().review.severityCount(severity)}
                        </span>
                      </span>
                    );
                  })}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
