import { useEffect, useState } from "react";
import type { ClaudeUsage } from "../../shared/types.ts";
import { browserClient } from "../api.ts";
import { formatRelative } from "../format.ts";
import { t } from "../i18n.ts";
import type { ReviewPhase } from "../state/sessions.ts";

/** 1234 → 1.2k。桁を揃えるより、ひと目で大きさが分かることを優先する */
function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function formatResets(iso: string): string {
  return new Date(iso).toLocaleString(t().relative.locale, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Claude Code の利用枠の状態と、前回の AI レビューのコスト。
 * サーバは claude を実行したときにしか知り得ないので、この PR の実行が終わるたびに取り直す
 */
export function UsageSummary({ phase }: { phase: ReviewPhase }) {
  const text = t().review;
  const [usage, setUsage] = useState<ClaudeUsage | null>(null);

  useEffect(() => {
    if (phase === "running") return;
    let cancelled = false;
    browserClient
      .fetchUsage()
      .then((value) => {
        if (!cancelled) setUsage(value);
      })
      .catch(() => {
        // 出せなくてもレビューには差し支えない。前の表示のままにする
      });
    return () => {
      cancelled = true;
    };
  }, [phase]);

  return (
    <div className="field usage" data-status={usage?.limit?.status ?? "unknown"}>
      <span>{text.usage}</span>
      {usage === null ? (
        <p className="muted">{text.usageNone}</p>
      ) : (
        <p>
          {usage.limit !== null && (
            <strong>
              {text.usageStatus(usage.limit.status)}
              {usage.limit.resetsAt !== null &&
                text.usageResets(formatResets(usage.limit.resetsAt))}
            </strong>
          )}
          {usage.run !== null && (
            <span>
              {text.usageLastRun(
                usage.run.costUsd.toFixed(2),
                compact(usage.run.inputTokens),
                compact(usage.run.outputTokens),
              )}
            </span>
          )}
          <span className="muted">{text.usageRecorded(formatRelative(usage.recordedAt))}</span>
        </p>
      )}
    </div>
  );
}
