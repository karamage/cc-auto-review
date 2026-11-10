import { Fragment } from "react";
import {
  type DiffFile,
  type ExistingComment,
  type PriorFindingCheck,
  SEVERITIES,
  type Severity,
} from "../../shared/types.ts";
import { splitPath } from "../format.ts";
import { t } from "../i18n.ts";
import type { DraftItem, FindingStatus } from "../state/draft.ts";
import { ExistingCommentCard } from "./ExistingCommentCard.tsx";
import { FindingCard } from "./FindingCard.tsx";
import { DiffLineRow } from "./DiffLineRow.tsx";
import { fileAnchorId } from "./FileIndex.tsx";

/** 1 行に複数の指摘があるときは、いちばん重いものの色で印を付ける */
function heaviest(items: DraftItem[]): Severity | undefined {
  return SEVERITIES.find((s) => items.some((i) => i.anchored.finding.severity === s));
}

const NONE: never[] = [];

/** 行番号ごとにまとめる。行ごとに配列を探し直すと、大きなファイルで行数 × 件数になる */
function byLine<T>(values: T[], lineOf: (value: T) => number | null): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const value of values) {
    const line = lineOf(value);
    if (line === null) continue;
    const list = map.get(line);
    if (list === undefined) map.set(line, [value]);
    else list.push(value);
  }
  return map;
}

export function DiffFileView({
  file,
  items,
  comments,
  numberOf,
  checkOf,
  onStatus,
  onBody,
  onAskFinding,
  onAskLine,
  onRemember,
}: {
  file: DiffFile;
  /** 行アンカーの指摘のみ。summary の指摘は ReviewPage が別枠で出す */
  items: DraftItem[];
  comments: ExistingComment[];
  /** 指摘 ID から通し番号を引く */
  numberOf: (findingId: string) => number | undefined;
  /** 既存コメントの ID から、過去の指摘の判定を引く */
  checkOf: (commentId: number) => PriorFindingCheck | undefined;
  onStatus: (findingId: string, status: FindingStatus) => void;
  onBody: (findingId: string, body: string) => void;
  /** チャットで質問する。質問できない状態なら無い */
  onAskFinding?: (findingId: string) => void;
  onAskLine?: (path: string, line: number, side: "LEFT" | "RIGHT") => void;
  /** 却下した指摘を学び帳に残す */
  onRemember?: (text: string) => Promise<void>;
}) {
  // side が LEFT のコメントは変更前ファイルの行番号を持つ。
  // 変更後の行番号と突き合わせると別の行の下に出るので、ファイル単位でまとめる
  const inlineComments = comments.filter((c) => c.line !== null && c.side !== "LEFT");
  const fileLevelComments = comments.filter((c) => c.line === null || c.side === "LEFT");
  const itemsAt = byLine(items, (i) => i.anchored.finding.line);
  const commentsAt = byLine(inlineComments, (c) => c.line);

  const { dir, name } = splitPath(file.path);
  const lines = file.hunks.flatMap((h) => h.lines);
  const additions = lines.filter((l) => l.type === "add").length;
  const deletions = lines.filter((l) => l.type === "del").length;

  return (
    <section className="diff-file" id={fileAnchorId(file.path)}>
      <header>
        <span className="diff-file-status" data-status={file.status}>
          {t().fileStatus[file.status]}
        </span>
        <span className="diff-file-path">
          <span className="diff-file-dir">{dir}</span>
          <strong>{name}</strong>
          {file.oldPath === null ? null : (
            <span className="muted">{t().oldPath(file.oldPath)}</span>
          )}
        </span>
        <span className="diff-file-counts">
          <span className="count-add">+{additions}</span>
          <span className="count-del">−{deletions}</span>
        </span>
      </header>

      {fileLevelComments.map((c) => (
        <ExistingCommentCard key={c.id} comment={c} check={checkOf(c.id)} />
      ))}

      {file.isBinary ? (
        <p className="diff-file-note">{t().binaryFile}</p>
      ) : (
        file.hunks.map((hunk) => (
          <table className="diff-table" key={hunk.header}>
            {/* table-layout: fixed は先頭行で列幅を決める。先頭は hunk 見出しの colSpan 行なので、ここで幅を固定する */}
            <colgroup>
              <col className="col-lineno" />
              <col className="col-lineno" />
              <col className="col-marker" />
              <col />
            </colgroup>
            <tbody>
              <tr className="diff-hunk">
                <td colSpan={4}>{hunk.header}</td>
              </tr>
              {hunk.lines.map((line, index) => {
                const lineItems =
                  line.newLine === null ? NONE : (itemsAt.get(line.newLine) ?? NONE);
                const lineComments =
                  line.newLine === null ? NONE : (commentsAt.get(line.newLine) ?? NONE);

                return (
                  <Fragment key={`${hunk.header}-${index}`}>
                    <DiffLineRow
                      path={file.path}
                      line={line}
                      marked={heaviest(lineItems)}
                      onAsk={onAskLine}
                    />
                    {lineItems.length + lineComments.length === 0 ? null : (
                      <tr className="diff-annotations">
                        <td colSpan={4}>
                          {lineItems.map((item) => (
                            <FindingCard
                              key={item.anchored.finding.id}
                              item={item}
                              number={numberOf(item.anchored.finding.id)}
                              onStatus={(status) => onStatus(item.anchored.finding.id, status)}
                              onBody={(body) => onBody(item.anchored.finding.id, body)}
                              onAsk={
                                onAskFinding === undefined
                                  ? undefined
                                  : () => onAskFinding(item.anchored.finding.id)
                              }
                              onRemember={onRemember}
                            />
                          ))}
                          {lineComments.map((c) => (
                            <ExistingCommentCard key={c.id} comment={c} check={checkOf(c.id)} />
                          ))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        ))
      )}
    </section>
  );
}
