// サイトのリスク採点の入り口。アプリと同じ diff パーサーと採点をブラウザで動かす。
// `bun run build:site` で docs/engine.js にまとめる
import { parseUnifiedDiff } from "../src/server/diff/parse.ts";
import { computeBaselineRisk } from "../src/shared/risk-score.ts";
import { DEFAULT_RISK_THRESHOLD, defaultSettings } from "../src/shared/settings.ts";

interface ScoreOptions {
  diff: string;
  title?: string;
  body?: string;
  draft?: boolean;
  authorIsBot?: boolean;
  lang: "ja" | "en";
}

function score(options: ScoreOptions) {
  return computeBaselineRisk(
    {
      files: parseUnifiedDiff(options.diff),
      title: options.title ?? "",
      body: options.body ?? "",
      draft: options.draft ?? false,
      authorIsBot: options.authorIsBot ?? false,
      ignoredPaths: defaultSettings().autopilot.ignoredPaths,
      threshold: DEFAULT_RISK_THRESHOLD,
    },
    options.lang,
  );
}

(globalThis as unknown as { CCAutoReviewRisk: { score: typeof score } }).CCAutoReviewRisk = {
  score,
};
