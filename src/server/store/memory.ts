import { defaultSettings, normalizeSettings, type Settings } from "../../shared/settings.ts";
import type { SystemActions } from "../system.ts";
import type { StateKey } from "./files.ts";

/** テスト用。設定をメモリにだけ持つ */
export class MemorySettingsStore {
  constructor(private current: Settings = defaultSettings()) {}
  async get(): Promise<Settings> {
    return this.current;
  }
  async save(raw: unknown): Promise<Settings> {
    this.current = normalizeSettings(raw);
    return this.current;
  }
}

/** テスト用。画面の状態をメモリにだけ持つ */
export class MemoryStateStore {
  readonly data = new Map<StateKey, string>();
  async load(key: StateKey): Promise<string | null> {
    return this.data.get(key) ?? null;
  }
  async save(key: StateKey, data: string): Promise<void> {
    this.data.set(key, data);
  }
}

/** テスト用。開いた URL と通知を記録するだけ */
export class RecordingSystemActions implements SystemActions {
  readonly opened: string[] = [];
  readonly notified: { title: string; body: string }[] = [];
  async openUrl(url: string): Promise<void> {
    this.opened.push(url);
  }
  async notify(title: string, body: string): Promise<void> {
    this.notified.push({ title, body });
  }
}

/** createApp に渡す、テスト用の既定の部品 */
export function memoryDeps(settings?: Settings) {
  return {
    settings: new MemorySettingsStore(settings),
    state: new MemoryStateStore(),
    system: new RecordingSystemActions(),
  };
}

/**
 * テスト用。指定が無ければ日本語で応答させる。既定の言語は英語だが、
 * ルートのテストは日本語の文言で書いてあるので、リクエストに accept-language: ja を足す
 */
export function inJapanese<T extends { request: (...args: any[]) => any }>(app: T): T {
  const original = app.request.bind(app);
  app.request = ((input: string, init: RequestInit = {}, ...rest: unknown[]) => {
    const headers = new Headers(init.headers);
    if (!headers.has("accept-language")) headers.set("accept-language", "ja");
    return original(input, { ...init, headers }, ...rest);
  }) as T["request"];
  return app;
}
