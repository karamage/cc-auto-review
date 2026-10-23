import { useRef } from "react";
import { type LgtmChoice, lgtmImageUrl } from "../../shared/lgtm.ts";
import { LANGS } from "../../shared/i18n.ts";
import type { CommentLanguage, ReviewEventKind } from "../../shared/types.ts";
import { t } from "../i18n.ts";
import {
  acceptedComments,
  needsTranslation,
  suggestEvent,
  type DraftState,
} from "../state/draft.ts";
import { LgtmPicker } from "./LgtmPicker.tsx";

/** 画面に並べる順 */
const EVENT_KINDS: readonly ReviewEventKind[] = ["COMMENT", "APPROVE", "REQUEST_CHANGES"];

export function eventLabel(kind: ReviewEventKind): string {
  return t().event[kind];
}

/** GitHub 上の呼び名。画面の言葉と GitHub の画面を対応づけるために添える */
export const EVENT_GITHUB: Record<ReviewEventKind, string> = {
  COMMENT: "Comment",
  APPROVE: "Approve",
  REQUEST_CHANGES: "Request changes",
};

/**
 * 画面の呼び名に添える GitHub 上の呼び名。英語の画面のように、
 * 画面の呼び名がすでに GitHub の呼び名で始まっていれば重ねて出さない
 */
export function githubEventName(kind: ReviewEventKind): string | null {
  const github = EVENT_GITHUB[kind];
  return eventLabel(kind).toLowerCase().startsWith(github.toLowerCase()) ? null : github;
}

/** 投稿する言語の名前。画面の言語で書く */
export function languageLabel(language: CommentLanguage): string {
  return t().commentLanguage[language];
}

/** 確認画面などで、どの LGTM 画像を添えるかを一言で示す */
export function describeLgtm(choice: LgtmChoice): string {
  if (choice === "random") return t().lgtmRandom;
  if (choice === "none") return t().lgtmNone;
  return `#${choice}`;
}

/**
 * 投稿の設定と送信。名前は歴史的経緯で SubmitBar のままだが、
 * 画面右の操作パネルの末尾に置く縦長のフォームとして描く
 */
export function SubmitBar({
  draft,
  onEvent,
  onSummary,
  onLanguage,
  onLgtm,
  onSubmit,
  submitting,
  disabled,
  alreadyPosted = false,
}: {
  draft: DraftState;
  onEvent: (event: ReviewEventKind) => void;
  onSummary: (summary: string) => void;
  onLanguage: (language: CommentLanguage) => void;
  onLgtm: (lgtm: LgtmChoice) => void;
  onSubmit: () => Promise<void>;
  submitting: boolean;
  disabled: boolean;
  /** いま表示しているコミットに、すでに投稿したことがあるか。二重投稿に気づけるようにする */
  alreadyPosted?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const comments = acceptedComments(draft);
  const suggested = suggestEvent(draft);
  const lineCount = comments.filter((c) => c.anchor === "line").length;
  const summaryCount = comments.length - lineCount;
  const translate = needsTranslation(draft);
  const target = languageLabel(draft.language);
  const text = t().submit;

  return (
    <>
      <section className="submit-bar" aria-labelledby="submit-heading">
        <h2 id="submit-heading">{text.heading}</h2>
        <p className="submit-tally">
          <strong>{comments.length}</strong>
          {text.acceptedUnit}
          <span className="muted">{text.tally(lineCount, summaryCount)}</span>
        </p>

        <fieldset className="choice-group">
          <legend>{text.eventLegend}</legend>
          {EVENT_KINDS.map((kind) => (
            <label key={kind} className="choice" data-event={kind}>
              <input
                type="radio"
                name="review-event"
                value={kind}
                checked={draft.event === kind}
                onChange={() => onEvent(kind)}
              />
              <span className="choice-text">
                {eventLabel(kind)}
                {githubEventName(kind) === null ? null : (
                  <span className="choice-sub">{githubEventName(kind)}</span>
                )}
              </span>
              {kind === suggested ? <span className="choice-note">{text.suggested}</span> : null}
            </label>
          ))}
        </fieldset>

        {draft.event === "APPROVE" ? <LgtmPicker value={draft.lgtm} onChange={onLgtm} /> : null}

        <label className="field">
          <span>{text.summary}</span>
          <textarea
            value={draft.summary}
            onChange={(e) => onSummary(e.target.value)}
            rows={2}
            placeholder={text.summaryPlaceholder}
          />
        </label>

        <div className="submit-row">
          <fieldset className="segmented">
            <legend className="visually-hidden">{text.languageLegend}</legend>
            {LANGS.map((language) => (
              <label key={language}>
                <input
                  type="radio"
                  name="review-language"
                  value={language}
                  checked={draft.language === language}
                  onChange={() => onLanguage(language)}
                />
                <span>{languageLabel(language)}</span>
              </label>
            ))}
          </fieldset>

          <button
            type="button"
            data-variant="primary"
            disabled={disabled || submitting}
            onClick={() => dialogRef.current?.showModal()}
          >
            {submitting
              ? translate
                ? text.translatingAndPosting(target)
                : text.posting
              : alreadyPosted
                ? text.postAgain
                : text.post}
          </button>
        </div>
        {disabled && !submitting ? <p className="submit-hint">{text.hint}</p> : null}
      </section>

      <dialog ref={dialogRef} className="confirm" aria-labelledby="confirm-heading">
        <h2 id="confirm-heading">{text.confirmHeading}</h2>
        <dl>
          <div>
            <dt>{text.kind}</dt>
            <dd>
              {eventLabel(draft.event)}
              {githubEventName(draft.event) === null ? null : (
                <span className="muted"> ({githubEventName(draft.event)})</span>
              )}
            </dd>
          </div>
          <div>
            <dt>{text.lineComments}</dt>
            <dd>{text.count(lineCount)}</dd>
          </div>
          <div>
            <dt>{text.summaryFindings}</dt>
            <dd>{text.count(summaryCount)}</dd>
          </div>
          <div>
            <dt>{text.language}</dt>
            <dd>{target}</dd>
          </div>
          {draft.event === "APPROVE" ? (
            <div>
              <dt>{text.lgtmImage}</dt>
              <dd>
                {typeof draft.lgtm === "number" ? (
                  <img
                    className="lgtm-confirm"
                    src={lgtmImageUrl(draft.lgtm)}
                    alt={text.chosenLgtm}
                  />
                ) : (
                  describeLgtm(draft.lgtm)
                )}
              </dd>
            </div>
          ) : null}
        </dl>
        {translate ? <p className="muted">{text.willTranslate(target)}</p> : null}
        {alreadyPosted ? <p className="error">{text.alreadyPosted}</p> : null}
        <p className="muted">{text.public}</p>
        <div className="confirm-actions">
          <button type="button" onClick={() => dialogRef.current?.close()}>
            {text.back}
          </button>
          <button
            type="button"
            data-variant="primary"
            onClick={() => {
              dialogRef.current?.close();
              void onSubmit();
            }}
          >
            {text.confirm}
          </button>
        </div>
      </dialog>
    </>
  );
}
