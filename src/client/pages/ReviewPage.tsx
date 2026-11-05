import { type MouseEvent, useCallback, useEffect, useState } from "react";
import {
  DEFAULT_VISIBLE_SEVERITIES,
  type PRDetail,
  type PRRef,
  type PRSummary,
  REVIEW_MODELS,
  type ReviewModel,
  SEVERITIES,
  type Severity,
} from "../../shared/types.ts";
import { ApiError, browserClient, fetchPRDetail, submitReview } from "../api.ts";
import { ChatPanel } from "../components/ChatPanel.tsx";
import { ConfirmButton } from "../components/ConfirmButton.tsx";
import { DiffFileView } from "../components/DiffFileView.tsx";
import { ExistingCommentCard } from "../components/ExistingCommentCard.tsx";
import { I18nComparisons } from "../components/I18nComparisons.tsx";
import { PriorChecks } from "../components/PriorChecks.tsx";
import { canChat, setChatReference } from "../state/chat.ts";
import { priorCheckLookup } from "../state/prior.ts";
import { FileIndex } from "../components/FileIndex.tsx";
import { FindingCard } from "../components/FindingCard.tsx";
import { FindingIndex } from "../components/FindingIndex.tsx";
import { LanguageSwitch } from "../components/LanguageSwitch.tsx";
import { ReviewingSheet } from "../components/ReviewingSheet.tsx";
import { RiskScoreCard } from "../components/RiskScoreCard.tsx";
import { SeverityFilter } from "../components/SeverityFilter.tsx";
import { PostedNotice } from "../components/PostedNotice.tsx";
import { SubmitBar } from "../components/SubmitBar.tsx";
import { TitleBlock } from "../components/TitleBlock.tsx";
import { UsageSummary } from "../components/UsageSummary.tsx";
import { formatRelative } from "../format.ts";
import { openExternal } from "../desktop.ts";
import { t } from "../i18n.ts";
import { useSettings } from "../settings.ts";
import {
  describeResult,
  editBody,
  lineItemsFor,
  setEvent,
  setLanguage,
  setLgtm,
  setStatus,
  setSummary,
  summaryItems,
  toSubmitRequest,
  type DraftItem,
  type DraftState,
  type FindingStatus,
} from "../state/draft.ts";
import { progressText, runReview, type SessionStore, useSession } from "../state/sessions.ts";
import { recordPosted, startWatching, stopWatching } from "../state/watch.ts";

/** 説明文内のリンクで画面遷移すると、レビューの下書きが消える。必ず既定のブラウザで開く */
function openLinkInNewTab(e: MouseEvent<HTMLElement>): void {
  const anchor = (e.target as HTMLElement).closest("a");
  if (anchor === null || anchor.href === "") return;
  e.preventDefault();
  openExternal(browserClient.post, anchor.href);
}

