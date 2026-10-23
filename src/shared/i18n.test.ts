import { expect, test } from "bun:test";
import { langFromLocale } from "./i18n.ts";

test("ロケールや Accept-Language の先頭の言語で決める", () => {
  expect(langFromLocale("ja-JP")).toBe("ja");
  expect(langFromLocale("en_US.UTF-8")).toBe("en");
  expect(langFromLocale("en-US,ja;q=0.9")).toBe("en");
  expect(langFromLocale("fr-FR")).toBe("en");
});

test("何も無ければ既定の言語にする", () => {
  expect(langFromLocale(undefined)).toBe("en");
  expect(langFromLocale("")).toBe("en");
  expect(langFromLocale("C", "ja")).toBe("ja");
});
