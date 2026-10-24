import type { CommandRunner } from "../exec.ts";
import type { FileReader } from "../reviewer/runner.ts";

/** 画面のファイルを配るのに使う */
export interface StaticFiles {
  /** ファイルの中身。無ければ null */
  read(path: string): Promise<Uint8Array<ArrayBuffer> | null>;
  isDirectory(path: string): Promise<boolean>;
}

export interface HttpServer {
  readonly port: number;
  stop(): Promise<void>;
}

/**
 * サーバを動かすランタイムごとに違う部分。
 * 開発とテストは Bun で、配布するアプリは txiki.js（小さな JS ランタイム）で動かす
 */
export interface Runtime {
  runner: CommandRunner;
  files: FileReader;
  staticFiles: StaticFiles;
  isPortFree(port: number): Promise<boolean>;
  /** 127.0.0.1 で待ち受ける。port が 0 なら空いているポートを OS に選ばせる */
  serve(port: number, fetch: (request: Request) => Response | Promise<Response>): HttpServer;
  /** このプロセスをもう一度起動するコマンド。claude が remote-read として呼ぶ */
  selfCommand(): string[];
  /** 書き終わるまで待つ。直後に exit しても出力が欠けない */
  write(stream: "stdout" | "stderr", text: string): Promise<void>;
}
