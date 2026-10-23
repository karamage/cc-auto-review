import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { SEVERITIES, type PRSummary, type Severity } from "../../shared/types.ts";
import { t } from "../i18n.ts";
import {
  autopilotIntervalMs,
  type AutopilotStore,
  nextPollAt,
  useAutopilot,
} from "../state/autopilot.ts";
import type { ReviewSession, Sessions } from "../state/sessions.ts";
import { formatCountdown } from "./AutopilotConsole.tsx";
import { LanguageSwitch } from "./LanguageSwitch.tsx";

/*
 * 一覧の画面をダッシュボードにする部品。数値はすべて手元の一覧と保存済みの AI レビューから数え、
 * 画面のためだけの値は作らない
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** 時間帯別の表で遡る日数 */
export const HEATMAP_DAYS = 7;

/** 系列の色。リポジトリのように数が決まっていないものに、順に割り当てる */
const SERIES = ["#2ee9ff", "#8b7bff", "#ff5fa8", "#ffc35a", "#3dffb0", "#4d8dff"];

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

export interface TrendPoint {
  at: number;
  /** その PR までに積み上がった変更行数 */
  total: number;
  pr: PRSummary;
}

/** 更新の古い順に PR を並べ、変更行数を積み上げる。最後の点の total が全体の変更行数になる */
export function cumulativeSize(prs: readonly PRSummary[]): TrendPoint[] {
  let total = 0;
  return [...prs]
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
    .map((pr) => {
      total += pr.additions + pr.deletions;
      return { at: Date.parse(pr.updatedAt), total, pr };
    });
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

/** 目盛りの上限。4 等分した目盛りが切りのよい数になる値のうち、max 以上で最小のもの */
export function niceCeiling(max: number): number {
  if (max <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10].find((s) => s * power >= max) ?? 10;
  return step * power;
}

/** 1 秒ごとに進む現在時刻 */
function useClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/* ---------- 線画のアイコン ---------- */

const ICONS = {
  home: "M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3Z",
  requests: "M4 4h16v11h-5l-3 3-3-3H4Z M8 9h8 M8 12h5",
  autopilot: "M12 3a9 9 0 1 0 9 9 M12 7a5 5 0 1 0 5 5 M12 12l6-6 M16 3h5v5",
  insights: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
  posted: "M4 12.5 9 17.5 20 6.5",
  link: "M10 14a4 4 0 0 0 5.7 0l3.3-3.3a4 4 0 0 0-5.7-5.7l-1.2 1.2 M14 10a4 4 0 0 0-5.7 0L5 13.3A4 4 0 0 0 10.7 19l1.2-1.2",
  code: "M8 7 3 12l5 5 M16 7l5 5-5 5 M13.5 4l-3 16",
  spark:
    "M12 3v4 M12 17v4 M3 12h4 M17 12h4 M6 6l2.5 2.5 M15.5 15.5 18 18 M18 6l-2.5 2.5 M8.5 15.5 6 18",
  alert: "M12 3 22 20H2Z M12 10v4.5 M12 17.2v.3",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4 21a8 8 0 0 1 16 0",
  settings: "M4 6h10 M18 6h2 M4 12h4 M12 12h8 M4 18h12 M20 18h0 M14 4v4 M8 10v4 M16 16v4",
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
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

/* ---------- 枠 ---------- */

/** 上辺の見出しと、四隅の光る角を持つ枠 */
export function Panel({
  id,
  className,
  title,
  aside,
  children,
}: {
  id?: string;
  className?: string;
  title: ReactNode;
  /** 見出しの右端に置くもの */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className={className === undefined ? "panel" : `panel ${className}`}>
      <header className="panel-head">
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

/* ---------- 上辺と左の帯 ---------- */

const NAV: readonly {
  id: string;
  icon: IconName;
  key: keyof ReturnType<typeof t>["dashboard"]["nav"];
}[] = [
  { id: "top", icon: "home", key: "dashboard" },
  { id: "requests", icon: "requests", key: "requests" },
  { id: "autopilot", icon: "autopilot", key: "autopilot" },
  { id: "insights", icon: "insights", key: "insights" },
  { id: "posted", icon: "posted", key: "posted" },
  { id: "open-by-url", icon: "link", key: "openByUrl" },
];

/** 製品の印。差分の + と − を、光る輪の中に置く */
function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="brand-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2ee9ff" />
          <stop offset="1" stopColor="#8b7bff" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="20" fill="none" stroke="url(#brand-ring)" strokeWidth="2" />
      <circle
        cx="24"
        cy="24"
        r="14"
        fill="none"
        stroke="url(#brand-ring)"
        strokeWidth="1"
        strokeDasharray="2 3"
        className="brand-mark-orbit"
      />
      <path d="M16 20h8 M20 16v8" stroke="#3dffb0" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M24 30h8" stroke="#ff5f87" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function TopBar({
  active = "top",
  onOpenSettings,
}: {
  active?: string;
  /** 設定画面を開く。無ければボタンを出さない */
  onOpenSettings?: () => void;
}) {
  const text = t().dashboard;
  const now = new Date(useClock());
  const weekday = now.toLocaleDateString(t().relative.locale, { weekday: "short" });
  return (
    <header className="topbar">
      <a className="brand" href="#top">
        <BrandMark />
        <span className="brand-text">
          <strong>CC AUTO REVIEW</strong>
          <span>{text.tagline}</span>
        </span>
      </a>
      <nav className="topnav" aria-label={text.navLabel}>
        {NAV.slice(0, 5).map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            aria-current={item.id === active ? "page" : undefined}
          >
            <Icon name={item.icon} size={16} />
            {text.nav[item.key]}
          </a>
        ))}
      </nav>
      <div className="topbar-clock">
        <time dateTime={now.toISOString()}>
          <span className="clock-date">
            {now.getFullYear()}/{pad(now.getMonth() + 1)}/{pad(now.getDate())}
            <small>({weekday})</small>
          </span>
          <span className="clock-time">
            {pad(now.getHours())}
            <span className="clock-colon">:</span>
            {pad(now.getMinutes())}
          </span>
        </time>
        <span className="topbar-source">
          <span className="live-dot" aria-hidden="true" />
          {text.source}
        </span>
      </div>
      {onOpenSettings === undefined ? null : (
        <button type="button" className="topbar-settings" onClick={onOpenSettings}>
          <Icon name="settings" size={16} />
          {t().settings.open}
        </button>
      )}
      <LanguageSwitch />
    </header>
  );
}

