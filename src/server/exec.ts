export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  stdin?: string;
  /** 追加する環境変数。親プロセスの環境変数に上書きで足す */
  env?: Record<string, string>;
}

export interface CommandRunner {
  run(cmd: string[], opts?: RunOptions): Promise<CommandResult>;
}

/** テストで期待値を書きやすくするためのヘルパ */
export function ok(stdout: string): CommandResult {
  return { stdout, stderr: "", exitCode: 0, timedOut: false };
}

export class BunCommandRunner implements CommandRunner {
  async run(cmd: string[], opts: RunOptions = {}): Promise<CommandResult> {
    let proc: Bun.Subprocess<any, "pipe", "pipe">;
    try {
      proc = Bun.spawn(cmd, {
        cwd: opts.cwd,
        // 起動後に PATH を補うことがあるので、毎回いまの環境変数を渡す
        env: { ...process.env, ...opts.env },
        stdin: opts.stdin === undefined ? "ignore" : new TextEncoder().encode(opts.stdin),
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (error) {
      // 実行ファイルが $PATH に無いと Bun.spawn は throw する。
      // 呼び出し側が終了コードだけを見られるよう 127 に正規化する
      return {
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 127,
        timedOut: false,
      };
    }

    let timedOut = false;
    const timer =
      opts.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            proc.kill();
          }, opts.timeoutMs);

    try {
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;
      return { stdout, stderr, exitCode, timedOut };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

/** テスト用。コマンド行をスペース結合したものをキーに応答を引く */
export class FakeCommandRunner implements CommandRunner {
  readonly calls: string[][] = [];
  readonly stdins: (string | undefined)[] = [];
  /** どのディレクトリで実行されたか。作業ディレクトリ内で claude を走らせる等の検証に使う */
  readonly cwds: (string | undefined)[] = [];
  readonly envs: (Record<string, string> | undefined)[] = [];

  constructor(private readonly responses: Record<string, Partial<CommandResult>>) {}

  async run(cmd: string[], opts: RunOptions = {}): Promise<CommandResult> {
    this.calls.push(cmd);
    this.stdins.push(opts.stdin);
    this.cwds.push(opts.cwd);
    this.envs.push(opts.env);
    const key = cmd.join(" ");
    const response = this.responses[key];
    if (response === undefined) {
      throw new Error(`FakeCommandRunner: unregistered command: ${key}`);
    }
    return {
      stdout: response.stdout ?? "",
      stderr: response.stderr ?? "",
      exitCode: response.exitCode ?? 0,
      timedOut: response.timedOut ?? false,
    };
  }
}
