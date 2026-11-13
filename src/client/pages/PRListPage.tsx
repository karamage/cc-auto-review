import {
  createContext,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  type PRListResponse,
  type PRRef,
  type PRSummary,
  parsePRInput,
  type Severity,
} from "../../shared/types.ts";
import { ApiError, browserClient, fetchPRs } from "../api.ts";
import { candidateCount } from "../state/learnings.ts";
import {
  ActivityHeatmap,
  AuthorBars,
  HeroSummary,
  QueueStrip,
  RepoBars,
  SeverityBar,
  TopBar,
} from "../components/Dashboard.tsx";
import { formatRelative, sizeRatio } from "../format.ts";
import { t } from "../i18n.ts";
import { getSettings } from "../settings.ts";
import {
  pendingReviews,
  type ReviewSession,
  runReviews,
  type SessionStore,
  type Sessions,
  sessionBadge,
  sessionKey,
  useSessions,
} from "../state/sessions.ts";
import { isApproved, postedElsewhere, postedLabel } from "../state/watch.ts";
import {
  allowAutoJudge,
  type AutopilotStore,
  releaseFromAutopilot,
  useAutopilot,
} from "../state/autopilot.ts";
import { AutopilotConsole } from "../components/AutopilotConsole.tsx";

const SEVERITIES: readonly Severity[] = ["blocker", "should", "question", "nit"];

/** リポジトリごとにまとめる。並び順は API の返した順（更新が新しい順）を保つ */
function groupByRepo(prs: PRSummary[]): [string, PRSummary[]][] {
  const groups = new Map<string, PRSummary[]>();
  for (const pr of prs) {
    groups.set(pr.repo, [...(groups.get(pr.repo) ?? []), pr]);
  }
  return [...groups];
}

/** 保存してある AI レビューの指摘を、重大度ごとに数える */
function countBySeverity(session: ReviewSession): Record<Severity, number> {
  const counts: Record<Severity, number> = { blocker: 0, should: 0, question: 0, nit: 0 };
  for (const item of session.draft.items) counts[item.anchored.finding.severity] += 1;
  return counts;
}

/**
 * 一覧の行の間を j / k（または上下の矢印）で移動する。
 * 入力欄や言語の切り替えを操作している間は、文字の入力として扱うので奪わない
 */
function useRowKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const step =
        e.key === "j" || e.key === "ArrowDown" ? 1 : e.key === "k" || e.key === "ArrowUp" ? -1 : 0;
      if (step === 0) return;
      const rows = [
        ...document.querySelectorAll<HTMLButtonElement>(".register-row:not(:disabled)"),
      ];
      if (rows.length === 0) return;
      e.preventDefault();
      const current = rows.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        current === -1
          ? step > 0
            ? 0
            : rows.length - 1
          : Math.min(rows.length - 1, Math.max(0, current + step));
      rows[next]?.focus();
      rows[next]?.scrollIntoView({ block: "nearest" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}

/** 改訂記号の △。数字はその重大度の指摘の件数 */
function SeverityMark({ severity, count }: { severity: Severity; count: number }) {
  return (
    <svg
      className="sev-mark"
      data-severity={severity}
      viewBox="0 0 32 28"
      role="img"
      aria-label={t().list.severityMark(severity, count)}
    >
      <title>{t().list.severityMark(severity, count)}</title>
      <path d="M16 2 30 26H2Z" />
      <text x="16" y="22.5" textAnchor="middle">
        {count}
      </text>
    </svg>
  );
}

/** 保存してある AI レビューの結果を、改訂記号の並びとして出す */
function ReviewMarks({
  session,
  headSha,
}: {
  session: ReviewSession | undefined;
  headSha: string;
}) {
  const text = t().list;
  const badge = sessionBadge(session);
  if (badge === null || session === undefined) {
    return (
      <span className="review-stamp" data-kind="none">
        {text.notReviewed}
      </span>
    );
  }
  if (badge.kind === "queued" || badge.kind === "running") {
    return (
      <span className="review-stamp" data-kind={badge.kind}>
        {badge.kind === "queued" ? text.queued : text.running}
      </span>
    );
  }
  const counts = countBySeverity(session);
  const stale = session.headSha !== null && session.headSha !== headSha;
  return (
    <span className="review-marks" data-stale={stale}>
      {badge.findings === 0 ? (
        <span className="review-clear">{text.savedNone}</span>
      ) : (
        <>
          <span className="review-marks-row">
            {SEVERITIES.filter((s) => counts[s] > 0).map((s) => (
              <SeverityMark key={s} severity={s} count={counts[s]} />
            ))}
          </span>
          <span className="review-marks-note">{text.accepted(badge.accepted, badge.findings)}</span>
        </>
      )}
      {stale ? (
        <span className="review-marks-note" data-stale="true">
          {text.stale}
        </span>
      ) : null}
    </span>
  );
}

/** GitHub に投稿済みかと、その後の見守りの状態。承認したものは朱の印にする */
function PostedStamp({ session }: { session: ReviewSession | undefined }) {
  const label = postedLabel(session);
  if (label === null) return null;
  return (
    <span
      className="review-stamp"
      data-kind={
        session?.watch?.status === "rereviewed"
          ? "rereviewed"
          : isApproved(session)
            ? "approved"
            : "posted"
      }
    >
      {label}
    </span>
  );
}

/** 完全自動運転がこの PR をどう扱ったか。人に回したものは理由を添える */
function AutopilotStamp({
  session,
  enabled,
}: {
  session: ReviewSession | undefined;
  enabled: boolean;
}) {
  const auto = session?.autopilot;
  if (auto == null) return null;
  const text = t().autopilot.stamp;
  const label =
    auto.status === "reviewing"
      ? enabled
        ? text.reviewing
        : text.paused
      : auto.status === "commented"
        ? auto.held === true
          ? text.held
          : text.commented(auto.rounds)
        : text[auto.status];
  return (
    <span className="autopilot-stamp" data-status={auto.status}>
      <span className="autopilot-stamp-label">{label}</span>
      {auto.note === null || auto.status === "reviewing" ? null : (
        <span className="autopilot-stamp-note">{auto.note}</span>
      )}
    </span>
  );
}

/**
 * 人に回された PR を、以降は完全自動運転に任せる。行そのものがボタンなので、行の外に置く
 */
function AutoJudgeAction({ pr, store }: { pr: PRSummary; store: SessionStore }) {
  const text = t().autopilot.autoJudge;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (): void => {
    setBusy(true);
    setError(null);
    allowAutoJudge(browserClient, store, pr)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="auto-judge">
      <button
        type="button"
        disabled={busy}
        title={text.hint(getSettings().autopilot.autoJudgeLabel)}
        onClick={run}
      >
        {busy ? text.busy : text.action}
      </button>
      {error === null ? null : (
        <span className="auto-judge-error" role="alert">
          {text.failed(error)}
        </span>
      )}
    </div>
  );
}

/**
 * 人に回された PR を、ほかの人がレビューしたなどで人が引き取ったときに、自動運転から外す
 */
function ReleaseAction({ pr, store }: { pr: PRSummary; store: SessionStore }) {
  const text = t().autopilot.release;
  return (
    <div className="auto-judge">
      <button type="button" title={text.hint} onClick={() => releaseFromAutopilot(store, pr)}>
        {text.action}
      </button>
    </div>
  );
}

/**
 * 変更規模を製図の寸法線で描く。線の長さは一覧の中の最大に対する対数比で、
 * 追加と削除の割合で線を塗り分ける
 */
function Dimension({ pr, maxSize }: { pr: PRSummary; maxSize: number }) {
  const size = pr.additions + pr.deletions;
  return (
    <span className="dim">
      <span className="dim-figure">
        <span className="dim-total">
          {size.toLocaleString()}
          <small>{t().list.lines}</small>
        </span>
        <span className="dim-split">
          <span className="count-add">+{pr.additions.toLocaleString()}</span>
          <span className="count-del">−{pr.deletions.toLocaleString()}</span>
        </span>
      </span>
      <span
        className="dim-line"
        aria-hidden="true"
        style={{ "--ratio": sizeRatio(size, maxSize) } as CSSProperties}
      >
        <span style={{ flexGrow: pr.additions }} className="dim-add" />
        <span style={{ flexGrow: pr.deletions }} className="dim-del" />
      </span>
      <span className="dim-files">{t().list.files(pr.changedFiles)}</span>
    </span>
  );
}

function Avatar({ login }: { login: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="avatar" aria-hidden="true">
      {failed ? (
        login.slice(0, 1).toUpperCase()
      ) : (
        <img
          src={`https://github.com/${encodeURIComponent(login.replace(/\[bot\]$/, ""))}.png?size=48`}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

function PRRow({
  pr,
  index,
  maxSize,
  saved,
  showRepo = false,
  autopilot = false,
  onSelect,
}: {
  pr: PRSummary;
  /** 読み込み時に寸法線を上から順に引くための通し番号 */
  index: number;
  maxSize: number;
  saved: Sessions;
  /** 投稿済みの段のように、リポジトリでまとめていない行ではリポジトリ名を添える */
  showRepo?: boolean;
  /** 完全自動運転がオンか。止めている間の印の出し分けに使う */
  autopilot?: boolean;
  onSelect: (pr: PRRef) => void;
}) {
  const session = saved[sessionKey(pr)];
  return (
    <button
      type="button"
      className="register-row"
      data-state={session?.phase === "running" ? "running" : undefined}
      style={{ "--i": index } as CSSProperties}
      onClick={() => onSelect({ repo: pr.repo, number: pr.number })}
    >
      <span className="register-number">{pr.number}</span>
      <span className="register-title">
        <strong>{pr.title.trim()}</strong>
        <span className="register-meta">
          <span className="register-author">
            <Avatar login={pr.author} />
            {pr.author}
          </span>
          {showRepo ? <span>{pr.repo}</span> : null}
          <code className="register-branch" title={`${pr.baseRefName} ← ${pr.headRefName}`}>
            {pr.headRefName}
          </code>
          <time dateTime={pr.updatedAt}>{t().updated(formatRelative(pr.updatedAt))}</time>
        </span>
      </span>
      <Dimension pr={pr} maxSize={maxSize} />
      <span className="register-status">
        <ReviewMarks session={session} headSha={pr.headSha} />
        <PostedStamp session={session} />
        <AutopilotStamp session={session} enabled={autopilot} />
      </span>
    </button>
  );
}

/** 図面の凡例。一覧の記号と寸法線が何を表すか */
function Legend() {
  return (
    <ul className="legend">
      {SEVERITIES.map((s) => (
        <li key={s}>
          <svg className="sev-mark" data-severity={s} viewBox="0 0 32 28" aria-hidden="true">
            <path d="M16 2 30 26H2Z" />
          </svg>
          {s}
        </li>
      ))}
      <li>
        <span className="dim-line" aria-hidden="true">
          <span className="dim-add" style={{ flexGrow: 3 }} />
          <span className="dim-del" style={{ flexGrow: 1 }} />
        </span>
        {t().list.legendSize}
      </li>
    </ul>
  );
}

/** 一覧の見出し。記号の凡例と、キーボードでの操作 */
function QueueHead({ count, children }: { count: number | null; children?: ReactNode }) {
  const text = t().list;
  return (
    <header className="queue-head">
      <h2 className="visually-hidden">{text.title}</h2>
      {count === null || count === 0 ? null : (
        <>
          <Legend />
          <p className="key-hints" aria-hidden="true">
            <kbd>j</kbd>
            <kbd>k</kbd>
            <span>{text.keysMove}</span>
            <kbd>Enter</kbd>
            <span>{text.keysOpen}</span>
          </p>
        </>
      )}
      {children}
    </header>
  );
}

/** まとめて AI レビューする操作。冒頭の要約に置く */
function RunAll({ pending, onRunAll }: { pending: number; onRunAll: () => void }) {
  return (
    <button type="button" data-variant="primary" onClick={onRunAll}>
      {t().list.runPending(pending)}
    </button>
  );
}

/** 設定画面を開く。一覧のどこからでも上辺の帯のボタンで開けるよう、枠に渡す */
const OpenSettings = createContext<(() => void) | undefined>(undefined);
const OpenLearnings = createContext<(() => void) | undefined>(undefined);

/** 上辺の帯と、その下の本文からなる画面全体の枠 */
function Shell({ children }: { children: ReactNode }) {
  const [pendingLearnings, setPendingLearnings] = useState(0);
  useEffect(() => {
    // 件数は目印なので、取れなければ出さないだけにする
    browserClient
      .fetchLearnings()
      .then((learnings) => setPendingLearnings(candidateCount(learnings)))
      .catch(() => {});
  }, []);
  return (
    <div className="shell">
      <TopBar
        onOpenSettings={useContext(OpenSettings)}
        onOpenLearnings={useContext(OpenLearnings)}
        pendingLearnings={pendingLearnings}
      />
      <main className="dash" id="top">
        {children}
      </main>
    </div>
  );
}

/**
 * 依頼されていない PR（自分で作った PR など）を、URL を貼ってレビューの対象にする
 */
function OpenByUrl({ onSelect }: { onSelect: (pr: PRRef) => void }) {
  const text = t().list;
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const pr = parsePRInput(value);
    if (pr === null) {
      setInvalid(true);
      return;
    }
    onSelect(pr);
  };
  return (
    <form id="open-by-url" className="open-by-url" onSubmit={onSubmit}>
      <label htmlFor="open-by-url-input" className="visually-hidden">
        {text.openByUrl}
      </label>
      <div className="open-by-url-field">
        <input
          id="open-by-url-input"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder={text.openByUrlPlaceholder}
          title={text.openByUrlLabel}
          value={value}
          aria-invalid={invalid}
          aria-describedby={invalid ? "open-by-url-error" : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setInvalid(false);
          }}
        />
        <button type="submit" disabled={value.trim() === ""}>
          {text.openByUrlButton}
        </button>
      </div>
      {invalid ? (
        <p id="open-by-url-error" className="error" role="alert">
          {text.openByUrlInvalid}
        </p>
      ) : null}
    </form>
  );
}

export function PRListPage({
  sessions,
  autopilot,
  onSelect,
  onOpenSettings,
  onOpenLearnings,
}: {
  sessions: SessionStore;
  autopilot: AutopilotStore;
  onSelect: (pr: PRRef) => void;
  onOpenSettings: () => void;
  onOpenLearnings: () => void;
}) {
  return (
    <OpenSettings.Provider value={onOpenSettings}>
      <OpenLearnings.Provider value={onOpenLearnings}>
        <PRList sessions={sessions} autopilot={autopilot} onSelect={onSelect} />
      </OpenLearnings.Provider>
    </OpenSettings.Provider>
  );
}

function PRList({
  sessions,
  autopilot,
  onSelect,
}: {
  sessions: SessionStore;
  autopilot: AutopilotStore;
  onSelect: (pr: PRRef) => void;
}) {
  const saved = useSessions(sessions);
  const auto = useAutopilot(autopilot);
  const [list, setList] = useState<PRListResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  useRowKeys();

  // 完全自動運転が新しい一覧を取ってきたら、開き直さなくても入れ替える
  useEffect(() => {
    if (auto.list !== null) {
      setList(auto.list);
      setError(null);
    }
  }, [auto.list]);

  useEffect(() => {
    fetchPRs()
      .then(setList)
      .catch((e: unknown) => {
        setError(e instanceof ApiError ? e : new ApiError(t().list.fetchFailed, null));
      });
  }, []);

  if (error !== null || list === null) {
    return (
      <Shell>
        <div className="overview">
          <HeroSummary
            prs={null}
            failed={error !== null}
            sessions={[]}
            saved={saved}
            human={0}
            posted={0}
          />
          <AutopilotConsole store={autopilot} sessions={saved} onSelect={onSelect} />
        </div>
        <section className="queue" id="requests">
          <QueueHead count={null}>
            <OpenByUrl onSelect={onSelect} />
          </QueueHead>
          {error === null ? (
            <div className="register" data-loading="true" aria-busy="true">
              <div className="register-row" />
              <div className="register-row" />
              <div className="register-row" />
            </div>
          ) : (
            <div className="load-error" role="alert">
              <strong>{error.message}</strong>
              {error.detail === null ? null : <pre>{error.detail}</pre>}
            </div>
          )}
        </section>
      </Shell>
    );
  }

  // 完全自動運転が人に回した PR は、いちばん上にまとめて出す。下の段には重ねて出さない
  const human = Object.values(saved).flatMap((s) =>
    s.autopilot?.status === "human" ? [s.autopilot.pr] : [],
  );
  const humanKeys = new Set(human.map(sessionKey));
  const requests = list.prs.filter((pr) => !humanKeys.has(sessionKey(pr)));
  const posted = postedElsewhere(list.prs, saved).filter((p) => !humanKeys.has(sessionKey(p.pr)));
  const maxSize = Math.max(
    0,
    ...[...list.prs, ...posted.map((p) => p.pr), ...human].map((pr) => pr.additions + pr.deletions),
  );
  const pending = pendingReviews(list.prs, saved);
  // 依頼中の PR のうち、AI レビューの結果があるもの。指標と重大度の集計に使う
  const reviewed = list.prs.flatMap((pr) => {
    const session = saved[sessionKey(pr)];
    return session === undefined || session.reviewedAt === null ? [] : [session];
  });
  const dash = t().dashboard;
  let index = 0;

  return (
    <Shell>
      <div className="overview">
        <HeroSummary
          prs={list.prs}
          sessions={reviewed}
          saved={saved}
          human={human.length}
          posted={posted.length}
          strip={<QueueStrip prs={list.prs} saved={saved} human={humanKeys} onSelect={onSelect} />}
          action={
            pending.length === 0 ? undefined : (
              <RunAll
                pending={pending.length}
                onRunAll={() => void runReviews(browserClient, sessions, pending)}
              />
            )
          }
        />
        <AutopilotConsole store={autopilot} sessions={saved} onSelect={onSelect} />
      </div>
      <section className="queue" id="requests">
        <QueueHead count={list.prs.length}>
          <OpenByUrl onSelect={onSelect} />
        </QueueHead>
        {human.length === 0 ? null : (
          <section className="register" data-kind="human">
            <h2>
              {t().autopilot.humanHeading}
              <span className="register-count">{human.length}</span>
            </h2>
            <p className="register-note">{t().autopilot.humanNote}</p>
            {human.map((pr) => (
              <div key={sessionKey(pr)} className="human-item">
                <PRRow
                  pr={pr}
                  index={index++}
                  maxSize={maxSize}
                  saved={saved}
                  showRepo
                  autopilot={auto.enabled}
                  onSelect={onSelect}
                />
                <div className="human-actions">
                  {/* 覚えている head が古ければ、一覧の最新の head で AI レビューする */}
                  <AutoJudgeAction
                    pr={list.prs.find((p) => sessionKey(p) === sessionKey(pr)) ?? pr}
                    store={sessions}
                  />
                  <ReleaseAction pr={pr} store={sessions} />
                </div>
              </div>
            ))}
          </section>
        )}
        {list.prs.length === 0 ? (
          <p className="empty">{t().list.empty}</p>
        ) : (
          groupByRepo(requests).map(([repo, prs]) => (
            <section key={repo} className="register">
              <h2>
                <span className="register-owner">{repo.split("/")[0]}/</span>
                {repo.split("/")[1]}
                <span className="register-count">{prs.length}</span>
              </h2>
              {prs.map((pr) => (
                <PRRow
                  key={pr.number}
                  pr={pr}
                  index={index++}
                  maxSize={maxSize}
                  saved={saved}
                  autopilot={auto.enabled}
                  onSelect={onSelect}
                />
              ))}
            </section>
          ))
        )}
      </section>
      {posted.length === 0 ? null : (
        <section className="queue" id="posted">
          <section className="register" data-kind="posted">
            <h2>
              {t().list.postedHeading}
              <span className="register-count">{posted.length}</span>
            </h2>
            <p className="register-note">{t().list.postedNote}</p>
            {posted.map(({ pr }) => (
              <PRRow
                key={sessionKey(pr)}
                pr={pr}
                index={index++}
                maxSize={maxSize}
                saved={saved}
                showRepo
                autopilot={auto.enabled}
                onSelect={onSelect}
              />
            ))}
          </section>
        </section>
      )}
      {list.prs.length === 0 ? null : (
        <section className="insights" id="insights" aria-labelledby="insights-title">
          <h2 id="insights-title">{dash.insights}</h2>
          <div className="insights-grid">
            <SeverityBar sessions={reviewed} />
            <RepoBars prs={list.prs} />
            <AuthorBars prs={list.prs} />
            <ActivityHeatmap prs={list.prs} sessions={Object.values(saved)} />
          </div>
        </section>
      )}
    </Shell>
  );
}
