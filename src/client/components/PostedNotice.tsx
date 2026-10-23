import { formatRelative } from "../format.ts";
import { t } from "../i18n.ts";
import type { PostedRecord, WatchState } from "../state/sessions.ts";
import { WATCH_INTERVAL_MS } from "../state/watch.ts";

const INTERVAL_MINUTES = WATCH_INTERVAL_MS / 60_000;

/**
 * GitHub に投稿済みであることと、その後の見守りの状態。
 * 投稿の直後だけでなく、画面を開き直しても出す
 */
export function PostedNotice({
  posted,
  watch,
  currentHeadSha,
  onStop,
  onStart,
}: {
  posted: PostedRecord;
  watch: WatchState | null;
  currentHeadSha: string;
  onStop: () => void;
  /** 見守りを始める。投稿しただけでは始まらない */
  onStart: () => void;
}) {
  const text = t().posted;
  return (
    <section className="posted-notice" data-watch={watch?.status ?? "off"} role="status">
      <p className="posted-notice-head">
        <strong>{text.heading}</strong>
        <span>
          {text.summary(
            formatRelative(posted.review.submittedAt),
            t().event[posted.event],
            posted.comments,
          )}
        </span>
        {posted.review.url === null ? null : (
          <a href={posted.review.url} target="_blank" rel="noreferrer">
            {text.view}
          </a>
        )}
      </p>
      {posted.headSha === currentHeadSha ? null : (
        <p className="muted">{text.stale(posted.headSha.slice(0, 7))}</p>
      )}

      {watch?.status === "waiting" ? (
        <p>
          {text.waiting(
            INTERVAL_MINUTES,
            watch.checkedAt === null ? null : formatRelative(watch.checkedAt),
          )}
          <span className="muted">{text.waitingNote}</span>
        </p>
      ) : watch?.status === "rereviewed" ? (
        <p>
          {watch.note}
          {text.rereviewed}
        </p>
      ) : watch?.status === "closed" ? (
        <p>
          {watch.note}
          {text.closed}
        </p>
      ) : watch?.status === "approved" ? (
        <p>
          {watch.note}
          {text.approved}
        </p>
      ) : (
        <p className="muted">{text.off(INTERVAL_MINUTES)}</p>
      )}

      {/* 見守りは投稿しただけでは始まらない。人がここで始める */}
      {watch?.status === "closed" ? null : (
        <div className="posted-notice-actions">
          {watch === null || watch.status === "approved" ? (
            <button type="button" data-variant="primary" onClick={onStart}>
              {text.start}
            </button>
          ) : (
            <button type="button" onClick={onStop}>
              {text.stop}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
