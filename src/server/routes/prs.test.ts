import { inJapanese, memoryDeps } from "../store/memory.ts";
import { expect, test } from "bun:test";
import { createApp } from "../app.ts";
import { diffDigest } from "../diff/digest.ts";
import { parseUnifiedDiff } from "../diff/parse.ts";
import { parsePRRef } from "./prs.ts";
import { FakeCommandRunner, ok } from "../exec.ts";
import {
  GitHubClient,
  REVIEW_REQUESTED_QUERY,
  REVIEW_REQUESTED_SEARCH,
  REVIEWED_QUERY,
  REVIEWED_SEARCH,
} from "../github/client.ts";
import { BunFileReader, ReviewRunner } from "../reviewer/runner.ts";
import { Translator } from "../reviewer/translate.ts";
import { SnapshotManager } from "../snapshot/manager.ts";
import { bunStaticFiles } from "../runtime/bun.ts";

const PR_FIELDS =
  "number,title,author,headRefName,baseRefName,additions,deletions,changedFiles,updatedAt,url";

const RAW_PR = {
  number: 12,
  title: "認証を直す",
  author: { login: "alice" },
  headRefName: "fix-auth",
  baseRefName: "main",
  headRefOid: "abc123",
  additions: 3,
  deletions: 1,
  changedFiles: 1,
  updatedAt: "2026-07-20T10:00:00Z",
  url: "https://github.com/o/r/pull/12",
};

const LIST_CMD = `gh api graphql -f query=${REVIEW_REQUESTED_QUERY} -f q=${REVIEW_REQUESTED_SEARCH}`;
const REVIEWED_CMD = `gh api graphql -f query=${REVIEWED_QUERY} -f q=${REVIEWED_SEARCH}`;
const NO_REVIEWED = ok(
  JSON.stringify({ data: { viewer: { login: "me" }, search: { nodes: [] } } }),
);

