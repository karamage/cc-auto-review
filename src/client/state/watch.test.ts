import { expect, test } from "bun:test";
import type { PRActivity, PRDigest, PRSummary, ReviewStreamEvent } from "../../shared/types.ts";
import type { ApiClient } from "../api.ts";
import { createSessionStore, type SessionStorage } from "./sessions.ts";
import {
  checkWatched,
  detectChange,
  isApproved,
  isDue,
  myReviewLabel,
  postedElsewhere,
  postedLabel,
  recordPosted,
  reviewedElsewhere,
  startWatching,
  stopWatching,
  WATCH_INTERVAL_MS,
} from "./watch.ts";

const SUMMARY: PRSummary = {
  repo: "o/r",
  number: 1,
  title: "認証を直す",
  author: "alice",
  headRefName: "fix",
  baseRefName: "main",
  headSha: "sha1",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  updatedAt: "2026-10-01T00:00:00Z",
  url: "https://github.com/o/r/pull/1",
};
const POSTED_AT = "2026-10-06T00:00:00Z";
const T0 = Date.parse(POSTED_AT);
const MINUTE = 60_000;
const INTERVAL = WATCH_INTERVAL_MS;
/** postedStore が見守りを始めた時刻。投稿の 1 分後 */
const STARTED_AT = new Date(T0 + MINUTE).toISOString();

function activity(change: Partial<PRActivity> = {}): PRActivity {
  return { state: "OPEN", headSha: "sha1", replies: [], approvals: [], ...change };
}

function reply(id: number) {
  return {
    id,
    author: "alice",
    body: "直しました",
    path: null,
    line: null,
    side: null,
    createdAt: "2026-10-06T00:10:00Z",
    url: "",
  };
}

function fakeApi(
  onActivity: () => Promise<PRActivity>,
  reviews: { headSha: string }[] = [],
  onDigest: () => Promise<PRDigest> = () => Promise.reject(new Error("unused")),
): ApiClient {
  return {
    fetchPRs: () => Promise.reject(new Error("unused")),
    fetchPRDetail: () => Promise.reject(new Error("unused")),
    submitReview: () => Promise.reject(new Error("unused")),
    fetchUsage: () => Promise.reject(new Error("unused")),
    fetchSettings: () => Promise.reject(new Error("unused")),
    fetchDefaultSettings: () => Promise.reject(new Error("unused")),
    saveSettings: () => Promise.reject(new Error("unused")),
    previewPrompt: () => Promise.reject(new Error("unused")),
    fetchLearnings: () => Promise.reject(new Error("unused")),
    addLearning: () => Promise.reject(new Error("unused")),
    updateLearning: () => Promise.reject(new Error("unused")),
    removeLearning: () => Promise.reject(new Error("unused")),
    resetLearnings: () => Promise.reject(new Error("unused")),
    post: () => Promise.reject(new Error("unused")),
    markAutoJudge: () => Promise.reject(new Error("unused")),
    fetchActivity: onActivity,
    fetchDigest: onDigest,
    streamChat: () => Promise.reject(new Error("unused")),
    async streamReview(_pr, headSha, _options, onEvent: (e: ReviewStreamEvent) => void) {
      reviews.push({ headSha });
      onEvent({ type: "findings", findings: [], priorChecks: [] });
    },
  };
}

/** 投稿して、見守りを始めたところ */
function postedStore(storage: SessionStorage | null = null, watching = true) {
  const store = createSessionStore(storage);
  recordPosted(store, SUMMARY, {
    review: { url: "https://github.com/o/r/pull/1#pullrequestreview-1", submittedAt: POSTED_AT },
    headSha: "sha1",
    event: "REQUEST_CHANGES",
    comments: 2,
  });
  if (watching) startWatching(store, SUMMARY, T0 + MINUTE);
  return store;
}

