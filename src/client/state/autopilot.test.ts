import { expect, test } from "bun:test";
import type { RiskAssessment } from "../../shared/risk.ts";
import { defaultSettings } from "../../shared/settings.ts";
import { SKIP_REVIEW_CODE } from "../../shared/types.ts";
import { setSettings } from "../settings.ts";
import type {
  AnchoredFinding,
  PRActivity,
  PRDigest,
  PriorFindingCheck,
  PRSummary,
  ReviewStreamEvent,
  Severity,
  SubmitRequest,
} from "../../shared/types.ts";
import { type ApiClient, ApiError, type ReviewOptions } from "../api.ts";
import { countBands, recentMoves } from "../components/AutopilotConsole.tsx";
import {
  autopilotCandidates,
  commentBody,
  createAutopilotStore,
  decideAutopilot,
  pollAutopilot,
  allowAutoJudge,
  releaseFromAutopilot,
  settleAutopilot,
  takeOverRereview,
} from "./autopilot.ts";
import { initDraft } from "./draft.ts";
import { createSessionStore, emptySession, type ReviewSession } from "./sessions.ts";
import { checkWatched, recordPosted } from "./watch.ts";

const PR: PRSummary = {
  repo: "o/r",
  number: 7,
  title: "Fix login",
  author: "alice",
  headRefName: "fix",
  baseRefName: "main",
  headSha: "sha1",
  additions: 3,
  deletions: 1,
  changedFiles: 1,
  updatedAt: "2026-10-20T00:00:00Z",
  url: "https://github.com/o/r/pull/7",
};
const MAX_ROUNDS = defaultSettings().autopilot.maxRounds;
const T0 = Date.parse("2026-10-20T01:00:00Z");
const LOW: RiskAssessment = { level: "low", reasons: ["文言だけ"] };

function finding(severity: Severity, id = severity): AnchoredFinding {
  return {
    finding: {
      id,
      path: "src/a.ts",
      line: 2,
      severity,
      title: `${severity} の指摘`,
      body: "本文",
      trigger: "",
      impact: "",
    },
    anchor: "line",
    reason: null,
  };
}

function reviewed(change: Partial<ReviewSession> = {}): ReviewSession {
  return {
    ...emptySession("ja"),
    phase: "done",
    headSha: "sha1",
    reviewedAt: new Date(T0).toISOString(),
    risk: LOW,
    ...change,
  };
}

function prior(status: "fixed" | "unfixed" | "unverified") {
  return {
    status,
    evidence: "",
    comment: {
      id: 99,
      author: "bob",
      body: "null を弾いてください",
      path: "src/a.ts",
      line: 1,
      side: "RIGHT" as const,
      createdAt: "2026-10-19T00:00:00Z",
      url: "https://github.com/o/r/pull/7#discussion_r99",
    },
  };
}

test("指摘も迷う材料も無ければ承認する。nit だけなら指摘が無いのと同じ", () => {
  expect(decideAutopilot(reviewed(), 0)).toEqual({ kind: "approve" });
  expect(decideAutopilot(reviewed({ draft: initDraft([finding("nit")], "ja") }), 0)).toEqual({
    kind: "approve",
  });
});

test("nit 以外の指摘があればコメントする。nit はコメントに含めない", () => {
  const decision = decideAutopilot(
    reviewed({ draft: initDraft([finding("should"), finding("nit")], "ja") }),
    0,
  );
  expect(decision.kind).toBe("comment");
  if (decision.kind !== "comment") return;
  expect(decision.items.map((i) => i.anchored.finding.severity)).toEqual(["should"]);
});

test("リスクが高い変更は、指摘が無くても人に回す", () => {
  const decision = decideAutopilot(
    reviewed({ risk: { level: "high", reasons: ["CI の設定を変えている"] } }),
    0,
  );
  expect(decision).toEqual({ kind: "human", reasons: ["CI の設定を変えている"] });
});

