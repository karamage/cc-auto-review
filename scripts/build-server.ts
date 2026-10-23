/**
 * サーバを 1 つの実行ファイルにまとめ、Tauri の sidecar として置く。
 * Tauri は sidecar の名前の後ろにターゲットの triple が付いたファイルを探す
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

/** rustc が知っている、このマシンのターゲット。Tauri はこの名前で sidecar を探す */
async function hostTriple(): Promise<string> {
  // src-tauri の rust-toolchain.toml が選ぶツールチェーンに合わせる
  const proc = Bun.spawn(["rustc", "-vV"], { stdout: "pipe", cwd: join(root, "src-tauri") });
  const text = await new Response(proc.stdout).text();
  const triple = /^host: (.+)$/m.exec(text)?.[1];
  if (triple === undefined) throw new Error("Could not read the host triple from rustc -vV");
  return triple;
}

/**
 * x64 は baseline 版にする。Apple Silicon の Rosetta などの AVX の無い CPU で、
 * 起動のたびに警告が stderr に出て、claude が読む remote-read の出力に混ざるため
 */
const BUN_TARGETS: Record<string, string> = {
  "aarch64-apple-darwin": "bun-darwin-arm64",
  "x86_64-apple-darwin": "bun-darwin-x64-baseline",
  "x86_64-unknown-linux-gnu": "bun-linux-x64-baseline",
  "aarch64-unknown-linux-gnu": "bun-linux-arm64",
  "x86_64-pc-windows-msvc": "bun-windows-x64-baseline",
};

// tauri build --target を付けたときは、Tauri が渡すターゲットに合わせる
const triple =
  process.env.TAURI_ENV_TARGET_TRIPLE ?? process.env.TAURI_TARGET_TRIPLE ?? (await hostTriple());
const target = BUN_TARGETS[triple];
if (target === undefined) throw new Error(`Unsupported target: ${triple}`);

const outDir = join(root, "src-tauri", "binaries");
await mkdir(outDir, { recursive: true });
const ext = triple.includes("windows") ? ".exe" : "";
const outfile = join(outDir, `cc-auto-review-server-${triple}${ext}`);

const proc = Bun.spawn(
  [
    "bun",
    "build",
    "--compile",
    "--minify",
    `--target=${target}`,
    join(root, "src", "server", "index.ts"),
    "--outfile",
    outfile,
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if ((await proc.exited) !== 0) process.exit(1);
console.log(`Built ${outfile}`);
