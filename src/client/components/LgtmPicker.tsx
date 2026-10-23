import { useEffect, useRef, useState } from "react";
import { LGTM_IMAGE_IDS, type LgtmChoice, lgtmImageUrl } from "../../shared/lgtm.ts";
import { t } from "../i18n.ts";

/** シャッフルで止まるまでに見せるコマの間隔。後ろほど間を空けて、減速して止まるように見せる */
const REEL_DELAYS_MS = [50, 50, 55, 60, 70, 80, 95, 115, 140, 175, 220];

function randomId(except?: number): number {
  const pool = LGTM_IMAGE_IDS.filter((id) => id !== except);
  return pool[Math.floor(Math.random() * pool.length)] as number;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function sealDate(): string {
  const now = new Date();
  return `${now.getMonth() + 1}.${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * 承認のときに本文の末尾へ添える LGTM 画像を選ぶ。
 * 検図の承認印に見立て、選んだ画像を図面として大きく見せてから印を押す。
 * 「自動」は投稿時ではなくこの場で引くので、見えている画像がそのまま投稿される
 */
export function LgtmPicker({
  value,
  onChange,
}: {
  value: LgtmChoice;
  onChange: (lgtm: LgtmChoice) => void;
}) {
  const [reel, setReel] = useState<number | null>(null);
  // 値が変わるたびに印を押し直すための key
  const [pressed, setPressed] = useState(0);
  const timers = useRef<number[]>([]);
  const stripRef = useRef<HTMLDivElement>(null);

  const stopReel = (): void => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  };

  const land = (id: number): void => {
    setReel(null);
    onChange(id);
    setPressed((n) => n + 1);
  };

  const shuffle = (): void => {
    stopReel();
    const current = typeof value === "number" ? value : undefined;
    const final = randomId(current);
    if (prefersReducedMotion()) {
      land(final);
      return;
    }
    let at = 0;
    let shown = current;
    for (const delay of REEL_DELAYS_MS) {
      at += delay;
      const frame = randomId(shown);
      shown = frame;
      timers.current.push(window.setTimeout(() => setReel(frame), at));
    }
    timers.current.push(window.setTimeout(() => land(final), at + 260));
  };

  // 承認を選んだ直後は「自動」のまま。その場で 1 枚引いて見せる
  useEffect(() => {
    if (value === "random") shuffle();
    return stopReel;
    // 初回に引くだけでよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = reel ?? (typeof value === "number" ? value : null);
  const attached = value !== "none";
  const rolling = reel !== null || value === "random";

  // 選んだコマをフィルムの中央に寄せる。scrollIntoView はページごと動かすので使わない
  useEffect(() => {
    const strip = stripRef.current;
    if (strip === null || shown === null) return;
    const cell = strip.querySelector<HTMLElement>(`[data-id="${shown}"]`);
    if (cell === null) return;
    strip.scrollTo({
      left: cell.offsetLeft - strip.clientWidth / 2 + cell.clientWidth / 2,
      behavior: prefersReducedMotion() || reel !== null ? "auto" : "smooth",
    });
  }, [shown, reel]);

  const index = shown === null ? -1 : LGTM_IMAGE_IDS.indexOf(shown);
  const text = t().lgtm;

  return (
    <section className="lgtm" data-attached={attached} aria-labelledby="lgtm-heading">
      <header className="lgtm-head">
        <h3 id="lgtm-heading">{text.heading}</h3>
        <label className="lgtm-switch">
          <input
            type="checkbox"
            role="switch"
            checked={attached}
            onChange={(e) =>
              e.target.checked ? shuffle() : (stopReel(), setReel(null), onChange("none"))
            }
          />
          <span>{text.attach}</span>
        </label>
      </header>

      <figure className="lgtm-sheet" data-rolling={rolling}>
        <div className="lgtm-frame">
          {attached && shown !== null ? (
            <img
              key={reel === null ? "landed" : "reel"}
              src={lgtmImageUrl(shown)}
              alt={reel === null ? text.chosenAlt(shown) : ""}
            />
          ) : (
            <p className="lgtm-empty">{attached ? text.drawing : text.noImage}</p>
          )}
          {attached && reel === null && shown !== null ? (
            <span key={pressed} className="lgtm-seal" aria-hidden="true">
              <span className="lgtm-seal-word">{text.seal}</span>
              <span className="lgtm-seal-date">{sealDate()}</span>
            </span>
          ) : null}
        </div>
        <figcaption className="lgtm-title-block">
          <span>
            <small>{text.sheetNo}</small>
            {shown === null || !attached ? "—" : `LGTM-${shown}`}
          </span>
          <span>
            <small>{text.sheet}</small>
            {index < 0 || !attached ? "—" : `${index + 1} / ${LGTM_IMAGE_IDS.length}`}
          </span>
        </figcaption>
      </figure>

      {attached ? (
        <>
          <button type="button" className="lgtm-shuffle" onClick={shuffle} disabled={reel !== null}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                d="M1.5 4.5h2.8c1 0 1.9.5 2.5 1.3l2.4 3.4c.6.8 1.5 1.3 2.5 1.3h2.8M1.5 11.5h2.8c1 0 1.9-.5 2.5-1.3l.5-.7m2.4-3.4.5-.7c.6-.8 1.5-1.3 2.5-1.3h2.8M12.5 2.5l2 2-2 2M12.5 9.5l2 2-2 2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {reel === null ? text.shuffle : text.drawing}
          </button>

          <div className="lgtm-strip" ref={stripRef} role="radiogroup" aria-label={text.pick}>
            {LGTM_IMAGE_IDS.map((id) => (
              <label key={id} data-id={id}>
                <input
                  type="radio"
                  name="review-lgtm-image"
                  value={id}
                  checked={value === id}
                  onChange={() => {
                    stopReel();
                    land(id);
                  }}
                />
                <img src={lgtmImageUrl(id)} alt={text.imageAlt(id)} loading="lazy" />
              </label>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
