import type { Context, Hono } from "hono";
import type { Lang } from "../../shared/i18n.ts";
import type { LearningPatch } from "../../shared/types.ts";
import type { AppDeps } from "../app.ts";
import { requestLang } from "../lang.ts";
import { LearningError } from "../store/learnings.ts";

function malformed(c: Context, lang: Lang): Response {
  return c.json(
    { message: lang === "en" ? "Malformed request" : "リクエストの形式が不正です", detail: null },
    400,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 型の合わないものがあれば null。何も変えない指定も誤りとして扱う */
function parsePatch(value: unknown): LearningPatch | null {
  if (!isObject(value)) return null;
  const patch: LearningPatch = {};
  if (value.text !== undefined) {
    if (typeof value.text !== "string") return null;
    patch.text = value.text;
  }
  if (value.pinned !== undefined) {
    if (typeof value.pinned !== "boolean") return null;
    patch.pinned = value.pinned;
  }
  if (value.adopt !== undefined) {
    if (typeof value.adopt !== "boolean") return null;
    patch.adopt = value.adopt;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

function notFoundId(c: Context, lang: Lang): Response {
  return c.json(
    { message: lang === "en" ? "Learning not found" : "学びが見つかりません", detail: null },
    404,
  );
}

function parseId(value: string | undefined): number | null {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : null;
}

/** ストアの入力の誤りは、決めた状態コードで返す。それ以外は app.onError に任せる */
async function guarded(c: Context, action: () => Promise<Response>): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof LearningError)) throw error;
    return c.json({ message: error.localized(requestLang(c)), detail: null }, error.status);
  }
}

export function registerLearningRoutes(app: Hono, deps: AppDeps): void {
  app.get("/api/learnings", async (c) => c.json({ learnings: await deps.learnings.list() }));

  app.post("/api/learnings", (c) =>
    guarded(c, async () => {
      const body = (await c.req.json().catch(() => null)) as unknown;
      if (!isObject(body) || typeof body.repo !== "string" || typeof body.text !== "string") {
        return malformed(c, requestLang(c));
      }
      return c.json(await deps.learnings.add(body.repo, body.text));
    }),
  );

  // /api/learnings/:id より先に登録する
  app.post("/api/learnings/reset", (c) =>
    guarded(c, async () => {
      const body = (await c.req.json().catch(() => null)) as unknown;
      if (!isObject(body) || (body.repo !== undefined && typeof body.repo !== "string")) {
        return malformed(c, requestLang(c));
      }
      return c.json({ removed: await deps.learnings.reset(body.repo as string | undefined) });
    }),
  );

  app.put("/api/learnings/:id", (c) =>
    guarded(c, async () => {
      const lang = requestLang(c);
      const id = parseId(c.req.param("id"));
      if (id === null) return notFoundId(c, lang);
      const patch = parsePatch(await c.req.json().catch(() => null));
      if (patch === null) return malformed(c, lang);
      return c.json(await deps.learnings.update(id, patch));
    }),
  );

  app.delete("/api/learnings/:id", (c) =>
    guarded(c, async () => {
      const id = parseId(c.req.param("id"));
      if (id === null) return notFoundId(c, requestLang(c));
      await deps.learnings.remove(id);
      return c.body(null, 204);
    }),
  );
}