test("リスクの点数が閾値を超えたら人に回す。自動判断のラベルがあれば回さない", () => {
  const riskScore = {
    score: 64,
    baseline: 52,
    level: "HIGH" as const,
    threshold: 50,
    needsHuman: true,
    factors: [
      {
        key: "sensitive" as const,
        label: "影響の大きい領域",
        points: 20,
        max: 40,
        reasons: ["認証"],
      },
    ],
    findings: [],
    adjustments: [],
    hotspots: [],
    semantic: null,
  };
  const decision = decideAutopilot(reviewed({ riskScore }), 0);
  expect(decision.kind).toBe("human");
  expect(decision.kind === "human" ? decision.reasons[0] : "").toContain("64/100");
  expect(decideAutopilot(reviewed({ riskScore, autoJudge: true }), 0).kind).toBe("approve");
  expect(
    decideAutopilot(reviewed({ riskScore: { ...riskScore, score: 50, needsHuman: false } }), 0)
      .kind,
  ).toBe("approve");
});

test("リスクを判定していない結果や、失敗した AI レビューでは投稿しない", () => {
  expect(decideAutopilot(reviewed({ risk: null }), 0).kind).toBe("human");
  expect(
    decideAutopilot(reviewed({ phase: "failed", error: { message: "時間切れ", raw: null } }), 0),
  ).toEqual({ kind: "human", reasons: ["AI レビューに失敗した（時間切れ）"] });
});

test("上限の回数までコメントしても指摘が残るなら人に回す。指摘が無くなれば承認する", () => {
  const withFinding = reviewed({ draft: initDraft([finding("should")], "ja") });
  expect(decideAutopilot(withFinding, MAX_ROUNDS - 1).kind).toBe("comment");
  expect(decideAutopilot(withFinding, MAX_ROUNDS).kind).toBe("human");
  expect(decideAutopilot(reviewed(), MAX_ROUNDS).kind).toBe("approve");
});

test("過去の指摘が直っていないだけなら、同じ指摘を投稿せずに待つ", () => {
  expect(decideAutopilot(reviewed({ priorChecks: [prior("unfixed")] }), 0)).toEqual({
    kind: "hold",
    unfixed: [prior("unfixed")],
    unverified: [],
  });
  // 回数の上限に達していても、投稿しないので人には回さない
  expect(decideAutopilot(reviewed({ priorChecks: [prior("unfixed")] }), MAX_ROUNDS).kind).toBe(
    "hold",
  );
  // 新しい指摘があれば、そのコメントの本文で直っていない指摘にも触れる
  expect(
    decideAutopilot(
      reviewed({ draft: initDraft([finding("should")], "ja"), priorChecks: [prior("unfixed")] }),
      0,
    ).kind,
  ).toBe("comment");
  expect(decideAutopilot(reviewed({ priorChecks: [prior("fixed")] }), 0).kind).toBe("approve");
});

test("過去の指摘が直ったか確かめられなければ、人に回さず、承認を保留する理由をコメントする。一度伝えたら重ねない", () => {
  expect(decideAutopilot(reviewed({ priorChecks: [prior("unverified")] }), 0)).toEqual({
    kind: "comment",
    items: [],
    unfixed: [],
    unverified: [prior("unverified")],
  });
  // 同じ指摘について保留の理由をもう伝えていれば、投稿せずに待つ
  const told = reviewed({
    priorChecks: [prior("unverified")],
    autopilot: {
      status: "reviewing",
      pr: PR,
      headSha: "sha1",
      rounds: 1,
      note: null,
      updatedAt: "",
      withheld: [99],
    },
  });
  expect(decideAutopilot(told, 1)).toEqual({
    kind: "hold",
    unfixed: [],
    unverified: [prior("unverified")],
  });
  // 上限の回数までやり取りしていれば、人に回す
  expect(decideAutopilot(reviewed({ priorChecks: [prior("unverified")] }), MAX_ROUNDS).kind).toBe(
    "human",
  );
});

test("承認を保留する理由だけを伝えるときは、保留の知らせとして書き、確かめられなかった指摘へのリンクを添える", () => {
  const decision = decideAutopilot(reviewed({ priorChecks: [prior("unverified")] }), 0);
  if (decision.kind !== "comment") throw new Error("comment のはず");
  const body = commentBody(decision, "ja");
  expect(body.split("\n")[0]).toContain("承認はいったん保留");
  expect(body).toContain("確かめられませんでした");
  expect(body).toContain("https://github.com/o/r/pull/7#discussion_r99");
});

test("skip-ai-review ラベルで見送った結果では、何もしない", () => {
  expect(decideAutopilot(reviewed({ skipped: true, risk: null }), 0)).toEqual({ kind: "skip" });
});

