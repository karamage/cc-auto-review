import { unlink } from "node:fs/promises";
import type { ReviewModel, ReviewResult } from "../../shared/types.ts";
import type { LocalizedText } from "../../shared/i18n.ts";
import { AppError } from "../errors.ts";
import type { CommandRunner } from "../exec.ts";
import { type ChatResult, FindingParseError, parseChatResult, parseReviewResult } from "./parse.ts";
import { ENV_BASE, ENV_HEAD, ENV_REPO, type ReadTarget } from "./remote-read.ts";
import { UsageRecorder } from "./usage.ts";

export class ReviewTimeoutError extends AppError {
  constructor(message: string | LocalizedText) {
    super(message);
    this.name = "ReviewTimeoutError";
  }
}

/** claude 自体が異常終了した場合。再実行しても直らないので retry しない */
export class ReviewCommandError extends AppError {
  constructor(message: string | LocalizedText, detail?: string) {
    super(message, detail);
    this.name = "ReviewCommandError";
  }
}

export interface FileReader {
  read(path: string): Promise<string>;
  remove(path: string): Promise<void>;
}

export class BunFileReader implements FileReader {
  async read(path: string): Promise<string> {
    return await Bun.file(path).text();
  }
  async remove(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch {
      // 既に無い場合は何もしない
    }
  }
}

/**
 * PR に紛れた指示で手元のファイルを読み書きさせないための引数。
 * dontAsk で利用者の defaultMode（auto など）を引き継がず、許可リストに無い操作を拒否する。
 * settings の 2 つのキーは、許可の有無によらず作業ディレクトリの外を拒否する
 */
export const CLAUDE_LOCKDOWN_ARGS: readonly string[] = [
  "--permission-mode",
  "dontAsk",
  "--settings",
  JSON.stringify({
    permissions: {
      blockReadsOutsideWorkingDirectories: true,
      blockWritesOutsideWorkingDirectories: true,
    },
  }),
];

/**
 * 1 つのファイルにだけ書かせる許可ルール。Write にも Edit のルールが効く。
 * path はプロンプトで渡す文字列のまま使う。実パスに直すと、macOS の $TMPDIR のように
 * シンボリックリンクを通るパスでは一致せず、出力ファイルにも書けなくなる
 */
export function writeOnlyRule(path: string): string {
  return `Edit(/${path})`;
}

/**
 * 作業ディレクトリに無いファイルは remote-read だけで読ませる。git も任意の gh も許可しない。
 * 書けるのは出力ファイルだけにする。Skill や MCP、WebFetch などは、
 * プロファイルで利用者が明示したものだけを足す
 */
export function allowedTools(
  remoteReadCommand: string,
  outputPath: string,
  extraTools: readonly string[] = [],
): string {
  return [
    `Read,Grep,Glob,${writeOnlyRule(outputPath)},Bash(${remoteReadCommand}:*)`,
    ...extraTools,
  ].join(",");
}

/** 1 回の AI レビューの実行条件 */
export interface ReviewRunOptions {
  /** null なら --model を付けず、claude の設定に任せる */
  model?: ReviewModel | null;
  /** 追加で許すツール */
  tools?: readonly string[];
  timeoutMs?: number;
}

export interface ReviewTarget extends ReadTarget {
  /** claude の cwd */
  workDir: string;
  /** workDir の親。diff と出力ファイルを置く場所で、claude が読めるのはこの中だけ */
  root: string;
}

export class ReviewRunner {
  constructor(
    private readonly runner: CommandRunner,
    private readonly files: FileReader,
    private readonly remoteReadCommand: string,
    /** 画面に出す Claude Code の使用量。実行のたびに出力から読んで更新する */
    readonly usage: UsageRecorder = new UsageRecorder(),
  ) {}

  async review(
    target: ReviewTarget,
    prompt: string,
    outputPath: string,
    options: ReviewRunOptions = {},
  ): Promise<ReviewResult> {
    return await this.runWithRetry(target, prompt, outputPath, options, parseReviewResult);
  }

  /** チャットの 1 回の質問。実行の条件と再実行の扱いはレビューと同じ */
  async ask(
    target: ReviewTarget,
    prompt: string,
    outputPath: string,
    options: ReviewRunOptions = {},
  ): Promise<ChatResult> {
    return await this.runWithRetry(target, prompt, outputPath, options, parseChatResult);
  }

  private async runWithRetry<T>(
    target: ReviewTarget,
    prompt: string,
    outputPath: string,
    options: ReviewRunOptions,
    parse: (raw: string) => T,
  ): Promise<T> {
    try {
      return await this.attempt(target, prompt, outputPath, options, parse);
    } catch (error) {
      // 再実行して直る見込みがあるのは「出力の形が崩れた」ときだけ
      if (!(error instanceof FindingParseError)) throw error;
      return await this.attempt(target, prompt, outputPath, options, parse);
    } finally {
      await this.files.remove(outputPath);
    }
  }

  private async attempt<T>(
    target: ReviewTarget,
    prompt: string,
    outputPath: string,
    { model = null, tools = [], timeoutMs = 600_000 }: ReviewRunOptions,
    parse: (raw: string) => T,
  ): Promise<T> {
    const result = await this.runner.run(
      [
        "claude",
        "-p",
        prompt,
        // 結果の JSON には利用枠の状態が載らない。イベントの流れで受け取る（-p では --verbose が要る）
        "--output-format",
        "stream-json",
        "--verbose",
        ...CLAUDE_LOCKDOWN_ARGS,
        "--add-dir",
        target.root,
        "--allowedTools",
        allowedTools(this.remoteReadCommand, outputPath, tools),
        ...(model === null ? [] : ["--model", model]),
      ],
      {
        cwd: target.workDir,
        timeoutMs,
        // remote-read が読む先。claude にはコマンドの引数しか触らせない
        env: {
          [ENV_REPO]: target.repo,
          [ENV_HEAD]: target.headSha,
          [ENV_BASE]: target.baseSha,
        },
      },
    );
    // 失敗した回も枠は消費している。上限に達して失敗したなら、その状態こそ見せたい
    this.usage.record(result.stdout);

    if (result.timedOut) {
      throw new ReviewTimeoutError({
        ja: `AI レビューが ${Math.round(timeoutMs / 1000)} 秒で終わらなかったため中断しました`,
        en: `The AI review was stopped because it did not finish within ${Math.round(timeoutMs / 1000)} seconds`,
      });
    }

    if (result.exitCode !== 0) {
      // 再実行しても同じ結果になる。パース失敗として retry させない
      throw new ReviewCommandError(
        {
          ja: `AI レビューの実行に失敗しました（終了コード ${result.exitCode}）`,
          en: `The AI review failed (exit code ${result.exitCode})`,
        },
        [result.stderr, result.stdout].join("\n").trim().slice(0, 2000),
      );
    }

    let raw: string;
    try {
      raw = await this.files.read(outputPath);
    } catch {
      throw new FindingParseError(
        {
          ja: "レビュー結果のファイルが作成されませんでした",
          en: "The review did not write its result file",
        },
        [result.stdout, result.stderr].join("\n").slice(0, 2000),
      );
    }

    return parse(raw);
  }
}
