import { join } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/serve-static";
import type { Lang } from "../shared/i18n.ts";
import { AppError } from "./errors.ts";
import type { GitHubClient } from "./github/client.ts";
import type { ReviewRunner } from "./reviewer/runner.ts";
import type { Translator } from "./reviewer/translate.ts";
import { registerChatRoutes } from "./routes/chat.ts";
import { registerPRRoutes } from "./routes/prs.ts";
import { registerReviewRoutes } from "./routes/review.ts";
import { registerSettingsRoutes } from "./routes/settings.ts";
import { registerSubmitRoutes } from "./routes/submit.ts";
import { registerSystemRoutes } from "./routes/system.ts";
import type { SnapshotManager } from "./snapshot/manager.ts";
import type { Settings } from "../shared/settings.ts";
import type { StateKey } from "./store/files.ts";
import type { StaticFiles } from "./runtime/types.ts";
import type { SystemActions } from "./system.ts";
import { requestLang } from "./lang.ts";

export interface AppDeps {
  github: GitHubClient;
  /** AI レビュー用の作業ディレクトリ。clone せず変更ファイルだけを置く */
  snapshots: SnapshotManager;
  reviewer: ReviewRunner;
  /** claude が GitHub 上のファイルを読むコマンド。プロンプトに載せる */
  remoteReadCommand: string;
  /** 指摘を書いた言語と違う言語で投稿するときに、コメントを訳す */
  translator: Translator;
  /** レビューのやり方の設定 */
  settings: { get(): Promise<Settings>; save(raw: unknown): Promise<Settings> };
  /** 画面の状態の保存先 */
  state: {
    load(key: StateKey): Promise<string | null>;
    save(key: StateKey, data: string): Promise<void>;
  };
  system: SystemActions;
  clientDir: string;
  staticFiles: StaticFiles;
  /**
   * API を呼ぶのに要る合言葉。デスクトップアプリが起動のたびに作って渡す。
   * localhost で待ち受けるので、ほかのアプリやブラウザのページから API を叩かせない。
   * null なら確かめない（開発時）
   */
  token?: string | null;
}

/** 合言葉を載せるヘッダ */
export const TOKEN_HEADER = "x-cc-auto-review-token";

export function toErrorResponse(
  error: unknown,
  lang: Lang = "en",
): { message: string; detail: string | null } {
  if (error instanceof AppError) {
    return { message: error.localized(lang), detail: error.detail ?? null };
  }
  return {
    message: lang === "ja" ? "予期しないエラーが発生しました" : "An unexpected error occurred",
    detail: error instanceof Error ? error.message : String(error),
  };
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  const token = deps.token ?? null;
  if (token !== null) {
    app.use("/api/*", async (c, next) => {
      if (c.req.header(TOKEN_HEADER) !== token) {
        return c.json({ message: "Forbidden", detail: null }, 403);
      }
      await next();
    });
  }

  registerPRRoutes(app, deps);
  registerReviewRoutes(app, deps);
  registerChatRoutes(app, deps);
  registerSubmitRoutes(app, deps);
  registerSettingsRoutes(app, deps);
  registerSystemRoutes(app, deps);

  // 想定外の失敗はすべて 500。入力の不正は各ルートが自分で 400 を返す
  app.onError((error, c) => c.json(toErrorResponse(error, requestLang(c)), 500));

  // API 以外はビルド済みクライアントを返す。未知のパスは index.html（SPA フォールバック）
  const files = {
    getContent: (path: string) => deps.staticFiles.read(path),
    isDir: (path: string) => deps.staticFiles.isDirectory(path),
    join,
  };
  app.use("/*", serveStatic({ ...files, root: deps.clientDir }));
  app.get("/*", serveStatic({ ...files, root: deps.clientDir, path: "index.html" }));

  return app;
}