function searchResult(nodes: unknown[]): string {
  return JSON.stringify({ data: { search: { nodes } } });
}

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
`;

function appWith(responses: Record<string, Partial<import("../exec.ts").CommandResult>>) {
  const runner = new FakeCommandRunner(responses);
  const github = new GitHubClient(runner);
  return inJapanese(
    createApp({
      github,
      snapshots: new SnapshotManager(github, "/tmp/advw"),
      reviewer: new ReviewRunner(runner, new BunFileReader(), "remote-read"),
      remoteReadCommand: "remote-read",
      translator: new Translator(runner, new BunFileReader()),
      clientDir: "./dist/client",
      staticFiles: bunStaticFiles,
      ...memoryDeps(),
    }),
  );
}

test("GET /api/prs は全リポジトリのレビュー依頼中の PR をリポジトリ名付きで返す", async () => {
  const app = appWith({
    [LIST_CMD]: ok(
      searchResult([
        { ...RAW_PR, repository: { nameWithOwner: "o/r" } },
        { ...RAW_PR, number: 7, repository: { nameWithOwner: "o/other" } },
      ]),
    ),
    [REVIEWED_CMD]: NO_REVIEWED,
  });
  const res = await app.request("/api/prs");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    prs: [
      {
        repo: "o/r",
        number: 12,
        title: "認証を直す",
        author: "alice",
        headRefName: "fix-auth",
        baseRefName: "main",
        headSha: "abc123",
        additions: 3,
        deletions: 1,
        changedFiles: 1,
        updatedAt: "2026-07-20T10:00:00Z",
        url: "https://github.com/o/r/pull/12",
      },
      expect.objectContaining({ repo: "o/other", number: 7 }),
    ],
    reviewed: [],
  });
});

test("PR が 1 件も無ければ空配列を返す", async () => {
  const app = appWith({ [LIST_CMD]: ok(searchResult([])), [REVIEWED_CMD]: NO_REVIEWED });
  const res = await app.request("/api/prs");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ prs: [], reviewed: [] });
});

test("GET /api/prs は自分がレビュー済みの PR を自分のレビューの種類付きで返す", async () => {
  const app = appWith({
    [LIST_CMD]: ok(searchResult([])),
    [REVIEWED_CMD]: ok(
      JSON.stringify({
        data: {
          viewer: { login: "me" },
          search: {
            nodes: [
              {
                ...RAW_PR,
                repository: { nameWithOwner: "o/r" },
                latestReviews: {
                  nodes: [
                    {
                      author: { login: "me" },
                      state: "APPROVED",
                      submittedAt: "2026-07-21T00:00:00Z",
                    },
                  ],
                },
              },
            ],
          },
        },
      }),
    ),
  });
  const res = await app.request("/api/prs");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    prs: [],
    reviewed: [
      expect.objectContaining({
        repo: "o/r",
        number: 12,
        myReview: { state: "APPROVED", submittedAt: "2026-07-21T00:00:00Z" },
      }),
    ],
  });
});

test("gh が失敗したら 500 と日本語メッセージを返す", async () => {
  const app = appWith({
    [LIST_CMD]: {
      stdout: "",
      stderr: "not authenticated",
      exitCode: 1,
    },
    [REVIEWED_CMD]: NO_REVIEWED,
  });
  const res = await app.request("/api/prs");
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({
    message: "PR 一覧の取得に失敗しました",
    detail: "not authenticated",
  });
});

test("GET /api/repos/:owner/:repo/pulls/:number は指定リポジトリの diff をパースして返す", async () => {
  const app = appWith({
    [`gh pr view 12 --repo o/r --json ${PR_FIELDS},headRefOid,baseRefOid,body,labels`]: ok(
      JSON.stringify({ ...RAW_PR, headRefOid: "abc123", baseRefOid: "base999" }),
    ),
    "gh pr diff 12 --repo o/r": ok(PATCH),
    [`gh api -H Accept: application/vnd.github.html+json repos/o/r/pulls/12 --jq .body_html // ""`]:
      ok("<p>説明</p>\n"),
    "gh api --paginate repos/o/r/pulls/12/comments --jq .[]": ok(""),
    "gh api --paginate repos/o/r/issues/12/comments --jq .[]": ok(""),
  });

  const res = await app.request("/api/repos/o/r/pulls/12");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.headSha).toBe("abc123");
  expect(body.pr.number).toBe(12);
  expect(body.pr.repo).toBe("o/r");
  expect(body.bodyHtml).toBe("<p>説明</p>");
  expect(body.files).toHaveLength(1);
  expect(body.files[0].path).toBe("src/a.ts");
  expect(body.files[0].hunks[0].lines).toHaveLength(3);
  expect(body.comments).toEqual([]);
});

test("POST .../auto-judge は PR に自動判断のラベルを付ける", async () => {
  const app = appWith({
    "gh api --method POST repos/o/r/issues/12/labels -f labels[]=auto-judge": ok("[]"),
  });
  const res = await app.request("/api/repos/o/r/pulls/12/auto-judge", { method: "POST" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ label: "auto-judge" });
});

test("PR 番号が数値でなければ 400 を返す", async () => {
  const app = appWith({});
  const res = await app.request("/api/repos/o/r/pulls/abc");
  expect(res.status).toBe(400);
  expect((await res.json()).message).toBe("PR の指定が不正です");
});

test("parsePRRef は gh api のパスに使えない owner / repo を拒否する", () => {
  expect(parsePRRef({ owner: "octo-org", repo: "hello.world", number: "1" })).toEqual({
    repo: "octo-org/hello.world",
    number: 1,
  });
  expect(parsePRRef({ owner: "..", repo: "r", number: "1" })).toBeNull();
  expect(parsePRRef({ owner: "o", repo: "r?x=1", number: "1" })).toBeNull();
  expect(parsePRRef({ owner: "o", repo: "", number: "1" })).toBeNull();
});

const STATE_CMD = "gh pr view 12 --repo o/r --json state,headRefOid,author,labels";

function rawComment(id: number, login: string, createdAt: string): string {
  return JSON.stringify({
    id,
    user: { login },
    body: `コメント ${id}`,
    created_at: createdAt,
    html_url: `https://github.com/o/r/pull/12#issuecomment-${id}`,
  });
}

const REVIEWS_CMD = "gh api --paginate repos/o/r/pulls/12/reviews --jq .[]";
const VIEWER_CMD = "gh api user --jq .login";