test("投稿を記録すると、画面を開き直しても投稿済みと分かる。見守りは始めない", () => {
  const storage = {
    data: null as string | null,
    load: () => storage.data,
    save: (d: string) => {
      storage.data = d;
    },
  };
  postedStore(storage, false);
  const session = createSessionStore(storage).get(SUMMARY);
  expect(session.posted?.review.submittedAt).toBe(POSTED_AT);
  expect(session.posted?.pr.title).toBe("認証を直す");
  expect(session.watch).toBeNull();
  expect(postedLabel(session)).toBe("投稿済み");
  expect(isDue(session, T0 + 999 * MINUTE, INTERVAL)).toBe(false);
});

test("見守りを始めると、返信待ちとして確認の対象になる", () => {
  const store = postedStore();
  expect(store.get(SUMMARY).watch).toEqual({
    status: "waiting",
    checkedAt: null,
    note: null,
    startedAt: STARTED_AT,
  });
  expect(postedLabel(store.get(SUMMARY))).toBe("投稿済み・返信待ち");
});

test("承認して投稿した PR は、承認済みと分かる", () => {
  const store = createSessionStore(null);
  recordPosted(store, SUMMARY, {
    review: { url: null, submittedAt: POSTED_AT },
    headSha: "sha1",
    event: "APPROVE",
    comments: 0,
  });
  expect(isApproved(store.get(SUMMARY))).toBe(true);
  expect(postedLabel(store.get(SUMMARY))).toBe("承認済み");
  startWatching(store, SUMMARY);
  expect(postedLabel(store.get(SUMMARY))).toBe("承認済み・返信待ち");
  expect(isApproved(postedStore().get(SUMMARY))).toBe(false);
});

test("投稿の記録が無かった頃の保存データも読める", () => {
  const old = JSON.stringify({
    "o/r#1": {
      phase: "done",
      progress: "",
      error: null,
      draft: { items: [], event: "COMMENT", summary: "", language: "ja" },
      instructions: "",
      headSha: "sha1",
      reviewedAt: POSTED_AT,
    },
  });
  const session = createSessionStore({ load: () => old, save: () => {} }).get(SUMMARY);
  expect(session.posted).toBeNull();
  expect(session.watch).toBeNull();
  expect(postedLabel(session)).toBeNull();
});

test("新しいコミットか作成者の返信があれば再レビュー、終わった PR は見守りをやめる", () => {
  const posted = postedStore().get(SUMMARY).posted!;
  expect(detectChange(posted, activity())).toBeNull();
  expect(detectChange(posted, activity({ headSha: "sha2abcdef" }))).toEqual({
    kind: "rereview",
    note: "新しいコミット（sha2abc）が push されました。",
  });
  expect(detectChange(posted, activity({ replies: [reply(1), reply(2)] }))?.note).toBe(
    "作成者が 2 件コメントしました。",
  );
  expect(detectChange(posted, activity({ state: "MERGED", headSha: "sha2" }))?.kind).toBe("closed");
  expect(detectChange(posted, activity({ state: "CLOSED" }))?.kind).toBe("closed");
});

test("確認の間隔は 10 分", () => {
  expect(WATCH_INTERVAL_MS).toBe(10 * MINUTE);
});

test("投稿から、または前回の確認から間隔の分だけたつまでは確認しに行かない", () => {
  const store = postedStore();
  expect(isDue(store.get(SUMMARY), T0 + INTERVAL - MINUTE, INTERVAL)).toBe(false);
  expect(isDue(store.get(SUMMARY), T0 + INTERVAL, INTERVAL)).toBe(true);

  store.update(SUMMARY, (s) => ({
    ...s,
    watch: { status: "waiting", checkedAt: new Date(T0 + INTERVAL).toISOString(), note: null },
  }));
  expect(isDue(store.get(SUMMARY), T0 + 2 * INTERVAL - MINUTE, INTERVAL)).toBe(false);

  stopWatching(store, SUMMARY);
  expect(isDue(store.get(SUMMARY), T0 + 999 * MINUTE, INTERVAL)).toBe(false);
});