export function SideRail() {
  const text = t().dashboard;
  return (
    <nav className="siderail" aria-label={text.navLabel}>
      {NAV.map((item, i) => (
        <a key={item.id} href={`#${item.id}`} aria-current={i === 0 ? "page" : undefined}>
          <Icon name={item.icon} size={20} />
          <span>{text.nav[item.key]}</span>
        </a>
      ))}
    </nav>
  );
}

/* ---------- 指標のカード ---------- */

function Kpi({
  icon,
  label,
  tone,
  hero = false,
  children,
  foot,
}: {
  icon: IconName;
  label: string;
  tone?: "alert" | "good" | "violet";
  hero?: boolean;
  children: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <div className="kpi" data-tone={tone} data-hero={hero}>
      <span className="kpi-icon">
        <Icon name={icon} size={hero ? 30 : 24} />
      </span>
      <div className="kpi-body">
        <span className="kpi-label">{label}</span>
        <span className="kpi-value">{children}</span>
      </div>
      {foot === undefined ? null : <div className="kpi-foot">{foot}</div>}
    </div>
  );
}

/** 自動運転の指標。次の巡回までを秒で刻む */
function AutopilotKpi({ store }: { store: AutopilotStore }) {
  const text = t().dashboard.kpi;
  const view = useAutopilot(store);
  const now = useClock();
  const remaining = Math.max(0, nextPollAt(view, now) - now);
  const progress = view.enabled && !view.busy ? 1 - remaining / autopilotIntervalMs() : 0;
  return (
    <Kpi
      icon="autopilot"
      label={text.autopilot}
      tone={view.enabled ? "good" : undefined}
      foot={
        <span className="kpi-chip" data-state={view.enabled ? "on" : "off"}>
          <span className="live-dot" aria-hidden="true" />
          {view.enabled
            ? view.busy
              ? text.busy
              : text.next(formatCountdown(remaining))
            : text.paused}
        </span>
      }
    >
      {view.enabled ? text.on : text.off}
      <span className="kpi-meter" aria-hidden="true" style={{ "--p": progress } as CSSProperties} />
    </Kpi>
  );
}

