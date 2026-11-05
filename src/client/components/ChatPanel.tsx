import { useEffect, useRef, useState } from "react";
import type { ChatReference, PRRef } from "../../shared/types.ts";
import { browserClient } from "../api.ts";
import { t } from "../i18n.ts";
import {
  addProposal,
  canChat,
  type ChatMessage,
  retryChat,
  sendChat,
  setChatReference,
  splitChatText,
} from "../state/chat.ts";
import type { DraftState } from "../state/draft.ts";
import type { ReviewSession, SessionStore } from "../state/sessions.ts";
import { renderInlineCode } from "./FindingCard.tsx";

function referenceLabel(reference: ChatReference, draft: DraftState): string {
  if (reference.kind === "line") return `${reference.path}:${reference.line}`;
  const index = draft.items.findIndex((item) => item.anchored.finding.id === reference.findingId);
  const item = draft.items[index];
  return item === undefined
    ? reference.findingId
    : t().chat.referenceFinding(index + 1, item.anchored.finding.title);
}

function ChatText({ text }: { text: string }) {
  return (
    <>
      {splitChatText(text).map((part, index) =>
        part.kind === "code" ? (
          // eslint-disable-next-line react/no-array-index-key -- 確定した文字列を分割しただけで、並びは変わらない
          <pre key={index}>
            <code>{part.text}</code>
          </pre>
        ) : (
          // eslint-disable-next-line react/no-array-index-key -- 確定した文字列を分割しただけで、並びは変わらない
          <p key={index}>{renderInlineCode(part.text)}</p>
        ),
      )}
    </>
  );
}

function Message({
  message,
  draft,
  onRetry,
  onAdd,
}: {
  message: ChatMessage;
  draft: DraftState;
  onRetry: () => void;
  onAdd: (index: number) => void;
}) {
  const text = t().chat;
  return (
    <article className="chat-message" data-role={message.role}>
      <header>{message.role === "user" ? text.you : text.ai}</header>
      {message.reference === null ? null : (
        <p className="chat-reference">{referenceLabel(message.reference, draft)}</p>
      )}
      <ChatText text={message.text} />
      {message.proposals.map((proposal, index) => {
        const { finding } = proposal.anchored;
        return (
          <div className="chat-proposal" data-severity={finding.severity} key={finding.id}>
            <p>
              <span className="severity">{finding.severity}</span> <strong>{finding.title}</strong>
            </p>
            <p className="chat-proposal-where">
              <code>
                {finding.line === null ? finding.path : `${finding.path}:${finding.line}`}
              </code>
            </p>
            <p>{renderInlineCode(finding.body)}</p>
            <button type="button" disabled={proposal.added} onClick={() => onAdd(index)}>
              {proposal.added ? text.added : text.addFinding}
            </button>
          </div>
        );
      })}
      {message.error === null ? null : (
        <div className="error" role="alert">
          <p>{message.error.message}</p>
          {message.error.raw === null ? null : (
            <details>
              <summary>{t().details}</summary>
              <pre>{message.error.raw}</pre>
            </details>
          )}
          <button type="button" onClick={onRetry}>
            {text.retry}
          </button>
        </div>
      )}
    </article>
  );
}

export function ChatPanel({
  sessions,
  pr,
  session,
  headSha,
  open,
  onClose,
}: {
  sessions: SessionStore;
  pr: PRRef;
  session: ReviewSession;
  headSha: string;
  open: boolean;
  onClose: () => void;
}) {
  const text = t().chat;
  const { chat, draft } = session;
  const available = canChat(session, headSha);
  // 閉じても入力途中の文を消さないよう、欄は描き続けて hidden で隠す
  const [input, setInput] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) bottom.current?.scrollIntoView({ block: "end" });
  }, [open, chat.messages.length, chat.pending]);

  useEffect(() => {
    if (open) textarea.current?.focus();
  }, [open, chat.reference]);

  const send = (): void => {
    if (input.trim() === "" || chat.pending || !available) return;
    setInput("");
    void sendChat(browserClient, sessions, pr, headSha, input);
  };

  return (
    <aside className="chat-panel" hidden={!open} aria-labelledby="chat-heading">
      <header className="chat-head">
        <h2 id="chat-heading">{text.heading}</h2>
        <button type="button" onClick={onClose}>
          {text.close}
        </button>
      </header>

      <div className="chat-log" aria-live="polite">
        {chat.messages.length === 0 ? <p className="muted">{text.empty}</p> : null}
        {chat.messages.map((message) => (
          <Message
            key={message.id}
            message={message}
            draft={draft}
            onRetry={() => void retryChat(browserClient, sessions, pr, headSha, message.id)}
            onAdd={(index) => addProposal(sessions, pr, message.id, index)}
          />
        ))}
        {chat.pending ? (
          <p className="chat-progress" role="status">
            {chat.progress === "" ? text.sending : chat.progress}
          </p>
        ) : null}
        <div ref={bottom} />
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {available ? null : <p className="muted">{text.unavailable}</p>}
        {chat.reference === null ? null : (
          <p className="chat-reference">
            <span>{referenceLabel(chat.reference, draft)}</span>
            <button
              type="button"
              aria-label={text.removeReference}
              onClick={() => setChatReference(sessions, pr, null)}
            >
              ×
            </button>
          </p>
        )}
        <textarea
          ref={textarea}
          value={input}
          rows={3}
          maxLength={4000}
          disabled={!available}
          placeholder={text.placeholder}
          aria-label={text.heading}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          type="submit"
          data-variant="primary"
          disabled={!available || chat.pending || input.trim() === ""}
        >
          {text.send}
        </button>
      </form>
    </aside>
  );
}
