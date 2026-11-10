import { type ReactNode, useEffect, useState } from "react";
import {
  type Learning,
  LEARNING_MAX_TEXT_LENGTH,
  LEARNING_PROMPT_LIMIT,
} from "../../shared/types.ts";
import { ApiError, browserClient } from "../api.ts";
import { ConfirmButton } from "../components/ConfirmButton.tsx";
import { LanguageSwitch } from "../components/LanguageSwitch.tsx";
import { t } from "../i18n.ts";
import { learningRepos } from "../state/learnings.ts";

type Act = (action: () => Promise<unknown>, done?: string) => Promise<boolean>;

function LearningItem({ item, busy, act }: { item: Learning; busy: boolean; act: Act }) {
  const text = t().learnings;
  const [draft, setDraft] = useState<string | null>(null);
  const isCandidate = item.status === "candidate";

  const editor: ReactNode = (
    <>
      <textarea
        value={draft ?? ""}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={text.editLabel}
        maxLength={LEARNING_MAX_TEXT_LENGTH}
        rows={3}
      />
      <footer>
        <button
          type="button"
          data-variant="primary"
          disabled={busy || (draft ?? "").trim() === ""}
          onClick={() =>
            void act(() =>
              browserClient.updateLearning(
                item.id,
                isCandidate ? { text: draft ?? "", adopt: true } : { text: draft ?? "" },
              ),
            ).then((ok) => {
              if (ok) setDraft(null);
            })
          }
        >
          {isCandidate ? text.saveAndAdopt : text.save}
        </button>
        <button type="button" disabled={busy} onClick={() => setDraft(null)}>
          {text.cancel}
        </button>
      </footer>
    </>
  );

  const actions: ReactNode = isCandidate ? (
    <footer>
      <button
        type="button"
        data-variant="primary"
        disabled={busy}
        onClick={() => void act(() => browserClient.updateLearning(item.id, { adopt: true }))}
      >
        {text.adopt}
      </button>
      <button type="button" disabled={busy} onClick={() => setDraft(item.text)}>
        {text.edit}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void act(() => browserClient.removeLearning(item.id))}
      >
        {text.reject}
      </button>
    </footer>
  ) : (
    <footer>
      <button
        type="button"
        aria-pressed={item.pinned}
        disabled={busy}
        onClick={() =>
          void act(() => browserClient.updateLearning(item.id, { pinned: !item.pinned }))
        }
      >
        {item.pinned ? text.unpin : text.pin}
      </button>
      <button type="button" disabled={busy} onClick={() => setDraft(item.text)}>
        {text.edit}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void act(() => browserClient.updateLearning(item.id, { adopt: false }))}
      >
        {text.unadopt}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void act(() => browserClient.removeLearning(item.id))}
      >
        {text.remove}
      </button>
    </footer>
  );

  return (
    <li className="learning-item" data-pinned={item.pinned}>
      {draft === null ? <p>{item.text}</p> : editor}
      <p className="learning-meta">
        <span>{item.prNumber === null ? text.byHuman : text.fromPr(item.prNumber)}</span>
        {!isCandidate && !item.inPrompt ? <span>{text.outOfPrompt}</span> : null}
      </p>
      {draft === null ? actions : null}
    </li>
  );
}

