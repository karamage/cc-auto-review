import { expect, test } from "bun:test";
import type { AnchoredFinding, PRSummary, ReviewStreamEvent } from "../../shared/types.ts";
import type { ApiClient, ReviewOptions } from "../api.ts";
import { setStatus } from "./draft.ts";
import {
  createSessionStore,
  pendingReviews,
  runReview,
  runReviews,
  sessionBadge,
  type SessionStorage,
  watchReviewOutcomes,
} from "./sessions.ts";

const pr = { repo: "o/r", number: 1 };

function finding(id: string): AnchoredFinding {
  return {
    finding: {
      id,
      path: "a.ts",
      line: 1,
      severity: "should",
      title: "題",
      body: "本文",
      trigger: "",
      impact: "",
    },
    anchor: "line",
    reason: null,
  };
}

function memoryStorage(initial: string | null = null): SessionStorage & { data: string | null } {
  const storage = {
    data: initial,
    load: () => storage.data,
    save: (data: string) => {
      storage.data = data;
    },
  };
  return storage;
}

function fakeApi(events: ReviewStreamEvent[]): ApiClient {
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
    fetchActivity: () => Promise.reject(new Error("unused")),
    fetchDigest: () => Promise.reject(new Error("unused")),
    streamChat: () => Promise.reject(new Error("unused")),
    async streamReview(_pr, _sha, _options, onEvent) {
      for (const event of events) onEvent(event);
    },
  };
}

test("AI レビューの結果と下書きはストアに残り、別のストアから読み直せる", async () => {
  const storage = memoryStorage();
  const store = createSessionStore(storage);
  await runReview(
    fakeApi([{ type: "findings", findings: [finding("f1")], priorChecks: [] }]),
    store,
    pr,
    "sha1",
  );
  store.update(pr, (s) => ({ ...s, draft: setStatus(s.draft, "f1", "accepted") }));

  const reopened = createSessionStore(storage);
  const session = reopened.get(pr);
  expect(session.phase).toBe("done");
  expect(session.headSha).toBe("sha1");
  expect(session.draft.items[0]?.status).toBe("accepted");
  expect(sessionBadge(session)).toEqual({ kind: "saved", findings: 1, accepted: 1 });
});

test("PR ごとに選んだモデル・範囲・指示でレビューを依頼し、保存先にも残る", async () => {
  const storage = memoryStorage();
  const store = createSessionStore(storage);
  const other = { repo: "o/r", number: 2 };
  const sent = new Map<number, ReviewOptions>();
  const api: ApiClient = {
    ...fakeApi([]),
    async streamReview(target, _sha, options, onEvent) {
      sent.set(target.number, options);
      onEvent({ type: "findings", findings: [], priorChecks: [] });
    },
  };
  store.update(pr, (s) => ({ ...s, model: "opus", profileId: "security", instructions: "権限" }));

  await runReview(api, store, pr, "sha1");
  await runReview(api, store, other, "sha2");

  expect(sent.get(1)).toEqual({ instructions: "権限", model: "opus", profileId: "security" });
  expect(sent.get(2)).toEqual({ instructions: "", model: "default", profileId: null });
  expect(createSessionStore(storage).get(pr).model).toBe("opus");
  expect(createSessionStore(storage).get(pr).profileId).toBe("security");
});

test("モデルの項目が無い保存データは、設定の既定のモデルを使う扱いで読む", () => {
  const storage = memoryStorage();
  storage.save(JSON.stringify({ "o/r#1": { phase: "idle", instructions: "" } }));
  expect(createSessionStore(storage).get(pr).model).toBe("default");
});

test("消去すると保存先からも消える", async () => {
  const storage = memoryStorage();
  const store = createSessionStore(storage);
  await runReview(
    fakeApi([{ type: "findings", findings: [], priorChecks: [] }]),
    store,
    pr,
    "sha1",
  );
  store.clear(pr);
  expect(store.get(pr).reviewedAt).toBeNull();
  expect(createSessionStore(storage).all()).toEqual({});
});

test("結果が来ないまま接続が切れたら失敗にする", async () => {
  const store = createSessionStore();
  await runReview(fakeApi([{ type: "reviewing", message: "…" }]), store, pr, "sha1");
  expect(store.get(pr).phase).toBe("failed");
  expect(sessionBadge(store.get(pr))).toBeNull();
});

test("実行中に消去されたら、あとから届いた結果は捨てる", async () => {
  const store = createSessionStore();
  const api: ApiClient = {
    ...fakeApi([]),
    async streamReview(_pr, _sha, _options, onEvent) {
      store.clear(pr);
      onEvent({ type: "findings", findings: [finding("f1")], priorChecks: [] });
    },
  };
  await runReview(api, store, pr, "sha1");
  expect(store.all()).toEqual({});
});

test("実行中のまま保存されたものは、読み込み時に中断として扱う", () => {
  const store = createSessionStore(memoryStorage());
  store.update(pr, (s) => ({ ...s, phase: "running" }));
  const storage = memoryStorage(JSON.stringify(store.all()));
  const session = createSessionStore(storage).get(pr);
  expect(session.phase).toBe("failed");
  expect(session.error?.message).toContain("中断");
});

