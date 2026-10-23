/** 画面に出す言語。AI レビューの指摘もこの言語で書かせる */
export type Lang = "ja" | "en";

export const LANGS: readonly Lang[] = ["ja", "en"];

/** 指定が無いときの言語 */
export const DEFAULT_LANG: Lang = "en";

export function isLang(value: unknown): value is Lang {
  return value === "ja" || value === "en";
}

/**
 * "ja-JP" や "en_US.UTF-8"、Accept-Language の "en-US,en;q=0.9" から言語を選ぶ。
 * 先頭の言語だけを見る。日本語でも英語でもなければ英語、何も無ければ fallback
 */
export function langFromLocale(
  locale: string | null | undefined,
  fallback: Lang = DEFAULT_LANG,
): Lang {
  const tag = locale?.trim().toLowerCase() ?? "";
  if (tag === "" || tag === "c" || tag === "posix") return fallback;
  return tag.startsWith("ja") ? "ja" : "en";
}

/** 言語ごとの文言。サーバのエラーのように、相手の言語が決まる前に作る文言に使う */
export type LocalizedText = Readonly<Record<Lang, string>>;
