import { expect, test } from "bun:test";
import type { DraftComment, SubmitRequest } from "../../shared/types.ts";
import { buildReviewPayload } from "./payload.ts";

function comment(overrides: Partial<DraftComment>): DraftComment {
  return {
    findingId: "f1",
    path: "src/a.ts",
    line: 2,
    body: "本文",
    anchor: "line",
    ...overrides,
  };
}

function request(overrides: Partial<SubmitRequest>): SubmitRequest {
  return {
    event: "COMMENT",
    body: "総評",
    comments: [],
    commitId: "abc123",
    language: "ja",
    lgtm: "random",
    ...overrides,
  };
}

test("line アンカーは line + side=RIGHT のコメントになる", () => {
  const payload = buildReviewPayload(request({ comments: [comment({ line: 7 })] }));
  expect(payload.comments).toEqual([{ path: "src/a.ts", body: "本文", line: 7, side: "RIGHT" }]);
});

test("commit_id に commitId を渡す", () => {
  expect(buildReviewPayload(request({ commitId: "deadbeef" })).commit_id).toBe("deadbeef");
});

test("summary アンカーはコメントにせず本文の末尾に追記する", () => {
  const payload = buildReviewPayload(
    request({
      body: "総評",
      comments: [comment({ anchor: "summary", line: null, body: "全体の設計について" })],
    }),
  );
  expect(payload.comments).toEqual([]);
  expect(payload.body).toBe(
    [
      "総評",
      "",
      "---",
      "",
      "### 行に紐づけられなかった指摘",
      "",
      "- **src/a.ts**: 全体の設計について",
    ].join("\n"),
  );
});

test("summary が無ければ本文をそのまま使う", () => {
  const payload = buildReviewPayload(request({ body: "総評", comments: [comment({})] }));
  expect(payload.body).toBe("総評");
});

test("event をそのまま引き継ぐ", () => {
  expect(buildReviewPayload(request({ event: "APPROVE" })).event).toBe("APPROVE");
  expect(buildReviewPayload(request({ event: "REQUEST_CHANGES" })).event).toBe("REQUEST_CHANGES");
});

test("line アンカーなのに line が null のものは本文送りにする（422 を出さない）", () => {
  const payload = buildReviewPayload(
    request({ comments: [comment({ anchor: "line", line: null })] }),
  );
  expect(payload.comments).toEqual([]);
  expect(payload.body).toContain("- **src/a.ts**: 本文");
});

test("COMMENT で本文が空なら件数から既定の本文を作る", () => {
  const payload = buildReviewPayload(
    request({ event: "COMMENT", body: "", comments: [comment({ line: 7 })] }),
  );
  // body が空だと GitHub が 422 を返す
  expect(payload.body).toBe("AI レビューの指摘 1 件です。");
});

test("REQUEST_CHANGES で本文が空でも既定の本文を作る", () => {
  const payload = buildReviewPayload(
    request({ event: "REQUEST_CHANGES", body: "   ", comments: [] }),
  );
  expect(payload.body).toBe("AI レビューの指摘 0 件です。");
});

test("APPROVE は本文が空なら LGTM 画像だけを本文にする", () => {
  const payload = buildReviewPayload(request({ event: "APPROVE", body: "" }), () => 0);
  expect(payload.body).toBe("![LGTM](https://image.lgtmoon.dev/185580)");
});

test("APPROVE は本文の末尾に LGTM 画像を添える", () => {
  const payload = buildReviewPayload(request({ event: "APPROVE", body: "総評" }), () => 0);
  expect(payload.body).toBe("総評\n\n![LGTM](https://image.lgtmoon.dev/185580)");
});

test("APPROVE 以外には LGTM 画像を添えない", () => {
  expect(buildReviewPayload(request({ event: "COMMENT" })).body).not.toContain("LGTM");
  expect(buildReviewPayload(request({ event: "REQUEST_CHANGES" })).body).not.toContain("LGTM");
});

test("複数の summary を箇条書きで並べる", () => {
  const payload = buildReviewPayload(
    request({
      body: "総評",
      comments: [
        comment({ findingId: "a", anchor: "summary", line: null, body: "一つ目" }),
        comment({
          findingId: "b",
          anchor: "summary",
          line: null,
          path: "src/b.ts",
          body: "二つ目",
        }),
      ],
    }),
  );
  expect(payload.body).toContain("- **src/a.ts**: 一つ目");
  expect(payload.body).toContain("- **src/b.ts**: 二つ目");
});

test("language が en なら定型文も英語になる", () => {
  const payload = buildReviewPayload(
    request({
      body: "",
      language: "en",
      comments: [comment({ anchor: "summary", line: null, body: "Design concern" })],
    }),
  );
  expect(payload.body).toContain("1 finding(s) from the AI review.");
  expect(payload.body).toContain("### Findings not tied to a line");
  expect(payload.body).not.toContain("行に紐づけられなかった指摘");
});

test("APPROVE で画像を選んでいればその画像を添える", () => {
  const payload = buildReviewPayload(request({ event: "APPROVE", body: "", lgtm: 16343 }));
  expect(payload.body).toBe("![LGTM](https://image.lgtmoon.dev/16343)");
});

test("APPROVE でも lgtm が none なら画像を添えない", () => {
  const payload = buildReviewPayload(request({ event: "APPROVE", body: "", lgtm: "none" }));
  expect(payload.body).toBe("");
});
