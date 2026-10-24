/**
 * txiki.js（配布するアプリでサーバを動かすランタイム）の API のうち、このアプリが使うものだけの型。
 * 全体は https://github.com/saghul/txiki.js/blob/master/types/src/txikijs.d.ts にある
 */

declare namespace tjs {
  type Signal = "SIGINT" | "SIGTERM" | "SIGHUP";

  interface ProcessStatus {
    exit_status: number;
    term_signal: Signal | null;
  }

  interface ProcessReadableStream extends ReadableStream<Uint8Array> {
    text(): Promise<string>;
  }

  interface Process {
    kill(signal?: Signal): void;
    wait(): Promise<ProcessStatus>;
    readonly pid: number;
    readonly stdout: ProcessReadableStream | null;
    readonly stderr: ProcessReadableStream | null;
  }

  interface ProcessOptions {
    env?: Record<string, string>;
    cwd?: string;
    stdin?: "inherit" | "pipe" | "ignore";
    stdout?: "inherit" | "pipe" | "ignore";
    stderr?: "inherit" | "pipe" | "ignore";
  }

  interface StatResult {
    readonly isDirectory: boolean;
    readonly isFile: boolean;
  }

  interface DirEnt {
    readonly name: string;
  }

  interface Server {
    readonly port: number;
    close(): Promise<void>;
  }

  interface Connection {
    close(): void;
  }

  const args: readonly string[];
  const env: Record<string, string>;
  const exePath: string;
  const homeDir: string;
  const tmpDir: string;
  const pid: number;
  const stdout: WritableStream<Uint8Array>;
  const stderr: WritableStream<Uint8Array>;

  function exit(code: number): never;
  function addSignalListener(signal: Signal, listener: () => void): void;
  function spawn(args: string[], options?: ProcessOptions): Process;

  function readFile(path: string): Promise<Uint8Array<ArrayBuffer>>;
  function writeFile(
    path: string,
    data: string | Uint8Array,
    options?: { mode?: number },
  ): Promise<void>;
  function makeDir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void>;
  function makeTempDir(template: string): Promise<string>;
  function readDir(path: string): Promise<AsyncIterableIterator<DirEnt>>;
  function remove(path: string): Promise<void>;
  function rename(path: string, newPath: string): Promise<void>;
  function chmod(path: string, mode: number): Promise<void>;
  function stat(path: string): Promise<StatResult>;

  function connect(transport: "tcp", host: string, port: number): Promise<Connection>;
  function serve(options: {
    fetch: (request: Request) => Response | Promise<Response>;
    port?: number;
    listenIp?: string;
  }): Server;
}

declare module "tjs:path" {
  interface Path {
    readonly delimiter: string;
    readonly sep: string;
    basename(path: string): string;
    dirname(path: string): string;
    join(...paths: string[]): string;
    resolve(...paths: string[]): string;
  }
  const path: Path;
  export default path;
}

declare module "tjs:hashing" {
  interface HashObj {
    update(data: string | Uint8Array): HashObj;
    /** 小文字の 16 進 */
    digest(): string;
  }
  export function createHash(type: "sha256"): HashObj;
}
