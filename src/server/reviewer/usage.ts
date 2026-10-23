import type { ClaudeUsage } from "../../shared/types.ts";

interface RawEvent {
  type?: unknown;
  rate_limit_info?: { status?: unknown; resetsAt?: unknown; rateLimitType?: unknown };
  total_cost_usd?: unknown;
  usage?: Record<string, unknown>;
}

function numberOr0(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * `claude -p --output-format stream-json` の出力から、利用枠の状態と今回の使用量を読む。
 * 使用率（何 % 使ったか）は出力に含まれないので読まない。どちらも無ければ null
 */
export function parseClaudeUsage(stdout: string, now: Date): ClaudeUsage | null {
  let limit: ClaudeUsage["limit"] = null;
  let run: ClaudeUsage["run"] = null;
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    let event: RawEvent;
    try {
      event = JSON.parse(line) as RawEvent;
    } catch {
      continue;
    }
    // 実行中に何度か届く。最後のものがいちばん新しい
    if (event.type === "rate_limit_event" && typeof event.rate_limit_info?.status === "string") {
      const { status, resetsAt, rateLimitType } = event.rate_limit_info;
      limit = {
        status,
        // 秒単位の UNIX 時刻で届く
        resetsAt: typeof resetsAt === "number" ? new Date(resetsAt * 1000).toISOString() : null,
        type: typeof rateLimitType === "string" ? rateLimitType : null,
      };
    }
    if (event.type === "result" && typeof event.total_cost_usd === "number") {
      const usage = event.usage ?? {};
      run = {
        costUsd: event.total_cost_usd,
        // キャッシュから読んだ分も、書いた分も入力に数える
        inputTokens:
          numberOr0(usage.input_tokens) +
          numberOr0(usage.cache_creation_input_tokens) +
          numberOr0(usage.cache_read_input_tokens),
        outputTokens: numberOr0(usage.output_tokens),
      };
    }
  }
  if (limit === null && run === null) return null;
  return { limit, run, recordedAt: now.toISOString() };
}

/**
 * 最後に実行した claude の使用量を覚えておく。利用枠はアカウント全体のものなので PR ごとには持たない。
 * プロセスのメモリにだけ置き、起動し直したら次の実行まで何も出さない
 */
export class UsageRecorder {
  private last: ClaudeUsage | null = null;

  constructor(private readonly now: () => Date = () => new Date()) {}

  record(stdout: string): void {
    const usage = parseClaudeUsage(stdout, this.now());
    if (usage === null) return;
    // 利用枠のイベントが来なかった回は、前に分かった状態を残す
    this.last = { ...usage, limit: usage.limit ?? this.last?.limit ?? null };
  }

  latest(): ClaudeUsage | null {
    return this.last;
  }
}
