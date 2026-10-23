import type { Context } from "hono";
import { type Lang, langFromLocale } from "../shared/i18n.ts";

/**
 * 応答に使う言語。画面は自分の言語を Accept-Language で送ってくる。
 * 送ってこなければ英語で返す
 */
export function requestLang(c: Context): Lang {
  return langFromLocale(c.req.header("accept-language"));
}