test("自動判断のラベルが付いていれば、リスクや確かめきれない過去の指摘があっても人に回さない", () => {
  const high = { level: "high" as const, reasons: ["CI の設定を変えている"] };
  expect(decideAutopilot(reviewed({ risk: high, autoJudge: true }), 0)).toEqual({
    kind: "approve",
  });
  expect(
    decideAutopilot(reviewed({ priorChecks: [prior("unverified")], autoJudge: true }), 0).kind,
  ).toBe("approve");
  const withFinding = reviewed({ risk: high, draft: initDraft([finding("should")], "ja") });
  expect(decideAutopilot({ ...withFinding, autoJudge: true }, MAX_ROUNDS).kind).toBe("comment");
  // AI レビューに失敗したときは、任されていても投稿できないので人に回す
  expect(
    decideAutopilot(
      reviewed({ phase: "failed", error: { message: "", raw: null }, autoJudge: true }),
      0,
    ).kind,
  ).toBe("human");
});

test("コメントの本文は件数から始め、直っていない過去の指摘へのリンクを添える", () => {
  const decision = decideAutopilot(
    reviewed({ draft: initDraft([finding("should")], "ja"), priorChecks: [prior("unfixed")] }),
    0,
  );
  if (decision.kind !== "comment") throw new Error("comment のはず");
  const body = commentBody(decision, "ja");
  expect(body.split("\n")[0]).toContain("1 件");
  expect(body).toContain("https://github.com/o/r/pull/7#discussion_r99");
  expect(commentBody(decision, "en").split("\n")[0]).toContain("1 point");
});

/** 一覧と AI レビューの結果と投稿を、決めた値で返す偽の API */
function fakeApi(result: {
  prs?: PRSummary[];
  findings?: AnchoredFinding[];
  risk?: RiskAssessment | null;
  descriptionLang?: "ja" | "en" | null;
  activity?: PRActivity;
  submitError?: Error;
  autoJudge?: boolean;
  priorChecks?: PriorFindingCheck[];
  skipped?: boolean;
  /** AI レビューの回が返す変更の中身の要約 */
  digest?: string;
  /** fetchDigest が返す、いまの head と中身の要約 */
  current?: PRDigest;
}) {
  const submitted: SubmitRequest[] = [];
  const activitySince: string[] = [];
  const reviews: { headSha: string; options: ReviewOptions }[] = [];
  const labeled: number[] = [];
  const api: ApiClient = {
    fetchPRs: async () => ({ prs: result.prs ?? [PR], reviewed: [] }),
    fetchPRDetail: () => Promise.reject(new Error("unused")),
    async submitReview(_pr, req) {
      if (result.submitError !== undefined) throw result.submitError;
      submitted.push(req);
      return {
        url: "https://github.com/o/r/pull/7#pullrequestreview-1",
        submittedAt: "2026-01-01T00:00:00Z",
      };
    },
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
    async markAutoJudge(pr) {
      labeled.push(pr.number);
      result.autoJudge = true;
    },
    async fetchActivity(_pr, since) {
      activitySince.push(since);
      return result.activity ?? { state: "OPEN", headSha: "sha1", replies: [], approvals: [] };
    },
    async fetchDigest() {
      if (result.current === undefined) throw new Error("unused");
      return result.current;
    },
    streamChat: () => Promise.reject(new Error("unused")),
    async streamReview(_pr, headSha, options, onEvent: (e: ReviewStreamEvent) => void) {
      reviews.push({ headSha, options });
      onEvent({
        type: "findings",
        findings: result.findings ?? [],
        priorChecks: result.priorChecks ?? [],
        risk: result.risk === undefined ? LOW : result.risk,
        descriptionLang: result.descriptionLang ?? null,
        autoJudge: result.autoJudge ?? false,
        ...(result.skipped === undefined ? {} : { skipped: result.skipped }),
        ...(result.digest === undefined ? {} : { digest: result.digest }),
      });
    },
  };
  return { api, submitted, reviews, labeled, activitySince };
}

async function runOnce(api: ApiClient, notify = (_pr: PRSummary, _reasons: string[]) => {}) {
  const store = createSessionStore();
  await pollAutopilot(api, store, createAutopilotStore(), Date.now());
  await settleAutopilot(api, store, notify);
  return store;
}

