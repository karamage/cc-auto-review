import { expect, test } from "bun:test";
import type { AnchoredFinding } from "../../shared/types.ts";
import {
  acceptedComments,
  describeResult,
  editBody,
  initDraft,
  lineItemsFor,
  needsTranslation,
  setEvent,
  setLanguage,
  setStatus,
  setSummary,
  suggestEvent,
  summaryItems,
  toSubmitRequest,
} from "./draft.ts";

function anchored(
  id: string,
  overrides: Partial<AnchoredFinding["finding"]> = {},
): AnchoredFinding {
  return {
    finding: {
      id,
      path: "src/a.ts",
      line: 2,
      severity: "should",
      title: "題",
      body: "本文",
      trigger: "",
      impact: "",
      ...overrides,
    },
    anchor: "line",
    reason: null,
  };
}

test("初期状態はすべて pending、event は COMMENT", () => {
  const state = initDraft([anchored("f1"), anchored("f2")]);
  expect(state.items.map((i) => i.status)).toEqual(["pending", "pending"]);
  expect(state.event).toBe("COMMENT");
  expect(state.summary).toBe("");
});

test("初期の本文は Finding の本文が入る", () => {
  const state = initDraft([anchored("f1", { body: "危ないです" })]);
  expect(state.items[0]!.body).toBe("危ないです");
});

test("採用・却下で status が変わり、他の項目に影響しない", () => {
  let state = initDraft([anchored("f1"), anchored("f2")]);
  state = setStatus(state, "f1", "accepted");
  state = setStatus(state, "f2", "rejected");
  expect(state.items.map((i) => i.status)).toEqual(["accepted", "rejected"]);
});

test("却下したものを pending に戻せる", () => {
  let state = initDraft([anchored("f1")]);
  state = setStatus(state, "f1", "rejected");
  state = setStatus(state, "f1", "pending");
  expect(state.items[0]!.status).toBe("pending");
});

test("本文を編集できる", () => {
  let state = initDraft([anchored("f1", { body: "元の本文" })]);
  state = editBody(state, "f1", "書き直した本文");
  expect(state.items[0]!.body).toBe("書き直した本文");
});

test("状態更新は元のオブジェクトを書き換えない", () => {
  const state = initDraft([anchored("f1")]);
  const next = setStatus(state, "f1", "accepted");
  expect(state.items[0]!.status).toBe("pending");
  expect(next).not.toBe(state);
});

test("存在しない id を指定しても壊れない", () => {
  const state = initDraft([anchored("f1")]);
  expect(setStatus(state, "unknown", "accepted").items[0]!.status).toBe("pending");
});

test("acceptedComments は採用したものだけを編集後の本文で返す", () => {
  let state = initDraft([anchored("f1"), anchored("f2")]);
  state = setStatus(state, "f1", "accepted");
  state = editBody(state, "f1", "編集後");

  expect(acceptedComments(state)).toEqual([
    { findingId: "f1", path: "src/a.ts", line: 2, body: "編集後", anchor: "line" },
  ]);
});

test("採用したものが 0 件なら空配列", () => {
  const state = initDraft([anchored("f1")]);
  expect(acceptedComments(state)).toEqual([]);
});

test("toSubmitRequest は event・本文・採用コメント・commitId をまとめる", () => {
  let state = initDraft([anchored("f1")]);
  state = setStatus(state, "f1", "accepted");
  state = setEvent(state, "REQUEST_CHANGES");
  state = setSummary(state, "全体としては良いです");

  expect(toSubmitRequest(state, "abc123")).toEqual({
    event: "REQUEST_CHANGES",
    body: "全体としては良いです",
    commitId: "abc123",
    comments: [{ findingId: "f1", path: "src/a.ts", line: 2, body: "本文", anchor: "line" }],
    language: "ja",
    sourceLanguage: "ja",
    lgtm: "random",
  });
});

test("summaryItems は行に紐づかない指摘だけを返す", () => {
  const state = initDraft([
    anchored("f1"),
    { ...anchored("f2"), anchor: "summary", reason: "diff 外です" },
  ]);
  expect(summaryItems(state).map((i) => i.anchored.finding.id)).toEqual(["f2"]);
});

