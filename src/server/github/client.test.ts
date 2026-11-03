import { expect, test } from "bun:test";
import { FakeCommandRunner, ok } from "../exec.ts";
import {
  GitHubClient,
  currentApprovals,
  REVIEW_REQUESTED_QUERY,
  REVIEW_REQUESTED_SEARCH,
  REVIEWED_QUERY,
  REVIEWED_SEARCH,
  encodeContentPath,
  parsePostedReview,
} from "./client.ts";

const LIST_CMD = `gh api graphql -f query=${REVIEW_REQUESTED_QUERY} -f q=${REVIEW_REQUESTED_SEARCH}`;
const PR = { repo: "o/r", number: 12 };

test("全リポジトリ横断でレビュー依頼中の PR 一覧を取得して PRSummary に変換する", async () => {
  const runner = new FakeCommandRunner({
    [LIST_CMD]: ok(
      JSON.stringify({
        data: {
          search: {
            nodes: [
              {
                number: 12,
                title: "認証を直す",
                author: { login: "alice" },
                headRefName: "fix-auth",
                baseRefName: "main",
                headRefOid: "abc123",
                additions: 30,
                deletions: 4,
                changedFiles: 3,
                updatedAt: "2026-07-20T10:00:00Z",
                url: "https://github.com/o/r/pull/12",
                repository: { nameWithOwner: "o/r" },
              },
              // PullRequest 以外は ... on PullRequest に当たらず空になる
              {},
            ],
          },
        },
      }),
    ),
  });

  const prs = await new GitHubClient(runner).listReviewRequestedPRs();
  expect(prs).toEqual([
    {
      repo: "o/r",
      number: 12,
      title: "認証を直す",
      author: "alice",
      headRefName: "fix-auth",
      baseRefName: "main",
      headSha: "abc123",
      additions: 30,
      deletions: 4,
      changedFiles: 3,
      updatedAt: "2026-07-20T10:00:00Z",
      url: "https://github.com/o/r/pull/12",
    },
  ]);
});

test("レビュー済みの PR は、自分の最新のレビューの種類を添えて返し、下書きしか無いものは除く", async () => {
  const pr = (number: number, reviews: unknown[]) => ({
    number,
    title: "認証を直す",
    author: { login: "alice" },
    headRefName: "fix-auth",
    baseRefName: "main",
    headRefOid: "abc123",
    additions: 30,
    deletions: 4,
    changedFiles: 3,
    updatedAt: "2026-07-20T10:00:00Z",
    url: `https://github.com/o/r/pull/${number}`,
    repository: { nameWithOwner: "o/r" },
    latestReviews: { nodes: reviews },
  });
  const runner = new FakeCommandRunner({
    [`gh api graphql -f query=${REVIEWED_QUERY} -f q=${REVIEWED_SEARCH}`]: ok(
      JSON.stringify({
        data: {
          viewer: { login: "me" },
          search: {
            nodes: [
              pr(1, [
                {
                  author: { login: "bob" },
                  state: "APPROVED",
                  submittedAt: "2026-07-21T00:00:00Z",
                },
                {
                  author: { login: "me" },
                  state: "COMMENTED",
                  submittedAt: "2026-07-22T00:00:00Z",
                },
              ]),
              pr(2, [{ author: { login: "me" }, state: "PENDING", submittedAt: null }]),
              {},
            ],
          },
        },
      }),
    ),
  });

  const prs = await new GitHubClient(runner).listReviewedPRs();
  expect(prs.map((p) => [p.number, p.myReview])).toEqual([
    [1, { state: "COMMENTED", submittedAt: "2026-07-22T00:00:00Z" }],
  ]);
});

test("gh が失敗したら ExternalCommandError を投げる", async () => {
  const runner = new FakeCommandRunner({
    [LIST_CMD]: { stdout: "", stderr: "gh: not authenticated", exitCode: 1 },
  });
  await expect(new GitHubClient(runner).listReviewRequestedPRs()).rejects.toThrow(
    "PR 一覧の取得に失敗しました",
  );
});