test("一覧の PR をリスクの判定付きで AI レビューし、指摘が無ければ承認する", async () => {
  const { api, submitted, reviews } = fakeApi({ descriptionLang: "en" });
  const store = await runOnce(api);

  expect(reviews).toHaveLength(1);
  // モデルとプロファイルは、サーバが自動運転の設定から選ぶ
  expect(reviews[0]?.options.profileId).toBeNull();
  expect(reviews[0]?.options.assessRisk).toBe(true);
  expect(submitted).toHaveLength(1);
  expect(submitted[0]).toMatchObject({
    event: "APPROVE",
    lgtm: "none",
    language: "en",
    sourceLanguage: "en",
    commitId: "sha1",
  });
  expect(submitted[0]?.body).toContain("Haiku");
  const session = store.get(PR);
  expect(session.autopilot?.status).toBe("approved");
  expect(session.posted?.event).toBe("APPROVE");
  expect(session.watch).toBeNull();
});

test("説明文が英語の PR には、日本語で書いた指摘を英語に訳させてコメントし、見守りを始める", async () => {
  const { api, submitted } = fakeApi({
    findings: [finding("should"), finding("nit")],
    descriptionLang: "en",
  });
  const store = await runOnce(api);

  expect(submitted[0]).toMatchObject({
    event: "COMMENT",
    language: "en",
    sourceLanguage: "ja",
    lgtm: "none",
  });
  expect(submitted[0]?.comments.map((c) => c.findingId)).toEqual(["should"]);
  const session = store.get(PR);
  expect(session.autopilot).toMatchObject({ status: "commented", rounds: 1 });
  expect(session.watch?.status).toBe("waiting");
  // 投稿した指摘はレビュー画面でも採用済みに見える
  expect(session.draft.items.find((i) => i.anchored.finding.id === "should")?.status).toBe(
    "accepted",
  );
});

test("過去の指摘が直ったか確かめられなければ、保留の理由をコメントして見守り、人には回さない", async () => {
  const { api, submitted } = fakeApi({ priorChecks: [prior("unverified")] });
  const notified: string[][] = [];
  const store = await runOnce(api, (_pr, reasons) => notified.push(reasons));

  expect(notified).toHaveLength(0);
  expect(submitted).toHaveLength(1);
  expect(submitted[0]).toMatchObject({ event: "COMMENT", comments: [] });
  expect(submitted[0]?.body).toContain("https://github.com/o/r/pull/7#discussion_r99");
  const session = store.get(PR);
  expect(session.autopilot).toMatchObject({ status: "commented", rounds: 1, withheld: [99] });
  expect(session.watch?.status).toBe("waiting");

  // 作成者が返信したが、まだ確かめられない。同じ保留の知らせは重ねない
  const second = fakeApi({
    activity: {
      state: "OPEN",
      headSha: "sha1",
      replies: [prior("unverified").comment],
      approvals: [],
    },
    priorChecks: [prior("unverified")],
  });
  await checkWatched(second.api, store, Date.now(), 10 * 60_000, (pr, now) =>
    takeOverRereview(store, pr, now),
  );
  await settleAutopilot(second.api, store);
  expect(second.submitted).toHaveLength(0);
  expect(store.get(PR).autopilot).toMatchObject({ status: "commented", held: true, rounds: 1 });
});

test("リスクが高ければ投稿せずに人に回し、通知する", async () => {
  const { api, submitted } = fakeApi({ risk: { level: "high", reasons: ["権限を変えている"] } });
  const notified: string[][] = [];
  const store = await runOnce(api, (_pr, reasons) => notified.push(reasons));

  expect(submitted).toHaveLength(0);
  expect(store.get(PR).autopilot).toMatchObject({ status: "human", note: "権限を変えている" });
  expect(notified).toEqual([["権限を変えている"]]);
});

test("投稿に失敗したら、やり直さずに人に回す", async () => {
  const { api } = fakeApi({ submitError: new Error("PR が更新されています") });
  const store = await runOnce(api);
  expect(store.get(PR).autopilot?.status).toBe("human");
  expect(store.get(PR).autopilot?.note).toContain("PR が更新されています");
});

test("skip-ai-review ラベルが付いた PR は、投稿も通知もせず、計器にも載せない", async () => {
  const { api, submitted } = fakeApi({ skipped: true, risk: null });
  const notified: string[][] = [];
  const store = await runOnce(api, (_pr, reasons) => notified.push(reasons));

  expect(submitted).toHaveLength(0);
  expect(notified).toHaveLength(0);
  expect(store.get(PR).autopilot?.status).toBe("skipped");
  expect(countBands(store.all())).toEqual({ approved: 0, commented: 0, reviewing: 0, human: 0 });
  expect(recentMoves(store.all())).toHaveLength(0);
  // 同じ head では扱い直さない
  expect(autopilotCandidates([PR], store.all())).toHaveLength(0);
});