test("何も起きていなければ確認時刻だけを進め、AI レビューは走らせない", async () => {
  const store = postedStore();
  const reviews: { headSha: string }[] = [];
  await checkWatched(
    fakeApi(async () => activity(), reviews),
    store,
    T0 + INTERVAL,
    INTERVAL,
  );
  expect(store.get(SUMMARY).watch).toEqual({
    status: "waiting",
    checkedAt: new Date(T0 + INTERVAL).toISOString(),
    note: null,
    startedAt: STARTED_AT,
  });
  expect(reviews).toEqual([]);
});

test("修正が push されたら、新しい head で AI レビューをやり直す", async () => {
  const store = postedStore();
  const reviews: { headSha: string }[] = [];
  let since = "";
  const api = fakeApi(async () => activity({ headSha: "sha2" }), reviews);
  api.fetchActivity = async (_pr, s) => {
    since = s;
    return activity({ headSha: "sha2" });
  };
  await checkWatched(api, store, T0 + INTERVAL, INTERVAL);

  expect(since).toBe(POSTED_AT);
  expect(reviews).toEqual([{ headSha: "sha2" }]);
  const session = store.get(SUMMARY);
  expect(session.phase).toBe("done");
  expect(session.headSha).toBe("sha2");
  expect(session.watch?.status).toBe("rereviewed");
  expect(postedLabel(session)).toBe("反応あり・再レビュー済み");
  // 再レビューのあとは、もう一度投稿するまで確認しに行かない
  expect(isDue(session, T0 + 999 * MINUTE, INTERVAL)).toBe(false);
});

test("新しいコミットの中身が前回レビューしたものと同じなら再レビューせず、その head を基準にする", async () => {
  const store = postedStore();
  store.update(SUMMARY, (s) => ({ ...s, digest: "d1" }));
  const reviews: { headSha: string }[] = [];
  const digests: string[] = [];
  const api = fakeApi(
    async () => activity({ headSha: "sha2" }),
    reviews,
    async () => {
      digests.push("called");
      return { headSha: "sha2", digest: "d1" };
    },
  );
  await checkWatched(api, store, T0 + INTERVAL, INTERVAL);

  expect(reviews).toEqual([]);
  expect(store.get(SUMMARY).watch).toMatchObject({
    status: "waiting",
    baseline: { headSha: "sha2", since: POSTED_AT },
  });

  // 次の確認で head が同じなら、中身を確かめ直さない
  await checkWatched(api, store, T0 + 2 * INTERVAL, INTERVAL);
  expect(digests).toHaveLength(1);
  expect(reviews).toEqual([]);

  // 中身が変わったら再レビューする
  const changed = fakeApi(
    async () => activity({ headSha: "sha3" }),
    reviews,
    async () => ({ headSha: "sha3", digest: "d2" }),
  );
  await checkWatched(changed, store, T0 + 3 * INTERVAL, INTERVAL);
  expect(reviews).toEqual([{ headSha: "sha3" }]);
});

test("作成者の返信があれば、中身が同じでも確かめずに再レビューする", async () => {
  const store = postedStore();
  store.update(SUMMARY, (s) => ({ ...s, digest: "d1" }));
  const reviews: { headSha: string }[] = [];
  const api = fakeApi(
    async () => activity({ headSha: "sha2", replies: [reply(1)] }),
    reviews,
    () => Promise.reject(new Error("呼ばれない")),
  );
  await checkWatched(api, store, T0 + INTERVAL, INTERVAL);
  expect(reviews).toEqual([{ headSha: "sha2" }]);
});

