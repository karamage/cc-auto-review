import { join } from "./tjs-node/path.ts";
import type { CommandResult, CommandRunner, RunOptions } from "../exec.ts";
import type { FileReader } from "../reviewer/runner.ts";
import type { Runtime } from "./types.ts";

const decoder = new TextDecoder();

export class TjsCommandRunner implements CommandRunner {
  async run(cmd: string[], opts: RunOptions = {}): Promise<CommandResult> {
    // txiki.js 26.6 の tjs.spawn は、stdin のパイプに書くと書き終わらずに止まる（saghul/txiki.js#1027）。
    // 一時ファイルに書いて、sh のリダイレクトで渡す
    const stdinDir =
      opts.stdin === undefined
        ? undefined
        : await tjs.makeTempDir(join(tjs.tmpDir, "cc-auto-review-stdin-XXXXXX"));
    const argv =
      stdinDir === undefined
        ? cmd
        : ["/bin/sh", "-c", 'exec "$@" < "$0"', join(stdinDir, "stdin"), ...cmd];
    if (stdinDir !== undefined) await tjs.writeFile(join(stdinDir, "stdin"), opts.stdin ?? "");

    try {
      let proc: tjs.Process;
      try {
        proc = tjs.spawn(argv, {
          cwd: opts.cwd,
          // 起動後に PATH を補うことがあるので、毎回いまの環境変数を渡す
          env: { ...(process.env as Record<string, string>), ...opts.env },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });
      } catch (error) {
        // 実行ファイルが $PATH に無いと tjs.spawn は throw する。
        // 呼び出し側が終了コードだけを見られるよう 127 に正規化する
        return {
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
          exitCode: 127,
          timedOut: false,
        };
      }

      let timedOut = false;
      const timer =
        opts.timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              timedOut = true;
              proc.kill();
            }, opts.timeoutMs);

      try {
        const [stdout, stderr] = await Promise.all([
          proc.stdout?.text() ?? "",
          proc.stderr?.text() ?? "",
        ]);
        const status = await proc.wait();
        // シグナルで止められたときの exit_status は 0 なので、失敗として 1 を返す
        const exitCode = status.term_signal === null ? status.exit_status : 1;
        return { stdout, stderr, exitCode, timedOut };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    } finally {
      if (stdinDir !== undefined) await tjs.remove(stdinDir);
    }
  }
}

export class TjsFileReader implements FileReader {
  async read(path: string): Promise<string> {
    return decoder.decode(await tjs.readFile(path));
  }
  async remove(path: string): Promise<void> {
    await tjs.remove(path);
  }
}

export function tjsRuntime(): Runtime {
  return {
    runner: new TjsCommandRunner(),
    files: new TjsFileReader(),
    staticFiles: {
      async read(path) {
        try {
          return await tjs.readFile(path);
        } catch {
          return null;
        }
      },
      async isDirectory(path) {
        try {
          return (await tjs.stat(path)).isDirectory;
        } catch {
          return false;
        }
      },
    },
    // tjs.serve は使用中のポートでも失敗しない（SO_REUSEPORT で重ねて待ち受ける）ので、
    // 先に繋いでみて、繋がったら使用中とみなす
    async isPortFree(port) {
      try {
        (await tjs.connect("tcp", "127.0.0.1", port)).close();
        return false;
      } catch {
        return true;
      }
    },
    serve(port, fetch) {
      // tjs は 2 つ目の引数に接続の情報を渡す。Hono が環境変数と取り違えないよう、request だけを渡す
      const server = tjs.serve({ port, listenIp: "127.0.0.1", fetch: (request) => fetch(request) });
      return { port: server.port, stop: () => server.close() };
    },
    // tjs run <server.js> で動いている。同じスクリプトをもう一度 tjs に渡す
    selfCommand: () => [tjs.exePath, "run", process.argv[1] ?? ""],
    write: (stream, text) => process[stream].write(text) as unknown as Promise<void>,
  };
}
