import type { CSSProperties, ReactNode } from "react";
import { SEVERITIES, type PRRef, type PRSummary, type Severity } from "../../shared/types.ts";
import { sizeRatio } from "../format.ts";
import { t } from "../i18n.ts";
import { type ReviewSession, type Sessions, sessionBadge, sessionKey } from "../state/sessions.ts";
import { LanguageSwitch } from "./LanguageSwitch.tsx";

/*
 * 一覧の画面の上半分と、下に添える傾向の部品。数値はすべて手元の一覧と保存済みの AI レビューから数え、
 * 画面のためだけの値は作らない。ひとつの事実は画面の中で一度だけ出す
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** 時間帯別の表で遡る日数 */
export const HEATMAP_DAYS = 7;

/** 保存してある AI レビューの指摘を、重大度ごとに合計する */
export function severityTotals(sessions: readonly ReviewSession[]): Record<Severity, number> {
  const totals: Record<Severity, number> = { blocker: 0, should: 0, question: 0, nit: 0 };
  for (const session of sessions) {
    for (const item of session.draft.items) totals[item.anchored.finding.severity] += 1;
  }
  return totals;
}

/** リポジトリごとの PR の数。多い順で、同数なら名前順 */
export function repoShares(prs: readonly PRSummary[]): { repo: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const pr of prs) counts.set(pr.repo, (counts.get(pr.repo) ?? 0) + 1);
  return [...counts]
    .map(([repo, count]) => ({ repo, count }))
    .sort((a, b) => b.count - a.count || a.repo.localeCompare(b.repo));
}

/**
 * 直近 HEATMAP_DAYS 日の動きを、日 × 時（0〜23 時）の表に数える。
 * 行は古い日から今日の順。PR の更新、AI レビューの完了、自動運転の動きをそれぞれ 1 件とする
 */
export function activityGrid(
  prs: readonly PRSummary[],
  sessions: readonly ReviewSession[],
  now: number,
): number[][] {
  const grid = Array.from({ length: HEATMAP_DAYS }, () => Array<number>(24).fill(0));
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const add = (iso: string | null | undefined): void => {
    if (iso == null) return;
    const at = new Date(iso);
    if (Number.isNaN(at.getTime()) || at.getTime() > now) return;
    const day = new Date(at);
    day.setHours(0, 0, 0, 0);
    const ago = Math.round((today.getTime() - day.getTime()) / DAY_MS);
    const row = grid[HEATMAP_DAYS - 1 - ago];
    if (row !== undefined) row[at.getHours()] = (row[at.getHours()] ?? 0) + 1;
  };
  for (const pr of prs) add(pr.updatedAt);
  for (const session of sessions) {
    add(session.reviewedAt);
    add(session.autopilot?.updatedAt);
  }
  return grid;
}

/** 作成者ごとの変更行数。多い順に limit 人まで */
export function authorLoad(
  prs: readonly PRSummary[],
  limit = 5,
): { author: string; lines: number; count: number }[] {
  const load = new Map<string, { lines: number; count: number }>();
  for (const pr of prs) {
    const current = load.get(pr.author) ?? { lines: 0, count: 0 };
    load.set(pr.author, {
      lines: current.lines + pr.additions + pr.deletions,
      count: current.count + 1,
    });
  }
  return [...load]
    .map(([author, v]) => ({ author, ...v }))
    .sort((a, b) => b.lines - a.lines || a.author.localeCompare(b.author))
    .slice(0, limit);
}

/* ---------- 線画のアイコン ---------- */

const ICONS = {
  settings: "M4 6h10 M18 6h2 M4 12h4 M12 12h8 M4 18h12 M20 18h0 M14 4v4 M8 10v4 M16 16v4",
  book: "M5 4.5h9.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3Z M5 17a3 3 0 0 1 3-3h9.5",
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

/* ---------- 上辺の帯 ---------- */

/**
 * 製品の印。巡回の輪と、輪の上を進む自動運転の点。
 * 輪の切れ目は「まだ巡回していない残り」を表し、計器の弧と同じ形にそろえる
 */
function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <circle
        cx="16"
        cy="16"
        r="11"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        pathLength={100}
        strokeDasharray="78 22"
        transform="rotate(-90 16 16)"
        strokeLinecap="round"
      />
      <circle cx="5.6" cy="12.4" r="3" className="brand-mark-dot" />
    </svg>
  );
}

