import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { normalizeSettings, type Settings } from "../../shared/settings.ts";
import type { LearningFile } from "./learnings.ts";

/** 設定と画面の状態を置くディレクトリを指す環境変数。無ければ ~/.config/cc-auto-review */
export const ENV_HOME = "CC_AUTO_REVIEW_HOME";

export function dataDir(env: Record<string, string | undefined> = process.env): string {
  return env[ENV_HOME] ?? join(homedir(), ".config", "cc-auto-review");
}

/** 書きかけのファイルが残らないよう、隣に書いてから置き換える */
async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, path);
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * レビューのやり方の設定。サーバが AI レビューのたびに読むので、メモリにも持つ。
 * ファイルが無ければ既定値で始め、壊れていても読める項目だけ使う
 */
export class SettingsStore {
  private current: Settings | null = null;

  constructor(private readonly path: string) {}

  async get(): Promise<Settings> {
    if (this.current !== null) return this.current;
    const raw = await readOrNull(this.path);
    let parsed: unknown = null;
    try {
      parsed = raw === null ? null : JSON.parse(raw);
    } catch {
      console.error(`Could not parse ${this.path}. Using the default settings.`);
    }
    this.current = normalizeSettings(parsed);
    return this.current;
  }

  async save(raw: unknown): Promise<Settings> {
    const settings = normalizeSettings(raw);
    await writeAtomic(this.path, `${JSON.stringify(settings, null, 2)}\n`);
    this.current = settings;
    return settings;
  }
}

/** 画面の状態（AI レビューの結果、見守り、自動運転）を保存するキー。決めたものだけを受け付ける */
export const STATE_KEYS = ["sessions", "autopilot", "lang"] as const;
export type StateKey = (typeof STATE_KEYS)[number];

export function isStateKey(value: unknown): value is StateKey {
  return (STATE_KEYS as readonly unknown[]).includes(value);
}

/**
 * 画面の状態をファイルに置く。デスクトップアプリはサーバのポートが起動のたびに変わり、
 * ブラウザの localStorage はオリジンごとに分かれて引き継げないので、サーバ側に持つ
 */
export class StateStore {
  constructor(private readonly dir: string) {}

  private file(key: StateKey): string {
    return join(this.dir, `${key}.json`);
  }

  async load(key: StateKey): Promise<string | null> {
    return await readOrNull(this.file(key));
  }

  async save(key: StateKey, data: string): Promise<void> {
    await writeAtomic(this.file(key), data);
  }
}

/** 学び帳のファイル。読めないファイルは .broken に移して残す */
export class JsonLearningFile implements LearningFile {
  constructor(private readonly path: string) {}

  async load(): Promise<string | null> {
    return await readOrNull(this.path);
  }

  async save(data: string): Promise<void> {
    await writeAtomic(this.path, data);
  }

  async quarantine(): Promise<void> {
    await rename(this.path, `${this.path}.broken`);
  }
}
