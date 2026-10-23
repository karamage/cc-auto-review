import type { ReactNode } from "react";
import { t } from "../i18n.ts";
import type { DraftItem, FindingStatus } from "../state/draft.ts";

/** AI の本文に含まれる `code` だけをコードとして描く。Markdown 全体は解釈しない */
export function renderInlineCode(text: string): ReactNode[] {
  return text.split(/(`[^`\n]+`)/).map((part, index) =>
    part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
      // eslint-disable-next-line react/no-array-index-key -- 固定の文字列を分割しただけで、並びは変わらない
      <code key={index}>{part.slice(1, -1)}</code>
    ) : (
      part
    ),
  );
}

export function FindingCard({
  item,
  number,
  onStatus,
  onBody,
}: {
  item: DraftItem;
  /** 図面の改訂記号のような通し番号。投稿前の確認やファイル索引で指摘を指し示すのに使う */
  number?: number;
  onStatus: (status: FindingStatus) => void;
  onBody: (body: string) => void;
}) {
  const { finding, anchor, reason } = item.anchored;
  const text = t().review;
  const toggle = (status: FindingStatus): void =>
    onStatus(item.status === status ? "pending" : status);

  return (
    <article className="finding" data-severity={finding.severity} data-status={item.status}>
      <header>
        {number === undefined ? null : (
          <svg
            className="delta"
            viewBox="0 0 32 28"
            role="img"
            aria-label={text.findingNumber(number)}
          >
            <path d="M16 2 30 26H2Z" />
            <text x="16" y="22.5" textAnchor="middle">
              {number}
            </text>
          </svg>
        )}
        <span className="severity">{finding.severity}</span>
        <h3>{finding.title}</h3>
      </header>

      {anchor === "line" ? null : (
        <p className="finding-where">
          <code>{finding.path}</code>
          {reason === null ? null : <span>{reason}</span>}
        </p>
      )}

      {item.status === "rejected" ? null : item.status === "accepted" ? (
        <textarea
          value={item.body}
          onChange={(e) => onBody(e.target.value)}
          aria-label={text.commentBody}
          rows={Math.min(10, Math.max(3, item.body.split("\n").length + 1))}
        />
      ) : (
        <p className="finding-body">{renderInlineCode(item.body)}</p>
      )}

      <footer>
        <button
          type="button"
          data-choice="accept"
          aria-pressed={item.status === "accepted"}
          onClick={() => toggle("accepted")}
        >
          {item.status === "accepted" ? text.accepted : text.accept}
        </button>
        <button
          type="button"
          data-choice="reject"
          aria-pressed={item.status === "rejected"}
          onClick={() => toggle("rejected")}
        >
          {item.status === "rejected" ? text.unreject : text.reject}
        </button>
        {item.status === "accepted" ? <span className="finding-hint">{text.editHint}</span> : null}
      </footer>
    </article>
  );
}
