import { expect, test } from "bun:test";
import { FakeCommandRunner, ok } from "../exec.ts";
import { FindingParseError } from "./parse.ts";
import {
  ReviewCommandError,
  ReviewRunner,
  ReviewTimeoutError,
  allowedTools,
  type FileReader,
} from "./runner.ts";

const CLAUDE_CMD = [
  "claude",
  "-p",
  "プロンプト本文",
  "--output-format",
  "stream-json",
  "--verbose",
  "--allowedTools",
  "Read,Grep,Glob,Write,Bash(remote-read:*)",
].join(" ");

const TARGET = { workDir: "/wt", repo: "o/r", headSha: "abc123", baseSha: "base999" };

/** remote-read のコマンドを固定して、argv を比較しやすくする */
function reviewRunner(runner: FakeCommandRunner, files: FileReader): ReviewRunner {
  return new ReviewRunner(runner, files, "remote-read");
}

class FakeFileReader implements FileReader {
  removed: string[] = [];
  private index = 0;
  constructor(private readonly contents: (string | Error)[]) {}
  async read(_path: string): Promise<string> {
    const value = this.contents[this.index++];
    if (value === undefined) throw new Error("FakeFileReader: 読み取り回数が想定を超えました");
    if (value instanceof Error) throw value;
    return value;
  }
  async remove(path: string): Promise<void> {
    this.removed.push(path);
  }
}

const VALID = JSON.stringify({
  findings: [{ path: "src/a.ts", line: 3, severity: "blocker", title: "題", body: "本文" }],
});

test("claude を作業ディレクトリ内で実行し、出力ファイルから Finding を読む", async () => {
  const runner = new FakeCommandRunner({ [CLAUDE_CMD]: ok('{"result":"done"}') });
  const files = new FakeFileReader([VALID]);
  const { findings } = await reviewRunner(runner, files).review(
    TARGET,
    "プロンプト本文",
    "/tmp/o.json",
  );

  expect(findings).toHaveLength(1);
  expect(findings[0]!.path).toBe("src/a.ts");
  expect(runner.calls[0]!.join(" ")).toBe(CLAUDE_CMD);
  // cwd を落とすと起動したディレクトリを読んでしまう。argv だけ見ても気付けない
  expect(runner.cwds).toEqual(["/wt"]);
  // remote-read が読む先は環境変数で固定する
  expect(runner.envs).toEqual([
    {
      CC_AUTO_REVIEW_REPO: "o/r",
      CC_AUTO_REVIEW_HEAD_SHA: "abc123",
      CC_AUTO_REVIEW_BASE_SHA: "base999",
    },
  ]);
});

test("git や任意の gh は許可せず、remote-read だけを Bash で許可する", () => {
  const tools = allowedTools("bun /app/remote-read.ts");
  expect(tools).toBe("Read,Grep,Glob,Write,Bash(bun /app/remote-read.ts:*)");
  expect(tools).not.toContain("git");
  expect(tools).not.toContain("Bash(gh");
});

test("プロファイルで許したツールだけを追加で許可する", () => {
  expect(allowedTools("remote-read", ["Skill", "mcp__docs"])).toBe(
    "Read,Grep,Glob,Write,Bash(remote-read:*),Skill,mcp__docs",
  );
});

test("指定したツールを claude の --allowedTools に渡す", async () => {
  const cmd = `${CLAUDE_CMD},mcp__docs`;
  const runner = new FakeCommandRunner({ [cmd]: ok("") });
  const files = new FakeFileReader([VALID]);
  await reviewRunner(runner, files).review(TARGET, "プロンプト本文", "/tmp/o.json", {
    tools: ["mcp__docs"],
  });
  expect(runner.calls[0]!.join(" ")).toBe(cmd);
});

test("モデルを指定したら claude に --model を付けて渡す", async () => {
  const cmd = `${CLAUDE_CMD} --model haiku`;
  const runner = new FakeCommandRunner({ [cmd]: ok("") });
  const files = new FakeFileReader([VALID]);
  await reviewRunner(runner, files).review(TARGET, "プロンプト本文", "/tmp/o.json", {
    model: "haiku",
  });
  expect(runner.calls[0]!.join(" ")).toBe(cmd);
});

