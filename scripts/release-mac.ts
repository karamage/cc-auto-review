/**
 * 配布用の macOS アプリを作る。Developer ID で署名し、Apple の公証を通して、DMG にまとめる。
 *
 *   bun run release:mac              Apple Silicon 版と Intel 版の DMG を 1 つずつ
 *   bun run release:mac arm64        Apple Silicon 版だけ
 *   bun run release:mac x64          Intel 版だけ
 *   bun run release:mac universal    両方で動く 1 つの DMG
 *
 * 前もって要るもの（どちらも一度だけ）:
 * - キーチェーンに「Developer ID Application」の証明書（Xcode > Settings > Accounts > Manage Certificates で作れる）
 * - 公証の認証情報を、キーチェーンのプロファイルとして保存しておく
 *     xcrun notarytool store-credentials cc-auto-review --apple-id <Apple ID> --team-id <Team ID>
 *
 * 環境変数:
 * - APPLE_SIGNING_IDENTITY  署名に使う証明書の名前。無ければキーチェーンの最初の Developer ID Application を使う
 * - NOTARY_PROFILE          公証の認証情報のプロファイル名。既定は cc-auto-review
 *
 * 公証は 2 回出す。先にアプリを公証してチケットを貼り（DMG から取り出したあとでもオフラインで開けるように）、
 * そのアプリを入れた DMG をもう一度公証する
 */
import { mkdir, readFile, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const APP_NAME = "CC Auto Review";

/** コマンドラインでの呼び名 → Rust のターゲット。DMG の名前にも呼び名を使う */
const ARCHES: Record<string, string> = {
  arm64: "aarch64-apple-darwin",
  x64: "x86_64-apple-darwin",
  universal: "universal-apple-darwin",
};
const DEFAULT_ARCHES = ["arm64", "x64"];

function appPathFor(target: string): string {
  return join(root, "src-tauri", "target", target, "release", "bundle", "macos", `${APP_NAME}.app`);
}

const outDir = join(root, "release");
const workDir = join(outDir, ".work");

async function run(
  cmd: string[],
  options: { env?: Record<string, string | undefined>; quiet?: boolean } = {},
): Promise<string> {
  if (options.quiet !== true) console.log(`$ ${cmd.join(" ")}`);
  const proc = Bun.spawn(cmd, {
    cwd: root,
    env: { ...process.env, ...options.env },
    stdout: "pipe",
    stderr: "inherit",
  });
  const stdout = await new Response(proc.stdout).text();
  if (options.quiet !== true && stdout.trim() !== "") console.log(stdout.trimEnd());
  if ((await proc.exited) !== 0) throw new Error(`Failed: ${cmd[0]} ${cmd[1] ?? ""}`);
  return stdout;
}

/** 署名に使う証明書。指定が無ければキーチェーンから Developer ID Application を探す */
async function signingIdentity(): Promise<string> {
  const given = process.env.APPLE_SIGNING_IDENTITY;
  if (given !== undefined && given !== "") return given;
  const list = await run(["security", "find-identity", "-v", "-p", "codesigning"], { quiet: true });
  const found = /"(Developer ID Application: [^"]+)"/.exec(list)?.[1];
  if (found === undefined) {
    throw new Error(
      'No "Developer ID Application" certificate in the keychain. Create one in Xcode > Settings > Accounts > Manage Certificates, or set APPLE_SIGNING_IDENTITY.',
    );
  }
  return found;
}

/** 公証に出して、通るまで待つ。通らなければ Apple のログを出して止める */
async function notarize(file: string, profile: string): Promise<void> {
  const output = await run([
    "xcrun",
    "notarytool",
    "submit",
    file,
    "--keychain-profile",
    profile,
    "--wait",
    "--output-format",
    "json",
  ]);
  const result = JSON.parse(output) as { id?: string; status?: string };
  if (result.status !== "Accepted") {
    if (result.id !== undefined) {
      await run(["xcrun", "notarytool", "log", result.id, "--keychain-profile", profile]);
    }
    throw new Error(`Notarization was not accepted: ${result.status ?? "unknown"}`);
  }
}