export function TopBar({
  onOpenSettings,
  onOpenLearnings,
  pendingLearnings = 0,
}: {
  /** 設定画面を開く。無ければボタンを出さない */
  onOpenSettings?: () => void;
  /** 学び帳を開く。無ければボタンを出さない */
  onOpenLearnings?: () => void;
  /** 人が確かめていない学びの候補の数 */
  pendingLearnings?: number;
}) {
  return (
    <header className="topbar">
      <a className="brand" href="#top">
        <BrandMark />
        <span className="brand-name">CC Auto Review</span>
        <span className="brand-tagline">{t().dashboard.tagline}</span>
      </a>
      <nav className="topbar-actions">
        {onOpenLearnings === undefined ? null : (
          <button type="button" data-variant="ghost" onClick={onOpenLearnings}>
            <Icon name="book" size={16} />
            {t().learnings.open}
            {pendingLearnings === 0 ? null : (
              <span className="topbar-badge" title={t().learnings.pendingBadge(pendingLearnings)}>
                {pendingLearnings}
              </span>
            )}
          </button>
        )}
        {onOpenSettings === undefined ? null : (
          <button type="button" data-variant="ghost" onClick={onOpenSettings}>
            <Icon name="settings" size={16} />
            {t().settings.open}
          </button>
        )}
        <LanguageSwitch />
      </nav>
    </header>
  );
}

/* ---------- 冒頭の要約 ---------- */

/** 依頼の 1 件が、いまどこまで進んでいるか */
export type StripState = "human" | "running" | "reviewed" | "pending";

/**
 * 依頼ごとの進み具合。自動運転が人に回したものを最優先にし、
 * 結果があっても今の head と違えばまだ見ていないものとして数える
 */
export function stripState(pr: PRSummary, saved: Sessions, human: ReadonlySet<string>): StripState {
  if (human.has(sessionKey(pr))) return "human";
  const session = saved[sessionKey(pr)];
  const badge = sessionBadge(session);
  if (badge === null) return "pending";
  if (badge.kind !== "saved") return "running";
  return session?.headSha === pr.headSha ? "reviewed" : "pending";
}

/** 帯を出す件数の下限。数本では帯として読めないので、数字だけにする */
const STRIP_MIN = 4;

const STRIP_ORDER: Record<StripState, number> = { human: 0, running: 1, pending: 2, reviewed: 3 };

/**
 * 依頼を 1 本ずつの縦線で並べた帯。高さは変更行数（対数）、色は進み具合。
 * 計器の目盛りと同じ形で、待っている仕事の量と内訳がひと目で分かる
 */
export function QueueStrip({
  prs,
  saved,
  human,
  onSelect,
}: {
  prs: readonly PRSummary[];
  saved: Sessions;
  human: ReadonlySet<string>;
  onSelect: (pr: PRRef) => void;
}) {
  const text = t().dashboard.strip;
  const maxSize = Math.max(0, ...prs.map((pr) => pr.additions + pr.deletions));
  const items = prs
    .map((pr) => ({ pr, state: stripState(pr, saved, human) }))
    .sort((a, b) => STRIP_ORDER[a.state] - STRIP_ORDER[b.state]);
  const count = (state: StripState): number => items.filter((i) => i.state === state).length;
  return (
    <figure className="strip">
      <div className="strip-bars" style={{ "--n": items.length } as CSSProperties}>
        {items.map(({ pr, state }, i) => (
          <button
            key={sessionKey(pr)}
            type="button"
            tabIndex={-1}
            className="strip-bar"
            data-state={state}
            title={`${pr.repo}#${pr.number} ${pr.title}`}
            aria-label={`${pr.repo}#${pr.number} ${text.state[state]}`}
            style={
              {
                "--h": sizeRatio(pr.additions + pr.deletions, maxSize),
                "--i": i,
              } as CSSProperties
            }
            onClick={() => onSelect({ repo: pr.repo, number: pr.number })}
          />
        ))}
      </div>
      <figcaption className="strip-legend">
        {(["human", "pending", "reviewed"] as const).map((state) =>
          count(state) === 0 && state === "human" ? null : (
            <span key={state} data-state={state}>
              {text.state[state]}
              <strong>{count(state) + (state === "pending" ? count("running") : 0)}</strong>
            </span>
          ),
        )}
        <span className="strip-note">{text.note}</span>
      </figcaption>
    </figure>
  );
}

