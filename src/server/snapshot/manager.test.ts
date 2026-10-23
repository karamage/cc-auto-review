import { expect, test } from "bun:test";
import type { DiffFile } from "../../shared/types.ts";
import { FakeCommandRunner, ok } from "../exec.ts";
import { GitHubClient } from "../github/client.ts";
import { isAgentConfig, SnapshotManager, type SnapshotFs } from "./manager.ts";

class MemoryFs implements SnapshotFs {
  written = new Map<string, string>();
  removed: string[] = [];
  made: string[] = [];
  constructor(private readonly entries: string[] = []) {}
  async write(path: string, content: string): Promise<void> {
    this.written.set(path, content);
  }
  async makeDir(path: string): Promise<void> {
    this.made.push(path);
  }
  async removeDir(path: string): Promise<void> {
    this.removed.push(path);
  }
  async list(): Promise<string[]> {
    return this.entries;
  }
}

const RAW = "gh api -H Accept: application/vnd.github.raw";
const NOT_FOUND = { stderr: "gh: Not Found (HTTP 404)", exitCode: 1 };
const PR = { repo: "o/r", number: 12 };
const ROOT = "/base/pr-o-r-12-1000";
const REFS = { headSha: "abc123", baseSha: "base000" };

function file(path: string, overrides: Partial<DiffFile> = {}): DiffFile {
  return { path, oldPath: null, status: "modified", hunks: [], isBinary: false, ...overrides };
}

function manager(
  responses: Record<string, Partial<import("../exec.ts").CommandResult>>,
  fs = new MemoryFs(),
) {
  const runner = new FakeCommandRunner({
    [`${RAW} repos/o/r/contents/CLAUDE.md?ref=base000`]: NOT_FOUND,
    [`${RAW} repos/o/r/contents/AGENTS.md?ref=base000`]: NOT_FOUND,
    [`${RAW} repos/o/r/contents/REVIEW.md?ref=base000`]: NOT_FOUND,
    ...responses,
  });
  return {
    snapshots: new SnapshotManager(new GitHubClient(runner), "/base", fs, () => 1000),
    runner,
    fs,
  };
}

test("削除・バイナリ以外の変更ファイルを head、規約を base 時点の内容で置き、diff も書き出す", async () => {
  const { snapshots, runner, fs } = manager({
    [`${RAW} repos/o/r/contents/src/a.ts?ref=abc123`]: ok("A"),
    [`${RAW} repos/o/r/contents/AGENTS.md?ref=base000`]: ok("規約"),
    [`${RAW} repos/o/r/contents/REVIEW.md?ref=base000`]: NOT_FOUND,
  });

  const snapshot = await snapshots.create(
    PR,
    REFS,
    [
      file("src/a.ts"),
      file("gone.ts", { status: "deleted" }),
      file("logo.png", { isBinary: true }),
    ],
    "PATCH",
  );

  expect(snapshot).toEqual({
    root: ROOT,
    workDir: `${ROOT}/repo`,
    diffPath: `${ROOT}/pr.diff`,
  });
  expect(Object.fromEntries(fs.written)).toEqual({
    [`${ROOT}/pr.diff`]: "PATCH",
    [`${ROOT}/repo/src/a.ts`]: "A",
    [`${ROOT}/repo/AGENTS.md`]: "規約",
  });
  // 削除済み・バイナリのファイルは取りに行かない
  const fetched = runner.calls.map((c) => c.join(" "));
  expect(fetched.some((c) => c.includes("gone.ts") || c.includes("logo.png"))).toBe(false);
  expect(snapshots.activeRoots()).toEqual([ROOT]);
});

test("作業ディレクトリの外を指すパスは書き込まない", async () => {
  const { snapshots, fs } = manager({});
  await snapshots.create(PR, REFS, [file("../escape.ts")], "PATCH");
  expect([...fs.written.keys()]).toEqual([`${ROOT}/pr.diff`]);
});

