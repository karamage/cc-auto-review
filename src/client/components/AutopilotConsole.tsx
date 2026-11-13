import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { PRRef } from "../../shared/types.ts";
import { t } from "../i18n.ts";
import { useSettings } from "../settings.ts";
import {
  autopilotIntervalMs,
  type AutopilotStore,
  type AutopilotView,
  nextPollAt,
  useAutopilot,
} from "../state/autopilot.ts";
import { type AutopilotState, type Sessions, sessionKey } from "../state/sessions.ts";

/**
 * 自動運転が扱った PR の状態。
 * skip-ai-review ラベルで見送った PR と、人が自動運転から外した PR は、
 * 扱っていないのと同じなので数えない
 */
export type Band = Exclude<AutopilotState["status"], "skipped" | "released">;

/** 件数と記録に載せる、自動運転が扱った PR の状態 */
function handled(sessions: Sessions): (AutopilotState & { status: Band })[] {
  return Object.values(sessions).flatMap((s) =>
    s.autopilot == null || s.autopilot.status === "skipped" || s.autopilot.status === "released"
      ? []
      : [s.autopilot as AutopilotState & { status: Band }],
  );
}
/** 件数の並び。手が要るものから、片付いたものへ */
const BANDS: readonly Band[] = ["human", "reviewing", "commented", "approved"];
/** 計器の目盛りの数。1 周が巡回の間隔で、目盛りが進んだ分だけ点く */
const TICKS = 120;
/** 長い目盛りを置く間隔。10 分の間隔なら 1 分ごと */
const MAJOR_EVERY = 12;
const TICK_OUTER = 156;
const TICK_INNER = 142;
const TICK_INNER_MAJOR = 134;
/** 進み具合の点が走る輪 */
const TRACK_RADIUS = 124;
/** 動きの記録に出す件数 */
const LOG_SIZE = 3;

/** 帯ごとの件数 */
export function countBands(sessions: Sessions): Record<Band, number> {
  const counts: Record<Band, number> = { approved: 0, commented: 0, reviewing: 0, human: 0 };
  for (const state of handled(sessions)) counts[state.status] += 1;
  return counts;
}

/** 新しい順に並べた、自動運転の動きの記録 */
export function recentMoves(
  sessions: Sessions,
  size: number = LOG_SIZE,
): (AutopilotState & { status: Band })[] {
  return handled(sessions)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, size);
}

/** 残り時間を「07:42」の形にする */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(t().relative.locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 12 時を 0 度とした時計回りの角度と半径から、座標を出す */
function polar(angle: number, radius: number): [number, number] {
  const rad = (angle * Math.PI) / 180;
  return [radius * Math.sin(rad), -radius * Math.cos(rad)];
}

/** 1 秒ごとに描き直すための現在時刻。動いている間だけ時を刻む */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** 目盛りの座標。描き直す必要が無いので、一度だけ計算する */
const TICK_LINES = Array.from({ length: TICKS }, (_, i) => {
  const major = i % MAJOR_EVERY === 0;
  const angle = (i * 360) / TICKS;
  const [x1, y1] = polar(angle, major ? TICK_INNER_MAJOR : TICK_INNER);
  const [x2, y2] = polar(angle, TICK_OUTER);
  return { i, major, x1, y1, x2, y2 };
});

/**
 * 巡回の計器。1 周が巡回の間隔で、経過した分の目盛りが順に点いていく。
 * 円が閉じると巡回する。巡回中は点いた弧が一周を回り続ける
 */
function Dial({
  view,
  now,
  handledCount,
}: {
  view: AutopilotView;
  now: number;
  handledCount: number;
}) {
  const text = t().autopilot.console;
  const remaining = Math.max(0, nextPollAt(view, now) - now);
  const progress = view.enabled && !view.busy ? 1 - remaining / autopilotIntervalMs() : 0;
  const lit = Math.floor(progress * TICKS);
  // 巻き戻るときだけ動きを付けない。円が閉じて 0 に戻るときに逆回転して見えないように
  const previous = useRef(progress);
  const rewinding = progress < previous.current;
  useEffect(() => {
    previous.current = progress;
  });
  const [hx, hy] = polar(progress * 360, TRACK_RADIUS);

  const readout = !view.enabled
    ? { value: text.readoutOff, caption: text.captionOff }
    : view.busy
      ? { value: text.readoutBusy, caption: text.captionBusy }
      : { value: formatCountdown(remaining), caption: text.captionUntil };

  return (
    <div className="ap-dial">
      <svg viewBox="-170 -170 340 340" aria-hidden="true">
        <circle r={TRACK_RADIUS} className="ap-track" />
        <g className="ap-ticks">
          {TICK_LINES.map((tick) => (
            <line
              key={tick.i}
              x1={tick.x1}
              y1={tick.y1}
              x2={tick.x2}
              y2={tick.y2}
              data-major={tick.major}
              data-lit={tick.i < lit}
              style={{ "--i": tick.i } as CSSProperties}
            />
          ))}
        </g>
        {view.enabled && !view.busy ? (
          <g className="ap-head" data-rewinding={rewinding}>
            <circle
              r={TRACK_RADIUS}
              className="ap-trail"
              pathLength={1}
              strokeDasharray={`${progress} 1`}
              transform="rotate(-90)"
            />
            <circle cx={hx} cy={hy} r="5" className="ap-head-dot" />
          </g>
        ) : null}
        {view.busy ? (
          <g className="ap-sweep">
            <circle r={TRACK_RADIUS} pathLength={1} strokeDasharray="0.22 1" />
          </g>
        ) : null}
      </svg>
      <div
        className="ap-readout"
        role="img"
        aria-label={text.dialLabel(readout.value, handledCount)}
      >
        <strong>{readout.value}</strong>
        <span>{readout.caption}</span>
      </div>
    </div>
  );
}

/** 自動運転を入れ切りするスイッチ。入れたら、状態の言葉と色が一緒に変わる */
function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const text = t().autopilot;
  return (
    <button
      type="button"
      className="ap-switch"
      role="switch"
      aria-checked={on}
      aria-labelledby="autopilot-title"
      aria-describedby="autopilot-status"
      onClick={onToggle}
    >
      <span className="ap-switch-label" aria-hidden="true">
        {on ? text.console.on : text.console.off}
      </span>
      <span className="ap-switch-track" aria-hidden="true">
        <span className="ap-switch-thumb" />
      </span>
    </button>
  );
}

