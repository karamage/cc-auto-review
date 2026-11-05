import type { Lang } from "../shared/i18n.ts";
import { AppError } from "./errors.ts";
import type { CommandRunner } from "./exec.ts";

export interface PreflightResult {
  ok: boolean;
  messages: string[];
}

/** 作業ディレクトリの外を拒否する設定（CLAUDE_LOCKDOWN_ARGS）が使える最初の版 */
const MIN_CLAUDE_VERSION = [2, 1, 314] as const;

/** 読めない版は、制限が効くと確かめられないので false にする */
function supportsLockdown(versionOutput: string): boolean {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(versionOutput);
  if (match === null) return false;
  for (const [i, min] of MIN_CLAUDE_VERSION.entries()) {
    const part = Number(match[i + 1]);
    if (part !== min) return part > min;
  }
  return true;
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

  const claude = await run(["claude", "--version"]);
  if (claude.exitCode !== 0) {
    messages.push(
      say(
        "claude コマンドが見つかりません。Claude Code をインストールしてください（https://claude.com/claude-code）。",
        "The claude command was not found. Install Claude Code (https://claude.com/claude-code).",
      ),
    );
  } else if (!supportsLockdown(claude.stdout)) {
    messages.push(
      say(
        `Claude Code ${MIN_CLAUDE_VERSION.join(".")} 以降が必要です（今の版: ${claude.stdout.trim()}）。古い版ではファイルへのアクセスを制限できません。claude update を実行してください。`,
        `Claude Code ${MIN_CLAUDE_VERSION.join(".")} or later is required (found: ${claude.stdout.trim()}). Older versions cannot restrict file access. Run claude update.`,
      ),
    );
  }

  return { ok: messages.length === 0, messages };
}

/** start から順に、isFree が true を返す最初のポートを探す */
export async function findAvailablePort(
  start: number,
  isFree: (port: number) => Promise<boolean>,
): Promise<number> {
  for (let port = start; port < start + 100; port += 1) {
    // eslint-disable-next-line no-await-in-loop -- 前から順に 1 つずつ確かめる
    if (await isFree(port)) return port;
  }
  throw new AppError({
    ja: `${start} から ${start + 99} までのポートがすべて使用中です。使っていないポートを空けてください。`,
    en: `All ports from ${start} to ${start + 99} are in use. Free up a port and try again.`,
  });
}
