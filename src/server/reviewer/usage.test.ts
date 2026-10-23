import { expect, test } from "bun:test";
import { parseClaudeUsage, UsageRecorder } from "./usage.ts";

const NOW = new Date("2026-10-19T06:00:00.000Z");

const RATE_LIMIT = JSON.stringify({
  type: "rate_limit_event",
  rate_limit_info: { status: "allowed_warning", resetsAt: 1793491200, rateLimitType: "five_hour" },
});
const RESULT = JSON.stringify({
  type: "result",
  total_cost_usd: 0.42,
  usage: {
    input_tokens: 10,
    cache_creation_input_tokens: 1000,
    cache_read_input_tokens: 20000,
    output_tokens: 300,
  },
});

test("stream-json の出力から利用枠の状態と今回のコスト・トークン数を読む", () => {
  const stdout = ['{"type":"system","subtype":"init"}', RATE_LIMIT, "壊れた行", RESULT].join("\n");
  expect(parseClaudeUsage(stdout, NOW)).toEqual({
    limit: { status: "allowed_warning", resetsAt: "2026-11-01T00:00:00.000Z", type: "five_hour" },
    run: { costUsd: 0.42, inputTokens: 21010, outputTokens: 300 },
    recordedAt: NOW.toISOString(),
  });
});

test("どちらのイベントも無ければ null", () => {
  expect(parseClaudeUsage('{"type":"assistant"}\n', NOW)).toBeNull();
});

test("利用枠のイベントが来なかった回は、前に分かった状態を残す", () => {
  const recorder = new UsageRecorder(() => NOW);
  expect(recorder.latest()).toBeNull();
  recorder.record([RATE_LIMIT, RESULT].join("\n"));
  recorder.record(RESULT.replace("0.42", "0.1"));
  expect(recorder.latest()?.limit?.status).toBe("allowed_warning");
  expect(recorder.latest()?.run?.costUsd).toBe(0.1);
});