const BAND_GLYPH: Record<Band, string> = {
  human: "M0 -6 5.6 4.5H-5.6Z",
  reviewing: "M-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0",
  commented: "M0 -6 5.6 4.5H-5.6Z",
  approved: "M-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0",
};

function Glyph({ band }: { band: Band }) {
  return (
    <svg className="ap-glyph" data-band={band} viewBox="-8 -8 16 16" aria-hidden="true">
      <path d={BAND_GLYPH[band]} />
    </svg>
  );
}

/**
 * 完全自動運転の操作盤。画面でただひとつ、色と動きを持つ部品にする
 */
export function AutopilotConsole({
  store,
  sessions,
  onSelect,
}: {
  store: AutopilotStore;
  sessions: Sessions;
  onSelect: (pr: PRRef) => void;
}) {
  const text = t().autopilot;
  const view = useAutopilot(store);
  const now = useNow(view.enabled);
  const counts = countBands(sessions);
  const moves = recentMoves(sessions);
  const handledCount = BANDS.reduce((sum, band) => sum + counts[band], 0);

  const config = useSettings().autopilot;
  const modelName =
    config.model === null ? t().modelName(null) : `Claude ${t().modelName(config.model)}`;

  const toggle = (): void => {
    store.update({ enabled: !view.enabled });
  };

  const status = !view.enabled
    ? text.console.statusOff(config.intervalMinutes)
    : view.busy
      ? text.console.statusBusy
      : text.console.statusOn(clockTime(nextPollAt(view, now)));

  return (
    <section
      id="autopilot"
      className="autopilot"
      data-enabled={view.enabled}
      data-busy={view.busy}
      data-motion={config.animations ? "on" : "off"}
      aria-labelledby="autopilot-title"
    >
      <header className="ap-head">
        <h2 id="autopilot-title">{text.toggle}</h2>
        <Switch on={view.enabled} onToggle={toggle} />
      </header>

      <Dial view={view} now={now} handledCount={handledCount} />

      <p id="autopilot-status" className="ap-status" aria-live="polite">
        {status}
      </p>

      {/* まだ何も扱っていなければ、0 の並びは出さない。動いている間だけ、記録が残ることを伝える */}
      {handledCount === 0 ? (
        view.enabled ? (
          <p className="ap-log-empty">{text.console.logEmpty}</p>
        ) : null
      ) : (
        <dl className="ap-tally">
          {BANDS.map((band) => (
            <div key={band} data-band={band} data-zero={counts[band] === 0}>
              <dt>
                <Glyph band={band} />
                {text.console.band[band]}
              </dt>
              <dd>{counts[band]}</dd>
            </div>
          ))}
        </dl>
      )}

      {moves.length === 0 ? null : (
        <ol className="ap-log" aria-label={text.console.logLabel}>
          {moves.map((move) => (
            <li key={`${sessionKey(move.pr)}@${move.updatedAt}`} data-band={move.status}>
              <time dateTime={move.updatedAt}>{clockTime(Date.parse(move.updatedAt))}</time>
              <Glyph band={move.status} />
              <button
                type="button"
                className="ap-log-pr"
                title={move.pr.title}
                onClick={() => onSelect({ repo: move.pr.repo, number: move.pr.number })}
              >
                <span className="ap-log-repo">{move.pr.repo.split("/")[1] ?? move.pr.repo}</span>#
                {move.pr.number}
              </button>
              <span className="ap-log-what">
                {move.status === "commented"
                  ? move.held === true
                    ? text.console.log.held
                    : text.console.log.commented(move.rounds)
                  : text.console.log[move.status]}
              </span>
            </li>
          ))}
        </ol>
      )}

      <footer className="ap-meta">
        <span>{text.console.interval(config.intervalMinutes)}</span>
        <span>{modelName}</span>
        <span>
          {text.console.lastSweep(
            view.polledAt === null ? "—" : clockTime(Date.parse(view.polledAt)),
          )}
        </span>
        <details className="ap-about">
          <summary>{text.console.about}</summary>
          <p>
            {text.description(config.intervalMinutes, modelName, config.approve)}
            {view.enabled ? <span className="ap-hint">{text.notifyHint}</span> : null}
          </p>
        </details>
      </footer>
      {view.enabled && view.error !== null ? (
        <p className="ap-error" role="alert">
          {text.pollFailed(view.error)}
        </p>
      ) : null}
    </section>
  );
}
