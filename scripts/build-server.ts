/**
 * サーバを 1 つの実行ファイルにまとめ、Tauri の sidecar として置く。
 * Tauri は sidecar の名前の後ろにターゲットの triple が付いたファイルを探す。
 *
 *   bun scripts/build-server.ts                          このマシン向け
 *   bun scripts/build-server.ts universal-apple-darwin   Apple Silicon と Intel の両方を入れた 1 つのファイル
 */
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const outDir = join(root, "src-tauri", "binaries");

/** rustc が知っている、このマシンのターゲット。Tauri はこの名前で sidecar を探す */
async function hostTriple(): Promise<string> {
  // リポジトリの rust-toolchain.toml が選ぶツールチェーンに合わせる
  const proc = Bun.spawn(["rustc", "-vV"], { stdout: "pipe", cwd: root });
  const text = await new Response(proc.stdout).text();
  const triple = /^host: (.+)$/m.exec(text)?.[1];
  if (triple === undefined) throw new Error("Could not read the host triple from rustc -vV");
  return triple;
}

/**
 * x64 は baseline 版を指定する。AVX の無い CPU で、起動のたびに警告が stderr に出て、
 * claude が読む remote-read の出力に混ざるのを避けたい。
 * ただし Bun 1.3.8 の darwin では通常版と同じものが届くので、Rosetta で x64 版を動かすと警告は出る。
 * macOS 11 以降が動く Intel Mac はどれも AVX を持ち、Apple Silicon では universal の arm64 側が動くので、実際には困らない
 */
const BUN_TARGETS: Record<string, string> = {
  "aarch64-apple-darwin": "bun-darwin-arm64",
  "x86_64-apple-darwin": "bun-darwin-x64-baseline",
  "x86_64-unknown-linux-gnu": "bun-linux-x64-baseline",
  "aarch64-unknown-linux-gnu": "bun-linux-arm64",
  "x86_64-pc-windows-msvc": "bun-windows-x64-baseline",
};

/** universal は、この 2 つを lipo で 1 つにまとめたもの */
const UNIVERSAL = "universal-apple-darwin";
const UNIVERSAL_PARTS = ["aarch64-apple-darwin", "x86_64-apple-darwin"] as const;

function outfile(triple: string): string {
  const ext = triple.includes("windows") ? ".exe" : "";
  return join(outDir, `cc-auto-review-server-${triple}${ext}`);
}

async function run(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
  if ((await proc.exited) !== 0) {
    throw new Error(`Failed: ${cmd.join(" ")}`);
  }
}

async function compile(triple: string): Promise<string> {
  const target = BUN_TARGETS[triple];
  if (target === undefined) throw new Error(`Unsupported target: ${triple}`);
  const file = outfile(triple);
  await run([
    "bun",
    "build",
    "--compile",
    "--minify",
    `--target=${target}`,
    join(root, "src", "server", "index.ts"),
    "--outfile",
    file,
  ]);
  return file;
}

// 引数で指定が無ければ、tauri build --target が渡すターゲット、それも無ければこのマシン
const triple =
  process.argv[2] ??
  process.env.TAURI_ENV_TARGET_TRIPLE ??
  process.env.TAURI_TARGET_TRIPLE ??
  (await hostTriple());

await mkdir(outDir, { recursive: true });

if (triple === UNIVERSAL) {
  const parts: string[] = [];
  for (const part of UNIVERSAL_PARTS) {
    // eslint-disable-next-line no-await-in-loop -- bun build を 1 つずつ走らせる
    parts.push(await compile(part));
  }
  const file = outfile(UNIVERSAL);
  await rm(file, { force: true });
  await run(["lipo", "-create", ...parts, "-output", file]);
  console.log(`Built ${file}`);
} else {
  console.log(`Built ${await compile(triple)}`);
}