test("処理後に出力ファイルを削除する", async () => {
  const runner = new FakeCommandRunner({ [CLAUDE_CMD]: ok("") });
  const files = new FakeFileReader([VALID]);
  await reviewRunner(runner, files).review(TARGET, "プロンプト本文", "/tmp/o.json");
  expect(files.removed).toEqual(["/tmp/o.json"]);
});

test("パースに失敗したら 1 回だけ再実行する", async () => {
  const runner = new FakeCommandRunner({ [CLAUDE_CMD]: ok("") });
  const files = new FakeFileReader(["壊れた出力", VALID]);
  const { findings } = await reviewRunner(runner, files).review(
    TARGET,
    "プロンプト本文",
    "/tmp/o.json",
  );

  expect(findings).toHaveLength(1);
  expect(runner.calls).toHaveLength(2);
});

test("再実行しても壊れていれば FindingParseError を投げる", async () => {
  const runner = new FakeCommandRunner({ [CLAUDE_CMD]: ok("") });
  const files = new FakeFileReader(["壊れた出力", "やはり壊れた出力"]);
  await expect(
    reviewRunner(runner, files).review(TARGET, "プロンプト本文", "/tmp/o.json"),
  ).rejects.toThrow(FindingParseError);
  expect(runner.calls).toHaveLength(2);
});

test("出力ファイルが存在しない場合もパース失敗として扱う", async () => {
  const runner = new FakeCommandRunner({ [CLAUDE_CMD]: ok("stdout の中身") });
  const files = new FakeFileReader([new Error("ENOENT"), new Error("ENOENT")]);
  await expect(
    reviewRunner(runner, files).review(TARGET, "プロンプト本文", "/tmp/o.json"),
  ).rejects.toThrow("レビュー結果のファイルが作成されませんでした");
});

test("タイムアウトしたら ReviewTimeoutError を投げ、再実行しない", async () => {
  const runner = new FakeCommandRunner({
    [CLAUDE_CMD]: { stdout: "", stderr: "", exitCode: 143, timedOut: true },
  });
  const files = new FakeFileReader([]);
  await expect(
    reviewRunner(runner, files).review(TARGET, "プロンプト本文", "/tmp/o.json"),
  ).rejects.toThrow(ReviewTimeoutError);
  expect(runner.calls).toHaveLength(1);
});

test("claude が異常終了したら再実行せず、原因を伝えるエラーを投げる", async () => {
  const runner = new FakeCommandRunner({
    [CLAUDE_CMD]: { stdout: "", stderr: "Invalid API key", exitCode: 1 },
  });
  const files = new FakeFileReader([]);
  await expect(
    reviewRunner(runner, files).review(TARGET, "プロンプト本文", "/tmp/o.json"),
  ).rejects.toThrow(ReviewCommandError);
  // 再実行しても同じ結果になるので 1 回で止める
  expect(runner.calls).toHaveLength(1);
});

test("claude が異常終了したときのエラーに stderr を含める", async () => {
  const runner = new FakeCommandRunner({
    [CLAUDE_CMD]: { stdout: "", stderr: "Invalid API key", exitCode: 1 },
  });
  const files = new FakeFileReader([]);
  const error = (await reviewRunner(runner, files)
    .review(TARGET, "プロンプト本文", "/tmp/o.json")
    .catch((e: unknown) => e as ReviewCommandError)) as ReviewCommandError;
  expect(error.message).toBe("AI レビューの実行に失敗しました（終了コード 1）");
  expect(error.detail).toContain("Invalid API key");
});

test("失敗した回も、出力から Claude Code の使用量を記録する", async () => {
  const stdout = JSON.stringify({
    type: "rate_limit_event",
    rate_limit_info: { status: "rejected", resetsAt: 1793491200, rateLimitType: "five_hour" },
  });
  const runner = new FakeCommandRunner({ [CLAUDE_CMD]: { stdout, exitCode: 1 } });
  const reviewer = reviewRunner(runner, new FakeFileReader([]));
  await expect(reviewer.review(TARGET, "プロンプト本文", "/tmp/o.json")).rejects.toThrow(
    ReviewCommandError,
  );
  expect(reviewer.usage.latest()?.limit?.status).toBe("rejected");
});
