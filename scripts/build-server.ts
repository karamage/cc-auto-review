/**
 * デスクトップアプリに同梱するサーバを用意する。
 *
 * - サーバのコードを 1 つの JS（dist/server/server.js）にまとめる。Tauri がリソースとして同梱する
 * - それを動かす txiki.js（tjs）の実行ファイルを、Tauri の sidecar として置く。
 *   Tauri は sidecar の名前の後ろにターゲットの triple が付いたファイルを探す
 *
 * Bun の --compile で 1 つの実行ファイルにすると、Bun 本体（約 60 MB）がまるごと入る。
 * tjs は約 6 MB で済む。tjs compile は使わない。実行ファイルの末尾に JS を足す方式で、macOS の署名と両立しないため
 *
 *   bun scripts/build-server.ts                          このマシン向け
 *   bun scripts/build-server.ts universal-apple-darwin   Apple Silicon と Intel の両方を入れた 1 つのファイル
 *
 * Linux 向けのリリースは無いので、ソースからビルドする。git、cmake、C コンパイラが要る
 */
import { chmod, copyFile, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { BunPlugin } from "bun";

const root = join(import.meta.dir, "..");
const binDir = join(root, "src-tauri", "binaries");
const cacheDir = join(binDir, ".cache");
const bundleFile = join(root, "dist", "server", "server.js");

/**
 * 同梱する txiki.js。上げるときは、リリースの各 zip の sha256 も書き換える。
 * 26.6.0 の tjs.spawn は stdin のパイプが詰まる（saghul/txiki.js#1027）ので、TjsCommandRunner で一時ファイル経由にしている
 */
const TJS_VERSION = "26.6.0";
const TJS_ASSETS: Record<string, { file: string; sha256: string }> = {
  "aarch64-apple-darwin": {
    file: "txiki-macos-arm64.zip",
    sha256: "f175e921c24b26905d23ad17c2e47c37c2bf638fb0d6993cdb6e0a79dbc1b621",
  },
  "x86_64-apple-darwin": {
    file: "txiki-macos-x86_64.zip",
    sha256: "9d36d7cc20e6adb4cf132a9a2ed7ea2b449ca03a257b3a52e8fe2c6d16dd6d3b",
  },
};

/** ソースからビルドするときのコミット。タグが動かされていないことを確かめる */
const TJS_COMMIT = "1a230d31183f062fae7a6c4fd2cff466cecc1787";

/** universal は、この 2 つを lipo で 1 つにまとめたもの */
const UNIVERSAL = "universal-apple-darwin";
const UNIVERSAL_PARTS = ["aarch64-apple-darwin", "x86_64-apple-darwin"] as const;

/** node:* を、txiki.js の API で書いた互換モジュールに差し替える */
const NODE_SHIMS: Record<string, string> = {
  "node:fs/promises": "fs-promises.ts",
  "node:os": "os.ts",
  "node:path": "path.ts",
  "node:crypto": "crypto.ts",
};

const tjsShims: BunPlugin = {
  name: "tjs-shims",
  setup(build) {
    build.onResolve({ filter: /^node:/ }, (args) => {
      const shim = NODE_SHIMS[args.path];
      if (shim === undefined) {
        throw new Error(`${args.path} has no txiki.js shim (imported from ${args.importer})`);
      }
      return { path: join(root, "src", "server", "runtime", "tjs-node", shim) };
    });
    // tjs:* は tjs に組み込まれたモジュール
    build.onResolve({ filter: /^tjs:/ }, (args) => ({ path: args.path, external: true }));
  },
};

/** rustc が知っている、このマシンのターゲット。Tauri はこの名前で sidecar を探す */
async function hostTriple(): Promise<string> {
  // リポジトリの rust-toolchain.toml が選ぶツールチェーンに合わせる
  const proc = Bun.spawn(["rustc", "-vV"], { stdout: "pipe", cwd: root });
  const text = await new Response(proc.stdout).text();
  const triple = /^host: (.+)$/m.exec(text)?.[1];
  if (triple === undefined) throw new Error("Could not read the host triple from rustc -vV");
  return triple;
}

async function run(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
  if ((await proc.exited) !== 0) {
    throw new Error(`Failed: ${cmd.join(" ")}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function bundle(): Promise<void> {
  const result = await Bun.build({
    entrypoints: [join(root, "src", "server", "index.tjs.ts")],
    target: "browser",
    format: "esm",
    minify: true,
    plugins: [tjsShims],
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("Could not bundle the server");
  }
  const [output] = result.outputs;
  if (output === undefined) throw new Error("The server bundle is empty");
  await mkdir(join(root, "dist", "server"), { recursive: true });
  await Bun.write(bundleFile, output);
  console.log(`Bundled ${bundleFile} (${Math.round(output.size / 1024)} KB)`);
}

/** リリースの zip を取ってきて、sha256 を確かめてから tjs を取り出す。一度取ったものは使い回す */
async function fetchTjs(triple: string): Promise<string> {
  const asset = TJS_ASSETS[triple];
  if (asset === undefined) throw new Error(`Unsupported target: ${triple}`);
  const dir = join(cacheDir, `tjs-${TJS_VERSION}-${triple}`);
  const exe = join(dir, "tjs");
  if (await exists(exe)) return exe;

  const url = `https://github.com/saghul/txiki.js/releases/download/v${TJS_VERSION}/${asset.file}`;
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${url}: ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  const digest = new Bun.CryptoHasher("sha256").update(data).digest("hex");
  if (digest !== asset.sha256) {
    throw new Error(`Checksum mismatch for ${asset.file}: expected ${asset.sha256}, got ${digest}`);
  }

  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const zip = join(dir, asset.file);
  await Bun.write(zip, data);
  // zip の中は txiki-macos-<arch>/tjs
  await run(["unzip", "-q", "-j", zip, "*/tjs", "-d", dir]);
  await rm(zip);
  await chmod(exe, 0o755);
  return exe;
}

/** 固定したコミットの txiki.js をビルドする。一度作ったものは使い回す */
async function buildTjs(triple: string): Promise<string> {
  const dir = join(cacheDir, `tjs-${TJS_VERSION}-${triple}`);
  const exe = join(dir, "tjs");
  if (await exists(exe)) return exe;

  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const src = join(dir, "src");
  await run([
    "git",
    "clone",
    "--quiet",
    "--depth=1",
    `--branch=v${TJS_VERSION}`,
    "--recurse-submodules",
    "--shallow-submodules",
    "https://github.com/saghul/txiki.js.git",
    src,
  ]);
  const proc = Bun.spawn(["git", "-C", src, "rev-parse", "HEAD"], { stdout: "pipe" });
  const commit = (await new Response(proc.stdout).text()).trim();
  if (commit !== TJS_COMMIT) {
    throw new Error(`Commit mismatch for txiki.js: expected ${TJS_COMMIT}, got ${commit}`);
  }

  // サーバは tjs:ffi を使わない。切っておくと libffi が実行時に要らなくなる
  const build = join(src, "build");
  await run([
    "cmake",
    "-S",
    src,
    "-B",
    build,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DBUILD_WITH_FFI=OFF",
    "-DBUILD_WITH_STRIP=ON",
  ]);
  // 数を指定しないと make が無制限に並列で動き、メモリが足りなくなる
  await run(["cmake", "--build", build, "--parallel", String(navigator.hardwareConcurrency)]);
  await copyFile(join(build, "tjs"), exe);
  await chmod(exe, 0o755);
  await rm(src, { recursive: true, force: true });
  return exe;
}

function sidecar(triple: string): string {
  return join(binDir, `cc-auto-review-server-${triple}`);
}

// 引数で指定が無ければ、tauri build --target が渡すターゲット、それも無ければこのマシン
const triple =
  process.argv[2] ??
  process.env.TAURI_ENV_TARGET_TRIPLE ??
  process.env.TAURI_TARGET_TRIPLE ??
  (await hostTriple());

await bundle();
await mkdir(binDir, { recursive: true });

const file = sidecar(triple);
await rm(file, { force: true });
if (triple === UNIVERSAL) {
  const parts: string[] = [];
  for (const part of UNIVERSAL_PARTS) {
    // eslint-disable-next-line no-await-in-loop -- 1 つずつ取ってくる
    parts.push(await fetchTjs(part));
  }
  await run(["lipo", "-create", ...parts, "-output", file]);
} else if (triple.includes("-linux-")) {
  await copyFile(await buildTjs(triple), file);
} else {
  await copyFile(await fetchTjs(triple), file);
}
console.log(
  `Placed ${file} (txiki.js ${TJS_VERSION}, ${((await stat(file)).size / 2 ** 20).toFixed(1)} MB)`,
);
