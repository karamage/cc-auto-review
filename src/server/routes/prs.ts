import type { Hono } from "hono";
import type { Lang } from "../../shared/i18n.ts";
import { computeBaselineRisk } from "../../shared/risk-score.ts";
import type { PRActivity, PRDetail, PRDigest, PRListResponse, PRRef } from "../../shared/types.ts";
import type { AppDeps } from "../app.ts";
import { diffDigest } from "../diff/digest.ts";
import { parseUnifiedDiff } from "../diff/parse.ts";
import { requestLang } from "../lang.ts";

/** GitHub の owner / repo に使える文字だけを通す。gh api のパスに埋め込むので厳しめに見る */
const NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * URL の :owner / :repo / :number を検証して PRRef にする。不正なら null。
 * ルートはすべて /api/repos/:owner/:repo/pulls/:number 配下に置く
 */
export function parsePRRef(params: {
  owner?: string;
  repo?: string;
  number?: string;
}): PRRef | null {
  const { owner = "", repo = "", number = "" } = params;
  const validName = (name: string): boolean => NAME.test(name) && name !== "." && name !== "..";
  if (!validName(owner) || !validName(repo) || !/^\d+$/.test(number)) return null;
  return { repo: `${owner}/${repo}`, number: Number(number) };
}

/** URL の PR の指定が読めなかったときの文言。activity では since も見る */
export function invalidPR(lang: Lang, withSince = false): string {
  if (lang === "en") return withSince ? "Invalid PR or since" : "Invalid PR";
  return withSince ? "PR または since の指定が不正です" : "PR の指定が不正です";
}

export const PR_PATH = "/api/repos/:owner/:repo/pulls/:number";

export function registerPRRoutes(app: Hono, deps: AppDeps): void {
  app.get("/api/prs", async (c) => {
    const [prs, reviewed] = await Promise.all([
      deps.github.listReviewRequestedPRs(),
      deps.github.listReviewedPRs(),
    ]);
    const body: PRListResponse = { prs, reviewed };
    return c.json(body);
  });

  // 投稿したレビューへの反応を見る。since は投稿時刻で、それより後の作成者のコメントと、
  // ほかの人の承認だけを返す
  app.get(`${PR_PATH}/activity`, async (c) => {
    const pr = parsePRRef(c.req.param());
    const since = Date.parse(c.req.query("since") ?? "");
    if (pr === null || Number.isNaN(since)) {
      return c.json({ message: invalidPR(requestLang(c), true), detail: null }, 400);
    }

    const [{ state, headSha, author }, comments, approvals, viewer] = await Promise.all([
      deps.github.fetchPRState(pr),
      deps.github.fetchComments(pr),
      deps.github.fetchApprovals(pr),
      deps.github.fetchViewerLogin(),
    ]);
    const body: PRActivity = {
      state,
      headSha,
      replies: comments.filter(
        (comment) => comment.author === author && Date.parse(comment.createdAt) > since,
      ),
      // 自分の承認は、自分が投稿したレビューそのもの。作成者は自分の PR を承認できない
      approvals: approvals.filter(
        (approval) =>
          approval.author !== viewer &&
          approval.author !== author &&
          Date.parse(approval.submittedAt) > since,
      ),
    };
    return c.json(body);
  });

  // 変更の中身の要約。新しいコミットが来ても、前回レビューした中身から変わっていなければ
  // AI レビューをやり直さない（base を取り込んだだけのマージなど）
  app.get(`${PR_PATH}/digest`, async (c) => {
    const pr = parsePRRef(c.req.param());
    if (pr === null) {
      return c.json({ message: invalidPR(requestLang(c)), detail: null }, 400);
    }
    // head を先に取る。間に push されても、要約は取った head 以降のものになり、
    // 次の確認で head の違いからもう一度確かめるので、変更を見落とさない
    const { headSha } = await deps.github.fetchPRState(pr);
    const body: PRDigest = {
      headSha,
      digest: diffDigest(
        parseUnifiedDiff(await deps.github.fetchDiff(pr)),
        (await deps.settings.get()).autopilot.ignoredPaths,
      ),
    };
    return c.json(body);
  });

  // 人が確かめて、以降は完全自動運転に任せると決めた PR に印を付ける。
  // 印は GitHub のラベルなので、ほかの人にも見え、このアプリの保存データが消えても残る
  app.post(`${PR_PATH}/auto-judge`, async (c) => {
    const pr = parsePRRef(c.req.param());
    if (pr === null) {
      return c.json({ message: invalidPR(requestLang(c)), detail: null }, 400);
    }
    const label = (await deps.settings.get()).autopilot.autoJudgeLabel;
    await deps.github.addLabel(pr, label);
    return c.json({ label });
  });

  app.get(PR_PATH, async (c) => {
    const pr = parsePRRef(c.req.param());
    if (pr === null) {
      return c.json({ message: invalidPR(requestLang(c)), detail: null }, 400);
    }

    const [{ summary, headSha, body, draft, authorIsBot }, bodyHtml, patch, comments, settings] =
      await Promise.all([
        deps.github.fetchPRMeta(pr),
        deps.github.fetchBodyHtml(pr),
        deps.github.fetchDiff(pr),
        deps.github.fetchComments(pr),
        deps.settings.get(),
      ]);

    const files = parseUnifiedDiff(patch);
    const detail: PRDetail = {
      pr: summary,
      bodyHtml,
      headSha,
      files,
      comments,
      // AI を呼ばずに決まる基準点。PR を開いた時点でリスクを見せる
      riskScore: computeBaselineRisk(
        {
          files,
          title: summary.title,
          body,
          draft,
          authorIsBot,
          ignoredPaths: settings.autopilot.ignoredPaths,
          threshold: settings.autopilot.riskThreshold,
        },
        requestLang(c),
      ),
    };
    return c.json(detail);
  });
}