function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>
        <span className="stat-value">{value}</span>
        {note === undefined ? null : <span className="stat-note">{note}</span>}
      </dd>
    </div>
  );
}

/**
 * 画面の冒頭。いまレビューを待っている依頼の数を大きく出し、
 * そのうち人の判断が要るものと、まとめて AI レビューする操作を添える
 */
export function HeroSummary({
  prs,
  sessions,
  saved,
  human,
  posted,
  strip,
  action,
  failed = false,
}: {
  /** null は読み込み中か、取得に失敗した */
  prs: readonly PRSummary[] | null;
  /** 一覧を取得できなかった */
  failed?: boolean;
  /** 依頼中の PR のうち、AI レビューの結果があるもの */
  sessions: readonly ReviewSession[];
  saved: Sessions;
  human: number;
  posted: number;
  /** 依頼ごとの進み具合の帯。数字の横に置く */
  strip?: ReactNode;
  /** まとめて AI レビューするボタン */
  action?: ReactNode;
}) {
  const text = t().dashboard;
  if (prs === null) {
    return (
      <section className="hero-summary" aria-busy={!failed}>
        <h1 className="hero-label">{text.hero.label}</h1>
        {failed ? null : (
          <p className="hero-count" data-loading="true">
            <span className="hero-count-skeleton" />
          </p>
        )}
        <p className="hero-line" data-failed={failed}>
          {failed ? t().list.fetchFailed : text.hero.loading}
        </p>
      </section>
    );
  }
  const additions = prs.reduce((sum, pr) => sum + pr.additions, 0);
  const deletions = prs.reduce((sum, pr) => sum + pr.deletions, 0);
  const totals = severityTotals(sessions);
  const repos = new Set(prs.map((pr) => pr.repo)).size;
  const rereviewed = Object.values(saved).filter((s) => s.watch?.status === "rereviewed").length;
  return (
    <section className="hero-summary">
      <h1 className="hero-label">
        {text.hero.label}
        {repos === 0 ? null : <span className="hero-label-note">{text.hero.repos(repos)}</span>}
      </h1>
      <div className="hero-figure">
        <p className="hero-count">{prs.length}</p>
        {prs.length < STRIP_MIN ? null : strip}
      </div>
      <p className="hero-line" data-attention={human > 0}>
        {human > 0 ? text.hero.forYou(human) : prs.length === 0 ? text.hero.none : text.hero.clear}
      </p>
      {action === undefined ? null : <div className="hero-action">{action}</div>}
      {prs.length === 0 ? null : (
        <dl className="stats">
          <Stat
            label={text.stat.lines}
            value={(additions + deletions).toLocaleString()}
            note={
              <>
                <span className="count-add">+{additions.toLocaleString()}</span>
                <span className="count-del">−{deletions.toLocaleString()}</span>
              </>
            }
          />
          {sessions.length === 0 ? null : (
            <Stat
              label={text.stat.blockers}
              value={<span data-alert={totals.blocker > 0}>{totals.blocker}</span>}
              note={text.stat.should(totals.should)}
            />
          )}
          {posted === 0 ? null : (
            <Stat
              label={text.stat.posted}
              value={posted}
              note={rereviewed === 0 ? undefined : text.stat.rereviewed(rereviewed)}
            />
          )}
        </dl>
      )}
    </section>
  );
}

/* ---------- 傾向 ---------- */

function Figure({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <figure className="figure">
      <figcaption>
        {title}
        {note === undefined ? null : <span>{note}</span>}
      </figcaption>
      {children}
    </figure>
  );
}

