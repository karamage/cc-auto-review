/**
 * AI レビュー中の claude に渡す、リポジトリの読み取り専用ビュー。
 * ローカルに clone が無いので、作業ディレクトリに置いていないファイルはこれで GitHub から読む。
 *
 * どのリポジトリ・コミットを読むかは環境変数で固定し、claude には変えさせない。
 * gh api は GET しか発行しない（--method や -f を渡す経路を作らない）。
 *
 *   remote-read cat <path>                head 時点のファイル本文
 *   remote-read cat-base <path>           base ブランチ時点のファイル本文
 *   remote-read ls [dir]                  head 時点のディレクトリ一覧
 *   remote-read find <keyword>            head 時点の全ファイルパスから keyword を含むものを列挙
 *   remote-read grep <pattern> [keyword]  head 時点のファイル本文を検索（パスに keyword を含むものに絞れる）
 *   remote-read issue <番号|URL>          GitHub の Issue / PR のタイトル・状態・本文（PR の説明にある関連資料を読むため）
 */
import { encodeContentPath } from "../github/client.ts";
import type { CommandRunner } from "../exec.ts";
import type { Runtime } from "../runtime/types.ts";

export const ENV_REPO = "CC_AUTO_REVIEW_REPO";
export const ENV_HEAD = "CC_AUTO_REVIEW_HEAD_SHA";
export const ENV_BASE = "CC_AUTO_REVIEW_BASE_SHA";

const USAGE = `Usage:
  cat <path>                 Print a file at the PR head
  cat-base <path>            Print a file at the base branch
  ls [dir]                   List a directory at the head (repository root if omitted)
  find <keyword>             List files at the head whose path contains keyword
  grep <pattern> [keyword]   Search file contents at the head with a regular expression.
                             Narrow the files to read with a path keyword
  issue <number|URL>         Print the title, state and body of a GitHub issue or PR
                             (a bare number refers to this repository; owner/repo#123 and github.com URLs also work)`;

/** find で出す件数の上限。巨大なリポジトリで出力が溢れないようにする */
const FIND_LIMIT = 200;

/** grep で中身を読むファイルの数の上限。1 ファイルごとに API を叩くので、パスで絞らせる */
export const GREP_FILE_LIMIT = 150;

/** grep で出す一致行の上限 */
const GREP_MATCH_LIMIT = 200;

/** 中身を読んでも意味の無いファイル。画像やフォント、ロックファイルなど */
const BINARY_LIKE =
  /\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tgz|jar|woff2?|ttf|otf|eot|mp[34]|mov|lockb?|min\.js|map)$/i;

/** issue で出す本文の上限。長い議事録のような Issue でプロンプトの文脈を食い潰さないように */
export const ISSUE_BODY_LIMIT = 20_000;

const NAME = "[A-Za-z0-9_.-]+";
const ISSUE_URL = new RegExp(
  `^https://github\\.com/(${NAME})/(${NAME})/(?:issues|pull)/(\\d+)(?:[/?#].*)?$`,
);
const ISSUE_REF = new RegExp(`^(${NAME})/(${NAME})#(\\d+)$`);

/**
 * "123" / "owner/repo#123" / "https://github.com/owner/repo/issues/123" を、読む Issue に直す。
 * 読めない形なら null。owner と repo は gh api のパスに入るので、名前に使える文字だけを通す
 */
export function parseIssueRef(
  arg: string,
  defaultRepo: string,
): { repo: string; number: number } | null {
  const plain = /^#?(\d+)$/.exec(arg);
  if (plain !== null) return { repo: defaultRepo, number: Number(plain[1]) };
  const match = ISSUE_URL.exec(arg) ?? ISSUE_REF.exec(arg);
  if (match === null) return null;
  const [, owner, repo, number] = match as unknown as [string, string, string, string];
  if ([owner, repo].some((name) => name === "." || name === "..")) return null;
  return { repo: `${owner}/${repo}`, number: Number(number) };
}