export function KpiStrip({
  prs,
  sessions,
  saved,
  human,
  posted,
  store,
}: {
  prs: readonly PRSummary[];
  /** 依頼中の PR のうち、AI レビューの結果があるもの */
  sessions: readonly ReviewSession[];
  saved: Sessions;
  human: number;
  posted: number;
  store: AutopilotStore;
}) {
  const text = t().dashboard.kpi;
  const additions = prs.reduce((sum, pr) => sum + pr.additions, 0);
  const deletions = prs.reduce((sum, pr) => sum + pr.deletions, 0);
  const totals = severityTotals(sessions);
  const coverage = prs.length === 0 ? 0 : Math.round((sessions.length / prs.length) * 100);
  const repos = new Set(prs.map((pr) => pr.repo)).size;
  const rereviewed = Object.values(saved).filter((s) => s.watch?.status === "rereviewed").length;
  return (
    <div className="kpis">
      <Kpi
        icon="code"
        label={text.lines}
        hero
        foot={
          <span className="kpi-chip">
            <span className="count-add">+{additions.toLocaleString()}</span>
            <span className="count-del">−{deletions.toLocaleString()}</span>
          </span>
        }
      >
        {(additions + deletions).toLocaleString()}
        <small>{text.linesUnit}</small>
      </Kpi>
      <Kpi
        icon="requests"
        label={text.requests}
        foot={<span className="kpi-chip">{text.repos(repos)}</span>}
      >
        {prs.length}
      </Kpi>
      <Kpi
        icon="spark"
        label={text.reviewed}
        tone="violet"
        foot={
          <span className="kpi-progress" style={{ "--p": coverage / 100 } as CSSProperties}>
            <span>{text.coverage(coverage)}</span>
          </span>
        }
      >
        {sessions.length}
        <small>/ {prs.length}</small>
      </Kpi>
      <Kpi
        icon="alert"
        label={text.blockers}
        tone={totals.blocker > 0 ? "alert" : undefined}
        foot={<span className="kpi-chip">{text.should(totals.should)}</span>}
      >
        {totals.blocker}
      </Kpi>
      <AutopilotKpi store={store} />
      <Kpi
        icon="user"
        label={text.human}
        tone={human > 0 ? "alert" : undefined}
        foot={<span className="kpi-chip">{text.posted(posted, rereviewed)}</span>}
      >
        {human}
      </Kpi>
    </div>
  );
}

/* ---------- 推移 ---------- */

const TREND = { width: 760, height: 340, left: 58, right: 28, top: 34, bottom: 34 } as const;