/** 指摘の重大度を、1 本の帯の長さの比で見せる */
export function SeverityBar({ sessions }: { sessions: readonly ReviewSession[] }) {
  const text = t().dashboard.severity;
  const totals = severityTotals(sessions);
  const total = SEVERITIES.reduce((sum, s) => sum + totals[s], 0);
  return (
    <Figure title={text.title}>
      {total === 0 ? (
        <p className="figure-empty">{text.empty}</p>
      ) : (
        <>
          <div className="severity-bar" role="img" aria-label={text.label(total)}>
            {SEVERITIES.filter((s) => totals[s] > 0).map((s) => (
              <span key={s} data-severity={s} style={{ flexGrow: totals[s] }} />
            ))}
          </div>
          <dl className="severity-legend">
            {SEVERITIES.map((s) => (
              <div key={s} data-severity={s} data-zero={totals[s] === 0}>
                <dt>{s}</dt>
                <dd>{totals[s]}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Figure>
  );
}

/** 名前と数を、最大に対する長さの細い線で並べる */
function BarList({
  rows,
}: {
  rows: { key: string; label: ReactNode; value: number; display?: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className="bar-list">
      {rows.map((r) => (
        <li key={r.key} style={{ "--p": r.value / max } as CSSProperties}>
          <span className="bar-list-label">{r.label}</span>
          <span className="bar-list-value">{r.display ?? r.value.toLocaleString()}</span>
          <span className="bar-list-track" aria-hidden="true" />
        </li>
      ))}
    </ol>
  );
}

/** 載せるリポジトリの数。これを超える分は「その他」にまとめる */
const REPO_ROWS = 4;

export function RepoBars({ prs }: { prs: readonly PRSummary[] }) {
  const text = t().dashboard.repos;
  const shares = repoShares(prs);
  const head = shares.slice(0, REPO_ROWS);
  const rest = shares.slice(REPO_ROWS).reduce((sum, s) => sum + s.count, 0);
  return (
    <Figure title={text.title}>
      <BarList
        rows={[
          ...head.map((s) => ({
            key: s.repo,
            label: (
              <>
                <span className="bar-list-owner">{s.repo.split("/")[0]}/</span>
                {s.repo.split("/")[1] ?? s.repo}
              </>
            ),
            value: s.count,
          })),
          ...(rest > 0 ? [{ key: "rest", label: text.rest, value: rest }] : []),
        ]}
      />
    </Figure>
  );
}

export function AuthorBars({ prs }: { prs: readonly PRSummary[] }) {
  const text = t().dashboard.authors;
  const load = authorLoad(prs, 4);
  return (
    <Figure title={text.title}>
      {load.length === 0 ? (
        <p className="figure-empty">{text.empty}</p>
      ) : (
        <BarList
          rows={load.map((a) => ({
            key: a.author,
            label: (
              <>
                {a.author}
                <small>{text.prs(a.count)}</small>
              </>
            ),
            value: a.lines,
          }))}
        />
      )}
    </Figure>
  );
}

export function ActivityHeatmap({
  prs,
  sessions,
}: {
  prs: readonly PRSummary[];
  sessions: readonly ReviewSession[];
}) {
  const text = t().dashboard.heatmap;
  const now = Date.now();
  const grid = activityGrid(prs, sessions, now);
  const max = Math.max(1, ...grid.flat());
  const currentHour = new Date(now).getHours();
  return (
    <Figure title={text.title} note={text.note}>
      <div className="heatmap" role="table" aria-label={text.note}>
        {grid.map((row, r) => {
          const ago = HEATMAP_DAYS - 1 - r;
          const day = new Date(now - ago * DAY_MS);
          const label =
            ago === 0
              ? text.today
              : day.toLocaleDateString(t().relative.locale, { weekday: "short" });
          return (
            <div key={day.toDateString()} className="heatmap-row" role="row">
              <span className="heatmap-day" role="rowheader">
                {label}
              </span>
              {row.map((n, hour) => (
                <span
                  // eslint-disable-next-line react/no-array-index-key -- 0〜23 時の固定の列
                  key={hour}
                  role="cell"
                  className="heatmap-cell"
                  data-level={n === 0 ? 0 : Math.ceil((n / max) * 4)}
                  data-now={ago === 0 && hour === currentHour}
                  title={text.cell(label, hour, n)}
                />
              ))}
            </div>
          );
        })}
        <div className="heatmap-axis" aria-hidden="true">
          <span />
          {Array.from({ length: 24 }, (_, hour) => (
            // eslint-disable-next-line react/no-array-index-key -- 0〜23 時の固定の目盛り
            <span key={hour}>{hour % 6 === 0 ? hour : ""}</span>
          ))}
        </div>
      </div>
    </Figure>
  );
}
