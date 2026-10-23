import { useSyncExternalStore } from "react";
import { DEFAULT_LANG, type Lang } from "../shared/i18n.ts";
import { MESSAGES, type Messages } from "./messages.ts";

/**
 * 画面の言語。ブラウザ版と TUI で共有する。
 * 文言は描画のたびに t() で引くので、切り替えるとその場で描き直される
 */
let current: Lang = DEFAULT_LANG;
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  for (const listener of listeners) listener();
}

export function subscribeLang(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** いまの言語の文言 */
export function t(): Messages {
  return MESSAGES[current];
}

/** 言語が変わったら描き直す。最上位のコンポーネントで一度呼べば、配下はすべて描き直される */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang);
}
