import type { Lang, LocalizedText } from "../shared/i18n.ts";

/**
 * ユーザーにそのまま見せてよいメッセージを持つエラー。
 * 投げる時点では相手の言語が分からないので、日本語と英語の両方を持たせ、応答を返すときに選ぶ。
 * message は日本語（ログやテストで読む既定の言語）
 */
export class AppError extends Error {
  readonly text: LocalizedText;

  constructor(
    message: string | LocalizedText,
    readonly detail?: string,
  ) {
    const text = typeof message === "string" ? { ja: message, en: message } : message;
    super(text.ja);
    this.text = text;
    this.name = "AppError";
  }

  localized(lang: Lang): string {
    return this.text[lang];
  }
}

/** 外部コマンド（gh / git / claude）が失敗したときのエラー */
export class ExternalCommandError extends AppError {
  constructor(message: string | LocalizedText, detail?: string) {
    super(message, detail);
    this.name = "ExternalCommandError";
  }
}