test("中身を確かめられないときや、前回の要約が無いときは、従来どおり再レビューする", async () => {
  const failing = postedStore();
  failing.update(SUMMARY, (s) => ({ ...s, digest: "d1" }));
  const reviews: { headSha: string }[] = [];
  await checkWatched(
    fakeApi(async () => activity({ headSha: "sha2" }), reviews),
    failing,
    T0 + INTERVAL,
    INTERVAL,
  );
  expect(reviews).toEqual([{ headSha: "sha2" }]);

  // 確かめている間にさらに push されていたら、その head はまだ確かめていない
  const moved = postedStore();
  moved.update(SUMMARY, (s) => ({ ...s, digest: "d1" }));
  const again: { headSha: string }[] = [];
  await checkWatched(
    fakeApi(
      async () => activity({ headSha: "sha2" }),
      again,
      async () => ({ headSha: "sha3", digest: "d1" }),
    ),
    moved,
    T0 + INTERVAL,
    INTERVAL,
  );
  expect(again).toEqual([{ headSha: "sha2" }]);
});

test("PR がマージされたら見守りを終え、AI レビューは走らせない", async () => {
  const store = postedStore();
  const reviews: { headSha: string }[] = [];
  await checkWatched(
    fakeApi(async () => activity({ state: "MERGED", headSha: "sha2" }), reviews),
    store,
    T0 + INTERVAL,
    INTERVAL,
  );
  expect(store.get(SUMMARY).watch?.status).toBe("closed");
  expect(reviews).toEqual([]);
});

test("確認に失敗しても見守りは続け、次の時期にもう一度確認する", async () => {
  const store = postedStore();
  await checkWatched(
    fakeApi(() => Promise.reject(new Error("offline"))),
    store,
    T0 + INTERVAL,
    INTERVAL,
  );
  const watch = store.get(SUMMARY).watch;
  expect(watch?.status).toBe("waiting");
  expect(watch?.checkedAt).toBe(new Date(T0 + INTERVAL).toISOString());
});

test("確認している間に見守りを止められたら、再レビューしない", async () => {
  const store = postedStore();
  const reviews: { headSha: string }[] = [];
  const api = fakeApi(async () => {
    stopWatching(store, SUMMARY);
    return activity({ headSha: "sha2" });
  }, reviews);
  await checkWatched(api, store, T0 + INTERVAL, INTERVAL);
  expect(store.get(SUMMARY).watch).toBeNull();
  expect(reviews).toEqual([]);
});

test("見守りは止めたり始め直したりできる", () => {
  const store = postedStore();
  stopWatching(store, SUMMARY);
  expect(store.get(SUMMARY).watch).toBeNull();
  expect(postedLabel(store.get(SUMMARY))).toBe("投稿済み");

  startWatching(store, SUMMARY);
  expect(store.get(SUMMARY).watch?.status).toBe("waiting");
});

test("一覧から消えた投稿済みの PR は、見守りの有無にかかわらず残す", () => {
  const store = postedStore(null, false);
  expect(postedElsewhere([SUMMARY], store.all())).toEqual([]);
  expect(postedElsewhere([], store.all()).map((p) => p.pr.number)).toEqual([1]);
  startWatching(store, SUMMARY);
  expect(postedElsewhere([], store.all()).map((p) => p.pr.number)).toEqual([1]);
});

test("GitHub でレビュー済みの PR は、このアプリの投稿記録が無いものだけを出す", () => {
  const store = postedStore(null, false);
  const reviewed = [SUMMARY, { ...SUMMARY, number: 2 }].map((pr) => ({
    ...pr,
    myReview: { state: "APPROVED" as const, submittedAt: POSTED_AT },
  }));
  // #1 は postedElsewhere が見守りの状態付きで出すので、重ねない
  expect(reviewedElsewhere(reviewed, store.all()).map((pr) => pr.number)).toEqual([2]);
  expect(myReviewLabel("APPROVED")).toBe("承認済み");
  expect(myReviewLabel("COMMENTED")).toBe("コメント済み");
});

