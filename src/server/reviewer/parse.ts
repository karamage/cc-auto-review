import {
  type Finding,
  type I18nComparison,
  type PriorFindingStatus,
  type ReviewResult,
  SEVERITIES,
  type Severity,
} from "../../shared/types.ts";
import type { LocalizedText } from "../../shared/i18n.ts";
import { isRiskLevel, type RiskAssessment } from "../../shared/risk.ts";
import { AppError } from "../errors.ts";

export class FindingParseError extends AppError {
  constructor(message: string | LocalizedText, detail?: string) {
    super(message, detail);
    this.name = "FindingParseError";
  }
}

const PRIOR_STATUSES: readonly PriorFindingStatus[] = ["fixed", "unfixed", "unverified"];

interface RawFinding {
  path?: unknown;
  line?: unknown;
  severity?: unknown;
  title?: unknown;
  body?: unknown;
  trigger?: unknown;
  impact?: unknown;
}

interface RawPriorFinding {
  commentId?: unknown;
  status?: unknown;
  evidence?: unknown;
}

const FENCE = /```(?:json)?\s*\n([\s\S]*?)\n```/;

/**
 * 前後の地の文やコードフェンスを取り除いて JSON 本体を取り出す。
 * フェンスがあればその中を優先する。地の文に波括弧が混ざっていても壊れないようにするため。
 */
const UNREADABLE: LocalizedText = {
  ja: "レビュー結果を JSON として読み取れませんでした",
  en: "Could not read the review result as JSON",
};

function extractJsonObject(text: string): string {
  const fenced = FENCE.exec(text);
  const target = fenced === null ? text : (fenced[1] as string);

  const start = target.indexOf("{");
  const end = target.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new FindingParseError(UNREADABLE, text.slice(0, 2000));
  }
  return target.slice(start, end + 1);
}

function toSeverity(value: unknown): Severity {
  return SEVERITIES.includes(value as Severity) ? (value as Severity) : "should";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 起きる条件か影響を示せない blocker / should は、根拠のある指摘とはいえない。
 * 捨てずに question へ下げて、人に確かめてもらう
 */
function settleSeverity(severity: Severity, trigger: string, impact: string): Severity {
  if (severity !== "blocker" && severity !== "should") return severity;
  return trigger === "" || impact === "" ? "question" : severity;
}

function parsePriorChecks(raw: unknown): ReviewResult["priorChecks"] {
  if (!Array.isArray(raw)) return [];
  return (raw as RawPriorFinding[]).flatMap((item) =>
    typeof item?.commentId === "number" &&
    Number.isInteger(item.commentId) &&
    PRIOR_STATUSES.includes(item.status as PriorFindingStatus)
      ? [
          {
            commentId: item.commentId,
            status: item.status as PriorFindingStatus,
            evidence: text(item.evidence),
          },
        ]
      : [],
  );
}

/** 段階を読めなければ判定が無かったものとして null にする。人に回すかどうかは呼び出し側が決める */
function parseRisk(raw: unknown): RiskAssessment | null {
  const item = raw as { level?: unknown; reasons?: unknown } | null;
  if (item === null || typeof item !== "object" || !isRiskLevel(item.level)) return null;
  const reasons = Array.isArray(item.reasons)
    ? item.reasons.map(text).filter((reason) => reason !== "")
    : [];
  return { level: item.level, reasons };
}

/** 書かれていなければ null。頼んだ回かどうかは呼び出し側が決める */
function parseI18nComparisons(raw: unknown): I18nComparison[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((item) => {
    const entry = item as { key?: unknown; original?: unknown; locale?: unknown } | null;
    if (entry === null || typeof entry !== "object") return [];
    const original = text(entry.original);
    const locale = text(entry.locale);
    if (original === "" && locale === "") return [];
    return [{ key: text(entry.key), original, locale, match: original === locale }];
  });
}

export function parseReviewResult(output: string): ReviewResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(output));
  } catch (error) {
    if (error instanceof FindingParseError) throw error;
    throw new FindingParseError(UNREADABLE, output.slice(0, 2000));
  }

  const raw = (parsed as { findings?: unknown }).findings;
  if (!Array.isArray(raw)) {
    throw new FindingParseError(
      {
        ja: "レビュー結果に findings 配列が含まれていません",
        en: "The review result has no findings array",
      },
      output.slice(0, 2000),
    );
  }

  const findings: Finding[] = [];
  for (const item of raw as RawFinding[]) {
    if (typeof item?.path !== "string" || item.path.length === 0) continue;

    const body = typeof item.body === "string" ? item.body : "";
    const title =
      typeof item.title === "string" && item.title.length > 0 ? item.title : body.slice(0, 40);
    const trigger = text(item.trigger);
    const impact = text(item.impact);

    findings.push({
      id: `finding-${findings.length + 1}`,
      path: item.path,
      line: typeof item.line === "number" && Number.isInteger(item.line) ? item.line : null,
      severity: settleSeverity(toSeverity(item.severity), trigger, impact),
      title,
      body,
      trigger,
      impact,
    });
  }

  return {
    findings,
    priorChecks: parsePriorChecks((parsed as { priorFindings?: unknown }).priorFindings),
    risk: parseRisk((parsed as { risk?: unknown }).risk),
    i18nComparisons: parseI18nComparisons(
      (parsed as { i18nComparisons?: unknown }).i18nComparisons,
    ),
  };
}
