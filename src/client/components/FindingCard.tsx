import { type ReactNode, useState } from "react";
import { LEARNING_MAX_TEXT_LENGTH } from "../../shared/types.ts";
import { t } from "../i18n.ts";
import type { DraftItem, FindingStatus } from "../state/draft.ts";
import { findingAnchorId } from "./FindingIndex.tsx";

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

export function rememberDraft(path: string, title: string): string {
  return t().review.rememberDraft(path, title);
}

/** 却下した指摘を、次回のレビューに引き継ぐ学びとして残す。文面は人が直してから保存する */
function RememberLearning({
  path,
  title,
  onRemember,
}: {
  path: string;
  title: string;
  onRemember: (text: string) => Promise<void>;
}) {
  const text = t().review;
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (saved) return <p className="finding-hint">{text.remembered}</p>;
  if (draft === null) {
    return (
      <footer>
        <button type="button" onClick={() => setDraft(rememberDraft(path, title))}>
          {text.remember}
        </button>
      </footer>
    );
  }
  return (
    <div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={text.rememberLabel}
        maxLength={LEARNING_MAX_TEXT_LENGTH}
        rows={3}
      />
      {error === null ? null : (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <footer>
        <button
          type="button"
          data-variant="primary"
          disabled={busy || draft.trim() === ""}
          onClick={() => {
            setBusy(true);
            setError(null);
            onRemember(draft)
              .then(() => setSaved(true))
              .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false));
          }}
        >
          {text.rememberSave}
        </button>
        <button type="button" disabled={busy} onClick={() => setDraft(null)}>
          {text.rememberCancel}
        </button>
      </footer>
    </div>
  );
}

export function FindingCard({
  item,
  number,
  onStatus,
  onBody,
  onAsk,
  onRemember,
}: {
  item: DraftItem;
  /** 図面の改訂記号のような通し番号。投稿前の確認やファイル索引で指摘を指し示すのに使う */
  number?: number;
  onStatus: (status: FindingStatus) => void;
  onBody: (body: string) => void;
  /** チャットでこの指摘について質問する。質問できない状態なら無い */
  onAsk?: () => void;
  /** 却下した指摘を学び帳に残す。残せない場面では無い */
  onRemember?: (text: string) => Promise<void>;
}) {
  const { finding, anchor, reason } = item.anchored;
  const text = t().review;
  const toggle = (status: FindingStatus): void =>
    onStatus(item.status === status ? "pending" : status);

  return (
    <article
      className="finding"
      id={findingAnchorId(finding.id)}
      // 指摘一覧から飛んできたとき、キーボード操作の起点をこのカードに移す
      tabIndex={-1}
      data-severity={finding.severity}
      data-status={item.status}
    >
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
        {onAsk === undefined ? null : (
          <button type="button" data-choice="ask" onClick={onAsk}>
            {t().chat.ask}
          </button>
        )}
        {item.status === "accepted" ? <span className="finding-hint">{text.editHint}</span> : null}
      </footer>
      {item.status === "rejected" && onRemember !== undefined ? (
        <RememberLearning path={finding.path} title={finding.title} onRemember={onRemember} />
      ) : null}
    </article>
  );
}