test("レビューの間に skip-ai-review ラベルが付いて投稿を断られたら、人に回さずに手を引く", async () => {
  const { api } = fakeApi({
    findings: [finding("should")],
    submitError: new ApiError("ラベルが付いた", null, SKIP_REVIEW_CODE),
  });
  const notified: string[][] = [];
  const store = await runOnce(api, (_pr, reasons) => notified.push(reasons));

  expect(store.get(PR).autopilot?.status).toBe("skipped");
  expect(notified).toHaveLength(0);
  expect(store.get(PR).watch).toBeNull();
});

test("扱い終えた PR に新しいコミットが来ても、中身が前回と同じならレビューせず、扱いはそのままにする", async () => {
  const first = fakeApi({ digest: "d1" });
  const store = await runOnce(first.api);
  expect(store.get(PR).autopilot?.status).toBe("approved");
  expect(store.get(PR).digest).toBe("d1");

  // base を取り込んだだけのマージで head が進んだ
  const moved = { ...PR, headSha: "sha2" };
  const second = fakeApi({ prs: [moved], current: { headSha: "sha2", digest: "d1" } });
  await pollAutopilot(second.api, store, createAutopilotStore(), Date.now());
  expect(second.reviews).toHaveLength(0);
  expect(store.get(PR).autopilot).toMatchObject({ status: "approved", headSha: "sha2" });
  expect(autopilotCandidates([moved], store.all())).toHaveLength(0);

  // 中身が変われば扱い直す
  const changed = { ...PR, headSha: "sha3" };
  const third = fakeApi({ prs: [changed], current: { headSha: "sha3", digest: "d2" } });
  await pollAutopilot(third.api, store, createAutopilotStore(), Date.now());
  expect(third.reviews.map((r) => r.headSha)).toEqual(["sha3"]);
});

test("いまの head を扱った PR と、手で AI レビューした結果のある PR は扱わない", () => {
  const store = createSessionStore();
  const other = { ...PR, number: 8 };
  const manual = { ...PR, number: 9 };
  store.update(PR, (s) => ({
    ...s,
    autopilot: { status: "human", pr: PR, headSha: "sha1", rounds: 0, note: null, updatedAt: "" },
  }));
  store.update(manual, () => reviewed());
  expect(autopilotCandidates([PR, other, manual], store.all())).toEqual([other]);
  // push されて head が変われば扱い直す
  expect(autopilotCandidates([{ ...PR, headSha: "sha2" }], store.all())).toHaveLength(1);
});

test("自動運転がコメントした PR に修正が push されたら、見守りが自動運転に回し、次の回を投稿する", async () => {
  const first = fakeApi({ findings: [finding("should")] });
  const store = createSessionStore();
  await pollAutopilot(first.api, store, createAutopilotStore(), Date.now());
  await settleAutopilot(first.api, store);
  expect(store.get(PR).autopilot?.rounds).toBe(1);

  // 作成者が直して push した。今度は指摘が無い
  const second = fakeApi({
    activity: { state: "OPEN", headSha: "sha2", replies: [], approvals: [] },
  });
  await checkWatched(second.api, store, Date.now(), 10 * 60_000, (pr, now) =>
    takeOverRereview(store, pr, now),
  );
  expect(second.reviews[0]).toMatchObject({ headSha: "sha2", options: { assessRisk: true } });
  await settleAutopilot(second.api, store);

  expect(second.submitted[0]).toMatchObject({ event: "APPROVE", commitId: "sha2" });
  expect(store.get(PR).autopilot?.status).toBe("approved");
});