function rawReview(id: number, login: string, state: string, submittedAt: string, type = "User") {
  return JSON.stringify({
    id,
    user: { login, type },
    body: "",
    state,
    submitted_at: submittedAt,
    html_url: `https://github.com/o/r/pull/12#pullrequestreview-${id}`,
  });
}

test("GET .../activity は since より後の作成者のコメントと、PR の状態・head を返す", async () => {
  const app = appWith({
    [REVIEWS_CMD]: ok(""),
    [VIEWER_CMD]: ok("me\n"),
    [STATE_CMD]: ok(
      JSON.stringify({ state: "OPEN", headRefOid: "def456", author: { login: "alice" } }),
    ),
    "gh api --paginate repos/o/r/pulls/12/comments --jq .[]": ok(
      [
        rawComment(1, "alice", "2026-10-01T00:00:00Z"), // 投稿より前
        rawComment(2, "alice", "2026-10-03T00:00:00Z"),
      ].join("\n"),
    ),
    "gh api --paginate repos/o/r/issues/12/comments --jq .[]": ok(
      [
        rawComment(3, "ci-bot", "2026-10-03T00:00:00Z"), // 作成者以外は数えない
        rawComment(4, "alice", "2026-10-04T00:00:00Z"),
      ].join("\n"),
    ),
  });

  const res = await app.request(
    `/api/repos/o/r/pulls/12/activity?since=${encodeURIComponent("2026-10-02T00:00:00Z")}`,
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.state).toBe("OPEN");
  expect(body.headSha).toBe("def456");
  expect(body.replies.map((c: { id: number }) => c.id)).toEqual([2, 4]);
  expect(body.approvals).toEqual([]);
});

test("GET .../activity は since より後の、自分と作成者と bot 以外の承認を返す", async () => {
  const app = appWith({
    [STATE_CMD]: ok(
      JSON.stringify({ state: "OPEN", headRefOid: "def456", author: { login: "alice" } }),
    ),
    "gh api --paginate repos/o/r/pulls/12/comments --jq .[]": ok(""),
    "gh api --paginate repos/o/r/issues/12/comments --jq .[]": ok(""),
    [VIEWER_CMD]: ok("me\n"),
    [REVIEWS_CMD]: ok(
      [
        rawReview(1, "old", "APPROVED", "2026-10-01T00:00:00Z"), // 投稿より前
        rawReview(2, "me", "APPROVED", "2026-10-03T00:00:00Z"), // 自分
        rawReview(3, "renovate", "APPROVED", "2026-10-03T00:00:00Z", "Bot"),
        rawReview(4, "bob", "APPROVED", "2026-10-03T00:00:00Z"),
        rawReview(5, "carol", "APPROVED", "2026-10-03T00:00:00Z"),
        rawReview(6, "carol", "CHANGES_REQUESTED", "2026-10-04T00:00:00Z"), // 後で撤回
        rawReview(7, "bob", "COMMENTED", "2026-10-05T00:00:00Z"), // コメントでは承認は消えない
      ].join("\n"),
    ),
  });

  const res = await app.request(
    `/api/repos/o/r/pulls/12/activity?since=${encodeURIComponent("2026-10-02T00:00:00Z")}`,
  );
  expect(res.status).toBe(200);
  expect((await res.json()).approvals).toEqual([
    {
      author: "bob",
      submittedAt: "2026-10-03T00:00:00Z",
      url: "https://github.com/o/r/pull/12#pullrequestreview-4",
    },
  ]);
});

test("GET .../activity は since が無ければ 400 を返す", async () => {
  const res = await appWith({}).request("/api/repos/o/r/pulls/12/activity");
  expect(res.status).toBe(400);
});

test("GET .../digest は PR のいまの head と、変更の中身の要約を返す", async () => {
  const app = appWith({
    [STATE_CMD]: ok(
      JSON.stringify({ state: "OPEN", headRefOid: "def456", author: { login: "alice" } }),
    ),
    "gh pr diff 12 --repo o/r": ok(PATCH),
  });
  const res = await app.request("/api/repos/o/r/pulls/12/digest");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    headSha: "def456",
    digest: diffDigest(parseUnifiedDiff(PATCH)),
  });
});
