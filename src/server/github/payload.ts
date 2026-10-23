import type { ReviewEventKind, SubmitRequest } from "../../shared/types.ts";
import { withLgtmImage } from "../../shared/lgtm.ts";

export interface ReviewPayloadComment {
  path: string;
  body: string;
  line: number;
  side: "RIGHT";
}

export interface ReviewPayload {
  event: ReviewEventKind;
  body: string;
  commit_id: string;
  comments: ReviewPayloadComment[];
}

export function buildReviewPayload(
  req: SubmitRequest,
  random: () => number = Math.random,
): ReviewPayload {
  const comments: ReviewPayloadComment[] = [];
  const summaries: string[] = [];

  for (const c of req.comments) {
    // 一括レビュー API の comments[] は行コメントしか受け付けない。
    // 行番号を持たないものは本文送りにする（載せると投稿全体が 422 で失敗する）
    if (c.anchor === "line" && c.line !== null) {
      comments.push({ path: c.path, body: c.body, line: c.line, side: "RIGHT" });
    } else {
      summaries.push(`- **${c.path}**: ${c.body}`);
    }
  }

  // 定型文も投稿言語に合わせる。本文だけ英語で見出しが日本語、という混在を避ける
  const en = req.language === "en";

  // COMMENT / REQUEST_CHANGES は body が必須。空だと 422 になる
  const base =
    req.body.trim().length > 0 || req.event === "APPROVE"
      ? req.body
      : en
        ? `${req.comments.length} finding(s) from the AI review.`
        : `AI レビューの指摘 ${req.comments.length} 件です。`;

  const heading = en ? "### Findings not tied to a line" : "### 行に紐づけられなかった指摘";
  const composed =
    summaries.length === 0 ? base : [base, "", "---", "", heading, "", ...summaries].join("\n");
  // 承認したときは LGTM 画像を添える
  const body = req.event === "APPROVE" ? withLgtmImage(composed, req.lgtm, random) : composed;

  return { event: req.event, body, commit_id: req.commitId, comments };
}
