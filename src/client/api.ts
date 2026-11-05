import type {
  ChatRequest,
  ChatStreamEvent,
  ClaudeUsage,
  PostedReview,
  PRActivity,
  PRDetail,
  PRDigest,
  PRListResponse,
  PRRef,
  ReviewModel,
  ReviewStreamEvent,
  SubmitRequest,
  SubmitResponse,
} from "../shared/types.ts";
import type { Settings } from "../shared/settings.ts";
import { apiToken } from "./desktop.ts";
import { getLang, t } from "./i18n.ts";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly detail: string | null,
    /** 呼び出し側が理由で扱いを変えるための印。サーバが付けたときだけある */
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** API への HTTP リクエストを送る関数。テストでは Hono の app.fetch へ直接渡す */
export type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

/** AI レビューの実行条件。PR ごとに画面で選ぶ */
export interface ReviewOptions {
  instructions: string;
  /** "default" なら設定の既定、null なら claude の設定に任せる */
  model: ReviewModel | null | "default";
  /** 使うプロファイル。null なら設定の既定 */
  profileId: string | null;
  /** 変更のリスクも判定させるか。完全自動運転のときだけ true */
  assessRisk?: boolean;
}

export interface ApiClient {
  fetchPRs(): Promise<PRListResponse>;
  fetchPRDetail(pr: PRRef): Promise<PRDetail>;
  submitReview(pr: PRRef, req: SubmitRequest): Promise<PostedReview>;
  /** PR に自動判断のラベルを付ける。以降は完全自動運転が人に回さずに進める */
  markAutoJudge(pr: PRRef): Promise<void>;
  /** since（投稿時刻）以降に PR で起きたこと */
  fetchActivity(pr: PRRef, since: string): Promise<PRActivity>;
  /** PR のいまの head と変更の中身の要約。前回レビューした中身から変わったかを見るのに使う */
  fetchDigest(pr: PRRef): Promise<PRDigest>;
  /** 最後に実行した AI レビューから読んだ Claude Code の使用量。まだ実行していなければ null */
  fetchUsage(): Promise<ClaudeUsage | null>;
  fetchSettings(): Promise<Settings>;
  fetchDefaultSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<Settings>;
  /** 保存前の設定で、プロファイルがどんなプロンプトになるか */
  previewPrompt(settings: Settings, profileId: string): Promise<string>;
  /** 投げっぱなしの POST。外部リンクを開く、通知を出すなど */
  post(path: string, body: unknown): Promise<unknown>;
  streamReview(
    pr: PRRef,
    headSha: string,
    options: ReviewOptions,
    onEvent: (event: ReviewStreamEvent) => void,
  ): Promise<void>;
  streamChat(
    pr: PRRef,
    request: ChatRequest,
    onEvent: (event: ChatStreamEvent) => void,
  ): Promise<void>;
}

/** repo は owner/repo なので、そのまま 2 セグメントになる */
function prPath(pr: PRRef): string {
  return `/api/repos/${pr.repo}/pulls/${pr.number}`;
}

/** SSE を読む。EventSource は POST を送れないので fetch のストリームを自前で読む */
async function readSse<T>(
  body: NonNullable<Response["body"]>,
  onEvent: (event: T) => void,
): Promise<void> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;

    // SSE のイベントは空行で区切られる
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        onEvent(JSON.parse(line.slice("data: ".length)) as T);
      }
    }
  }
}

export function createApiClient(base: Fetcher): ApiClient {
  // エラーの文言と AI レビューの指摘を画面の言語で返してもらう
  const fetcher: Fetcher = (path, init) => {
    const headers = new Headers(init?.headers);
    headers.set("accept-language", getLang());
    return base(path, { ...init, headers });
  };

  async function getJson<T>(path: string): Promise<T> {
    return await sendJson<T>(path, undefined);
  }

  async function sendJson<T>(path: string, body: unknown, method = "POST"): Promise<T> {
    const res = await fetcher(
      path,
      body === undefined
        ? undefined
        : {
            method,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    if (!res.ok) {
      const error = (await res.json().catch(() => ({}))) as {
        message?: string;
        detail?: string | null;
      };
      throw new ApiError(error.message ?? t().api.requestFailed, error.detail ?? null);
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  return {
    fetchPRs: () => getJson<PRListResponse>("/api/prs"),

    fetchPRDetail: (pr) => getJson<PRDetail>(prPath(pr)),

    async submitReview(pr, req) {
      const res = await fetcher(`${prPath(pr)}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const body = (await res.json()) as {
          message?: string;
          detail?: string | null;
          code?: string;
        };
        throw new ApiError(
          body.message ?? t().api.submitFailed,
          body.detail ?? null,
          body.code ?? null,
        );
      }
      return ((await res.json()) as SubmitResponse).review;
    },

    async markAutoJudge(pr) {
      const res = await fetcher(`${prPath(pr)}/auto-judge`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string; detail?: string | null };
        throw new ApiError(body.message ?? t().api.requestFailed, body.detail ?? null);
      }
    },

    fetchDigest: (pr) => getJson<PRDigest>(`${prPath(pr)}/digest`),

    fetchActivity: (pr, since) =>
      getJson<PRActivity>(`${prPath(pr)}/activity?since=${encodeURIComponent(since)}`),

    fetchUsage: async () => (await getJson<{ usage: ClaudeUsage | null }>("/api/usage")).usage,

    fetchSettings: () => getJson<Settings>("/api/settings"),

    fetchDefaultSettings: () => getJson<Settings>("/api/settings/defaults"),

    saveSettings: (settings) => sendJson<Settings>("/api/settings", settings, "PUT"),

    previewPrompt: async (settings, profileId) =>
      (await sendJson<{ prompt: string }>("/api/settings/preview", { settings, profileId })).prompt,

    post: (path, body) => sendJson<unknown>(path, body),

    async streamReview(
      pr,
      headSha,
      { instructions, model, profileId, assessRisk = false },
      onEvent,
    ) {
      const res = await fetcher(`${prPath(pr)}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // 表示中の diff を特定させる。ズレていればサーバが弾く
        body: JSON.stringify({ headSha, instructions, model, profileId, assessRisk }),
      });
      if (!res.ok || res.body === null) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new ApiError(body?.message ?? t().api.reviewStartFailed, null);
      }

      await readSse<ReviewStreamEvent>(res.body, onEvent);
    },

    async streamChat(pr, request, onEvent) {
      const res = await fetcher(`${prPath(pr)}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!res.ok || res.body === null) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new ApiError(body?.message ?? t().chat.failed, null);
      }
      await readSse<ChatStreamEvent>(res.body, onEvent);
    },
  };
}

const token = typeof window === "undefined" ? null : apiToken();

/** 合言葉をヘッダに載せて、同じオリジンのサーバに送る */
export const browserFetch = (path: string, init?: RequestInit): Promise<Response> => {
  const headers = new Headers(init?.headers);
  if (token !== null) headers.set("x-cc-auto-review-token", token);
  return fetch(path, { ...init, headers });
};

export const browserClient = createApiClient(browserFetch);

export const { fetchPRs, fetchPRDetail, submitReview, streamReview } = browserClient;