/** 1 つのアーキテクチャ分を、ビルド・署名・公証して DMG にする。できた DMG のパスを返す */
async function release(
  arch: string,
  options: { identity: string; profile: string; version: string },
): Promise<string> {
  const { identity, profile, version } = options;
  const target = ARCHES[arch] as string;
  const appPath = appPathFor(target);
  console.log(`\n=== ${arch} (${target}) ===\n`);

  // 1. ビルドと署名。公証はこのスクリプトが行うので、Tauri には認証情報を渡さない
  await run(["bun", "scripts/build-server.ts", target]);
  await run(["bunx", "tauri", "build", "--target", target, "--bundles", "app"], {
    env: {
      APPLE_SIGNING_IDENTITY: identity,
      APPLE_ID: undefined,
      APPLE_PASSWORD: undefined,
      APPLE_TEAM_ID: undefined,
      APPLE_API_KEY: undefined,
      APPLE_API_ISSUER: undefined,
      APPLE_API_KEY_PATH: undefined,
      // 実行ファイルにビルドした人のホームディレクトリのパス（ユーザー名）を残さない
      RUSTFLAGS: [process.env.RUSTFLAGS, `--remap-path-prefix=${homedir()}=~`]
        .filter(Boolean)
        .join(" "),
    },
  });
  await run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", appPath]);

  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  // 2. アプリを公証してチケットを貼る
  const appZip = join(workDir, `${APP_NAME}.zip`);
  await run(["ditto", "-c", "-k", "--keepParent", appPath, appZip]);
  await notarize(appZip, profile);
  await run(["xcrun", "stapler", "staple", appPath]);

  // 3. DMG を作る。Finder の自動操作を使わず、アプリと /Applications へのリンクを並べるだけにする
  const staging = join(workDir, "dmg");
  await mkdir(staging, { recursive: true });
  await run(["ditto", appPath, join(staging, `${APP_NAME}.app`)]);
  await symlink("/Applications", join(staging, "Applications"));
  const dmg = join(outDir, `CC-Auto-Review_${version}_${arch}.dmg`);
  await rm(dmg, { force: true });
  await run([
    "hdiutil",
    "create",
    "-volname",
    APP_NAME,
    "-srcfolder",
    staging,
    "-ov",
    "-format",
    "UDZO",
    dmg,
  ]);
  await run(["codesign", "--sign", identity, "--timestamp", dmg]);

  // 4. DMG を公証してチケットを貼る
  await notarize(dmg, profile);
  await run(["xcrun", "stapler", "staple", dmg]);

  // 5. Gatekeeper が通すかを確かめる
  await run(["spctl", "--assess", "--type", "execute", "--verbose=2", appPath]);
  await run([
    "spctl",
    "--assess",
    "--type",
    "open",
    "--context",
    "context:primary-signature",
    "--verbose=2",
    dmg,
  ]);

  await rm(workDir, { recursive: true, force: true });
  return dmg;
}

async function main(): Promise<void> {
  const arches = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_ARCHES;
  for (const arch of arches) {
    if (ARCHES[arch] === undefined) {
      throw new Error(`Unknown architecture: ${arch} (use ${Object.keys(ARCHES).join(", ")})`);
    }
  }

  const identity = await signingIdentity();
  const profile = process.env.NOTARY_PROFILE ?? "cc-auto-review";
  const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    version: string;
  };
  console.log(
    `Signing identity: ${identity}\nNotary profile:   ${profile}\nVersion:          ${version}\nArchitectures:    ${arches.join(", ")}\n`,
  );

  // 認証情報が無ければ、時間のかかるビルドの前に止める
  await run(["xcrun", "notarytool", "history", "--keychain-profile", profile], {
    quiet: true,
  }).catch(() => {
    throw new Error(
      `The notary profile "${profile}" is not usable. Save it with:\n  xcrun notarytool store-credentials ${profile} --apple-id <Apple ID> --team-id <Team ID>`,
    );
  });

  // 画面は CPU に依らないので 1 回だけビルドする
  await run(["bun", "run", "build:client"]);
  const dmgs: string[] = [];
  for (const arch of arches) {
    // eslint-disable-next-line no-await-in-loop -- 公証は 1 つずつ出して、通ったのを確かめてから次へ進む
    dmgs.push(await release(arch, { identity, profile, version }));
  }
  console.log(`\nDone:\n${dmgs.map((dmg) => `  ${dmg}`).join("\n")}`);
}

try {
  await main();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
