import { useSyncExternalStore } from "react";
import { defaultSettings, type Settings } from "../shared/settings.ts";

/**
 * サーバに保存したレビューのやり方の設定。起動時に読み込み、設定画面で保存したら差し替える。
 * 読み込む前（とテスト）は既定値で動く
 */
let current: Settings = defaultSettings();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function setSettings(settings: Settings): void {
  current = settings;
  for (const listener of listeners) listener();
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings);
}