test("再レビューで残ったのが直っていない既存の指摘だけなら、投稿せずに待ち、同じ動きでは再レビューしない", async () => {
  const first = fakeApi({ findings: [finding("should")] });
  const store = createSessionStore();
  await pollAutopilot(first.api, store, createAutopilotStore(), Date.now());
  await settleAutopilot(first.api, store);

  // 作成者が push したが、前回の指摘は直っていない。新しい指摘は無い
  const second = fakeApi({
    activity: { state: "OPEN", headSha: "sha2", replies: [], approvals: [] },
    priorChecks: [prior("unfixed")],
  });
  await checkWatched(second.api, store, Date.now(), 10 * 60_000, (pr, now) =>
    takeOverRereview(store, pr, now),
  );
  const heldAt = Date.parse("2026-10-21T00:00:00Z");
  await settleAutopilot(
    second.api,
    store,
    () => {},
    () => heldAt,
  );

  expect(second.submitted).toHaveLength(0);
  const session = store.get(PR);
  expect(session.autopilot).toMatchObject({ status: "commented", held: true, rounds: 1 });
  expect(session.watch).toMatchObject({
    status: "waiting",
    baseline: { headSha: "sha2", since: new Date(heldAt).toISOString() },
  });

  // 次の確認で head が見送った回と同じなら、何もしない。返信も見送った回より後だけを見る
  const third = fakeApi({
    activity: { state: "OPEN", headSha: "sha2", replies: [], approvals: [] },
  });
  await checkWatched(third.api, store, heldAt + 11 * 60_000, 10 * 60_000, (pr, now) =>
    takeOverRereview(store, pr, now),
  );
  expect(third.reviews).toHaveLength(0);
  expect(third.activitySince).toEqual([new Date(heldAt).toISOString()]);
  expect(store.get(PR).watch?.status).toBe("waiting");

  // さらに直して push されたら、自動運転の回としてやり直す
  const fourth = fakeApi({
    activity: { state: "OPEN", headSha: "sha3", replies: [], approvals: [] },
  });
  await checkWatched(fourth.api, store, heldAt + 22 * 60_000, 10 * 60_000, (pr, now) =>
    takeOverRereview(store, pr, now),
  );
  expect(fourth.reviews[0]).toMatchObject({ headSha: "sha3", options: { assessRisk: true } });
  await settleAutopilot(fourth.api, store);
  expect(fourth.submitted[0]).toMatchObject({ event: "APPROVE", commitId: "sha3" });
});

test("まだ投稿していない PR で、ほかの人の指摘が直っていないだけなら、投稿せずに次の head を待つ", async () => {
  const { api, submitted } = fakeApi({ priorChecks: [prior("unfixed")] });
  const store = await runOnce(api);

  expect(submitted).toHaveLength(0);
  expect(store.get(PR).autopilot).toMatchObject({ status: "commented", held: true, rounds: 0 });
  expect(store.get(PR).watch).toBeNull();
  expect(autopilotCandidates([PR], store.all())).toHaveLength(0);
  expect(autopilotCandidates([{ ...PR, headSha: "sha2" }], store.all())).toHaveLength(1);
});

test("自動運転が引き取らなければ、見守りは従来どおり PR ごとのモデルでやり直すだけ", async () => {
  const store = createSessionStore();
  recordPosted(store, PR, {
    review: { url: null, submittedAt: "2026-10-20T00:00:00Z" },
    headSha: "sha1",
    event: "COMMENT",
    comments: 1,
  });
  store.update(PR, (s) => ({
    ...s,
    watch: { status: "waiting", checkedAt: null, note: null, startedAt: "2026-10-20T00:00:00Z" },
  }));
  const { api, reviews, submitted } = fakeApi({
    activity: { state: "OPEN", headSha: "sha2", replies: [], approvals: [] },
  });
  await checkWatched(api, store, Date.parse("2026-10-20T00:11:00Z"));
  await settleAutopilot(api, store);
  expect(reviews[0]?.options.model).toBe("default");
  expect(reviews[0]?.options.assessRisk).toBeUndefined();
  expect(submitted).toHaveLength(0);
});

test("人が手で投稿したら、自動運転はその PR から手を離す", () => {
  const store = createSessionStore();
  store.update(PR, (s) => ({
    ...s,
    autopilot: { status: "human", pr: PR, headSha: "sha1", rounds: 0, note: "x", updatedAt: "" },
  }));
  recordPosted(store, PR, {
    review: { url: null, submittedAt: "2026-10-20T00:00:00Z" },
    headSha: "sha1",
    event: "COMMENT",
    comments: 1,
  });
  expect(store.get(PR).autopilot).toBeNull();
});

test("オン・オフと確認した時刻は保存し、開き直しても引き継ぐ", () => {
  const storage = {
    data: null as string | null,
    load: () => storage.data,
    save: (d: string) => {
      storage.data = d;
    },
  };
  createAutopilotStore(storage).update({ enabled: true, polledAt: "2026-10-20T00:00:00Z" });
  expect(createAutopilotStore(storage).get()).toMatchObject({
    enabled: true,
    polledAt: "2026-10-20T00:00:00Z",
    list: null,
    busy: false,
  });
});