export function LearningsPage({ onBack }: { onBack: () => void }) {
  const text = t().learnings;
  const [learnings, setLearnings] = useState<Learning[] | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ error: boolean; message: string } | null>(null);
  // null の間は、開いている repo をそのまま宛先にする
  const [addRepo, setAddRepo] = useState<string | null>(null);
  const [addText, setAddText] = useState("");

  const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  useEffect(() => {
    browserClient
      .fetchLearnings()
      .then(setLearnings)
      .catch((e: unknown) => {
        setLearnings([]);
        setStatus({ error: true, message: e instanceof ApiError ? e.message : message(e) });
      });
  }, []);

  const repos = learningRepos(learnings ?? []);
  const current = repo !== null && repos.includes(repo) ? repo : (repos[0] ?? null);
  const inRepo = (learnings ?? []).filter((item) => item.repo === current);
  const candidates = inRepo.filter((item) => item.status === "candidate");
  const adopted = inRepo.filter((item) => item.status === "active");
  const addTarget = addRepo ?? current ?? "";

  const act: Act = async (action, done) => {
    setBusy(true);
    setStatus(null);
    try {
      await action();
      setLearnings(await browserClient.fetchLearnings());
      if (done !== undefined) setStatus({ error: false, message: done });
      return true;
    } catch (e) {
      setStatus({ error: true, message: message(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const reset = (target: string | null): void => {
    setBusy(true);
    setStatus(null);
    browserClient
      .resetLearnings(target)
      .then(async (removed) => {
        setLearnings(await browserClient.fetchLearnings());
        setStatus({ error: false, message: text.resetDone(removed) });
      })
      .catch((e: unknown) => setStatus({ error: true, message: message(e) }))
      .finally(() => setBusy(false));
  };

  return (
    <main className="page learnings">
      <nav className="back">
        <button type="button" onClick={onBack}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          {text.back}
        </button>
        <LanguageSwitch />
      </nav>

      <header className="settings-head">
        <h1>{text.title}</h1>
      </header>
      <p className="muted">{text.intro}</p>
      <p className="muted">{text.limit(LEARNING_PROMPT_LIMIT)}</p>

      {status === null ? null : (
        <p role="status" className={status.error ? "error" : "muted"}>
          {status.message}
        </p>
      )}

      {learnings === null ? (
        <p className="muted">{text.loading}</p>
      ) : repos.length === 0 ? (
        <p className="muted">{text.empty}</p>
      ) : (
        <>
          <label className="learning-repo">
            <span>{text.repoLabel}</span>
            <select value={current ?? ""} onChange={(e) => setRepo(e.target.value)}>
              {repos.map((name) => {
                const pending = (learnings ?? []).filter(
                  (item) => item.repo === name && item.status === "candidate",
                ).length;
                return (
                  <option key={name} value={name}>
                    {pending === 0 ? name : `${name} (${text.candidates} ${pending})`}
                  </option>
                );
              })}
            </select>
          </label>

          <section aria-label={text.candidates}>
            <h2>
              {text.candidates} <small>{candidates.length}</small>
            </h2>
            {candidates.length === 0 ? (
              <p className="muted">{text.candidatesEmpty}</p>
            ) : (
              <p className="muted">{text.candidatesCaution}</p>
            )}
            <ul className="learning-list">
              {candidates.map((item) => (
                <LearningItem key={item.id} item={item} busy={busy} act={act} />
              ))}
            </ul>
          </section>

          <section aria-label={text.adopted}>
            <h2>
              {text.adopted} <small>{adopted.length}</small>{" "}
              <small>{text.inPromptCount(adopted.filter((item) => item.inPrompt).length)}</small>
            </h2>
            {adopted.length === 0 ? <p className="muted">{text.adoptedEmpty}</p> : null}
            <ul className="learning-list">
              {adopted.map((item) => (
                <LearningItem key={item.id} item={item} busy={busy} act={act} />
              ))}
            </ul>
          </section>
        </>
      )}

      <section aria-label={text.add}>
        <h2>{text.add}</h2>
        <label className="learning-repo">
          <span>{text.addRepoLabel}</span>
          <input value={addTarget} onChange={(e) => setAddRepo(e.target.value)} />
        </label>
        <textarea
          value={addText}
          onChange={(e) => setAddText(e.target.value)}
          aria-label={text.addTextLabel}
          placeholder={text.addPlaceholder}
          maxLength={LEARNING_MAX_TEXT_LENGTH}
          rows={3}
        />
        <footer className="learning-actions">
          <button
            type="button"
            data-variant="primary"
            disabled={busy || addText.trim() === "" || addTarget.trim() === ""}
            onClick={() =>
              void act(() => browserClient.addLearning(addTarget, addText), text.added).then(
                (ok) => {
                  if (!ok) return;
                  setAddText("");
                  setAddRepo(null);
                  setRepo(addTarget.trim().toLowerCase());
                },
              )
            }
          >
            {text.add}
          </button>
        </footer>
      </section>

      {repos.length === 0 ? null : (
        <footer className="learning-actions">
          {current === null ? null : (
            <ConfirmButton
              message={text.confirmReset(current)}
              confirmLabel={text.confirmResetLabel}
              disabled={busy}
              onConfirm={() => reset(current)}
            >
              {text.reset}
            </ConfirmButton>
          )}
          <ConfirmButton
            message={text.confirmResetAll}
            confirmLabel={text.confirmResetLabel}
            disabled={busy}
            onConfirm={() => reset(null)}
          >
            {text.resetAll}
          </ConfirmButton>
        </footer>
      )}
    </main>
  );
}
