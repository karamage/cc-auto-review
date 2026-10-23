import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { PRRef, PRSummary } from "../../shared/types.ts";
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
 * 計器盤の同心円の帯。内側ほど片付いた状態で、外側ほど手が要る。
 * 帯の並びがそのまま処理の段階を表す。
 * skip-ai-review ラベルで見送った PR と、人が自動運転から外した PR は、
 * 扱っていないのと同じなので計器に載せない
 */
export type Band = Exclude<AutopilotState["status"], "skipped" | "released">;

/** 計器と記録に載せる、自動運転が扱った PR の状態 */
function handled(sessions: Sessions): (AutopilotState & { status: Band })[] {
  return Object.values(sessions).flatMap((s) =>
    s.autopilot == null || s.autopilot.status === "skipped" || s.autopilot.status === "released"
      ? []
      : [s.autopilot as AutopilotState & { status: Band }],
  );
}
const BANDS: readonly Band[] = ["approved", "commented", "reviewing", "human"];
const BAND_RADIUS: Record<Band, number> = {
  approved: 70,
  commented: 96,
  reviewing: 122,
  human: 148,
};
/** コンパスが 10 分かけて描く円 */
const ARC_RADIUS = 168;
/** 6 時の方向は帯の名前を書く場所として空けておく。バルーンはその左右の間に並べる */
const GAP_DEGREES = 44;
const BALLOON_RADIUS = 13;
const ARC_LENGTH = 2 * Math.PI * ARC_RADIUS;
/** 1 周 50 目盛り（12 秒ごと）、5 目盛りごと（1 分ごと）に長い目盛りと数字 */
const TICKS = 50;
/** 動きの記録に出す件数 */
const LOG_SIZE = 5;

export interface Blip {
  key: string;
  pr: PRSummary;
  band: Band;
  /** 12 時の方向を 0 とした時計回りの角度 */
  angle: number;
}

/** 帯ごとの件数。計器に載りきらない分も数える */
export function countBands(sessions: Sessions): Record<Band, number> {
  const counts: Record<Band, number> = { approved: 0, commented: 0, reviewing: 0, human: 0 };
  for (const state of handled(sessions)) counts[state.status] += 1;
  return counts;
}

/** 計器に置くバルーンの上限。これを超えた分は件数の欄でだけ数える */
const MAX_BLIPS = 36;

/**
 * 自動運転が扱った PR を、状態の帯の上に置く。帯をまたいで PR ごとに別の角度を割り当て、
 * どの 2 つも同じ方向に来ないようにする（違う帯でも半径の差だけでは重なるため）。
 * 並びは PR の名前順で、PR が増減しない限り位置は変わらない。6 時の方向は帯の名前のために空ける
 */
export function plotBlips(sessions: Sessions): Blip[] {
  const states = handled(sessions)
    .sort((x, y) => sessionKey(x.pr).localeCompare(sessionKey(y.pr)))
    .slice(0, MAX_BLIPS);
  const span = 360 - GAP_DEGREES;
  const step = span / Math.max(states.length, 1);
  const start = 180 + GAP_DEGREES / 2 + step / 2;
  return states.map((state, i) => ({
    key: sessionKey(state.pr),
    pr: state.pr,
    band: state.status,
    angle: (start + i * step) % 360,
  }));
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

/** 文字盤の目盛りと数字。描き直す必要が無いので、一度だけ作る */
const DIAL_FACE = (
  <g className="ap-face">
    {Array.from({ length: TICKS }, (_, i) => {
      const major = i % 5 === 0;
      const [x1, y1] = polar((i * 360) / TICKS, 176);
      const [x2, y2] = polar((i * 360) / TICKS, major ? 189 : 182);
      return (
        <line
          // eslint-disable-next-line react/no-array-index-key -- 固定の目盛りで、並びは変わらない
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          className={major ? "ap-tick ap-tick-major" : "ap-tick"}
        />
      );
    })}
    {Array.from({ length: 10 }, (_, minute) => {
      const [x, y] = polar(minute * 36, 202);
      return (
        <text
          // eslint-disable-next-line react/no-array-index-key -- 0〜9 分の固定の数字
          key={minute}
          x={x}
          y={y}
          className="ap-numeral"
          textAnchor="middle"
          dominantBaseline="central"
        >
          {minute}
        </text>
      );
    })}
  </g>
);

function Balloon({ blip, onSelect }: { blip: Blip; onSelect: (pr: PRRef) => void }) {
  const [x, y] = polar(blip.angle, BAND_RADIUS[blip.band]);
  const label = String(blip.pr.number);
  const open = (): void => onSelect({ repo: blip.pr.repo, number: blip.pr.number });
  const onKey = (e: KeyboardEvent<SVGGElement>): void => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    open();
  };
  return (
    <g
      className="ap-balloon"
      data-band={blip.band}
      transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}
      role="button"
      tabIndex={0}
      aria-label={t().autopilot.console.open(
        `${blip.pr.repo}#${blip.pr.number}`,
        t().autopilot.console.band[blip.band],
      )}
      onClick={open}
      onKeyDown={onKey}
    >
      <title>{`${blip.pr.repo}#${blip.pr.number} ${blip.pr.title}`}</title>
      {blip.band === "human" ? <circle r={BALLOON_RADIUS} className="ap-balloon-pulse" /> : null}
      {blip.band === "commented" || blip.band === "human" ? (
        // 改訂記号の △。一覧の指摘の印と同じ形
        <path d="M0 -16 16 11H-16Z" className="ap-balloon-shape" />
      ) : (
        <circle r={BALLOON_RADIUS} className="ap-balloon-shape" />
      )}
      {blip.band === "approved" ? (
        <circle r={BALLOON_RADIUS - 3} className="ap-balloon-inner" />
      ) : null}
      <text
        className="ap-balloon-label"
        y={blip.band === "commented" || blip.band === "human" ? 3.5 : 0}
        textAnchor="middle"
        dominantBaseline="central"
        style={{ fontSize: label.length > 3 ? 8 : 9.5 } as CSSProperties}
      >
        {label}
      </text>
    </g>
  );
}