test("diff を unified diff として取得する（--patch を付けない）", async () => {
  const runner = new FakeCommandRunner({
    "gh pr diff 12 --repo o/r": ok("diff --git a/a.ts b/a.ts\n"),
  });
  const diff = await new GitHubClient(runner).fetchDiff(PR);
  expect(diff).toBe("diff --git a/a.ts b/a.ts\n");
  // --patch は format-patch 形式（コミット単位・メールヘッダ付き）を返すので使わない
  expect(runner.calls[0]).not.toContain("--patch");
});

test("行コメントと PR 全体コメントをまとめて取得する", async () => {
  const runner = new FakeCommandRunner({
    "gh api --paginate repos/o/r/pulls/12/comments --jq .[]": ok(
      [
        JSON.stringify({
          id: 1,
          user: { login: "bob" },
          body: "ここは危ない",
          path: "src/a.ts",
          line: 7,
          side: "RIGHT",
          created_at: "2026-07-21T00:00:00Z",
          html_url: "https://github.com/o/r/pull/12#discussion_r1",
        }),
      ].join("\n"),
    ),
    "gh api --paginate repos/o/r/issues/12/comments --jq .[]": ok(
      [
        JSON.stringify({
          id: 2,
          user: { login: "carol" },
          body: "全体的に良さそう",
          created_at: "2026-07-22T00:00:00Z",
          html_url: "https://github.com/o/r/pull/12#issuecomment-2",
        }),
      ].join("\n"),
    ),
  });

  const comments = await new GitHubClient(runner).fetchComments(PR);
  expect(comments).toEqual([
    {
      id: 1,
      author: "bob",
      body: "ここは危ない",
      path: "src/a.ts",
      line: 7,
      side: "RIGHT",
      createdAt: "2026-07-21T00:00:00Z",
      url: "https://github.com/o/r/pull/12#discussion_r1",
    },
    {
      id: 2,
      author: "carol",
      body: "全体的に良さそう",
      path: null,
      line: null,
      side: null,
      createdAt: "2026-07-22T00:00:00Z",
      url: "https://github.com/o/r/pull/12#issuecomment-2",
    },
  ]);
});

test("削除行に付いたコメントの side=LEFT を保持する", async () => {
  const runner = new FakeCommandRunner({
    "gh api --paginate repos/o/r/pulls/12/comments --jq .[]": ok(
      JSON.stringify({
        id: 4,
        user: { login: "bob" },
        body: "消した理由は？",
        path: "src/a.ts",
        line: 2,
        side: "LEFT",
        created_at: "2026-07-21T00:00:00Z",
        html_url: "https://example.com/4",
      }),
    ),
    "gh api --paginate repos/o/r/issues/12/comments --jq .[]": ok(""),
  });
  // LEFT の line は変更前ファイルの行番号。変更後の行番号と混ぜると別の行に出る
  expect((await new GitHubClient(runner).fetchComments(PR))[0]!.side).toBe("LEFT");
});

test("コメントが 0 件（空出力）でも空配列を返す", async () => {
  const runner = new FakeCommandRunner({
    "gh api --paginate repos/o/r/pulls/12/comments --jq .[]": ok("\n"),
    "gh api --paginate repos/o/r/issues/12/comments --jq .[]": ok(""),
  });
  expect(await new GitHubClient(runner).fetchComments(PR)).toEqual([]);
});

test("解決済みの outdated な行コメント（line が null）も path 付きで残す", async () => {
  const runner = new FakeCommandRunner({
    "gh api --paginate repos/o/r/pulls/12/comments --jq .[]": ok(
      JSON.stringify({
        id: 3,
        user: { login: "bob" },
        body: "古いコメント",
        path: "src/a.ts",
        line: null,
        created_at: "2026-07-21T00:00:00Z",
        html_url: "https://example.com/3",
      }),
    ),
    "gh api --paginate repos/o/r/issues/12/comments --jq .[]": ok(""),
  });
  const comments = await new GitHubClient(runner).fetchComments(PR);
  expect(comments[0]!.path).toBe("src/a.ts");
  expect(comments[0]!.line).toBeNull();
});

