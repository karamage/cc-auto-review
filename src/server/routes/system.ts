import type { Hono } from "hono";
import type { AppDeps } from "../app.ts";

/** 開いてよい外部の URL。http(s) だけ。file: やカスタムスキームでアプリを起動させない */
export function isOpenableUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * デスクトップアプリの webview ではブラウザの通知も新しいウィンドウも使えないので、
 * OS の機能をサーバから呼ぶ
 */
export function registerSystemRoutes(app: Hono, deps: AppDeps): void {
  app.post("/api/system/open", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { url?: unknown } | null;
    if (!isOpenableUrl(body?.url)) return c.json({ message: "Invalid URL", detail: null }, 400);
    await deps.system.openUrl(body.url);
    return c.body(null, 204);
  });

  app.post("/api/system/notify", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      title?: unknown;
      body?: unknown;
    } | null;
    if (typeof body?.title !== "string") {
      return c.json({ message: "Invalid notification", detail: null }, 400);
    }
    await deps.system.notify(body.title.slice(0, 200), String(body.body ?? "").slice(0, 1000));
    return c.body(null, 204);
  });
}