test("マージかクローズを見届けた PR は一覧に残さない", () => {
  const store = postedStore();
  store.update(SUMMARY, (s) => ({
    ...s,
    watch: { status: "closed", checkedAt: POSTED_AT, note: "PR がマージされました。" },
  }));
  expect(postedElsewhere([], store.all())).toEqual([]);
});

test("再レビュー済み → 返信待ち → 見守りなしの順に、それぞれ投稿の新しい順で並べる", () => {
  const store = createSessionStore();
  const post = (number: number, submittedAt: string) => {
    const pr = { ...SUMMARY, number };
    recordPosted(store, pr, {
      review: { url: null, submittedAt },
      headSha: "sha1",
      event: "COMMENT",
      comments: 0,
    });
    return pr;
  };
  post(1, "2026-10-01T00:00:00Z");
  post(2, "2026-10-03T00:00:00Z");
  startWatching(store, post(3, "2026-10-02T00:00:00Z"));
  const rereviewed = post(4, "2026-09-01T00:00:00Z");
  store.update(rereviewed, (s) => ({
    ...s,
    watch: { status: "rereviewed", checkedAt: null, note: null },
  }));

  expect(postedElsewhere([], store.all()).map((p) => p.pr.number)).toEqual([4, 3, 2, 1]);
});

function approval(author: string, submittedAt: string) {
  return { author, submittedAt, url: "" };
}

test("見守りを始めた後にほかの人が承認したら、新しいコミットがあっても再レビューしない", () => {
  const posted = postedStore().get(SUMMARY).posted!;
  const approved = activity({
    headSha: "sha2",
    replies: [reply(1)],
    approvals: [approval("bob", "2026-10-06T00:05:00Z"), approval("carol", "2026-10-06T00:06:00Z")],
  });
  expect(detectChange(posted, approved, STARTED_AT)).toEqual({
    kind: "approved",
    note: "bob、carol が承認しました。",
  });
  // マージやクローズは承認より優先して見守りを終える
  expect(detectChange(posted, { ...approved, state: "MERGED" }, STARTED_AT)?.kind).toBe("closed");
});

test("見守りを始める前の承認では止めない。人が承知のうえで始め直したものとみなす", () => {
  const posted = postedStore().get(SUMMARY).posted!;
  const restartedAt = "2026-10-06T01:00:00Z";
  const before = activity({
    headSha: "sha2",
    approvals: [approval("bob", "2026-10-06T00:30:00Z")],
  });
  expect(detectChange(posted, before, restartedAt)?.kind).toBe("rereview");
  // startedAt を持たない古い見守りは、投稿時刻から数える
  expect(detectChange(posted, before)?.kind).toBe("approved");
});

test("ほかの人が承認したら AI レビューを走らせずに見守りを止め、始め直せる", async () => {
  const store = postedStore();
  const reviews: { headSha: string }[] = [];
  await checkWatched(
    fakeApi(
      async () =>
        activity({ headSha: "sha2", approvals: [approval("bob", "2026-10-06T00:05:00Z")] }),
      reviews,
    ),
    store,
    T0 + INTERVAL,
    INTERVAL,
  );

  expect(reviews).toEqual([]);
  expect(store.get(SUMMARY).watch).toEqual({
    status: "approved",
    checkedAt: new Date(T0 + INTERVAL).toISOString(),
    note: "bob が承認しました。",
    startedAt: STARTED_AT,
  });
  expect(postedLabel(store.get(SUMMARY))).toBe("投稿済み・他の人が承認");
  expect(isDue(store.get(SUMMARY), T0 + 999 * MINUTE, INTERVAL)).toBe(false);
  // 一覧では返信待ちの後、見守りなしの前に並ぶ
  expect(postedElsewhere([], store.all())).toHaveLength(1);

  startWatching(store, SUMMARY, T0 + 2 * INTERVAL);
  expect(store.get(SUMMARY).watch?.status).toBe("waiting");
  expect(store.get(SUMMARY).watch?.startedAt).toBe(new Date(T0 + 2 * INTERVAL).toISOString());
});
