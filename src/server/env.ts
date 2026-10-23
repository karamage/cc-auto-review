import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { CommandRunner } from "./exec.ts";

/**
 * Finder や Dock から起動したアプリは、ログインシェルの PATH を受け継がない。
 * そのままでは Homebrew の gh や ~/.local/bin の claude が見つからないので、
 * ログインシェルに PATH を聞いて補う。聞けなければよく使われる場所を足す
 */
export async function loginShellPath(runner: CommandRunner, env = process.env): Promise<string> {
  const shell = env.SHELL ?? "/bin/zsh";
  const marker = "__CC_AUTO_REVIEW_PATH__";
  const result = await runner.run([shell, "-ilc", `printf '${marker}%s${marker}' "$PATH"`], {
    timeoutMs: 5000,
  });
  const match = new RegExp(`${marker}(.*)${marker}`).exec(result.stdout);
  const home = homedir();
  const fallback = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(home, ".local", "bin"),
    join(home, ".claude", "local"),
    join(home, ".bun", "bin"),
    join(home, ".npm-global", "bin"),
  ];
  return mergePath(match?.[1] ?? "", env.PATH ?? "", fallback.join(delimiter));
}

/** 前にあるものを優先して、重複を除いて並べる */
export function mergePath(...paths: string[]): string {
  const seen = new Set<string>();
  return paths
    .flatMap((path) => path.split(delimiter))
    .filter((entry) => {
      if (entry === "" || seen.has(entry)) return false;
      seen.add(entry);
      return true;
    })
    .join(delimiter);
}

/** sh の 1 語として安全に埋め込む */
export function shellQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/**
 * claude に許す remote-read のコマンドを、空白を含まない場所にシェルスクリプトとして置く。
 * claude の Bash の許可は「このコマンドで始まる」で決まるので、アプリの置き場所
 * （/Applications/CC Auto Review.app/... のように空白を含む）を直接書くと許可も実行も崩れる
 */
export async function installRemoteRead(dir: string, command: readonly string[]): Promise<string> {
  const path = join(dir, "remote-read");
  await mkdir(dir, { recursive: true });
  await writeFile(path, `#!/bin/sh\nexec ${command.map(shellQuote).join(" ")} remote-read "$@"\n`);
  await chmod(path, 0o755);
  return path;
}
