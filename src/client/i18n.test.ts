import { afterEach, expect, test } from "bun:test";
import { createApiClient } from "./api.ts";
import { formatRelative } from "./format.ts";
import { setLang, t } from "./i18n.ts";

afterEach(() => setLang("ja"));

test("API には画面の言語を Accept-Language で送る", async () => {
  const sent: (string | null)[] = [];
  const api = createApiClient(async (_path, init) => {
    sent.push(new Headers(init?.headers).get("accept-language"));
    return Response.json({ prs: [], reviewed: [] });
  });

  await api.fetchPRs();
  setLang("en");
  await api.fetchPRs();

  expect(sent).toEqual(["ja", "en"]);
});

test("言語を切り替えると文言も切り替わる", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  expect(formatRelative("2026-10-07T09:00:00Z", now)).toBe("3 時間前");
  expect(t().list.title).toBe("レビュー依頼");

  setLang("en");
  expect(formatRelative("2026-10-07T09:00:00Z", now)).toBe("3 hours ago");
  expect(t().list.title).toBe("Review requests");
});
