import type { Hono } from "hono";
import type {
  AnchorKind,
  CommentLanguage,
  DraftComment,
  SubmitRequest,
  SubmitResponse,
} from "../../shared/types.ts";
import { isLgtmChoice, settleLgtmChoice } from "../../shared/lgtm.ts";
import { SKIP_REVIEW_CODE } from "../../shared/types.ts";
import type { AppDeps } from "../app.ts";
import { AppError } from "../errors.ts";
import { requestLang } from "../lang.ts";
import { invalidPR, PR_PATH, parsePRRef } from "./prs.ts";

const EVENTS = ["APPROVE", "REQUEST_CHANGES", "COMMENT"] as const;
const ANCHORS: readonly AnchorKind[] = ["line", "summary"];
const LANGUAGES: readonly CommentLanguage[] = ["ja", "en"];

const MALFORMED = { ja: "リクエストの形式が不正です", en: "Malformed request" };

function toLanguage(value: unknown): CommentLanguage {
  return LANGUAGES.includes(value as CommentLanguage) ? (value as CommentLanguage) : "en";
}

/** クライアントから来た JSON を検証して SubmitRequest にする */
export function parseSubmitRequest(value: unknown): SubmitRequest {
  const raw = value as Partial<SubmitRequest> | null;
  if (raw === null || typeof raw !== "object") {
    throw new AppError(MALFORMED);
  }
  if (!EVENTS.includes(raw.event as (typeof EVENTS)[number])) {
    throw new AppError({
      ja: "レビュー種別（event）が不正です",
      en: "Invalid review type (event)",
    });
  }
  if (typeof raw.body !== "string") {
    throw new AppError({ ja: "レビュー本文（body）が不正です", en: "Invalid review body (body)" });
  }
  if (typeof raw.commitId !== "string" || raw.commitId.length === 0) {
    throw new AppError({
      ja: "対象コミット（commitId）が指定されていません",
      en: "The target commit (commitId) is missing",
    });
  }
  if (!Array.isArray(raw.comments)) {
    throw new AppError({
      ja: "コメント一覧（comments）が不正です",
      en: "Invalid comment list (comments)",
    });
  }

  const comments: DraftComment[] = raw.comments.map((c, index) => {
    const item = c as Partial<DraftComment>;
    if (typeof item?.path !== "string" || item.path.length === 0) {
      throw new AppError({
        ja: `${index + 1} 件目のコメントに path がありません`,
        en: `Comment ${index + 1} has no path`,
      });
    }
    if (typeof item.body !== "string" || item.body.trim().length === 0) {
      throw new AppError({
        ja: `${index + 1} 件目のコメント本文が空です`,
        en: `Comment ${index + 1} has an empty body`,
      });
    }
    if (!ANCHORS.includes(item.anchor as AnchorKind)) {
      throw new AppError({
        ja: `${index + 1} 件目のコメントの anchor が不正です`,
        en: `Comment ${index + 1} has an invalid anchor`,
      });
    }
    return {
      findingId: typeof item.findingId === "string" ? item.findingId : `comment-${index + 1}`,
      path: item.path,
      line: typeof item.line === "number" ? item.line : null,
      body: item.body,
      anchor: item.anchor as AnchorKind,
    };
  });

  if (raw.event !== "APPROVE" && comments.length === 0 && raw.body.trim().length === 0) {
    throw new AppError({
      ja: "本文もコメントも空のレビューは投稿できません",
      en: "A review with neither a body nor comments cannot be posted",
    });
  }

  return {
    event: raw.event as (typeof EVENTS)[number],
    body: raw.body,
    comments,
    commitId: raw.commitId,
    language: toLanguage(raw.language),
    // 指定が無ければ、投稿する言語で書いたものとみなす（訳さない）
    sourceLanguage: toLanguage(raw.sourceLanguage ?? raw.language),
    // 指定が無ければ画像を添えない。選んだ後に設定の一覧から消された画像でも投稿できるよう、一覧とは照合しない
    lgtm: raw.lgtm === undefined ? "none" : parseLgtm(raw.lgtm),
    autopilot: raw.autopilot === true,
  };
}

