import type { Lang } from "./i18n.ts";
import { type AutopilotConfig, compilePattern, type RoutingRule } from "./settings.ts";
import type { DiffFile } from "./types.ts";

/**
 * 変更のリスクの段階。
 * low は自動レビューだけで通してよいもの、medium は普通のプロダクトの変更、
 * high は人が判断しなければならないもの。完全自動運転は high を人に回す
 */
export type RiskLevel = "low" | "medium" | "high";

const RISK_ORDER: readonly RiskLevel[] = ["low", "medium", "high"];

export function isRiskLevel(value: unknown): value is RiskLevel {
  return (RISK_ORDER as readonly unknown[]).includes(value);
}

export interface RiskAssessment {
  level: RiskLevel;
  /** その段階にした理由。画面と、人に回すときの説明に出す */
  reasons: string[];
}

/** 重い方の段階に寄せて、理由はどちらも残す */
export function mergeRisk(
  a: RiskAssessment | null,
  b: RiskAssessment | null,
): RiskAssessment | null {
  if (a === null) return b;
  if (b === null) return a;
  const level = RISK_ORDER.indexOf(a.level) >= RISK_ORDER.indexOf(b.level) ? a.level : b.level;
  return { level, reasons: [...a.reasons, ...b.reasons] };
}

/** 文章のどれかが mention を含むか。@org/team-foo のような、名前の続く別のチームは数えない */
export function mentions(texts: readonly string[], mention: string): boolean {
  if (mention === "") return false;
  const pattern = new RegExp(
    `(^|[^\\w/-])${mention.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![\\w-])`,
    "i",
  );
  return texts.some((text) => pattern.test(text));
}

/**
 * PR に当たる最初のルーティング規則。ラベルとメンションの両方を書いた規則は、どちらかに当たれば使う。
 * 当たらなければ null（自動運転の既定のプロファイルを使う）
 */
export function matchRouting(
  rules: readonly RoutingRule[],
  labels: readonly string[],
  texts: readonly string[],
): RoutingRule | null {
  return (
    rules.find(
      (rule) =>
        (rule.label !== "" && labels.includes(rule.label)) ||
        (rule.mention !== "" && mentions(texts, rule.mention)),
    ) ?? null
  );
}

/** 変更の規模に数えないファイルか。設定の正規表現のどれかに当たれば数えない */
export function isUnreviewedPath(path: string, ignoredPaths: readonly string[]): boolean {
  return ignoredPaths.some((pattern) => compilePattern(pattern)?.test(path) === true);
}

/** 変更の規模として数える行数。人がレビューしないファイルの行は除く */
export function reviewedChangedLines(
  files: readonly DiffFile[],
  ignoredPaths: readonly string[],
): number {
  let count = 0;
  for (const file of files) {
    if (isUnreviewedPath(file.path, ignoredPaths)) continue;
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type !== "context") count++;
      }
    }
  }
  return count;
}

/**
 * パスと規模から機械的に決めるリスク。AI に頼らず決まるので、該当すれば AI を呼ばずに人へ回せる。
 * 何も該当しなければ null（段階は AI の判定に任せる）
 */
export function ruleRisk(
  paths: readonly string[],
  changedLines: number,
  config: Pick<AutopilotConfig, "sensitivePaths" | "maxChangedLines">,
  lang: Lang,
): RiskAssessment | null {
  const reasons: string[] = [];
  for (const rule of config.sensitivePaths) {
    const pattern = compilePattern(rule.pattern);
    if (pattern === null) continue;
    const hits = paths.filter((path) => pattern.test(path));
    if (hits.length === 0) continue;
    const shown = hits.slice(0, 3).join(", ");
    const more =
      hits.length > 3
        ? lang === "en"
          ? ` and ${hits.length - 3} more`
          : ` ほか ${hits.length - 3} 件`
        : "";
    reasons.push(`${rule.reason} (${shown}${more})`);
  }
  const max = config.maxChangedLines;
  if (max > 0 && changedLines > max) {
    reasons.push(
      lang === "en"
        ? `The change is large (${changedLines} lines, over ${max})`
        : `変更が大きい（${changedLines} 行。${max} 行を超える）`,
    );
  }
  return reasons.length === 0 ? null : { level: "high", reasons };
}

/**
 * 文章が日本語か英語か。PR の説明文の言語に合わせてコメントするために使う。
 * コードブロック、インラインコード、URL、HTML のコメント（PR テンプレートの説明書き）は除いて見る。
 * かなか漢字があれば日本語、英字だけなら英語、どちらも無ければ null
 */
export function detectTextLang(text: string): Lang | null {
  const prose = text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
  if (/[぀-ヿ一-鿿]/.test(prose)) return "ja";
  if (/[A-Za-z]{2,}/.test(prose)) return "en";
  return null;
}