test("レビュー本文は、本文のある提出済みのものだけを PR 全体のコメントとして返す", async () => {
  const review = (id: number, body: string | null, state: string, submitted: string | null) =>
    JSON.stringify({
      id,
      user: { login: "bob" },
      body,
      state,
      submitted_at: submitted,
      html_url: `https://github.com/o/r/pull/12#pullrequestreview-${id}`,
    });
  const runner = new FakeCommandRunner({
    "gh api --paginate repos/o/r/pulls/12/reviews --jq .[]": ok(
      [
        review(1, "全体的にエラー処理が弱い", "CHANGES_REQUESTED", "2026-07-22T00:00:00Z"),
        review(2, "", "APPROVED", "2026-07-23T00:00:00Z"),
        review(3, "下書き", "PENDING", null),
      ].join("\n"),
    ),
  });

  expect(await new GitHubClient(runner).fetchReviewBodies(PR)).toEqual([
    {
      id: 1,
      author: "bob",
      body: "［レビュー: 変更を要求］\n全体的にエラー処理が弱い",
      path: null,
      line: null,
      side: null,
      createdAt: "2026-07-22T00:00:00Z",
      url: "https://github.com/o/r/pull/12#pullrequestreview-1",
    },
  ]);
});

test("PR のメタ情報と head SHA を取得する", async () => {
  const runner = new FakeCommandRunner({
    "gh pr view 12 --repo o/r --json number,title,author,headRefName,baseRefName,additions,deletions,changedFiles,updatedAt,url,headRefOid,baseRefOid,body,labels,isDraft":
      ok(
        JSON.stringify({
          number: 12,
          title: "認証を直す",
          author: { login: "alice" },
          headRefName: "fix-auth",
          baseRefName: "main",
          additions: 30,
          deletions: 4,
          changedFiles: 3,
          updatedAt: "2026-07-20T10:00:00Z",
          url: "https://github.com/o/r/pull/12",
          headRefOid: "abc123",
          baseRefOid: "base999",
          body: "## 目的\n認証を直す",
        }),
      ),
  });
  const { summary, headSha, baseSha, body } = await new GitHubClient(runner).fetchPRMeta(PR);
  expect(body).toBe("## 目的\n認証を直す");
  expect(headSha).toBe("abc123");
  expect(baseSha).toBe("base999");
  expect(summary.author).toBe("alice");
  expect(summary.repo).toBe("o/r");
});

test("レビューを 1 リクエストで投稿し、payload を stdin で渡す", async () => {
  const runner = new FakeCommandRunner({
    "gh api --method POST repos/o/r/pulls/12/reviews --input -": ok("{}"),
  });
  await new GitHubClient(runner).submitReview(PR, {
    event: "COMMENT",
    body: "総評",
    commitId: "abc123",
    comments: [{ findingId: "f1", path: "src/a.ts", line: 7, body: "危ない", anchor: "line" }],
    language: "ja",
    lgtm: "random",
  });

  expect(JSON.parse(runner.stdins[0] as string)).toEqual({
    event: "COMMENT",
    body: "総評",
    commit_id: "abc123",
    comments: [{ path: "src/a.ts", body: "危ない", line: 7, side: "RIGHT" }],
  });
});

test("投稿に失敗したら stderr を detail に含めて投げる", async () => {
  const runner = new FakeCommandRunner({
    "gh api --method POST repos/o/r/pulls/12/reviews --input -": {
      stdout: "",
      stderr: "HTTP 422: line must be part of the diff",
      exitCode: 1,
    },
  });
  try {
    await new GitHubClient(runner).submitReview(PR, {
      event: "COMMENT",
      body: "総評",
      commitId: "abc123",
      comments: [],
      language: "ja",
      lgtm: "random",
    });
    expect.unreachable("submitReview should have thrown");
  } catch (e) {
    expect((e as any).message).toBe("レビューの投稿に失敗しました");
    expect((e as any).detail).toBe("HTTP 422: line must be part of the diff");
  }
});