/**
 * 10 分を 1 周とする計器。コンパスの脚が経過に合わせて弧を描き、円が閉じると巡回する。
 * 同心円の帯の上に、自動運転が扱った PR を品番バルーンで置く
 */
function Dial({
  view,
  now,
  blips,
  onSelect,
}: {
  view: AutopilotView;
  now: number;
  blips: Blip[];
  onSelect: (pr: PRRef) => void;
}) {
  const text = t().autopilot.console;
  const remaining = Math.max(0, nextPollAt(view, now) - now);
  const progress = view.enabled && !view.busy ? 1 - remaining / autopilotIntervalMs() : 0;
  // 巻き戻るときだけ動きを付けない。円が閉じて 0 に戻るときに逆回転して見えないように
  const previous = useRef(progress);
  const rewinding = progress < previous.current;
  useEffect(() => {
    previous.current = progress;
  });
  const angle = progress * 360;

  const readout = !view.enabled
    ? { value: text.readoutOff, caption: text.captionOff }
    : view.busy
      ? { value: text.readoutBusy, caption: text.captionBusy }
      : { value: formatCountdown(remaining), caption: text.captionUntil };

  return (
    <svg
      className="ap-dial"
      viewBox="-214 -214 428 428"
      role="img"
      aria-label={text.dialLabel(readout.value, blips.length)}
    >
      <defs>
        <radialGradient id="ap-glow" r="0.5">
          <stop offset="0" stopColor="var(--ap-pencil)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--ap-pencil)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 製図の中心線（一点鎖線）。円より少し外まで延ばす */}
      <g className="ap-centerlines">
        <line x1="-212" y1="0" x2="212" y2="0" />
        <line x1="0" y1="-212" x2="0" y2="212" />
      </g>

      {BANDS.map((band) => (
        <circle
          key={band}
          r={BAND_RADIUS[band]}
          pathLength={1}
          className="ap-band"
          data-band={band}
        />
      ))}
      {/* 6 時の方向に空けた場所へ、帯の名前を書く */}
      <g className="ap-band-labels">
        {BANDS.map((band) => (
          <text key={band} x="5" y={BAND_RADIUS[band] - 5} data-band={band}>
            {text.band[band]}
          </text>
        ))}
      </g>
      {DIAL_FACE}

      {/* コンパスが描いた弧。12 時から時計回りに伸びる */}
      <circle r={ARC_RADIUS} className="ap-arc-track" />
      <circle
        r={ARC_RADIUS}
        className="ap-arc"
        data-rewinding={rewinding}
        transform="rotate(-90)"
        strokeDasharray={ARC_LENGTH}
        strokeDashoffset={ARC_LENGTH * (1 - progress)}
      />

      {/* コンパスの脚。中心の針から、弧の先の鉛筆まで */}
      <g className="ap-compass" transform={`rotate(${angle.toFixed(2)})`}>
        {/* 巡回中に回す内側の組。見えない円で、回転の中心を計器の中心に合わせる */}
        <g className="ap-compass-spin">
          <circle r={ARC_RADIUS} fill="none" stroke="none" />
          <line x1="0" y1="-50" x2="0" y2={-ARC_RADIUS + 8} className="ap-compass-leg" />
          <circle cx="0" cy={-ARC_RADIUS} r="26" fill="url(#ap-glow)" />
          <path
            d={`M-3.5 ${-ARC_RADIUS + 9} 3.5 ${-ARC_RADIUS + 9} 0 ${-ARC_RADIUS}Z`}
            className="ap-compass-tip"
          />
        </g>
      </g>

      {blips.map((blip) => (
        <Balloon key={blip.key} blip={blip} onSelect={onSelect} />
      ))}

      <circle r="50" className="ap-hub" />
      <text className="ap-readout" y="-4" textAnchor="middle" dominantBaseline="central">
        {readout.value}
      </text>
      <text className="ap-readout-caption" y="20" textAnchor="middle" dominantBaseline="central">
        {readout.caption}
      </text>
    </svg>
  );
}