test("人に回した PR を自動判断に任せると、ラベルを付けて AI レビューをやり直し、人に回さずに承認する", async () => {
  const high = { level: "high" as const, reasons: ["CI の設定を変えている"] };
  const { api, submitted, reviews, labeled } = fakeApi({ risk: high });
  const notified: string[][] = [];
  const store = await runOnce(api, (_pr, reasons) => notified.push(reasons));
  expect(store.get(PR).autopilot?.status).toBe("human");
  expect(submitted).toHaveLength(0);

  await allowAutoJudge(api, store, PR);
  expect(store.get(PR).autopilot?.status).toBe("reviewing");
  await settleAutopilot(api, store);

  expect(labeled).toEqual([7]);
  expect(reviews).toHaveLength(2);
  expect(reviews[1]?.options.assessRisk).toBe(true);
  expect(submitted.map((r) => r.event)).toEqual(["APPROVE"]);
  expect(store.get(PR).autopilot?.status).toBe("approved");
  expect(notified).toHaveLength(1);
});

test("ラベルを付けられなければ、人に回したまま AI レビューもやり直さない", async () => {
  const { api, reviews } = fakeApi({ risk: { level: "high", reasons: ["x"] } });
  const store = await runOnce(api);
  api.markAutoJudge = () => Promise.reject(new Error("403"));

  await expect(allowAutoJudge(api, store, PR)).rejects.toThrow("403");
  expect(store.get(PR).autopilot?.status).toBe("human");
  expect(reviews).toHaveLength(1);
});

test("人に回した PR を自動運転から外すと、新しいコミットが来ても自動運転では AI レビューしない", async () => {
  const { api, submitted } = fakeApi({ risk: { level: "high", reasons: ["x"] } });
  const store = await runOnce(api);
  expect(store.get(PR).autopilot?.status).toBe("human");

  releaseFromAutopilot(store, PR, T0);

  expect(store.get(PR).autopilot).toMatchObject({ status: "released" });
  expect(autopilotCandidates([PR], store.all())).toHaveLength(0);
  expect(autopilotCandidates([{ ...PR, headSha: "sha2" }], store.all())).toHaveLength(0);
  expect(countBands(store.all())).toEqual({ approved: 0, commented: 0, reviewing: 0, human: 0 });
  expect(recentMoves(store.all())).toHaveLength(0);
  expect(submitted).toHaveLength(0);
});

test("人に回していない PR は、自動運転から外さない", async () => {
  const { api } = fakeApi({ risk: LOW });
  const store = await runOnce(api);
  expect(store.get(PR).autopilot?.status).toBe("approved");

  releaseFromAutopilot(store, PR, T0);

  expect(store.get(PR).autopilot?.status).toBe("approved");
});

test("承認を人に任せる設定なら、指摘が無くても承認せず、その旨をコメントする", async () => {
  const settings = defaultSettings();
  settings.autopilot.approve = false;
  setSettings(settings);
  try {
    const { api, submitted } = fakeApi({ descriptionLang: "en" });
    const store = await runOnce(api);
    expect(submitted[0]).toMatchObject({ event: "COMMENT", lgtm: "none" });
    expect(submitted[0]?.body).toContain("Approval is left to a human reviewer");
    expect(store.get(PR).autopilot?.status).toBe("approved");
  } finally {
    setSettings(defaultSettings());
  }
});

test("LGTM 画像を添える設定なら、承認に画像を選ばせる", async () => {
  const settings = defaultSettings();
  settings.autopilot.lgtmImage = true;
  setSettings(settings);
  try {
    const { api, submitted } = fakeApi({ descriptionLang: "en" });
    await runOnce(api);
    expect(submitted[0]).toMatchObject({ event: "APPROVE", lgtm: "random" });
  } finally {
    setSettings(defaultSettings());
  }
});

test("コメントの回数の上限は設定から読む", () => {
  const withFinding = reviewed({ draft: initDraft([finding("should")], "ja") });
  expect(decideAutopilot(withFinding, 1, 1).kind).toBe("human");
  expect(decideAutopilot(withFinding, 1, 5).kind).toBe("comment");
});
