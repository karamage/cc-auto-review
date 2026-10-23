import type { Hono } from "hono";
import { defaultSettings, findProfile, normalizeSettings } from "../../shared/settings.ts";
import type { AppDeps } from "../app.ts";
import { requestLang } from "../lang.ts";
import { buildReviewPrompt } from "../reviewer/prompt.ts";
import { isStateKey } from "../store/files.ts";

/** 画面の状態 1 つの上限。壊れたクライアントがディスクを埋めないように */
const MAX_STATE_BYTES = 20 * 1024 * 1024;

export function registerSettingsRoutes(app: Hono, deps: AppDeps): void {
  app.get("/api/settings", async (c) => c.json(await deps.settings.get()));

  app.get("/api/settings/defaults", (c) => c.json(defaultSettings()));

  app.put("/api/settings", async (c) => {
    const body = (await c.req.json().catch(() => null)) as unknown;
    if (body === null || typeof body !== "object") {
      const en = requestLang(c) === "en";
      return c.json(
        { message: en ? "Malformed settings" : "設定の形式が不正です", detail: null },
        400,
      );
    }
    return c.json(await deps.settings.save(body));
  });

  // 保存前の設定で、プロファイルがどんなプロンプトになるかを見せる。PR は架空のもの
  app.post("/api/settings/preview", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      settings?: unknown;
      profileId?: unknown;
    } | null;
    const settings = normalizeSettings(body?.settings ?? (await deps.settings.get()));
    const profile = findProfile(
      settings,
      typeof body?.profileId === "string" ? body.profileId : null,
    );
    const prompt = buildReviewPrompt({
      prNumber: 123,
      title: "Example pull request",
      baseRef: "main",
      description: "(The PR description goes here.)",
      files: [],
      outputPath: "/tmp/cc-auto-review/findings.json",
      diffPath: "/tmp/cc-auto-review/pr.diff",
      remoteReadCommand: deps.remoteReadCommand,
      profile,
      language: requestLang(c),
    });
    return c.json({ prompt });
  });

  app.get("/api/state/:key", async (c) => {
    const key = c.req.param("key");
    if (!isStateKey(key)) return c.json({ message: "Unknown key", detail: null }, 404);
    return c.json({ data: await deps.state.load(key) });
  });

  app.put("/api/state/:key", async (c) => {
    const key = c.req.param("key");
    if (!isStateKey(key)) return c.json({ message: "Unknown key", detail: null }, 404);
    const data = await c.req.text();
    if (data.length > MAX_STATE_BYTES) {
      return c.json({ message: "Too large", detail: null }, 413);
    }
    await deps.state.save(key, data);
    return c.body(null, 204);
  });
}
