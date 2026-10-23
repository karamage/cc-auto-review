import { expect, test } from "bun:test";
import { FakeCommandRunner, ok } from "../exec.ts";
import {
  GREP_FILE_LIMIT,
  ISSUE_BODY_LIMIT,
  isSafePath,
  parseIssueRef,
  remoteRead,
} from "./remote-read.ts";

const TARGET = { repo: "o/r", headSha: "head1", baseSha: "base1" };
const RAW = "gh api -H Accept: application/vnd.github.raw";

test("cat は head 時点、cat-base は base 時点のファイルを読む", async () => {
  const runner = new FakeCommandRunner({
    [`${RAW} repos/o/r/contents/src/a.ts?ref=head1`]: ok("new"),
    [`${RAW} repos/o/r/contents/src/a.ts?ref=base1`]: ok("old"),
  });
  expect((await remoteRead(runner, TARGET, ["cat", "src/a.ts"])).stdout).toBe("new");
  expect((await remoteRead(runner, TARGET, ["cat-base", "./src/a.ts"])).stdout).toBe("old");
});

test("存在しないファイルは分かるメッセージで終了コード 1 にする", async () => {
  const runner = new FakeCommandRunner({
    [`${RAW} repos/o/r/contents/nope.ts?ref=head1`]: {
      stderr: "gh: Not Found (HTTP 404)",
      exitCode: 1,
    },
  });
  const out = await remoteRead(runner, TARGET, ["cat", "nope.ts"]);
  expect(out.exitCode).toBe(1);
  expect(out.stderr).toBe("Not found: nope.ts\n");
});

test("ls は末尾のスラッシュを落としてディレクトリを一覧する", async () => {
  const runner = new FakeCommandRunner({
    'gh api repos/o/r/contents/src?ref=head1 --jq if type == "array" then .[] | (if .type == "dir" then .path + "/" else .path end) else .path end':
      ok("src/a.ts\nsrc/lib/\n"),
  });
  expect((await remoteRead(runner, TARGET, ["ls", "src/"])).stdout).toBe("src/a.ts\nsrc/lib/\n");
});

test("find は head 時点の全パスからキーワードを含むものだけを返す", async () => {
  const runner = new FakeCommandRunner({
    'gh api repos/o/r/git/trees/head1?recursive=1 --jq .tree[] | select(.type == "blob") | .path':
      ok("src/user.ts\nsrc/order.ts\ntest/user.test.ts\n"),
  });
  const out = await remoteRead(runner, TARGET, ["find", "user"]);
  expect(out.stdout).toBe("src/user.ts\ntest/user.test.ts\n");
  expect(out.exitCode).toBe(0);
});

test("リポジトリの外を指すパスは gh を呼ばずに拒否する", async () => {
  const runner = new FakeCommandRunner({});
  for (const path of ["../other/repo", "/etc/passwd", "src/../../x"]) {
    // eslint-disable-next-line no-await-in-loop -- 各ケースを順に確かめるだけ
    const out = await remoteRead(runner, TARGET, ["cat", path]);
    expect(out.exitCode).toBe(2);
  }
  expect(runner.calls).toEqual([]);
});

test("未知のサブコマンドは使い方を出す", async () => {
  const out = await remoteRead(new FakeCommandRunner({}), TARGET, ["rm", "a.ts"]);
  expect(out.exitCode).toBe(2);
  expect(out.stderr).toContain("Usage");
});

test("isSafePath", () => {
  expect(isSafePath("src/a.ts")).toBe(true);
  expect(isSafePath("..")).toBe(false);
  expect(isSafePath("a/./b")).toBe(false);
});

const ISSUE_JQ =
  '"\\(.title)\\nType: \\(if .pull_request then "PR" else "Issue" end) / State: \\(.state)\\n\\(.html_url)\\n\\n\\(.body // "")"';

