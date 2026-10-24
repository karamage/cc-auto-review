/**
 * txiki.js には Node の process が無い。サーバが使う分だけを tjs の API で用意する。
 * ほかのモジュールより先に評価されるよう、tjs 向けの入口（index.tjs.ts）で最初に import する
 */
import { resolve } from "./tjs-node/path.ts";

const encoder = new TextEncoder();

/** 書き終わるまで待てる標準出力・標準エラー。直後に exit しても出力が欠けない */
function writer(stream: WritableStream<Uint8Array>) {
  return {
    async write(text: string): Promise<void> {
      const w = stream.getWriter();
      try {
        await w.write(encoder.encode(text));
      } finally {
        w.releaseLock();
      }
    },
  };
}

// tjs は `tjs run <script> <args...>` で起動するので、Node と同じ [実行ファイル, スクリプト, 引数...] に並べ直す
const [, , script = "", ...rest] = tjs.args;

const tjsProcess = {
  argv: [tjs.exePath, resolve(script), ...rest],
  env: tjs.env,
  execPath: tjs.exePath,
  pid: tjs.pid,
  // tjs で動かすのは macOS 向けのアプリだけ
  platform: "darwin",
  exit: (code = 0): never => tjs.exit(code),
  on(signal: tjs.Signal, listener: () => void) {
    tjs.addSignalListener(signal, listener);
  },
  stdout: writer(tjs.stdout),
  stderr: writer(tjs.stderr),
};

globalThis.process = tjsProcess as unknown as NodeJS.Process;