/** 更新の古い順に積み上げた変更行数の推移。最後の点が今の総量 */
export function TrendChart({ prs }: { prs: readonly PRSummary[] }) {
  const text = t().dashboard.trend;
  const points = cumulativeSize(prs);
  const last = points.at(-1);
  if (last === undefined) return <p className="panel-empty">{text.empty}</p>;

  const first = points[0]?.at ?? last.at;
  const now = Math.max(Date.now(), last.at);
  // 点が 1 つでも線が引けるよう、左端は最初の更新より少し前にする
  const start = first - Math.max((now - first) * 0.06, HOUR_MS);
  const ceiling = niceCeiling(last.total * 1.08);
  const plotW = TREND.width - TREND.left - TREND.right;
  const plotH = TREND.height - TREND.top - TREND.bottom;
  const x = (at: number): number => TREND.left + ((at - start) / (now - start)) * plotW;
  const y = (v: number): number => TREND.top + plotH - (v / ceiling) * plotH;

  const coords = [
    [x(start), y(0)],
    ...points.map((p) => [x(p.at), y(p.total)]),
    [x(now), y(last.total)],
  ] as [number, number][];
  const line = coords
    .map(([cx, cy], i) => `${i === 0 ? "M" : "L"}${cx.toFixed(1)} ${cy.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(now).toFixed(1)} ${y(0)} L${x(start).toFixed(1)} ${y(0)}Z`;

  const span = now - start;
  const ticks = Array.from({ length: 5 }, (_, i) => start + (span * (i + 0.5)) / 5);
  const tickLabel = (at: number): string => {
    const d = new Date(at);
    return span < 2 * DAY_MS
      ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
      : `${d.getMonth() + 1}/${d.getDate()}`;
  };
  // 数字が重ならないよう、前に書いた数字と最後の点の両方から離れた点だけに書く
  const labeled = new Set<TrendPoint>([last]);
  let lastX = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    const px = x(p.at);
    if (px - lastX >= 46 && x(last.at) - px >= 54) {
      labeled.add(p);
      lastX = px;
    }
  }

  return (
    <svg
      className="trend"
      viewBox={`0 0 ${TREND.width} ${TREND.height}`}
      role="img"
      aria-label={text.label(points.length, last.total)}
    >
      <defs>
        <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2ee9ff" stopOpacity="0.42" />
          <stop offset="0.6" stopColor="#2ee9ff" stopOpacity="0.08" />
          <stop offset="1" stopColor="#2ee9ff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="trend-stroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8b7bff" />
          <stop offset="1" stopColor="#2ee9ff" />
        </linearGradient>
        <filter id="trend-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g className="trend-grid">
        {[0, 0.25, 0.5, 0.75, 1].map((r) => (
          <g key={r}>
            <line
              x1={TREND.left}
              x2={TREND.width - TREND.right}
              y1={y(ceiling * r)}
              y2={y(ceiling * r)}
            />
            <text
              x={TREND.left - 10}
              y={y(ceiling * r)}
              textAnchor="end"
              dominantBaseline="central"
            >
              {Math.round(ceiling * r).toLocaleString()}
            </text>
          </g>
        ))}
        {ticks.map((at) => (
          <text key={at} x={x(at)} y={TREND.height - 10} textAnchor="middle">
            {tickLabel(at)}
          </text>
        ))}
      </g>
      <path d={area} className="trend-area" fill="url(#trend-fill)" />
      <path
        d={line}
        className="trend-line"
        stroke="url(#trend-stroke)"
        filter="url(#trend-glow)"
        pathLength={1}
      />
      {points.map((p, i) => {
        const isLast = p === last;
        return (
          <g
            key={`${p.pr.repo}#${p.pr.number}`}
            className="trend-point"
            data-last={isLast}
            transform={`translate(${x(p.at).toFixed(1)} ${y(p.total).toFixed(1)})`}
            style={{ "--i": i } as CSSProperties}
          >
            <title>{`${p.pr.repo}#${p.pr.number} ${p.pr.title} (+${p.pr.additions} −${p.pr.deletions})`}</title>
            {isLast ? <circle r="12" className="trend-pulse" /> : null}
            <circle r={isLast ? 5.5 : 3.6} />
            {labeled.has(p) ? (
              <text y={isLast ? -16 : -11} textAnchor="middle">
                {p.total.toLocaleString()}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- 円グラフ ---------- */

interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
}

function Donut({ slices, total, caption }: { slices: Slice[]; total: number; caption: string }) {
  let offset = 0;
  return (
    <div className="donut">
      <svg viewBox="-60 -60 120 120" aria-hidden="true">
        <circle r="44" className="donut-track" />
        {slices.map((s, i) => {
          const share = total === 0 ? 0 : (s.value / total) * 100;
          // 隙間を空けて、つながった 1 本の輪に見えないようにする
          const gap = slices.filter((v) => v.value > 0).length > 1 ? 1.2 : 0;
          const el = (
            <circle
              key={s.key}
              r="44"
              pathLength={100}
              className="donut-slice"
              stroke={s.color}
              strokeDasharray={`${Math.max(share - gap, 0)} ${100 - Math.max(share - gap, 0)}`}
              strokeDashoffset={-offset}
              transform="rotate(-90)"
              style={{ "--i": i, color: s.color } as CSSProperties}
            />
          );
          offset += share;
          return el;
        })}
      </svg>
      <div className="donut-center">
        <span>{caption}</span>
        <strong>{total.toLocaleString()}</strong>
      </div>
    </div>
  );
}

function Legend({ slices, total }: { slices: Slice[]; total: number }) {
  return (
    <ul className="chart-legend">
      {slices.map((s) => (
        <li key={s.key} style={{ "--c": s.color } as CSSProperties}>
          <span className="chart-legend-dot" aria-hidden="true" />
          <span className="chart-legend-label">{s.label}</span>
          <span className="chart-legend-value">{s.value}</span>
          <span className="chart-legend-share">
            {total === 0 ? "0.0" : ((s.value / total) * 100).toFixed(1)}%
          </span>
        </li>
      ))}
    </ul>
  );
}

const SEVERITY_COLOR: Record<Severity, string> = {
  blocker: "#ff4d6d",
  should: "#ffb547",
  question: "#a78bfa",
  nit: "#6f86ad",
};

export function SeverityChart({ sessions }: { sessions: readonly ReviewSession[] }) {
  const text = t().dashboard.severity;
  const totals = severityTotals(sessions);
  const total = SEVERITIES.reduce((sum, s) => sum + totals[s], 0);
  const slices = SEVERITIES.map((s) => ({
    key: s,
    label: s,
    value: totals[s],
    color: SEVERITY_COLOR[s],
  }));
  return (
    <div className="chart-pair">
      <Donut slices={slices} total={total} caption={text.total} />
      {total === 0 ? (
        <p className="panel-empty">{text.empty}</p>
      ) : (
        <Legend slices={slices} total={total} />
      )}
    </div>
  );
}

export function RepoChart({ prs }: { prs: readonly PRSummary[] }) {
  const text = t().dashboard.repos;
  const shares = repoShares(prs);
  // 色が足りなくなる分は「その他」にまとめる
  const head = shares.slice(0, SERIES.length - 1);
  const rest = shares.slice(SERIES.length - 1).reduce((sum, s) => sum + s.count, 0);
  const slices: Slice[] = [
    ...head.map((s, i) => ({
      key: s.repo,
      label: s.repo.split("/")[1] ?? s.repo,
      value: s.count,
      color: SERIES[i] ?? "#2ee9ff",
    })),
    ...(rest > 0
      ? [{ key: "rest", label: text.rest, value: rest, color: SERIES.at(-1) ?? "#4d8dff" }]
      : []),
  ];
  return (
    <div className="chart-pair">
      <Donut slices={slices} total={prs.length} caption={text.total} />
      <Legend slices={slices} total={prs.length} />
    </div>
  );
}

/* ---------- 時間帯の表 ---------- */

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
    <div className="heatmap" role="table" aria-label={text.title}>
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
                style={{ "--d": (r * 24 + hour) % 37 } as CSSProperties}
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
          <span key={hour}>{hour % 4 === 0 ? hour : ""}</span>
        ))}
      </div>
    </div>
  );
}

/* ---------- 作成者 ---------- */

export function AuthorBars({ prs }: { prs: readonly PRSummary[] }) {
  const text = t().dashboard.authors;
  const load = authorLoad(prs);
  const max = Math.max(1, ...load.map((a) => a.lines));
  if (load.length === 0) return <p className="panel-empty">{text.empty}</p>;
  return (
    <ol className="bars">
      {load.map((a, i) => (
        <li key={a.author} style={{ "--p": a.lines / max, "--i": i } as CSSProperties}>
          <span className="bars-name">
            <img
              src={`https://github.com/${encodeURIComponent(a.author.replace(/\[bot\]$/, ""))}.png?size=40`}
              alt=""
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.visibility = "hidden";
              }}
            />
            {a.author}
            <small>{text.prs(a.count)}</small>
          </span>
          <span className="bars-track" aria-hidden="true">
            <span />
          </span>
          <span className="bars-value">{a.lines.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}