test("parseIssueRef は番号・owner/repo#番号・GitHub の URL を読み、それ以外は拒否する", () => {
  expect(parseIssueRef("12", "o/r")).toEqual({ repo: "o/r", number: 12 });
  expect(parseIssueRef("#12", "o/r")).toEqual({ repo: "o/r", number: 12 });
  expect(parseIssueRef("a/b-c#3", "o/r")).toEqual({ repo: "a/b-c", number: 3 });
  expect(parseIssueRef("https://github.com/a/b/pull/7/files", "o/r")).toEqual({
    repo: "a/b",
    number: 7,
  });
  expect(parseIssueRef("https://github.com/a/../issues/1", "o/r")).toBeNull();
  expect(parseIssueRef("https://example.com/a/b/issues/1", "o/r")).toBeNull();
  expect(parseIssueRef("../../user", "o/r")).toBeNull();
});

test("issue は Issue / PR のタイトル・状態・本文を読む", async () => {
  const runner = new FakeCommandRunner({
    [`gh api repos/a/b/issues/7 --jq ${ISSUE_JQ}`]: ok(
      "Design\nType: Issue / State: open\nurl\n\nbody",
    ),
  });
  const out = await remoteRead(runner, TARGET, ["issue", "https://github.com/a/b/issues/7"]);
  expect(out.exitCode).toBe(0);
  expect(out.stdout).toBe("a/b#7 Design\nType: Issue / State: open\nurl\n\nbody");
});

test("issue の長い本文は上限で切り、見つからなければ終了コード 1 にする", async () => {
  const runner = new FakeCommandRunner({
    [`gh api repos/o/r/issues/1 --jq ${ISSUE_JQ}`]: ok("あ".repeat(ISSUE_BODY_LIMIT + 10)),
    [`gh api repos/o/r/issues/2 --jq ${ISSUE_JQ}`]: { stderr: "HTTP 404", exitCode: 1 },
  });
  const long = await remoteRead(runner, TARGET, ["issue", "1"]);
  expect(long.stdout).toContain(`truncated to the first ${ISSUE_BODY_LIMIT} characters`);
  const missing = await remoteRead(runner, TARGET, ["issue", "2"]);
  expect(missing.exitCode).toBe(1);
  expect(missing.stderr).toContain("Not found");
});

test("issue に読めない指定を渡すと gh を呼ばずに使い方を出す", async () => {
  const runner = new FakeCommandRunner({});
  const out = await remoteRead(runner, TARGET, ["issue", "repos/o/r/hooks"]);
  expect(out.exitCode).toBe(2);
  expect(runner.calls).toEqual([]);
});

const TREE =
  'gh api repos/o/r/git/trees/head1?recursive=1 --jq .tree[] | select(.type == "blob") | .path';

test("grep はパスのキーワードで絞ったファイルの中身を、正規表現で探して行番号付きで返す", async () => {
  const runner = new FakeCommandRunner({
    [TREE]: ok("src/user.ts\nsrc/order.ts\nsrc/logo.png\ndocs/user.md\n"),
    [`${RAW} repos/o/r/contents/src/user.ts?ref=head1`]: ok("const a = 1;\nfindUser(id);\n"),
    [`${RAW} repos/o/r/contents/src/order.ts?ref=head1`]: ok("findUser(order.userId);\n"),
  });
  const out = await remoteRead(runner, TARGET, ["grep", "findUser\\(", "src/"]);
  expect(out.stdout).toBe("src/user.ts:2:findUser(id);\nsrc/order.ts:1:findUser(order.userId);\n");
  expect(out.exitCode).toBe(0);
  // 画像は読まない
  expect(runner.calls.some((c) => c.join(" ").includes("logo.png"))).toBe(false);
});

test("grep は読むファイルが多すぎれば、絞り直しを頼んで中身を読まない", async () => {
  const paths = Array.from({ length: GREP_FILE_LIMIT + 1 }, (_, i) => `src/f${i}.ts`).join("\n");
  const runner = new FakeCommandRunner({ [TREE]: ok(paths) });
  const out = await remoteRead(runner, TARGET, ["grep", "x"]);
  expect(out.exitCode).toBe(2);
  expect(out.stderr).toContain("Narrow it");
  expect(runner.calls).toHaveLength(1);
});

test("grep に読めない正規表現を渡すと、gh を呼ばずに断る", async () => {
  const runner = new FakeCommandRunner({});
  const out = await remoteRead(runner, TARGET, ["grep", "("]);
  expect(out.exitCode).toBe(2);
  expect(runner.calls).toHaveLength(0);
});