test("lineItemsFor は指定パスの行アンカーの指摘だけを返す", () => {
  const state = initDraft([
    anchored("f1"),
    anchored("f2", { path: "src/b.ts" }),
    { ...anchored("f3"), anchor: "summary", reason: "diff 外です" },
  ]);
  expect(lineItemsFor(state, "src/a.ts").map((i) => i.anchored.finding.id)).toEqual(["f1"]);
});

test("summaryItems と lineItemsFor を合わせるとすべての指摘を覆う", () => {
  // どちらにも入らない指摘があると、人間が見られないまま投稿対象になりうる
  const state = initDraft([
    anchored("f1"),
    anchored("f2", { path: "src/b.ts" }),
    { ...anchored("f3", { path: "src/zzz.ts" }), anchor: "summary", reason: "変更ファイル外です" },
  ]);
  const covered = [
    ...summaryItems(state),
    ...lineItemsFor(state, "src/a.ts"),
    ...lineItemsFor(state, "src/b.ts"),
  ].map((i) => i.anchored.finding.id);
  expect(covered.sort()).toEqual(["f1", "f2", "f3"]);
});

test("suggestEvent は blocker を採用していれば REQUEST_CHANGES を勧める", () => {
  let state = initDraft([anchored("f1", { severity: "blocker" })]);
  state = setStatus(state, "f1", "accepted");
  expect(suggestEvent(state)).toBe("REQUEST_CHANGES");
});

test("suggestEvent は採用が 0 件なら APPROVE を勧める", () => {
  const state = initDraft([anchored("f1", { severity: "blocker" })]);
  expect(suggestEvent(state)).toBe("APPROVE");
});

test("suggestEvent は blocker 以外だけ採用なら COMMENT を勧める", () => {
  let state = initDraft([anchored("f1", { severity: "nit" })]);
  state = setStatus(state, "f1", "accepted");
  expect(suggestEvent(state)).toBe("COMMENT");
});

const ALL = new Set(["blocker", "should", "nit"] as const);

test("指摘が 0 件でも完了したことを伝える", () => {
  expect(describeResult(initDraft([]), new Set(ALL))).toBe(
    "AI レビューが完了しました。指摘はありませんでした。",
  );
});

test("件数と severity の内訳、表示場所を伝える", () => {
  const state = initDraft([
    anchored("f1", { severity: "blocker" }),
    anchored("f2", { severity: "nit" }),
    anchored("f3", { severity: "nit" }),
  ]);
  expect(describeResult(state, new Set(ALL))).toBe(
    "AI レビューが完了しました。指摘は 3 件（blocker 1 / nit 2）です。diff の該当行に表示しています。",
  );
});

test("行に紐づかない指摘とフィルタで隠れている件数も伝える", () => {
  const state = initDraft([
    anchored("f1", { severity: "should" }),
    { ...anchored("f2", { severity: "nit" }), anchor: "summary", reason: "diff 外" },
  ]);
  expect(describeResult(state, new Set(["should"] as const))).toBe(
    "AI レビューが完了しました。指摘は 2 件（should 1 / nit 1）（うち 1 件はフィルタで非表示）です。diff の該当行と、行に紐づけられなかった 1 件は下の別枠に表示しています。",
  );
});

test("投稿する本文の初期値に、起きる条件と影響を添える", () => {
  const draft = initDraft([
    anchored("f1", { trigger: "空配列のとき", impact: "例外で落ちる" }),
    anchored("f2", { severity: "question" }),
  ]);
  expect(draft.items[0]!.body).toBe("本文\n\n- 起きる条件: 空配列のとき\n- 影響: 例外で落ちる");
  expect(draft.items[1]!.body).toBe("本文");
});

test("英語で書かせた指摘は、根拠の見出しも英語にして、そのまま英語で投稿する", () => {
  const draft = initDraft(
    [anchored("f1", { body: "Body", trigger: "empty array", impact: "throws" })],
    "en",
  );
  expect(draft.items[0]!.body).toBe("Body\n\n- When it happens: empty array\n- Impact: throws");
  expect(draft.language).toBe("en");
  expect(needsTranslation(draft)).toBe(false);
  expect(needsTranslation(setLanguage(draft, "ja"))).toBe(true);
});

test("言語を選べなかった頃の下書きは、日本語で書いたものとして扱う", () => {
  const { source: _source, ...legacy } = initDraft([anchored("f1")]);
  expect(toSubmitRequest(legacy, "abc").sourceLanguage).toBe("ja");
  expect(needsTranslation(setLanguage(legacy, "en"))).toBe(true);
});