/** 工作機械のロータリースイッチ。切から入へ 90 度回す */
function Knob({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const text = t().autopilot;
  return (
    <button
      type="button"
      className="ap-knob"
      role="switch"
      aria-checked={on}
      aria-label={text.toggle}
      aria-describedby="autopilot-description"
      onClick={onToggle}
    >
      <svg viewBox="-50 -50 100 100" aria-hidden="true">
        <circle r="44" className="ap-knob-plate" />
        <text
          x="-27"
          y="-27"
          className="ap-knob-mark"
          data-active={!on}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {text.console.knobOff}
        </text>
        <text
          x="27"
          y="-27"
          className="ap-knob-mark"
          data-active={on}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {text.console.knobOn}
        </text>
        <g className="ap-knob-dial">
          <circle r="26" className="ap-knob-body" />
          <rect x="-4" y="-25" width="8" height="50" rx="2" className="ap-knob-grip" />
          <circle cy="-18" r="2.4" className="ap-knob-pointer" />
        </g>
        <circle cx="0" cy="38" r="3" className="ap-knob-lamp" />
      </svg>
    </button>
  );
}

const BAND_GLYPH: Record<Band, string> = {
  human: "M0 -7 6.5 5H-6.5Z",
  reviewing: "M-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0",
  commented: "M0 -7 6.5 5H-6.5Z",
  approved: "M-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0",
};

function Glyph({ band }: { band: Band }) {
  return (
    <svg className="ap-glyph" data-band={band} viewBox="-8 -8 16 16" aria-hidden="true">
      <path d={BAND_GLYPH[band]} />
    </svg>
  );
}

/**
 * 完全自動運転の操作盤。一覧の白い図面の中に、ここだけ青焼きの挿し図として置く
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
  const blips = plotBlips(sessions);
  const counts = countBands(sessions);
  const moves = recentMoves(sessions);

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
      aria-labelledby="autopilot-title"
    >
      <div className="ap-figure">
        <Dial view={view} now={now} blips={blips} onSelect={onSelect} />
      </div>

      <div className="ap-body">
        <div className="ap-head">
          <h2 id="autopilot-title" className="ap-title">
            {text.toggle}
          </h2>
          <Knob on={view.enabled} onToggle={toggle} />
        </div>
        <p className="ap-status" aria-live="polite">
          {status}
        </p>

        <dl className="ap-tally">
          {[...BANDS].reverse().map((band) => (
            <div key={band} data-band={band} data-zero={counts[band] === 0}>
              <dt>
                <Glyph band={band} />
                {text.console.band[band]}
              </dt>
              <dd>{counts[band]}</dd>
            </div>
          ))}
        </dl>

        <ol className="ap-log" aria-label={text.console.logLabel}>
          {moves.length === 0 ? (
            <li className="ap-log-empty">{text.console.logEmpty}</li>
          ) : (
            moves.map((move) => (
              <li key={`${sessionKey(move.pr)}@${move.updatedAt}`} data-band={move.status}>
                <time dateTime={move.updatedAt}>{clockTime(Date.parse(move.updatedAt))}</time>
                <Glyph band={move.status} />
                <button
                  type="button"
                  className="ap-log-pr"
                  onClick={() => onSelect({ repo: move.pr.repo, number: move.pr.number })}
                >
                  {move.pr.repo}#{move.pr.number}
                </button>
                <span className="ap-log-what">
                  {move.status === "commented"
                    ? move.held === true
                      ? text.console.log.held
                      : text.console.log.commented(move.rounds)
                    : text.console.log[move.status]}
                </span>
              </li>
            ))
          )}
        </ol>

        <p id="autopilot-description" className="ap-description">
          {text.description(config.intervalMinutes, modelName, config.approve)}
          {view.enabled ? <span className="ap-hint">{text.notifyHint}</span> : null}
        </p>

        {/* 図面の表題欄。この計器の縮尺と、誰が描いているか */}
        <dl className="ap-titleblock">
          <div>
            <dt>{text.console.scale}</dt>
            <dd>{text.console.scaleValue(config.intervalMinutes)}</dd>
          </div>
          <div>
            <dt>{text.console.drafter}</dt>
            <dd>{modelName}</dd>
          </div>
          <div>
            <dt>{text.console.lastSweep}</dt>
            <dd>{view.polledAt === null ? "—" : clockTime(Date.parse(view.polledAt))}</dd>
          </div>
        </dl>
        {view.enabled && view.error !== null ? (
          <p className="ap-error" role="alert">
            {text.pollFailed(view.error)}
          </p>
        ) : null}
      </div>
    </section>
  );
}