function parseLgtm(value: unknown): SubmitRequest["lgtm"] {
  if (!isLgtmChoice(value)) {
    throw new AppError({
      ja: "LGTM 画像（lgtm）の指定が不正です",
      en: "Invalid LGTM image (lgtm)",
    });
  }
  return value;
}

/**
 * 本文と各コメントを訳した SubmitRequest を返す。
 * 空文字は翻訳に送らず、返ってきた訳文を元の位置に戻す。
 */
export async function translateRequest(
  request: SubmitRequest,
  translate: (texts: string[]) => Promise<string[]>,
): Promise<SubmitRequest> {
  const sources = [request.body, ...request.comments.map((c) => c.body)];
  const targets = sources
    .map((text, index) => ({ text, index }))
    .filter((t) => t.text.trim() !== "");

  const translated = await translate(targets.map((t) => t.text));
  const byIndex = new Map(targets.map((t, i) => [t.index, translated[i] as string]));
  const at = (index: number): string => byIndex.get(index) ?? (sources[index] as string);

  return {
    ...request,
    body: at(0),
    comments: request.comments.map((c, i) => ({ ...c, body: at(i + 1) })),
  };
}

export function registerSubmitRoutes(app: Hono, deps: AppDeps): void {
  app.post(`${PR_PATH}/submit`, async (c) => {
    const lang = requestLang(c);
    const pr = parsePRRef(c.req.param());
    if (pr === null) {
      return c.json({ message: invalidPR(lang), detail: null }, 400);
    }

    let request: SubmitRequest;
    try {
      request = parseSubmitRequest(await c.req.json());
    } catch (error) {
      const message = error instanceof AppError ? error.localized(lang) : MALFORMED[lang];
      return c.json({ message, detail: null }, 400);
    }

    // 翻訳に失敗したら投稿しない。選んでいない言語のまま出てしまう方が事故になる
    const posted =
      request.language === (request.sourceLanguage ?? request.language)
        ? request
        : await translateRequest(request, (texts) =>
            deps.translator.translate(texts, request.language),
          );

    // 指摘を確かめている間に push されていたら投稿しない。古いコミットに貼った行コメントは
    // すぐ outdated になり、Approve なら見ていないコードを承認したことになる。
    // 翻訳は時間がかかるので、その後で投稿する直前に確かめる
    const { headSha, labels } = await deps.github.fetchPRState(pr);
    // 完全自動運転がレビューしている間に、AI にレビューさせないと決められた PR には投稿しない
    const settings = await deps.settings.get();
    const skipLabel = settings.autopilot.skipLabel;
    if (request.autopilot === true && labels.includes(skipLabel)) {
      return c.json(
        {
          message:
            lang === "en"
              ? `The ${skipLabel} label was added to this PR, so nothing was posted.`
              : `この PR に ${skipLabel} ラベルが付いたので、投稿は取りやめました。`,
          detail: null,
          code: SKIP_REVIEW_CODE,
        },
        409,
      );
    }
    if (headSha !== request.commitId) {
      return c.json(
        {
          message:
            lang === "en"
              ? "This PR was updated after you started reviewing it, so nothing was posted. Reload the page and check the new changes before posting."
              : "この PR はレビューを始めた後に更新されています。投稿は取りやめました。ページを再読み込みして、新しい変更を確かめてから投稿してください。",
          detail:
            lang === "en"
              ? `Reviewed commit ${request.commitId.slice(0, 7)} / current head ${headSha.slice(0, 7)}`
              : `レビューしたコミット ${request.commitId.slice(0, 7)} / 現在の head ${headSha.slice(0, 7)}`,
        },
        409,
      );
    }

    const response: SubmitResponse = {
      review: await deps.github.submitReview(pr, {
        ...posted,
        lgtm: settleLgtmChoice(posted.lgtm, settings.lgtmImageIds),
      }),
    };
    return c.json(response);
  });
}
