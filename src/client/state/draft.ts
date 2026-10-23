import {
  type AnchoredFinding,
  type CommentLanguage,
  type DraftComment,
  type Finding,
  type ReviewEventKind,
  SEVERITIES,
  type Severity,
  type SubmitRequest,
} from "../../shared/types.ts";
import type { Lang } from "../../shared/i18n.ts";
import type { LgtmChoice } from "../../shared/lgtm.ts";
import { getLang, t } from "../i18n.ts";
import { MESSAGES } from "../messages.ts";

export type FindingStatus = "pending" | "accepted" | "rejected";

export interface DraftItem {
  anchored: AnchoredFinding;
  status: FindingStatus;
  /** AI の本文を人間が書き換えたもの。初期値は AI の本文 */
  body: string;
}

export interface DraftState {
  items: DraftItem[];
  event: ReviewEventKind;
  summary: string;
  /** GitHub に投稿する言語。source と違えば、送信時にサーバが訳す */
  language: CommentLanguage;
  /**
   * 指摘を書いた言語。AI レビューを実行したときの画面の言語。
   * 言語を選べなかった頃に保存した下書きには無いので、そのときは日本語とみなす
   */
  source?: Lang;
  /** 承認するときに添える LGTM 画像 */
  lgtm: LgtmChoice;
}

/**
 * 投稿するコメントの本文の初期値。起きる条件と影響も載せて、PR の作成者が
 * 指摘の根拠を確かめられるようにする。人が採用したあとで書き換えられる
 */
export function composeBody(finding: Finding, lang: Lang = "ja"): string {
  const text = MESSAGES[lang].draft;
  const grounds = [
    finding.trigger === "" ? null : `- ${text.trigger}: ${finding.trigger}`,
    finding.impact === "" ? null : `- ${text.impact}: ${finding.impact}`,
  ].filter((line) => line !== null);
  return grounds.length === 0 ? finding.body : `${finding.body}\n\n${grounds.join("\n")}`;
}

/** lang は指摘を書いた言語。投稿する言語の初期値もこれに揃え、訳さずに済むようにする */
export function initDraft(findings: AnchoredFinding[], lang: Lang = getLang()): DraftState {
  return {
    items: findings.map((anchored) => ({
      anchored,
      status: "pending",
      body: composeBody(anchored.finding, lang),
    })),
    event: "COMMENT",
    summary: "",
    language: lang,
    source: lang,
    lgtm: "random",
  };
}

function updateItem(
  state: DraftState,
  findingId: string,
  update: (item: DraftItem) => DraftItem,
): DraftState {
  return {
    ...state,
    items: state.items.map((item) =>
      item.anchored.finding.id === findingId ? update(item) : item,
    ),
  };
}

export function setStatus(state: DraftState, findingId: string, status: FindingStatus): DraftState {
  return updateItem(state, findingId, (item) => ({ ...item, status }));
}

export function editBody(state: DraftState, findingId: string, body: string): DraftState {
  return updateItem(state, findingId, (item) => ({ ...item, body }));
}

export function setEvent(state: DraftState, event: ReviewEventKind): DraftState {
  return { ...state, event };
}

export function setSummary(state: DraftState, summary: string): DraftState {
  return { ...state, summary };
}

export function setLanguage(state: DraftState, language: CommentLanguage): DraftState {
  return { ...state, language };
}

export function sourceLanguage(state: DraftState): Lang {
  return state.source ?? "ja";
}

/** 投稿の前に AI が訳すか。指摘を書いた言語のまま投稿するなら訳さない */
export function needsTranslation(state: DraftState): boolean {
  return state.language !== sourceLanguage(state);
}

export function setLgtm(state: DraftState, lgtm: LgtmChoice): DraftState {
  return { ...state, lgtm };
}

export function acceptedComments(state: DraftState): DraftComment[] {
  return state.items
    .filter((item) => item.status === "accepted")
    .map((item) => ({
      findingId: item.anchored.finding.id,
      path: item.anchored.finding.path,
      line: item.anchored.finding.line,
      body: item.body,
      anchor: item.anchored.anchor,
    }));
}

export function toSubmitRequest(state: DraftState, commitId: string): SubmitRequest {
  return {
    event: state.event,
    body: state.summary,
    comments: acceptedComments(state),
    commitId,
    language: state.language,
    sourceLanguage: sourceLanguage(state),
    lgtm: state.lgtm,
  };
}

/** 行に紐づかない指摘。diff の中に描画先が無いので、UI は必ず別枠で出す */
export function summaryItems(state: DraftState): DraftItem[] {
  return state.items.filter((item) => item.anchored.anchor === "summary");
}

export function lineItemsFor(state: DraftState, path: string): DraftItem[] {
  return state.items.filter(
    (item) => item.anchored.anchor === "line" && item.anchored.finding.path === path,
  );
}

/** 採用した指摘の重さから、妥当なレビュー種別を提案する。最終決定は人間が行う */
export function suggestEvent(state: DraftState): ReviewEventKind {
  const accepted = state.items.filter((item) => item.status === "accepted");
  if (accepted.length === 0) return "APPROVE";
  if (accepted.some((item) => item.anchored.finding.severity === "blocker")) {
    return "REQUEST_CHANGES";
  }
  return "COMMENT";
}

/**
 * AI レビューが終わったことを、指摘の有無にかかわらず必ず伝える一文。
 * 行に紐づいた指摘は diff の中に散らばるので、件数と居場所をここで示す
 */
export function describeResult(state: DraftState, visible: Set<Severity>): string {
  const text = t().draft;
  const total = state.items.length;
  if (total === 0) return text.doneNone;

  const counts = SEVERITIES.map((severity) => ({
    severity,
    count: state.items.filter((i) => i.anchored.finding.severity === severity).length,
  })).filter((c) => c.count > 0);
  const breakdown = counts.map((c) => `${c.severity} ${c.count}`).join(" / ");

  const unanchored = summaryItems(state).length;
  const where =
    unanchored === 0
      ? text.whereLines
      : unanchored === total
        ? text.whereAllUnanchored
        : text.whereSome(unanchored);

  const hidden = state.items.filter((i) => !visible.has(i.anchored.finding.severity)).length;
  const filtered = hidden === 0 ? "" : text.hidden(hidden);

  return text.done(total, breakdown, filtered, where);
}
