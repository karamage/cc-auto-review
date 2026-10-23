import { isLang, type Lang } from "../shared/i18n.ts";

/** 端末に出す文言の言語を選ぶ環境変数。--lang が優先する */
export const ENV_LANG = "CC_AUTO_REVIEW_LANG";

const USAGE: Record<Lang, string> = {
  ja: `使い方: cc-auto-review-server [--port <番号>] [--desktop] [--client-dir <dir>] [--lang ja|en]

  --port <番号>       待ち受けるポート（既定は 4711。使用中なら空いているポートを探す。0 なら OS に任せる）
  --desktop           デスクトップアプリから起動する。ブラウザを開かず、準備ができたら URL を出す
  --client-dir <dir>  ビルド済みの画面のディレクトリ（既定は dist/client）
  --lang ja|en        端末に出す文言の言語（既定は英語。環境変数 ${ENV_LANG} でも指定できる）
  -h, --help          この説明を出す`,
  en: `Usage: cc-auto-review-server [--port <number>] [--desktop] [--client-dir <dir>] [--lang ja|en]

  --port <number>     Port to listen on (default 4711; the next free port is used if busy; 0 lets the OS pick)
  --desktop           Started by the desktop app: do not open a browser, print the URL when ready
  --client-dir <dir>  Directory of the built UI (default dist/client)
  --lang ja|en        Language of terminal messages (default English; ${ENV_LANG} also works)
  -h, --help          Show this help`,
};

export function usage(lang: Lang): string {
  return USAGE[lang];
}

export interface RunOptions {
  kind: "run";
  port: number | null;
  desktop: boolean;
  clientDir: string | null;
  lang: Lang | null;
}

export type CliOptions =
  | RunOptions
  | { kind: "help"; lang: Lang | null }
  | { kind: "error"; message: string };

/** --opt value と --opt=value の両方を受け付ける。どちらでもなければ null */
function optionValue(
  args: readonly string[],
  index: number,
  name: string,
): { value: string | undefined; next: number } | null {
  const arg = args[index];
  if (arg === name) return { value: args[index + 1], next: index + 1 };
  if (arg?.startsWith(`${name}=`)) return { value: arg.slice(name.length + 1), next: index };
  return null;
}

/** lang はエラーの文言に使う。--lang が先に来ていれば、そちらで書く */
export function parseCliArgs(args: readonly string[], lang: Lang = "en"): CliOptions {
  const options: RunOptions = {
    kind: "run",
    port: null,
    desktop: false,
    clientDir: null,
    lang: null,
  };
  const say = (ja: string, en: string): string => ((options.lang ?? lang) === "ja" ? ja : en);
  const none = (): string => say("(なし)", "(none)");

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") return { kind: "help", lang: options.lang };
    if (arg === "--desktop") {
      options.desktop = true;
      continue;
    }

    const langOption = optionValue(args, i, "--lang");
    if (langOption !== null) {
      i = langOption.next;
      if (!isLang(langOption.value)) {
        const value = langOption.value ?? none();
        return {
          kind: "error",
          message: say(
            `--lang には ja か en を指定してください: ${value}`,
            `--lang must be ja or en: ${value}`,
          ),
        };
      }
      options.lang = langOption.value;
      continue;
    }

    const portOption = optionValue(args, i, "--port");
    if (portOption !== null) {
      i = portOption.next;
      const port = Number(portOption.value);
      if (!/^\d+$/.test(portOption.value ?? "") || port > 65535) {
        const value = portOption.value ?? none();
        return {
          kind: "error",
          message: say(
            `--port には 0 から 65535 の数を指定してください: ${value}`,
            `--port must be a number from 0 to 65535: ${value}`,
          ),
        };
      }
      options.port = port;
      continue;
    }

    const dirOption = optionValue(args, i, "--client-dir");
    if (dirOption !== null) {
      i = dirOption.next;
      if (dirOption.value === undefined || dirOption.value === "") {
        return {
          kind: "error",
          message: say(
            "--client-dir にディレクトリを指定してください",
            "--client-dir needs a directory",
          ),
        };
      }
      options.clientDir = dirOption.value;
      continue;
    }

    return {
      kind: "error",
      message: say(`知らないオプションです: ${arg}`, `Unknown option: ${arg}`),
    };
  }

  return options;
}