export interface ReadTarget {
  repo: string;
  headSha: string;
  baseSha: string;
}

export interface Output {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** リポジトリ外を指すパスで別の API を叩かせないよう、.. と絶対パスを拒否する */
export function isSafePath(path: string): boolean {
  if (path.startsWith("/")) return false;
  return path.split("/").every((segment) => segment !== ".." && segment !== ".");
}

function fail(message: string, exitCode = 2): Output {
  return { stdout: "", stderr: `${message}\n`, exitCode };
}

async function readIssue(runner: CommandRunner, target: ReadTarget, arg: string): Promise<Output> {
  if (arg === "") return fail(`Specify an issue number or URL\n\n${USAGE}`);
  const ref = parseIssueRef(arg, target.repo);
  if (ref === null) return fail(`Cannot read this issue reference: ${arg}\n\n${USAGE}`);

  // issues API は PR も返す。pull_request があれば PR
  const result = await runner.run([
    "gh",
    "api",
    `repos/${ref.repo}/issues/${ref.number}`,
    "--jq",
    '"\\(.title)\\nType: \\(if .pull_request then "PR" else "Issue" end) / State: \\(.state)\\n\\(.html_url)\\n\\n\\(.body // "")"',
  ]);
  if (result.exitCode !== 0) {
    return result.stderr.includes("HTTP 404")
      ? fail(`Not found (or not readable with your gh account): ${arg}`, 1)
      : { stdout: "", stderr: result.stderr, exitCode: result.exitCode };
  }
  const text = result.stdout;
  const truncated =
    text.length > ISSUE_BODY_LIMIT
      ? `${text.slice(0, ISSUE_BODY_LIMIT)}\n… (truncated to the first ${ISSUE_BODY_LIMIT} characters)\n`
      : text;
  return { stdout: `${ref.repo}#${ref.number} ${truncated}`, stderr: "", exitCode: 0 };
}

/** head 時点の全ファイルのパス。1 行に 1 つ */
async function listTree(runner: CommandRunner, target: ReadTarget): Promise<Output> {
  const result = await runner.run([
    "gh",
    "api",
    `repos/${target.repo}/git/trees/${target.headSha}?recursive=1`,
    "--jq",
    '.tree[] | select(.type == "blob") | .path',
  ]);
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

/**
 * clone が無いので、ファイルを 1 つずつ取り寄せて正規表現で探す。
 * 読む数を抑えるため、パスのキーワードで絞らせ、上限を超えたら絞り直しを頼む
 */
async function grep(
  runner: CommandRunner,
  target: ReadTarget,
  rawPattern: string,
  keyword: string,
): Promise<Output> {
  if (rawPattern === "") return fail(`Specify a pattern\n\n${USAGE}`);
  let pattern: RegExp;
  try {
    pattern = new RegExp(rawPattern);
  } catch {
    return fail(`Invalid regular expression: ${rawPattern}`);
  }
  const tree = await listTree(runner, target);
  if (tree.exitCode !== 0) return tree;
  const paths = tree.stdout
    .split("\n")
    .filter((p) => p !== "" && p.includes(keyword) && !BINARY_LIKE.test(p));
  if (paths.length > GREP_FILE_LIMIT) {
    return fail(
      `${paths.length} files match the path keyword "${keyword}". Narrow it so that at most ${GREP_FILE_LIMIT} files match (e.g. a directory such as src/api/)`,
    );
  }

  const matches: string[] = [];
  for (let i = 0; i < paths.length && matches.length < GREP_MATCH_LIMIT; i += 8) {
    // eslint-disable-next-line no-await-in-loop -- GitHub API への同時リクエスト数を抑えるため
    const contents = await Promise.all(
      paths.slice(i, i + 8).map(async (path) => {
        const result = await runner.run([
          "gh",
          "api",
          "-H",
          "Accept: application/vnd.github.raw",
          `repos/${target.repo}/contents/${encodeContentPath(path)}?ref=${target.headSha}`,
        ]);
        return { path, text: result.exitCode === 0 ? result.stdout : "" };
      }),
    );
    for (const { path, text } of contents) {
      text.split("\n").forEach((line, index) => {
        if (pattern.test(line)) matches.push(`${path}:${index + 1}:${line.slice(0, 300)}`);
      });
    }
  }
  if (matches.length === 0) return { stdout: "", stderr: `No match: ${rawPattern}\n`, exitCode: 1 };
  const shown = matches.slice(0, GREP_MATCH_LIMIT);
  const more =
    matches.length > GREP_MATCH_LIMIT ? `… more matches omitted. Use a narrower pattern\n` : "";
  return { stdout: `${shown.join("\n")}\n${more}`, stderr: "", exitCode: 0 };
}

export async function remoteRead(
  runner: CommandRunner,
  target: ReadTarget,
  args: string[],
): Promise<Output> {
  const [command, rawArg = ""] = args;
  // issue の引数はパスではなく URL や番号なので、パスの検査より先に分ける
  if (command === "issue") return await readIssue(runner, target, rawArg.trim());
  // grep の第 1 引数はパスではなく正規表現
  if (command === "grep") return await grep(runner, target, rawArg, args[2] ?? "");
  const arg = rawArg.replace(/^\.\//, "").replace(/\/+$/, "");
  if (arg !== "" && !isSafePath(arg)) return fail(`Invalid path: ${rawArg}`);

  const gh = async (cmd: string[]): Promise<Output> => {
    const result = await runner.run(["gh", "api", ...cmd]);
    if (result.exitCode !== 0 && result.stderr.includes("HTTP 404")) {
      return fail(`Not found: ${arg}`, 1);
    }
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  };

  switch (command) {
    case "cat":
    case "cat-base": {
      if (arg === "") return fail(`Specify a path\n\n${USAGE}`);
      const ref = command === "cat" ? target.headSha : target.baseSha;
      return await gh([
        "-H",
        "Accept: application/vnd.github.raw",
        `repos/${target.repo}/contents/${encodeContentPath(arg)}?ref=${ref}`,
      ]);
    }
    case "ls": {
      return await gh([
        `repos/${target.repo}/contents/${encodeContentPath(arg)}?ref=${target.headSha}`,
        "--jq",
        // ファイルを指定すると配列ではなくオブジェクトが返る
        'if type == "array" then .[] | (if .type == "dir" then .path + "/" else .path end) else .path end',
      ]);
    }
    case "find": {
      if (arg === "") return fail(`Specify a keyword\n\n${USAGE}`);
      const result = await listTree(runner, target);
      if (result.exitCode !== 0) return result;
      const matched = result.stdout.split("\n").filter((p) => p !== "" && p.includes(arg));
      const shown = matched.slice(0, FIND_LIMIT);
      const more =
        matched.length > FIND_LIMIT
          ? `\n… and ${matched.length - FIND_LIMIT} more. Use a narrower keyword\n`
          : "";
      return {
        stdout: shown.length === 0 ? "" : `${shown.join("\n")}\n${more}`,
        stderr: shown.length === 0 ? `No match: ${arg}\n` : "",
        exitCode: shown.length === 0 ? 1 : 0,
      };
    }
    default:
      return fail(USAGE);
  }
}

/** 環境変数で決めた PR を読む。claude から呼ばれるサブコマンドの入口 */
export async function runRemoteRead(runtime: Runtime, args: string[]): Promise<never> {
  const repo = process.env[ENV_REPO];
  const headSha = process.env[ENV_HEAD];
  const baseSha = process.env[ENV_BASE];
  if (repo === undefined || headSha === undefined || baseSha === undefined) {
    console.error(`${ENV_REPO} / ${ENV_HEAD} / ${ENV_BASE} are not set`);
    process.exit(2);
  }
  const output = await remoteRead(runtime.runner, { repo, headSha, baseSha }, args);
  await runtime.write("stdout", output.stdout);
  await runtime.write("stderr", output.stderr);
  process.exit(output.exitCode);
}
