import type { CommandRunner } from "./exec.ts";

/** OS の機能。テストでは偽物に差し替える */
export interface SystemActions {
  openUrl(url: string): Promise<void>;
  notify(title: string, body: string): Promise<void>;
}

/** AppleScript の文字列リテラルに埋め込む。引用符とバックスラッシュだけを逃がす */
export function appleScriptString(text: string): string {
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export class OsSystemActions implements SystemActions {
  constructor(
    private readonly runner: CommandRunner,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  async openUrl(url: string): Promise<void> {
    const cmd =
      this.platform === "darwin"
        ? ["open", url]
        : this.platform === "win32"
          ? ["cmd", "/c", "start", "", url]
          : ["xdg-open", url];
    await this.runner.run(cmd);
  }

  /** 通知を出せなくても、一覧には印が残る。失敗は無視する */
  async notify(title: string, body: string): Promise<void> {
    if (this.platform === "darwin") {
      await this.runner.run([
        "osascript",
        "-e",
        `display notification ${appleScriptString(body)} with title ${appleScriptString(title)}`,
      ]);
    } else if (this.platform === "linux") {
      await this.runner.run(["notify-send", "--app-name=CC Auto Review", "--", title, body]);
    }
  }
}
