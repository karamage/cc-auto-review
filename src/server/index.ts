#!/usr/bin/env bun
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { DEFAULT_LANG, isLang, type Lang } from "../shared/i18n.ts";
import { ENV_LANG, parseCliArgs, type RunOptions, usage } from "./cli.ts";
import { installRemoteRead, loginShellPath } from "./env.ts";
import { AppError } from "./errors.ts";
import { BunCommandRunner } from "./exec.ts";
import { GitHubClient } from "./github/client.ts";
import { findAvailablePort, runPreflight } from "./preflight.ts";
import { runRemoteRead } from "./reviewer/remote-read.ts";
import { BunFileReader, ReviewRunner } from "./reviewer/runner.ts";
import { Translator } from "./reviewer/translate.ts";
import { SnapshotManager } from "./snapshot/manager.ts";
import { dataDir, SettingsStore, StateStore } from "./store/files.ts";
import { OsSystemActions } from "./system.ts";

const DEFAULT_PORT = 4711;

/** デスクトップアプリが起動のたびに作って渡す、API の合言葉 */
const ENV_TOKEN = "CC_AUTO_REVIEW_TOKEN";

/** デスクトップアプリがこの行を読んで、画面を開く URL を知る */
const READY_PREFIX = "CC_AUTO_REVIEW_READY ";

function isPortFree(port: number): boolean {
  try {
    const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("") });
    server.stop(true);
    return true;
  } catch {
    return false;
  }
}

/**
 * このプロセスを remote-read として呼び直すコマンド。
 * bun build --compile した実行ファイルなら自分自身、bun で動かしているならこのファイルを渡す
 */
function selfCommand(): string[] {
  const compiled = import.meta.path.startsWith("/$bunfs/") || import.meta.path.includes("~BUN");
  return compiled ? [process.execPath] : [process.execPath, import.meta.path];
}

async function main(options: RunOptions, lang: Lang): Promise<void> {
  const say = (ja: string, en: string): string => (lang === "ja" ? ja : en);
  const runner = new BunCommandRunner();

  // Finder から起動するとログインシェルの PATH が無く、gh も claude も見つからない
  process.env.PATH = await loginShellPath(runner);

  const preflight = await runPreflight(runner, lang);
  if (!preflight.ok) {
    console.error(say("起動できませんでした:\n", "Could not start:\n"));
    for (const message of preflight.messages) console.error(`  - ${message}`);
    process.exit(1);
  }

  const home = dataDir();
  const remoteReadCommand = await installRemoteRead(join(home, "bin"), selfCommand());
  const github = new GitHubClient(runner);
  const snapshots = new SnapshotManager(github, join(tmpdir(), "cc-auto-review-snapshots"));
  // 前回のプロセスが残した作業ディレクトリを掃除してから始める
  await snapshots.pruneOrphans();

  const app = createApp({
    github,
    snapshots,
    reviewer: new ReviewRunner(runner, new BunFileReader(), remoteReadCommand),
    remoteReadCommand,
    translator: new Translator(runner, new BunFileReader()),
    settings: new SettingsStore(join(home, "settings.json")),
    state: new StateStore(join(home, "state")),
    system: new OsSystemActions(runner),
    clientDir: options.clientDir ?? join(import.meta.dir, "../../dist/client"),
    token: process.env[ENV_TOKEN] ?? null,
  });

  const port = options.port === 0 ? 0 : findAvailablePort(options.port ?? DEFAULT_PORT, isPortFree);
  // AI レビューは数分かかることがある。Bun の HTTP idle timeout（デフォルト 10 秒）で
  // SSE 接続が切られないよう、指定可能な最大値まで延ばす（併せて review ルート側で heartbeat も送る）
  const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: app.fetch, idleTimeout: 255 });
  const url = `http://127.0.0.1:${server.port}`;

  const shutdown = async (): Promise<void> => {
    await snapshots.destroyAll();
    server.stop(true);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  if (options.desktop) {
    console.log(`${READY_PREFIX}${url}`);
    return;
  }
  console.log(say(`cc-auto-review を起動しました: ${url}`, `cc-auto-review is running: ${url}`));
  await new OsSystemActions(runner).openUrl(url);
}

// claude から remote-read として呼ばれたときは、サーバを立てずに読むだけ
if (process.argv[2] === "remote-read") {
  await runRemoteRead(process.argv.slice(3));
}

const envLang = process.env[ENV_LANG];
const defaultLang: Lang = isLang(envLang) ? envLang : DEFAULT_LANG;
const options = parseCliArgs(process.argv.slice(2), defaultLang);
if (options.kind === "help") {
  console.log(usage(options.lang ?? defaultLang));
  process.exit(0);
}
if (options.kind === "error") {
  console.error(`${options.message}\n\n${usage(defaultLang)}`);
  process.exit(1);
}

const lang = options.lang ?? defaultLang;
try {
  await main(options, lang);
} catch (error) {
  // ここまで来る失敗はすべて起動時のもの。スタックトレースではなく対処法を出す
  const failed = lang === "ja" ? "起動できませんでした" : "Could not start";
  if (error instanceof AppError) {
    console.error(`${failed}: ${error.localized(lang)}`);
    if (error.detail !== undefined) {
      console.error(`\n${lang === "ja" ? "詳細" : "Details"}: ${error.detail}`);
    }
  } else {
    console.error(`${failed}:`);
    console.error(error);
  }
  process.exit(1);
}