test("壊れた保存データは無視して空から始める", () => {
  expect(createSessionStore(memoryStorage("{")).all()).toEqual({});
});

const summary = (number: number, headSha: string): PRSummary => ({
  repo: "o/r",
  number,
  title: "t",
  author: "a",
  headRefName: "h",
  baseRefName: "main",
  headSha,
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  updatedAt: "2026-10-05T00:00:00Z",
  url: `https://github.com/o/r/pull/${number}`,
});

test("まとめて実行する対象から、実行中のものと最新の head の結果を持つものを外す", async () => {
  const store = createSessionStore();
  const api = fakeApi([{ type: "findings", findings: [], priorChecks: [] }]);
  await runReview(api, store, { repo: "o/r", number: 1 }, "sha1");
  await runReview(api, store, { repo: "o/r", number: 2 }, "old");
  store.update({ repo: "o/r", number: 3 }, (s) => ({ ...s, phase: "running" }));
  store.update({ repo: "o/r", number: 4 }, (s) => ({ ...s, phase: "failed" }));

  const prs = [1, 2, 3, 4, 5].map((n) => summary(n, n === 1 ? "sha1" : `sha${n}`));
  // 1: 最新の結果あり 2: 古い head の結果 3: 実行中 4: 失敗 5: 未実行
  expect(pendingReviews(prs, store.all()).map((pr) => pr.number)).toEqual([2, 4, 5]);
});

test("まとめて実行すると、同時に走らせる数を超えた分は順番待ちとして一覧に出る", async () => {
  const store = createSessionStore();
  const releases: (() => void)[] = [];
  const started: number[] = [];
  const api: ApiClient = {
    ...fakeApi([]),
    async streamReview(pr, _sha, _options, onEvent) {
      started.push(pr.number);
      await new Promise<void>((resolve) => releases.push(resolve));
      onEvent({ type: "findings", findings: [], priorChecks: [] });
    },
  };

  const done = runReviews(api, store, [summary(1, "a"), summary(2, "b"), summary(3, "c")], 2);
  await Promise.resolve();
  expect(started).toEqual([1, 2]);
  expect(sessionBadge(store.get({ repo: "o/r", number: 3 }))).toEqual({ kind: "queued" });

  releases.shift()?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(started).toEqual([1, 2, 3]);

  for (const release of releases.splice(0)) release();
  await done;
  expect([1, 2, 3].map((number) => store.get({ repo: "o/r", number }).headSha)).toEqual([
    "a",
    "b",
    "c",
  ]);
});

test("順番待ちの間に消されたら、その PR は走らせない", async () => {
  const store = createSessionStore();
  const started: number[] = [];
  const api: ApiClient = {
    ...fakeApi([]),
    async streamReview(pr, _sha, _options, onEvent) {
      started.push(pr.number);
      await Promise.resolve();
      onEvent({ type: "findings", findings: [], priorChecks: [] });
    },
  };

  const done = runReviews(api, store, [summary(1, "a"), summary(2, "b")], 1);
  store.clear({ repo: "o/r", number: 2 });
  await done;
  expect(started).toEqual([1]);
  expect(store.get({ repo: "o/r", number: 2 }).phase).toBe("idle");
});

test("AI レビューが完了か失敗したら、PR ごとに 1 回だけ知らせる", async () => {
  const store = createSessionStore();
  const outcomes: string[] = [];
  watchReviewOutcomes(store, (target, session) =>
    outcomes.push(`${target.repo}#${target.number}:${session.phase}`),
  );

  await runReview(
    fakeApi([{ type: "findings", findings: [finding("f1")], priorChecks: [] }]),
    store,
    pr,
    "sha1",
  );
  // 結果が出たあとの下書きの編集では知らせない
  store.update(pr, (s) => ({ ...s, draft: setStatus(s.draft, "f1", "accepted") }));
  await runReview(
    fakeApi([{ type: "error", message: "boom", raw: null }]),
    store,
    { repo: "o/r", number: 2 },
    "sha2",
  );
  expect(outcomes).toEqual(["o/r#1:done", "o/r#2:failed"]);
});

test("完全自動運転の回と、実行中に消された回は知らせない", async () => {
  const store = createSessionStore();
  const outcomes: number[] = [];
  watchReviewOutcomes(store, (target) => outcomes.push(target.number));

  store.update(pr, (s) => ({
    ...s,
    autopilot: {
      status: "reviewing",
      pr: summary(1, "a"),
      headSha: "a",
      rounds: 0,
      note: null,
      updatedAt: new Date(0).toISOString(),
    },
  }));
  await runReview(fakeApi([{ type: "findings", findings: [], priorChecks: [] }]), store, pr, "a");

  const other = { repo: "o/r", number: 2 };
  store.update(other, (s) => ({ ...s, phase: "running" }));
  store.clear(other);
  expect(outcomes).toEqual([]);
});
