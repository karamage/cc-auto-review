import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { DiffFile, PRRef } from "../../shared/types.ts";
import type { GitHubClient } from "../github/client.ts";

export interface SnapshotFs {
  write(path: string, content: string): Promise<void>;
  makeDir(path: string): Promise<void>;
  removeDir(path: string): Promise<void>;
  list(path: string): Promise<string[]>;
}

export class BunSnapshotFs implements SnapshotFs {
  async write(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }

  async makeDir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  async removeDir(path: string): Promise<void> {
    try {
      await rm(path, { recursive: true, force: true });
    } catch (error) {
      console.error(`Could not remove the work directory: ${path} (${error})`);
    }
  }

  async list(path: string): Promise<string[]> {
    try {
      return await readdir(path);
    } catch (error) {
      // 初回起動時はディレクトリ自体が無い（ENOENT）のは正常系として黙って空配列を返す。
      // それ以外（権限エラー等）は見えなくなると困るので警告する
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(`Could not list the work directories: ${path} (${error})`);
      }
      return [];
    }
  }
}

export interface Snapshot {
  /** 後始末で丸ごと消すディレクトリ */
  root: string;
  /** claude の cwd。変更ファイルが head 時点、規約ファイルが base 時点の内容で置かれる */
  workDir: string;
  /** PR 全体の unified diff */
  diffPath: string;
}

/** リポジトリ直下にあればレビューの規約として読ませたいファイル */
const CONVENTION_FILES = ["CLAUDE.md", "AGENTS.md", "REVIEW.md"];

/** claude が cwd から設定や指示として読み込むファイル。規約ファイルのほかに設定・hook・MCP がある */
const AGENT_CONFIG_FILES = new Set([...CONVENTION_FILES, "CLAUDE.local.md", ".mcp.json"]);

/**
 * PR が変更していても、head 時点の内容を作業ディレクトリに置いてはいけないファイルか。
 * 置くと claude がレビューの規約や設定として読み込み、PR の作成者がレビューのやり方を
 * 書き換えられてしまう（.claude/settings.json の hook ならコマンドも走る）。
 * 変更の中身は diff と remote-read で読ませる
 */
export function isAgentConfig(path: string): boolean {
  return (
    AGENT_CONFIG_FILES.has(basename(path)) ||
    path.startsWith(".claude/") ||
    path.includes("/.claude/")
  );
}

/** どのコミットの内容を置くか。変更ファイルは head、規約は PR の手が入っていない base から取る */
export interface SnapshotRefs {
  headSha: string;
  baseSha: string;
}

/** GitHub API への同時リクエスト数 */
const CONCURRENCY = 8;

/**
 * AI レビュー用の作業ディレクトリを作る。
 * リポジトリを clone せず、変更ファイルだけを GitHub API から head 時点の内容で取り寄せる。
 * 規約ファイル（CLAUDE.md / AGENTS.md / REVIEW.md）は base 時点の内容を置く。PR が規約を書き換えていても、
 * それはレビューする変更であって、レビューのやり方ではない。
 * それ以外のファイルは claude が remote-read.ts で必要な分だけ読む。
 */
export class SnapshotManager {
  private readonly active = new Set<string>();

  constructor(
    private readonly github: GitHubClient,
    private readonly baseDir: string,
    private readonly fs: SnapshotFs = new BunSnapshotFs(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  activeRoots(): string[] {
    return [...this.active];
  }

  async create(pr: PRRef, refs: SnapshotRefs, files: DiffFile[], patch: string): Promise<Snapshot> {
    const root = join(this.baseDir, `pr-${pr.repo.replace("/", "-")}-${pr.number}-${this.now()}`);
    const workDir = join(root, "repo");
    const diffPath = join(root, "pr.diff");
    this.active.add(root);

    try {
      await this.fs.write(diffPath, patch);
      // 置くファイルが 1 つも無くても cwd は要る。無い cwd で spawn すると
      // Bun は「claude が見つからない（ENOENT）」として失敗する
      await this.fs.makeDir(workDir);

      const changed = files.filter((f) => f.status !== "deleted" && !f.isBinary).map((f) => f.path);
      // 変更された規約ファイルは、置くとしても base 時点の内容にする。設定・hook・MCP は置かない
      const sources = new Map<string, string>([
        ...changed
          .filter((path) => !isAgentConfig(path))
          .map((path) => [path, refs.headSha] as const),
        ...changed
          .filter((path) => CONVENTION_FILES.includes(basename(path)))
          .map((path) => [path, refs.baseSha] as const),
        ...CONVENTION_FILES.map((path) => [path, refs.baseSha] as const),
      ]);
      const entries = [...sources];
      for (let i = 0; i < entries.length; i += CONCURRENCY) {
        // eslint-disable-next-line no-await-in-loop -- GitHub API への同時リクエスト数を抑えるため
        await Promise.all(
          entries.slice(i, i + CONCURRENCY).map(async ([path, ref]) => {
            const target = resolve(workDir, path);
            // diff 由来のパスで作業ディレクトリの外に書かせない
            if (!target.startsWith(resolve(workDir) + sep)) return;
            const content = await this.github.fetchFile(pr.repo, ref, path);
            if (content !== null) await this.fs.write(target, content);
          }),
        );
      }
    } catch (error) {
      await this.destroy(root);
      throw error;
    }

    return { root, workDir, diffPath };
  }

  /** 後始末は失敗しても呼び出し側を止めない */
  async destroy(root: string): Promise<void> {
    this.active.delete(root);
    await this.fs.removeDir(root);
  }

  async destroyAll(): Promise<void> {
    await Promise.all([...this.active].map((root) => this.destroy(root)));
  }

  /** 前回のプロセスが残した作業ディレクトリを掃除する */
  async pruneOrphans(): Promise<void> {
    const entries = (await this.fs.list(this.baseDir)).filter((e) => e.startsWith("pr-"));
    await Promise.all(entries.map((entry) => this.fs.removeDir(join(this.baseDir, entry))));
  }
}
