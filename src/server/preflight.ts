import type { Lang } from "../shared/i18n.ts";
import { AppError } from "./errors.ts";
import type { CommandRunner } from "./exec.ts";

export interface PreflightResult {
  ok: boolean;
  messages: string[];
}

/** ローカルの clone には依存しないので、どのディレクトリから起動してもよい */
export async function runPreflight(
  runner: CommandRunner,
  lang: Lang = "en",
): Promise<PreflightResult> {
  const messages: string[] = [];
  const say = (ja: string, en: string): string => (lang === "ja" ? ja : en);
  const run = (cmd: string[]) => runner.run(cmd);

  if ((await run(["gh", "--version"])).exitCode !== 0) {
    messages.push(
      say(
        "gh コマンドが見つかりません。GitHub CLI をインストールしてください（例: brew install gh）。",
        "The gh command was not found. Install the GitHub CLI (e.g. brew install gh).",
      ),
    );
  } else {
    if ((await run(["gh", "auth", "status"])).exitCode !== 0) {
      messages.push(
        say(
          "gh が GitHub にログインしていません。gh auth login を実行してください。",
          "gh is not signed in to GitHub. Run gh auth login.",
        ),
      );
    }
  }

  if ((await run(["claude", "--version"])).exitCode !== 0) {
    messages.push(
      say(
        "claude コマンドが見つかりません。Claude Code をインストールしてください（https://claude.com/claude-code）。",
        "The claude command was not found. Install Claude Code (https://claude.com/claude-code).",
      ),
    );
  }

  return { ok: messages.length === 0, messages };
}

/** start から順に、isFree が true を返す最初のポートを探す */
export function findAvailablePort(start: number, isFree: (port: number) => boolean): number {
  for (let port = start; port < start + 100; port += 1) {
    if (isFree(port)) return port;
  }
  throw new AppError({
    ja: `${start} から ${start + 99} までのポートがすべて使用中です。使っていないポートを空けてください。`,
    en: `All ports from ${start} to ${start + 99} are in use. Free up a port and try again.`,
  });
}
