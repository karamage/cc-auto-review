import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { BunCommandRunner } from "../exec.ts";
import { BunFileReader } from "../reviewer/runner.ts";
import type { Runtime, StaticFiles } from "./types.ts";

export const bunStaticFiles: StaticFiles = {
  async read(path) {
    const file = Bun.file(path);
    return (await file.exists()) ? new Uint8Array(await file.arrayBuffer()) : null;
  },
  async isDirectory(path) {
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  },
};

export function bunRuntime(): Runtime {
  return {
    runner: new BunCommandRunner(),
    files: new BunFileReader(),
    staticFiles: bunStaticFiles,
    async isPortFree(port) {
      try {
        const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("") });
        await server.stop(true);
        return true;
      } catch {
        return false;
      }
    },
    serve(port, fetch) {
      // AI レビューは数分かかることがある。Bun の HTTP idle timeout（デフォルト 10 秒）で
      // SSE 接続が切られないよう、指定可能な最大値まで延ばす（併せて review ルート側で heartbeat も送る）
      const server = Bun.serve({ hostname: "127.0.0.1", port, fetch, idleTimeout: 255 });
      return { port: server.port ?? port, stop: () => server.stop(true) };
    },
    // bun src/server/index.ts で動いている。同じスクリプトをもう一度 bun に渡す
    selfCommand: () => [process.execPath, resolve(process.argv[1] ?? "")],
    write: (stream, text) =>
      new Promise((done) => {
        process[stream].write(text, () => done());
      }),
  };
}
