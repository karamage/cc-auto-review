import type {
  Approval,
  ExistingComment,
  MyReviewState,
  PostedReview,
  PRRef,
  PRState,
  PRSummary,
  ReviewedPR,
  SubmitRequest,
} from "../../shared/types.ts";
import type { CommandResult, CommandRunner } from "../exec.ts";
import type { LocalizedText } from "../../shared/i18n.ts";
import { ExternalCommandError } from "../errors.ts";
import { buildReviewPayload } from "./payload.ts";

const PR_FIELDS = [
  "number",
  "title",
  "author",
  "headRefName",
  "baseRefName",
  "additions",
  "deletions",
  "changedFiles",
  "updatedAt",
  "url",
].join(",");

/**
 * https://github.com/pulls/review-requested と同じ条件。
 * gh pr list はカレントディレクトリのリポジトリしか見ないので、
 * 全リポジトリを横断できる GraphQL の search を使う
 */
export const REVIEW_REQUESTED_SEARCH = "is:pr is:open review-requested:@me archived:false";

export const REVIEW_REQUESTED_QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 100) {
    nodes {
      ... on PullRequest {
        number title url updatedAt additions deletions changedFiles headRefName baseRefName headRefOid
        author { login }
        repository { nameWithOwner }
      }
    }
  }
}`;

/**
 * 自分がレビュー済みで、いまは依頼の来ていない open な PR。
 * レビューを投稿すると review-requested から外れるので、こちらで拾い直す。自分の PR は除く
 */
export const REVIEWED_SEARCH =
  "is:pr is:open reviewed-by:@me -review-requested:@me -author:@me archived:false";

/** latestReviews は人ごとの最新のレビュー。自分の分を viewer の login で選ぶ */
export const REVIEWED_QUERY = `query($q: String!) {
  viewer { login }
  search(query: $q, type: ISSUE, first: 100) {
    nodes {
      ... on PullRequest {
        number title url updatedAt additions deletions changedFiles headRefName baseRefName headRefOid
        author { login }
        repository { nameWithOwner }
        latestReviews(first: 100) { nodes { author { login } state submittedAt } }
      }
    }
  }
}`;

const MY_REVIEW_STATES = new Set<string>([
  "APPROVED",
  "CHANGES_REQUESTED",
  "COMMENTED",
  "DISMISSED",
]);

interface RawPR {
  number: number;
  title: string;
  author: { login: string } | null;
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  updatedAt: string;
  url: string;
}

interface RawSearchResult {
  data: {
    search: {
      // PullRequest 以外（Issue）は ... on PullRequest に当たらず空オブジェクトになる
      nodes: (Partial<RawPR> & { repository?: { nameWithOwner: string } })[];
    };
  };
}

interface RawLatestReview {
  author: { login: string } | null;
  state: string;
  submittedAt: string | null;
}

interface RawReviewedResult {
  data: {
    viewer: { login: string };
    search: {
      nodes: (Partial<RawPR> & {
        repository?: { nameWithOwner: string };
        latestReviews?: { nodes: RawLatestReview[] };
      })[];
    };
  };
}

interface RawComment {
  id: number;
  user: { login: string } | null;
  body: string;
  path?: string | null;
  line?: number | null;
  side?: "LEFT" | "RIGHT" | null;
  created_at: string;
  html_url: string;
}

export interface RawReview {
  id: number;
  /** type は "User" か "Bot" */
  user: { login: string; type?: string } | null;
  body: string | null;
  state: string;
  submitted_at: string | null;
  html_url: string;
}

const REVIEW_STATE_LABELS: Record<string, string> = {
  APPROVED: "承認",
  CHANGES_REQUESTED: "変更を要求",
  COMMENTED: "コメント",
  DISMISSED: "取り下げ",
};

/** 承認の有効・無効を決めるレビュー。COMMENTED は前の判断を変えない */
const DECISIVE_STATES = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);

/**
 * レビュー一覧（古い順）から、いまも有効な人の承認を取り出す。
 * 同じ人が後で変更を要求したり、承認が取り下げ（DISMISSED）られたりしたものは除く
 */
export function currentApprovals(reviews: RawReview[]): Approval[] {
  const latest = new Map<string, RawReview>();
  for (const review of reviews) {
    const login = review.user?.login;
    if (login === undefined || review.submitted_at === null) continue;
    if (review.user?.type === "Bot") continue;
    if (DECISIVE_STATES.has(review.state)) latest.set(login, review);
  }
  return [...latest.values()]
    .filter((review) => review.state === "APPROVED")
    .map((review) => ({
      author: review.user?.login ?? "(unknown)",
      submittedAt: review.submitted_at as string,
      url: review.html_url,
    }));
}

function toSummary(repo: string, raw: RawPR): PRSummary {
  return {
    repo,
    number: raw.number,
    title: raw.title,
    author: raw.author?.login ?? "(unknown)",
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    headSha: raw.headRefOid,
    additions: raw.additions,
    deletions: raw.deletions,
    changedFiles: raw.changedFiles,
    updatedAt: raw.updatedAt,
    url: raw.url,
  };
}

function toComment(raw: RawComment): ExistingComment {
  return {
    id: raw.id,
    author: raw.user?.login ?? "(unknown)",
    body: raw.body,
    path: raw.path ?? null,
    line: raw.line ?? null,
    side: raw.side ?? null,
    createdAt: raw.created_at,
    url: raw.html_url,
  };
}

/** gh api --jq '.[]' の出力（JSONL）を 1 行ずつパースする */
function parseJsonLines<T>(stdout: string): T[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

/**
 * 投稿 API の応答から、画面に残す分だけを取り出す。
 * 投稿自体は済んでいるので、応答が読めなくても失敗にはしない
 */
export function parsePostedReview(stdout: string): PostedReview {
  let raw: { html_url?: unknown; submitted_at?: unknown } = {};
  try {
    raw = (JSON.parse(stdout) ?? {}) as typeof raw;
  } catch {
    // 応答が JSON でなくても、投稿できたことは変わらない
  }
  return {
    url: typeof raw.html_url === "string" ? raw.html_url : null,
    submittedAt: typeof raw.submitted_at === "string" ? raw.submitted_at : new Date().toISOString(),
  };
}

/** contents API に渡すパス。セグメントごとにエンコードし、スラッシュは残す */
export function encodeContentPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * ローカルの clone には一切依存しない。
 * どのリポジトリに対する操作かは、常に引数の owner/repo で明示する
 */
export class GitHubClient {
  private viewerLogin: Promise<string> | null = null;

  constructor(private readonly runner: CommandRunner) {}

  private async run(
    cmd: string[],
    failureMessage: LocalizedText,
    stdin?: string,
  ): Promise<CommandResult> {
    const result = await this.runner.run(cmd, { stdin });
    if (result.exitCode !== 0) {
      throw new ExternalCommandError(failureMessage, result.stderr.trim() || result.stdout.trim());
    }
    return result;
  }

  async listReviewRequestedPRs(): Promise<PRSummary[]> {
    const result = await this.run(
      [
        "gh",
        "api",
        "graphql",
        "-f",
        `query=${REVIEW_REQUESTED_QUERY}`,
        "-f",
        `q=${REVIEW_REQUESTED_SEARCH}`,
      ],
      { ja: "PR 一覧の取得に失敗しました", en: "Failed to fetch the PR list" },
    );
    const parsed = JSON.parse(result.stdout) as RawSearchResult;
    return parsed.data.search.nodes
      .filter((node) => node.number !== undefined && node.repository !== undefined)
      .map((node) =>
        toSummary((node.repository as { nameWithOwner: string }).nameWithOwner, node as RawPR),
      );
  }

  async listReviewedPRs(): Promise<ReviewedPR[]> {
    const result = await this.run(
      ["gh", "api", "graphql", "-f", `query=${REVIEWED_QUERY}`, "-f", `q=${REVIEWED_SEARCH}`],
      {
        ja: "レビュー済みの PR 一覧の取得に失敗しました",
        en: "Failed to fetch the list of PRs you have reviewed",
      },
    );
    const parsed = JSON.parse(result.stdout) as RawReviewedResult;
    const viewer = parsed.data.viewer.login;
    return parsed.data.search.nodes.flatMap((node): ReviewedPR[] => {
      if (node.number === undefined || node.repository === undefined) return [];
      const mine = node.latestReviews?.nodes.find(
        (review) =>
          review.author?.login === viewer &&
          review.submittedAt !== null &&
          MY_REVIEW_STATES.has(review.state),
      );
      // 下書き（PENDING）しか無いものは、まだレビューしていないのと同じなので出さない
      if (mine === undefined) return [];
      return [
        {
          ...toSummary(node.repository.nameWithOwner, node as RawPR),
          myReview: { state: mine.state as MyReviewState, submittedAt: mine.submittedAt as string },
        },
      ];
    });
  }

  async fetchPRMeta(pr: PRRef): Promise<{
    summary: PRSummary;
    headSha: string;
    baseSha: string;
    body: string;
    labels: string[];
    /** ドラフトか。リスクの点数に使う */
    draft: boolean;
    /** 作成者が bot か。リスクの点数に使う */
    authorIsBot: boolean;
  }> {
    const result = await this.run(
      [
        "gh",
        "pr",
        "view",
        String(pr.number),
        "--repo",
        pr.repo,
        "--json",
        `${PR_FIELDS},headRefOid,baseRefOid,body,labels,isDraft`,
      ],
      {
        ja: `${pr.repo}#${pr.number} の情報を取得できませんでした`,
        en: `Could not fetch ${pr.repo}#${pr.number}`,
      },
    );
    const raw = JSON.parse(result.stdout) as RawPR & {
      baseRefOid: string;
      body: string | null;
      labels?: { name: string }[];
      isDraft?: boolean;
    };
    const author = raw.author as { login: string; is_bot?: boolean } | null;
    return {
      summary: toSummary(pr.repo, raw),
      headSha: raw.headRefOid,
      baseSha: raw.baseRefOid,
      // AI レビューのプロンプトに載せる素の Markdown。画面表示は描画済みの fetchBodyHtml を使う
      body: raw.body ?? "",
      labels: (raw.labels ?? []).map((label) => label.name),
      draft: raw.isDraft === true,
      authorIsBot: author?.is_bot === true || (author?.login ?? "").endsWith("[bot]"),
    };
  }

  /**
   * 説明文は GitHub が描画した HTML で受け取る。Markdown の描画と無害化を
   * GitHub に任せ、画面の見た目も GitHub と揃える
   */
  async fetchBodyHtml(pr: PRRef): Promise<string> {
    const result = await this.run(
      [
        "gh",
        "api",
        "-H",
        "Accept: application/vnd.github.html+json",
        `repos/${pr.repo}/pulls/${pr.number}`,
        "--jq",
        '.body_html // ""',
      ],
      {
        ja: `${pr.repo}#${pr.number} の説明文を取得できませんでした`,
        en: `Could not fetch the description of ${pr.repo}#${pr.number}`,
      },
    );
    return result.stdout.trim();
  }

  async fetchDiff(pr: PRRef): Promise<string> {
    // --patch は付けない。format-patch 形式になり、ファイルがコミット数だけ重複して
    // 行番号が壊れる。素の diff は application/vnd.github.diff（単一の unified diff）
    const result = await this.run(["gh", "pr", "diff", String(pr.number), "--repo", pr.repo], {
      ja: `${pr.repo}#${pr.number} の diff を取得できませんでした`,
      en: `Could not fetch the diff of ${pr.repo}#${pr.number}`,
    });
    return result.stdout;
  }

  async fetchComments(pr: PRRef): Promise<ExistingComment[]> {
    const reviewComments = await this.run(
      ["gh", "api", "--paginate", `repos/${pr.repo}/pulls/${pr.number}/comments`, "--jq", ".[]"],
      {
        ja: `${pr.repo}#${pr.number} の行コメントを取得できませんでした`,
        en: `Could not fetch the line comments of ${pr.repo}#${pr.number}`,
      },
    );
    const issueComments = await this.run(
      ["gh", "api", "--paginate", `repos/${pr.repo}/issues/${pr.number}/comments`, "--jq", ".[]"],
      {
        ja: `${pr.repo}#${pr.number} のコメントを取得できませんでした`,
        en: `Could not fetch the comments of ${pr.repo}#${pr.number}`,
      },
    );

    return [
      ...parseJsonLines<RawComment>(reviewComments.stdout),
      ...parseJsonLines<RawComment>(issueComments.stdout),
    ].map(toComment);
  }

  /**
   * レビュー本文（Approve / Request changes と一緒に書く総評）。行コメントとは別の API にある。
   * 本文の無いレビュー（承認だけ等）と、まだ提出されていない下書きは除く
   */
  async fetchReviewBodies(pr: PRRef): Promise<ExistingComment[]> {
    const result = await this.run(
      ["gh", "api", "--paginate", `repos/${pr.repo}/pulls/${pr.number}/reviews`, "--jq", ".[]"],
      {
        ja: `${pr.repo}#${pr.number} のレビューを取得できませんでした`,
        en: `Could not fetch the reviews of ${pr.repo}#${pr.number}`,
      },
    );

    return parseJsonLines<RawReview>(result.stdout)
      .filter((raw) => raw.submitted_at !== null && (raw.body ?? "").trim() !== "")
      .map((raw) => ({
        id: raw.id,
        author: raw.user?.login ?? "(unknown)",
        body: `［レビュー: ${REVIEW_STATE_LABELS[raw.state] ?? raw.state}］\n${raw.body}`,
        path: null,
        line: null,
        side: null,
        createdAt: raw.submitted_at as string,
        url: raw.html_url,
      }));
  }

  /** レビューを出した人が承認したままでいるもの。fetchReviewBodies と同じ API を読む */
  async fetchApprovals(pr: PRRef): Promise<Approval[]> {
    const result = await this.run(
      ["gh", "api", "--paginate", `repos/${pr.repo}/pulls/${pr.number}/reviews`, "--jq", ".[]"],
      {
        ja: `${pr.repo}#${pr.number} のレビューを取得できませんでした`,
        en: `Could not fetch the reviews of ${pr.repo}#${pr.number}`,
      },
    );
    return currentApprovals(parseJsonLines<RawReview>(result.stdout));
  }

  /** gh でログインしている自分のアカウント名。変わらないので一度だけ取る */
  async fetchViewerLogin(): Promise<string> {
    this.viewerLogin ??= this.run(["gh", "api", "user", "--jq", ".login"], {
      ja: "GitHub のログイン中のアカウントを取得できませんでした",
      en: "Could not get the GitHub account you are signed in as",
    }).then((result) => result.stdout.trim());
    try {
      return await this.viewerLogin;
    } catch (error) {
      // 失敗を覚えておくと、通信が戻っても取り直せない
      this.viewerLogin = null;
      throw error;
    }
  }

  /**
   * 指定コミット時点のファイル本文。存在しなければ null。
   * AI レビュー用に、変更ファイルだけを clone せずに取り寄せるために使う
   */
  async fetchFile(repo: string, ref: string, path: string): Promise<string | null> {
    const result = await this.runner.run([
      "gh",
      "api",
      "-H",
      "Accept: application/vnd.github.raw",
      `repos/${repo}/contents/${encodeContentPath(path)}?ref=${ref}`,
    ]);
    if (result.exitCode === 0) return result.stdout;
    if (result.stderr.includes("HTTP 404")) return null;
    throw new ExternalCommandError(
      {
        ja: `${repo} の ${path} を取得できませんでした`,
        en: `Could not fetch ${path} from ${repo}`,
      },
      result.stderr.trim() || result.stdout.trim(),
    );
  }

  /** 見守りと投稿の直前の確認用に、PR の状態・head・作成者・ラベルだけを軽く取る */
  async fetchPRState(
    pr: PRRef,
  ): Promise<{ state: PRState; headSha: string; author: string; labels: string[] }> {
    const result = await this.run(
      [
        "gh",
        "pr",
        "view",
        String(pr.number),
        "--repo",
        pr.repo,
        "--json",
        "state,headRefOid,author,labels",
      ],
      {
        ja: `${pr.repo}#${pr.number} の状態を取得できませんでした`,
        en: `Could not fetch the state of ${pr.repo}#${pr.number}`,
      },
    );
    const raw = JSON.parse(result.stdout) as {
      state: PRState;
      headRefOid: string;
      author: { login: string } | null;
      labels?: { name: string }[];
    };
    return {
      state: raw.state,
      headSha: raw.headRefOid,
      author: raw.author?.login ?? "(unknown)",
      labels: (raw.labels ?? []).map((label) => label.name),
    };
  }

  /** PR にラベルを付ける。リポジトリに無いラベルは GitHub が作る */
  async addLabel(pr: PRRef, label: string): Promise<void> {
    await this.run(
      [
        "gh",
        "api",
        "--method",
        "POST",
        `repos/${pr.repo}/issues/${pr.number}/labels`,
        "-f",
        `labels[]=${label}`,
      ],
      {
        ja: `${pr.repo}#${pr.number} にラベル ${label} を付けられませんでした`,
        en: `Could not add the label ${label} to ${pr.repo}#${pr.number}`,
      },
    );
  }

  async submitReview(pr: PRRef, req: SubmitRequest): Promise<PostedReview> {
    const payload = buildReviewPayload(req);
    const result = await this.run(
      [
        "gh",
        "api",
        "--method",
        "POST",
        `repos/${pr.repo}/pulls/${pr.number}/reviews`,
        "--input",
        "-",
      ],
      { ja: "レビューの投稿に失敗しました", en: "Failed to post the review" },
      JSON.stringify(payload),
    );
    return parsePostedReview(result.stdout);
  }
}