test("指定コミット時点のファイルを raw で取得する", async () => {
  const runner = new FakeCommandRunner({
    "gh api -H Accept: application/vnd.github.raw repos/o/r/contents/src/a%20b.ts?ref=abc123":
      ok("const a = 1;\n"),
  });
  expect(await new GitHubClient(runner).fetchFile("o/r", "abc123", "src/a b.ts")).toBe(
    "const a = 1;\n",
  );
});

test("ファイルが存在しなければ null を返す", async () => {
  const runner = new FakeCommandRunner({
    "gh api -H Accept: application/vnd.github.raw repos/o/r/contents/CLAUDE.md?ref=abc123": {
      stderr: "gh: Not Found (HTTP 404)",
      exitCode: 1,
    },
  });
  expect(await new GitHubClient(runner).fetchFile("o/r", "abc123", "CLAUDE.md")).toBeNull();
});

test("404 以外の失敗は握りつぶさずに投げる", async () => {
  const runner = new FakeCommandRunner({
    "gh api -H Accept: application/vnd.github.raw repos/o/r/contents/a.ts?ref=abc123": {
      stderr: "gh: Bad credentials (HTTP 401)",
      exitCode: 1,
    },
  });
  await expect(new GitHubClient(runner).fetchFile("o/r", "abc123", "a.ts")).rejects.toThrow(
    "o/r の a.ts を取得できませんでした",
  );
});

test("contents API のパスはセグメントごとにエンコードする", () => {
  expect(encodeContentPath("src/日本語/a?b.ts")).toBe("src/%E6%97%A5%E6%9C%AC%E8%AA%9E/a%3Fb.ts");
});

test("説明文を GitHub が描画した HTML で取得する", async () => {
  const runner = new FakeCommandRunner({
    'gh api -H Accept: application/vnd.github.html+json repos/o/r/pulls/12 --jq .body_html // ""':
      ok("<h3>概要</h3>\n"),
  });
  expect(await new GitHubClient(runner).fetchBodyHtml(PR)).toBe("<h3>概要</h3>");
});

test("説明文が無ければ空文字を返す", async () => {
  const runner = new FakeCommandRunner({
    'gh api -H Accept: application/vnd.github.html+json repos/o/r/pulls/12 --jq .body_html // ""':
      ok("\n"),
  });
  expect(await new GitHubClient(runner).fetchBodyHtml(PR)).toBe("");
});

test("投稿 API の応答からレビューの場所と時刻を取り出す", () => {
  expect(
    parsePostedReview(
      JSON.stringify({
        html_url: "https://github.com/o/r/pull/12#pullrequestreview-1",
        submitted_at: "2026-10-06T01:00:00Z",
      }),
    ),
  ).toEqual({
    url: "https://github.com/o/r/pull/12#pullrequestreview-1",
    submittedAt: "2026-10-06T01:00:00Z",
  });
});

test("投稿 API の応答が読めなくても、投稿できたことにする", () => {
  const posted = parsePostedReview("not json");
  expect(posted.url).toBeNull();
  expect(Number.isNaN(Date.parse(posted.submittedAt))).toBe(false);
});

test("currentApprovals は取り下げられた承認と、後で変更を要求した人の承認を除く", () => {
  const review = (id: number, login: string, state: string) => ({
    id,
    user: { login, type: "User" },
    body: "",
    state,
    submitted_at: `2026-10-0${id}T00:00:00Z`,
    html_url: `u${id}`,
  });
  expect(
    currentApprovals([
      review(1, "bob", "DISMISSED"), // 承認が取り下げられると state が DISMISSED になる
      review(2, "carol", "APPROVED"),
      review(3, "carol", "CHANGES_REQUESTED"),
      review(4, "dave", "CHANGES_REQUESTED"),
      review(5, "dave", "APPROVED"),
      { ...review(6, "erin", "APPROVED"), submitted_at: null }, // 下書き
    ]),
  ).toEqual([{ author: "dave", submittedAt: "2026-10-05T00:00:00Z", url: "u5" }]);
});