test("取得に失敗したら作業ディレクトリを消してから投げる", async () => {
  const { snapshots, fs } = manager({
    [`${RAW} repos/o/r/contents/src/a.ts?ref=abc123`]: { stderr: "HTTP 500", exitCode: 1 },
  });
  await expect(snapshots.create(PR, REFS, [file("src/a.ts")], "PATCH")).rejects.toThrow(
    "o/r の src/a.ts を取得できませんでした",
  );
  expect(fs.removed).toEqual([ROOT]);
  expect(snapshots.activeRoots()).toEqual([]);
});

test("destroyAll は作ったものをすべて消す", async () => {
  const { snapshots, fs } = manager({});
  await snapshots.create(PR, REFS, [], "PATCH");
  await snapshots.destroyAll();
  expect(fs.removed).toEqual([ROOT]);
  expect(snapshots.activeRoots()).toEqual([]);
});

test("pruneOrphans は前回の作業ディレクトリ（pr- で始まるもの）だけを消す", async () => {
  const fs = new MemoryFs(["pr-o-r-1-1", "other", "pr-x-y-2-2"]);
  const { snapshots } = manager({}, fs);
  await snapshots.pruneOrphans();
  expect(fs.removed.sort()).toEqual(["/base/pr-o-r-1-1", "/base/pr-x-y-2-2"]);
});

test("PR が変更した規約ファイルは head ではなく base 時点の内容を置く", async () => {
  // head の CLAUDE.md を置くと、PR の作成者がレビューの規約を書き換えられてしまう
  const { snapshots, runner, fs } = manager({
    [`${RAW} repos/o/r/contents/CLAUDE.md?ref=base000`]: ok("元の規約"),
    [`${RAW} repos/o/r/contents/pkg/AGENTS.md?ref=base000`]: NOT_FOUND,
  });

  await snapshots.create(
    PR,
    REFS,
    [file("CLAUDE.md"), file("pkg/AGENTS.md", { status: "added" })],
    "PATCH",
  );

  expect(Object.fromEntries(fs.written)).toEqual({
    [`${ROOT}/pr.diff`]: "PATCH",
    [`${ROOT}/repo/CLAUDE.md`]: "元の規約",
  });
  expect(runner.calls.some((c) => c.join(" ").includes("ref=abc123"))).toBe(false);
});

test("PR が変更した .claude/ の設定や .mcp.json は作業ディレクトリに置かない", async () => {
  // claude が cwd の設定として読み込み、hook や MCP が動いてしまう
  const { snapshots, runner, fs } = manager({
    [`${RAW} repos/o/r/contents/src/a.ts?ref=abc123`]: ok("A"),
  });

  await snapshots.create(
    PR,
    REFS,
    [
      file("src/a.ts"),
      file(".claude/settings.json"),
      file("pkg/.claude/skills/x/SKILL.md"),
      file(".mcp.json"),
      file("CLAUDE.local.md"),
    ],
    "PATCH",
  );

  expect([...fs.written.keys()].sort()).toEqual([`${ROOT}/pr.diff`, `${ROOT}/repo/src/a.ts`]);
  const fetched = runner.calls.map((c) => c.join(" "));
  expect(fetched.some((c) => c.includes(".claude") || c.includes(".mcp.json"))).toBe(false);
});

test("isAgentConfig は規約・設定ファイルだけを拾う", () => {
  expect(isAgentConfig("CLAUDE.md")).toBe(true);
  expect(isAgentConfig("pkg/AGENTS.md")).toBe(true);
  expect(isAgentConfig(".claude/settings.json")).toBe(true);
  expect(isAgentConfig("apps/web/.claude/commands/x.md")).toBe(true);
  expect(isAgentConfig(".mcp.json")).toBe(true);
  expect(isAgentConfig("docs/claude.md.bak")).toBe(false);
  expect(isAgentConfig("src/claude/client.ts")).toBe(false);
});

test("置くファイルが 1 つも無くても、claude の cwd になる作業ディレクトリは作る", async () => {
  const { snapshots, fs } = manager({});

  const snapshot = await snapshots.create(
    PR,
    REFS,
    [file("gone.ts", { status: "deleted" }), file(".claude/settings.json")],
    "PATCH",
  );

  expect(fs.made).toEqual([snapshot.workDir]);
  expect([...fs.written.keys()]).toEqual([`${ROOT}/pr.diff`]);
});