export function ReviewPage({
  sessions,
  pr,
  onBack,
}: {
  sessions: SessionStore;
  pr: PRRef;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<PRDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // AI レビューの状態と下書きはストアが持つ。一覧へ戻っても消えない
  const session = useSession(sessions, pr);
  const { draft, phase, progress, instructions, model, profileId } = session;
  const settings = useSettings();
  const reviewError = session.error;
  const setDraft = (change: (s: DraftState) => DraftState): void => {
    sessions.update(pr, (s) => ({ ...s, draft: change(s.draft) }));
  };
  const setInstructions = (text: string): void => {
    sessions.update(pr, (s) => ({ ...s, instructions: text }));
  };
  const setModel = (value: ReviewModel | null | "default"): void => {
    sessions.update(pr, (s) => ({ ...s, model: value }));
  };
  const setProfile = (value: string): void => {
    sessions.update(pr, (s) => ({ ...s, profileId: value === "" ? null : value }));
  };
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // diff の行は memo されるので、描画のたびに変わらない関数を渡す
  const askAboutLine = useCallback(
    (path: string, line: number, side: "LEFT" | "RIGHT"): void => {
      setChatReference(sessions, pr, { kind: "line", path, line, side });
      setChatOpen(true);
    },
    [sessions, pr],
  );
  const askAboutFinding = useCallback(
    (findingId: string): void => {
      setChatReference(sessions, pr, { kind: "finding", findingId });
      setChatOpen(true);
    },
    [sessions, pr],
  );
  const [severities, setSeverities] = useState<Set<Severity>>(new Set(DEFAULT_VISIBLE_SEVERITIES));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ message: string; detail: string | null } | null>(
    null,
  );

  useEffect(() => {
    setDetail(null);
    setLoadError(null);
    setDescriptionExpanded(false);
    setChatOpen(false);
    setSubmitError(null);
    fetchPRDetail(pr)
      .then(setDetail)
      .catch((e: unknown) => {
        setLoadError(e instanceof ApiError ? e.message : t().review.loadFailed);
      });
  }, [pr]);

  const handleStatus = (findingId: string, status: FindingStatus): void => {
    setDraft((s) => setStatus(s, findingId, status));
  };
  const handleBody = (findingId: string, body: string): void => {
    setDraft((s) => editBody(s, findingId, body));
  };

  const handleSubmit = async (summary: PRSummary, commitId: string): Promise<void> => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const request = toSubmitRequest(draft, commitId);
      const review = await submitReview(pr, request);
      // 投稿できたことは画面を離れても分かるよう、ストアに残す。見守りは人がオンにする
      recordPosted(sessions, summary, {
        review,
        headSha: commitId,
        event: request.event,
        comments: request.comments.length,
      });
    } catch (e: unknown) {
      // 失敗しても下書きは消さない。そのまま再送できる
      setSubmitError({
        message: e instanceof ApiError ? e.message : t().api.submitFailed,
        detail: e instanceof ApiError ? e.detail : null,
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError !== null) {
    return (
      <main className="page">
        <BackLink onBack={onBack} />
        <p className="error">{loadError}</p>
      </main>
    );
  }

  if (detail === null) {
    return (
      <main className="page">
        <BackLink onBack={onBack} />
        <div className="title-block" data-loading="true" aria-busy="true">
          <p className="muted">{t().review.loading}</p>
        </div>
      </main>
    );
  }

  const text = t().review;
  const chatAvailable = canChat(session, detail.headSha);
  const visible = (item: DraftItem): boolean => severities.has(item.anchored.finding.severity);
  const unanchored = summaryItems(draft).filter(visible);
  const unanchoredCount = summaryItems(draft).length;
  const generalComments = detail.comments.filter((c) => c.path === null);
  const nothingToSend =
    draft.items.every((i) => i.status !== "accepted") &&
    draft.summary.trim() === "" &&
    draft.event !== "APPROVE";
  const numbers = new Map(draft.items.map((item, index) => [item.anchored.finding.id, index + 1]));
  const numberOf = (id: string): number | undefined => numbers.get(id);
  const checkOf = priorCheckLookup(session.priorChecks);
  const counts = Object.fromEntries(
    SEVERITIES.map((s) => [s, draft.items.filter((i) => i.anchored.finding.severity === s).length]),
  ) as Record<Severity, number>;

  const runControls = (
    <>
      <label className="field">
        <span>{text.focus}</span>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          disabled={phase === "running"}
          rows={phase === "idle" ? 3 : 2}
          placeholder={text.focusPlaceholder}
        />
      </label>
      <label className="field">
        <span>{text.profile}</span>
        {/* 選んでいなければ設定の既定。消されたプロファイルを選んでいたときも既定に見せる */}
        <select
          value={
            settings.profiles.some((p) => p.id === profileId)
              ? (profileId as string)
              : settings.defaultProfileId
          }
          onChange={(e) => setProfile(e.target.value)}
          disabled={phase === "running"}
        >
          {settings.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <UsageSummary phase={phase} />
      <label className="field">
        <span>{text.model}</span>
        {/* 「Claude Code の設定に任せる」は空文字で持ち、null に戻す */}
        <select
          value={model ?? ""}
          onChange={(e) =>
            setModel(
              e.target.value === "default"
                ? "default"
                : (REVIEW_MODELS.find((m) => m === e.target.value) ?? null),
            )
          }
          disabled={phase === "running"}
        >
          <option value="default">
            {t().modelName("default")}
            {settings.defaultModel === null ? "" : ` (${t().modelName(settings.defaultModel)})`}
          </option>
          <option value="">{t().modelName(null)}</option>
          {REVIEW_MODELS.map((m) => (
            <option key={m} value={m}>
              {t().modelName(m)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        data-variant="primary"
        onClick={() => void runReview(browserClient, sessions, pr, detail.headSha)}
        disabled={phase === "running"}
      >
        {phase === "running" ? text.running : phase === "idle" ? text.run : text.rerun}
      </button>
    </>
  );

  return (
    <main className="page review">
      <BackLink onBack={onBack} />
      <TitleBlock pr={detail.pr} />

      <div className="review-layout">
        <aside className="review-panel">
          <section className="run-panel" aria-labelledby="run-heading" data-phase={phase}>
            <h2 id="run-heading">{text.aiReview}</h2>
            {phase === "idle" || phase === "running" ? (
              runControls
            ) : (
              <details className="rerun">
                <summary>{text.rerunWithOptions}</summary>
                {runControls}
              </details>
            )}

            {phase === "running" ? (
              <div className="run-progress" role="status">
                <ReviewingSheet />
                <span>{progressText(progress)}</span>
                <span className="muted">{text.mayTakeMinutes}</span>
              </div>
            ) : null}

            {phase === "done" ? (
              <div className="review-result">
                {/* 読み上げ用には完全な一文を、画面には件数を大きく出す */}
                <p className="visually-hidden" role="status">
                  {describeResult(draft, severities)}
                </p>
                {draft.items.length === 0 ? (
                  <p className="review-result-head">{t().noFindings}</p>
                ) : (
                  <>
                    <p className="review-result-head">
                      <strong>{draft.items.length}</strong>
                      {text.findingsUnit(draft.items.length)}
                    </p>
                    {unanchoredCount === 0 ? null : (
                      <p className="review-result-note">{text.unanchoredCount(unanchoredCount)}</p>
                    )}
                    <SeverityFilter value={severities} onChange={setSeverities} counts={counts} />
                  </>
                )}
                <button type="button" className="chat-open" onClick={() => setChatOpen(true)}>
                  {t().chat.open}
                </button>
              </div>
            ) : null}

            {reviewError === null ? null : (
              <div className="error" role="alert">
                <p>{reviewError.message}</p>
                {reviewError.raw === null ? null : (
                  <details>
                    <summary>{t().details}</summary>
                    <pre>{reviewError.raw}</pre>
                  </details>
                )}
              </div>
            )}

            {session.reviewedAt === null || phase === "running" ? null : (
              <div className="saved-result">
                <p>
                  {text.savedAt(formatRelative(session.reviewedAt))}
                  {session.headSha === detail.headSha
                    ? text.savedKept
                    : text.savedStale(session.headSha?.slice(0, 7) ?? "")}
                </p>
                <ConfirmButton
                  key={`${pr.repo}#${pr.number}`}
                  message={session.posted === null ? text.confirmClear : text.confirmClearPosted}
                  confirmLabel={text.clearConfirm}
                  onConfirm={() => sessions.clear(pr)}
                >
                  {text.clear}
                </ConfirmButton>
              </div>
            )}
          </section>

          {/* AI レビューの結果があればその点数を、無ければ diff だけから決めた基準点を出す */}
          {phase === "done" && session.riskScore !== null ? (
            <RiskScoreCard risk={session.riskScore} stale={session.headSha !== detail.headSha} />
          ) : (
            <RiskScoreCard risk={detail.riskScore} stale={false} />
          )}

          {phase !== "done" || draft.items.length === 0 ? null : (
            <FindingIndex items={draft.items.filter(visible)} numberOf={numberOf} />
          )}

          <FileIndex files={detail.files} draft={draft} />

          <div className="submit-area">
            {session.posted === null ? null : (
              <PostedNotice
                posted={session.posted}
                watch={session.watch}
                currentHeadSha={detail.headSha}
                onStop={() => stopWatching(sessions, pr)}
                onStart={() => startWatching(sessions, pr)}
              />
            )}
            {/* AI レビューの成否に関わらず出す。人間が Approve だけ送りたい場合もある */}
            <SubmitBar
              draft={draft}
              onEvent={(event) => setDraft((s) => setEvent(s, event))}
              onSummary={(summary) => setDraft((s) => setSummary(s, summary))}
              onLanguage={(language) => setDraft((s) => setLanguage(s, language))}
              onLgtm={(lgtm) => setDraft((s) => setLgtm(s, lgtm))}
              onSubmit={() => handleSubmit(detail.pr, detail.headSha)}
              submitting={submitting}
              disabled={nothingToSend}
              alreadyPosted={session.posted?.headSha === detail.headSha}
            />
            {submitError === null ? null : (
              <div className="error" role="alert">
                <p>{submitError.message}</p>
                {submitError.detail === null ? null : <pre>{submitError.detail}</pre>}
              </div>
            )}
          </div>
        </aside>

        <div className="review-main">
          <section className="pr-description" data-expanded={descriptionExpanded}>
            <div className="pr-description-head">
              <h2>{t().prDescription}</h2>
              <a href={detail.pr.url} target="_blank" rel="noreferrer">
                {t().openOnGitHub}
              </a>
            </div>
            {detail.bodyHtml === "" ? (
              <p className="muted">{t().noDescription}</p>
            ) : (
              <>
                <div
                  className="pr-body"
                  // GitHub が Markdown から描画・無害化した HTML なので、そのまま差し込む
                  dangerouslySetInnerHTML={{ __html: detail.bodyHtml }}
                  onClick={openLinkInNewTab}
                />
                {/* 長い説明文で diff が画面外に追いやられないよう、最初は高さを抑えて出す */}
                <button
                  type="button"
                  className="pr-description-toggle"
                  aria-expanded={descriptionExpanded}
                  onClick={() => setDescriptionExpanded((v) => !v)}
                >
                  {descriptionExpanded ? text.collapseDescription : text.expandDescription}
                </button>
              </>
            )}
          </section>

          {phase === "running" ? null : <PriorChecks checks={session.priorChecks} />}

          {phase === "running" ? null : <I18nComparisons comparisons={session.i18nComparisons} />}

          {unanchored.length === 0 ? null : (
            <section className="unanchored">
              <header>
                <h2>{t().unanchoredHeading}</h2>
                <p>{t().unanchoredNote}</p>
              </header>
              {unanchored.map((item) => (
                <FindingCard
                  key={item.anchored.finding.id}
                  item={item}
                  number={numberOf(item.anchored.finding.id)}
                  onStatus={(status) => handleStatus(item.anchored.finding.id, status)}
                  onBody={(body) => handleBody(item.anchored.finding.id, body)}
                  onAsk={
                    chatAvailable ? () => askAboutFinding(item.anchored.finding.id) : undefined
                  }
                />
              ))}
            </section>
          )}

          {generalComments.length === 0 ? null : (
            <section className="conversation">
              <h2>{t().prComments}</h2>
              {generalComments.map((c) => (
                <ExistingCommentCard key={c.id} comment={c} check={checkOf(c.id)} />
              ))}
            </section>
          )}

          {detail.files.map((file) => (
            <DiffFileView
              key={file.path}
              file={file}
              items={lineItemsFor(draft, file.path).filter(visible)}
              comments={detail.comments.filter((c) => c.path === file.path)}
              numberOf={numberOf}
              checkOf={checkOf}
              onStatus={handleStatus}
              onBody={handleBody}
              onAskFinding={chatAvailable ? askAboutFinding : undefined}
              onAskLine={chatAvailable ? askAboutLine : undefined}
            />
          ))}
        </div>
      </div>

      <ChatPanel
        key={`${pr.repo}#${pr.number}`}
        sessions={sessions}
        pr={pr}
        session={session}
        headSha={detail.headSha}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
      />
    </main>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <nav className="back">
      <button type="button" onClick={onBack}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        {t().review.back}
      </button>
      <LanguageSwitch />
    </nav>
  );
}
