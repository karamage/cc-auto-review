import { expect, test } from "bun:test";
import { FindingParseError, parseReviewResult } from "./parse.ts";

const parseFindings = (output: string) => parseReviewResult(output).findings;
const GROUNDS = { trigger: "空配列を渡したとき", impact: "例外で画面が落ちる" };

test("正常な JSON から Finding を組み立て、id を採番する", () => {
  const findings = parseFindings(
    JSON.stringify({
      findings: [
        { path: "src/a.ts", line: 12, severity: "blocker", title: "題", body: "本文", ...GROUNDS },
        { path: "src/b.ts", line: 3, severity: "nit", title: "題2", body: "本文2" },
      ],
    }),
  );
  expect(findings).toHaveLength(2);
  expect(findings[0]!.id).toBe("finding-1");
  expect(findings[1]!.id).toBe("finding-2");
  expect(findings[0]!.severity).toBe("blocker");
  expect(findings[0]!.trigger).toBe("空配列を渡したとき");
  expect(findings[0]!.impact).toBe("例外で画面が落ちる");
  expect(findings[1]!.trigger).toBe("");
});

test("findings が空配列でも成功する", () => {
  expect(parseFindings('{"findings": []}')).toEqual([]);
});

test("未知の severity は should に丸める", () => {
  const findings = parseFindings(
    JSON.stringify({
      findings: [
        { path: "a.ts", line: 1, severity: "critical", title: "t", body: "b", ...GROUNDS },
      ],
    }),
  );
  expect(findings[0]!.severity).toBe("should");
});

test("line が数値でなければ null にする", () => {
  const findings = parseFindings(
    JSON.stringify({
      findings: [{ path: "a.ts", line: "12", severity: "nit", title: "t", body: "b" }],
    }),
  );
  expect(findings[0]!.line).toBeNull();
});

test("path が無い指摘は落とす", () => {
  const findings = parseFindings(
    JSON.stringify({
      findings: [
        { line: 1, severity: "nit", title: "t", body: "b" },
        { path: "a.ts", line: 1, severity: "nit", title: "t", body: "b" },
      ],
    }),
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]!.path).toBe("a.ts");
});

test("title が無ければ body の先頭 40 文字で補う", () => {
  const findings = parseFindings(
    JSON.stringify({
      findings: [
        { path: "a.ts", line: 1, severity: "nit", body: "とても長い本文がここにあります" },
      ],
    }),
  );
  expect(findings[0]!.title).toBe("とても長い本文がここにあります");
});

test("JSON として壊れていれば FindingParseError を投げる", () => {
  expect(() => parseFindings("これは JSON ではありません")).toThrow(FindingParseError);
});

test("findings 配列が無ければ FindingParseError を投げる", () => {
  expect(() => parseFindings('{"result": "ok"}')).toThrow(
    "レビュー結果に findings 配列が含まれていません",
  );
});

test("前後に地の文が付いていても JSON 部分を取り出す", () => {
  const findings = parseFindings(
    'レビューしました。\n{"findings": [{"path":"a.ts","line":1,"severity":"nit","title":"t","body":"b"}]}\n以上です。',
  );
  expect(findings).toHaveLength(1);
});

test("```json フェンスで囲まれていても取り出す", () => {
  const findings = parseFindings(
    '```json\n{"findings": [{"path":"a.ts","line":1,"severity":"nit","title":"t","body":"b"}]}\n```',
  );
  expect(findings).toHaveLength(1);
});

test("地の文に波括弧が混ざっていてもフェンス内を優先して取り出す", () => {
  // 最初の { から最後の } までを取る素朴な方法だと、この入力で壊れる
  const findings = parseFindings(
    '`{}` のように書きます。\n```json\n{"findings": [{"path":"a.ts","line":1,"severity":"nit","title":"t","body":"b"}]}\n```\n以上です `{...}`。',
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]!.path).toBe("a.ts");
});

test("起きる条件か影響の無い blocker / should は question に下げる", () => {
  const findings = parseFindings(
    JSON.stringify({
      findings: [
        { path: "a.ts", line: 1, severity: "blocker", title: "t", body: "b", trigger: "x" },
        { path: "a.ts", line: 2, severity: "should", title: "t", body: "b", impact: "y" },
        { path: "a.ts", line: 3, severity: "should", title: "t", body: "b", ...GROUNDS },
        { path: "a.ts", line: 4, severity: "nit", title: "t", body: "b" },
        { path: "a.ts", line: 5, severity: "question", title: "t", body: "b" },
      ],
    }),
  );
  expect(findings.map((f) => f.severity)).toEqual([
    "question",
    "question",
    "should",
    "nit",
    "question",
  ]);
});

test("過去の指摘の判定を読み、形の崩れたものは捨てる", () => {
  const result = parseReviewResult(
    JSON.stringify({
      findings: [],
      priorFindings: [
        { commentId: 11, status: "fixed", evidence: " src/a.ts:3 で null を弾いている " },
        { commentId: 12, status: "unfixed", evidence: "まだ未対応" },
        { commentId: 13, status: "unverified" },
        { commentId: "14", status: "fixed", evidence: "" },
        { commentId: 15, status: "resolved", evidence: "" },
      ],
    }),
  );
  expect(result.priorChecks).toEqual([
    { commentId: 11, status: "fixed", evidence: "src/a.ts:3 で null を弾いている" },
    { commentId: 12, status: "unfixed", evidence: "まだ未対応" },
    { commentId: 13, status: "unverified", evidence: "" },
  ]);
});

test("priorFindings が無ければ判定は空", () => {
  expect(parseReviewResult('{"findings": []}').priorChecks).toEqual([]);
});

test("リスクの判定を読み取る。段階を読めなければ判定が無かったものとして null", () => {
  expect(
    parseReviewResult(
      JSON.stringify({ findings: [], risk: { level: "high", reasons: ["権限", "", 3] } }),
    ).risk,
  ).toEqual({ level: "high", reasons: ["権限"] });
  expect(
    parseReviewResult(JSON.stringify({ findings: [], risk: { level: "extreme" } })).risk,
  ).toBeNull();
  expect(parseReviewResult(JSON.stringify({ findings: [] })).risk).toBeNull();
});

test("元の日本語と locale の日本語は、AI の判定ではなく文字列を比べて一致を決める", () => {
  const result = parseReviewResult(
    JSON.stringify({
      findings: [],
      i18nComparisons: [
        { key: "history.open", original: "履歴を見る", locale: " 履歴を見る ", match: false },
        { key: "", original: "帳票出力", locale: "帳票出力設定", match: true },
        { key: "x", original: "", locale: "" },
        "broken",
      ],
    }),
  );
  expect(result.i18nComparisons).toEqual([
    { key: "history.open", original: "履歴を見る", locale: "履歴を見る", match: true },
    { key: "", original: "帳票出力", locale: "帳票出力設定", match: false },
  ]);
});

test("i18nComparisons が書かれていなければ null", () => {
  expect(parseReviewResult('{"findings": []}').i18nComparisons).toBeNull();
});
