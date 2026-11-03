import { useSyncExternalStore } from "react";
import type { Lang } from "../../shared/i18n.ts";
import type { RiskScore } from "../../shared/risk-score.ts";
import type { AutopilotConfig } from "../../shared/settings.ts";
import {
  type DraftComment,
  type PriorFindingCheck,
  type PRListResponse,
  type PRSummary,
  SKIP_REVIEW_CODE,
  type SubmitRequest,
} from "../../shared/types.ts";
import { type ApiClient, ApiError } from "../api.ts";
import { t } from "../i18n.ts";
import { MESSAGES } from "../messages.ts";
import { getSettings } from "../settings.ts";
import { type DraftItem, type DraftState, setStatus, sourceLanguage } from "./draft.ts";
import {
  type AutopilotState,
  pendingReviews,
  QUEUED,
  type ReviewSession,
  runReviews,
  type SessionStorage,
  type SessionStore,
  type Sessions,
  sessionKey,
} from "./sessions.ts";
import { hasSameContent, recordPosted, startWatching } from "./watch.ts";

/** レビュー依頼の一覧を確認しに行く間隔（ミリ秒）。設定の分から決める */
export function autopilotIntervalMs(config: AutopilotConfig = getSettings().autopilot): number {
  return config.intervalMinutes * 60 * 1000;
}

/** 時期が来たかを見る間隔。スリープ明けにも遅れず動けるよう細かく見る */
const TICK_MS = 60 * 1000;

export interface AutopilotSettings {
  enabled: boolean;
  /** 最後にレビュー依頼の一覧を確認した時刻（ISO 8601）。まだなら null */
  polledAt: string | null;
}

export interface AutopilotView extends AutopilotSettings {
  /** 自動運転が最後に取った一覧。一覧の画面を開き直さなくても新しい依頼が出るようにする */
  list: PRListResponse | null;
  /** 一覧の確認か AI レビューの最中か */
  busy: boolean;
  /** 最後の確認の失敗。成功したら消える */
  error: string | null;
}

export interface AutopilotStore {
  get(): AutopilotView;
  update(change: Partial<AutopilotView>): void;
  subscribe(listener: () => void): () => void;
}

function restoreSettings(data: string | null): AutopilotSettings {
  try {
    const parsed = JSON.parse(data ?? "{}") as Partial<AutopilotSettings>;
    return {
      enabled: parsed.enabled === true,
      polledAt: typeof parsed.polledAt === "string" ? parsed.polledAt : null,
    };
  } catch {
    return { enabled: false, polledAt: null };
  }
}

/** オンかオフかと確認の時刻だけを保存する。一覧と実行中かどうかは開いている間だけ持つ */
export function createAutopilotStore(storage: SessionStorage | null = null): AutopilotStore {
  let view: AutopilotView = {
    ...restoreSettings(storage?.load() ?? null),
    list: null,
    busy: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  return {
    get: () => view,
    update(change) {
      view = { ...view, ...change };
      try {
        storage?.save(JSON.stringify({ enabled: view.enabled, polledAt: view.polledAt }));
      } catch {
        // 保存できなくても、開いている間は手元の状態で動く
      }
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useAutopilot(store: AutopilotStore): AutopilotView {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** 次に一覧を確認しに行く時刻（ミリ秒）。まだ一度も確認していなければ今 */
export function nextPollAt(view: AutopilotSettings, now: number): number {
  return view.polledAt === null ? now : Date.parse(view.polledAt) + autopilotIntervalMs();
}

export type AutopilotDecision =
  | { kind: "approve" }
  | {
      kind: "comment";
      items: DraftItem[];
      unfixed: PriorFindingCheck[];
      /** 直ったか確かめられず、承認を保留する理由としてまだ伝えていない過去の指摘 */
      unverified: PriorFindingCheck[];
    }
  | { kind: "hold"; unfixed: PriorFindingCheck[]; unverified: PriorFindingCheck[] }
  | { kind: "skip" }
  | { kind: "human"; reasons: string[] };

/** 人に回すときに添える、点数の主な理由。エスカレーション、下限、点の大きい要因の順に 3 つまで */
function riskScoreReasons(score: RiskScore): string[] {
  const escalations = (score.semantic?.items ?? [])
    .filter((item) => item.escalation)
    .map((item) => `${item.file}${item.line === "" ? "" : `:${item.line}`} — ${item.reason}`);
  const floors = score.adjustments.filter((a) => a.type === "floor").map((a) => a.reason);
  const factors = [...score.factors]
    .filter((f) => f.points > 0)
    .sort((a, b) => b.points - a.points)
    .map((f) => `${f.label} +${f.points}: ${f.reasons[0] ?? ""}`);
  return [...escalations, ...floors, ...factors].slice(0, 3);
}

/**
 * AI レビューの結果から、自動で承認するか、指摘をコメントするか、人に回すかを決める。
 * rounds はこれまでに指摘をコメントした回数。maxRounds を超えて指摘が残れば人に回す。
 * 迷う材料があれば人に回す。自動で承認してよいのは、リスクが高くなく、指摘も
 * 確かめきれなかった過去の指摘も無いときだけ。
 * 自動判断のラベルが付いた PR は、人が任せると決めたので、AI レビューに失敗したとき以外は人に回さない。
 * 見送りのラベルが付いた PR は、何もしない。
 * 過去の指摘が直ったか確かめられなければ、人に聞かずに、承認を保留する理由をコメントで伝える。
 * 残ったのが既存のコメントで直っていない指摘や、すでに伝えた保留の理由だけなら、
 * 同じ内容を重ねて投稿せず、承認もせずに待つ
 */
export function decideAutopilot(
  session: ReviewSession,
  rounds: number,
  maxRounds: number = getSettings().autopilot.maxRounds,
): AutopilotDecision {
  const text = t().autopilot;
  if (session.phase === "failed") {
    return { kind: "human", reasons: [text.failed(session.error?.message ?? "")] };
  }
  if (session.skipped) return { kind: "skip" };
  const trusted = session.autoJudge;
  // 手で走らせた AI レビューの結果など、リスクを判定していない結果では動かない
  if (session.risk === null && !trusted) return { kind: "human", reasons: [text.noRisk] };
  if (session.risk?.level === "high" && !trusted) {
    return {
      kind: "human",
      reasons: session.risk.reasons.length > 0 ? session.risk.reasons : [text.highRisk],
    };
  }
  // リスクの点数が閾値を超えた変更と、AI が重大な仕組みを見つけた変更は人に回す
  const score = session.riskScore;
  if (score?.needsHuman === true && !trusted) {
    return {
      kind: "human",
      reasons: [text.highRiskScore(score.score, score.threshold), ...riskScoreReasons(score)],
    };
  }

  const items = session.draft.items.filter((item) => item.anchored.finding.severity !== "nit");
  const unfixed = session.priorChecks.filter((check) => check.status === "unfixed");
  // 人が出した過去の指摘が直ったか確かめられないまま、承認はしない。
  // 理由は作成者に伝えるが、一度伝えた指摘について同じことを重ねて書かない
  const told = new Set(session.autopilot?.withheld ?? []);
  const unverified = trusted
    ? []
    : session.priorChecks.filter((check) => check.status === "unverified");
  const untold = unverified.filter((check) => !told.has(check.comment.id));
  // 既存のコメントへのリンクを並べただけの投稿は、作成者には同じ指摘の繰り返しになる。
  // 新しく伝えることがあるときだけ、その本文で触れる
  if (items.length > 0 || untold.length > 0) {
    if (rounds >= maxRounds && !trusted) {
      return { kind: "human", reasons: [text.tooManyRounds(rounds)] };
    }
    return { kind: "comment", items, unfixed, unverified: untold };
  }
  if (unfixed.length > 0 || unverified.length > 0) return { kind: "hold", unfixed, unverified };
  return { kind: "approve" };
}

/**
 * 指摘をコメントするときのレビュー本文。指摘を書いた言語で書き、
 * 投稿する言語が違えばサーバが訳す。件数を先頭に書く
 */
export function commentBody(
  decision: Extract<AutopilotDecision, { kind: "comment" }>,
  lang: Lang,
): string {
  const text = MESSAGES[lang].autopilot;
  // 伝えるのが承認を保留する理由だけなら、指摘ではなく保留の知らせとして書く
  const withholdOnly = decision.items.length === 0;
  const lines = [
    withholdOnly ? text.withholdHeadline : text.commentHeadline(decision.items.length),
  ];
  if (decision.unfixed.length > 0) {
    lines.push(
      "",
      text.unfixedHeading(decision.unfixed.length),
      ...decision.unfixed.map(
        (check) => `- ${check.comment.url === "" ? `#${check.comment.id}` : check.comment.url}`,
      ),
    );
  }
  if (decision.unverified.length > 0) {
    lines.push(
      "",
      text.unverifiedHeading(decision.unverified.length),
      ...decision.unverified.map(
        (check) => `- ${check.comment.url === "" ? `#${check.comment.id}` : check.comment.url}`,
      ),
    );
  }
  return lines.join("\n");
}

function toComments(items: DraftItem[]): DraftComment[] {
  return items.map((item) => ({
    findingId: item.anchored.finding.id,
    path: item.anchored.finding.path,
    line: item.anchored.finding.line,
    body: item.body,
    anchor: item.anchored.anchor,
  }));
}

/** 自動運転が人に回した PR を知らせる。ブラウザの通知など、画面に依存するので外から渡す */
export type HumanNotifier = (pr: PRSummary, reasons: string[]) => void;

/**
 * 自動運転で AI レビューを待っていた PR のうち、結果が出たものを承認・コメント・人に回す。
 * 1 件ずつ投稿する
 */
export async function settleAutopilot(
  api: ApiClient,
  store: SessionStore,
  notify: HumanNotifier = () => {},
  now: () => number = Date.now,
): Promise<void> {
  const ready = Object.values(store.all()).filter(
    (s) => s.autopilot?.status === "reviewing" && (s.phase === "done" || s.phase === "failed"),
  );
  for (const session of ready) {
    const auto = session.autopilot as AutopilotState;
    // eslint-disable-next-line no-await-in-loop -- 投稿は 1 件ずつ。GitHub をまとめて叩かない
    await settleOne(api, store, session, auto, notify, now);
  }
}

async function settleOne(
  api: ApiClient,
  store: SessionStore,
  session: ReviewSession,
  auto: AutopilotState,
  notify: HumanNotifier,
  now: () => number,
): Promise<void> {
  const text = t().autopilot;
  const headSha = session.headSha ?? auto.pr.headSha;
  const pr: PRSummary = { ...auto.pr, headSha };
  // 投稿を記録すると自動運転の状態は外れるので、扱い始めたときの状態から書き直す
  const finish = (change: Partial<AutopilotState>): void => {
    store.update(pr, (s) => ({
      ...s,
      autopilot: {
        ...(s.autopilot ?? auto),
        pr,
        headSha,
        updatedAt: new Date(now()).toISOString(),
        ...change,
      },
    }));
  };
  const handOver = (reasons: string[]): void => {
    finish({ status: "human", note: reasons.join("\n") });
    notify(pr, reasons);
  };

  // 自動運転に回す前の結果が残っているだけなら、それでは動かない
  if (
    session.phase === "done" &&
    (session.reviewedAt === null || Date.parse(session.reviewedAt) < Date.parse(auto.updatedAt))
  ) {
    handOver([t().session.interrupted]);
    return;
  }

  const config = getSettings().autopilot;
  const decision = decideAutopilot(session, auto.rounds, config.maxRounds);
  if (decision.kind === "human") {
    handOver(decision.reasons);
    return;
  }
  if (decision.kind === "skip") {
    // 人に回すものでもないので、通知もしない
    finish({ status: "skipped", held: false, note: text.skippedNote(config.skipLabel) });
    return;
  }
  if (decision.kind === "hold") {
    // 投稿も承認もしない。回数も数えない。作成者が直すか返信したら、見守りが AI レビューをやり直す。
    // 見守りは、この回より後の動きだけを見る。同じ動きで再レビューを繰り返さないため。
    // まだ投稿していない PR（ほかの人の指摘が残っているだけ）は、新しい head が来たら一覧の側で扱う
    finish({
      status: "commented",
      held: true,
      note: text.heldNote(decision.unfixed.length + decision.unverified.length),
    });
    startWatching(store, pr, now(), { headSha, since: new Date(now()).toISOString() });
    return;
  }

  const source = sourceLanguage(session.draft);
  // PR の説明文が英語なら英語で、日本語なら日本語で返す。読み取れなければ指摘を書いた言語のまま
  const target = session.descriptionLang ?? source;
  // 承認を人に任せる設定なら、指摘が無かったことをコメントするだけにする
  const request: SubmitRequest =
    decision.kind === "approve"
      ? {
          event: config.approve ? "APPROVE" : "COMMENT",
          body: config.approve
            ? MESSAGES[target].autopilot.approveBody(config.model)
            : MESSAGES[target].autopilot.cleanCommentBody(config.model),
          comments: [],
          language: target,
          sourceLanguage: target,
          lgtm: config.approve && config.lgtmImage ? "random" : "none",
          commitId: headSha,
          autopilot: true,
        }
      : {
          event: "COMMENT",
          body: commentBody(decision, source),
          comments: toComments(decision.items),
          language: target,
          sourceLanguage: source,
          lgtm: "none",
          commitId: headSha,
          autopilot: true,
        };

  try {
    const review = await api.submitReview(pr, request);
    recordPosted(store, pr, {
      review,
      headSha,
      event: request.event,
      comments: request.comments.length,
    });
  } catch (e: unknown) {
    // レビューの間に見送りのラベルが付いたなら、投稿せずに手を引く
    if (e instanceof ApiError && e.code === SKIP_REVIEW_CODE) {
      finish({ status: "skipped", held: false, note: text.skippedNote(config.skipLabel) });
      return;
    }
    // 投稿の直前に push されていた場合なども、自動ではやり直さず人に回す
    handOver([text.submitFailed(e instanceof Error ? e.message : String(e))]);
    return;
  }

  if (decision.kind === "approve") {
    finish({
      status: "approved",
      held: false,
      note: config.approve ? text.approvedNote : text.cleanNote,
    });
    return;
  }

  // 投稿した指摘を、レビュー画面でも採用済みとして見えるようにする
  store.update(pr, (s) => ({
    ...s,
    draft: decision.items.reduce<DraftState>(
      (draft, item) => setStatus(draft, item.anchored.finding.id, "accepted"),
      { ...s.draft, event: "COMMENT", summary: request.body },
    ),
  }));
  const rounds = auto.rounds + 1;
  finish({
    status: "commented",
    held: false,
    rounds,
    // 保留の理由を伝えた指摘を覚えておき、次の回で同じことを重ねて書かない
    withheld: [
      ...new Set([
        ...(auto.withheld ?? []),
        ...decision.unverified.map((check) => check.comment.id),
      ]),
    ],
    note:
      request.comments.length === 0
        ? text.withheldNote(decision.unverified.length, rounds)
        : text.commentedNote(request.comments.length, rounds),
  });
  // 作成者の反応を待つ。修正か返信があれば、見守りが AI レビューをやり直す
  startWatching(store, pr, now());
}

/**
 * 一覧のうち、自動運転で AI レビューする PR。
 * いまの head をすでに扱ったもの、実行中のもの、手で AI レビューして結果を持っているもの
 * （人が下書きを確かめている途中かもしれない）、人が自動運転から外したものは外す
 */
export function autopilotCandidates(prs: readonly PRSummary[], sessions: Sessions): PRSummary[] {
  return pendingReviews(prs, sessions).filter((pr) => {
    const auto = sessions[sessionKey(pr)]?.autopilot;
    return auto?.status !== "released" && auto?.headSha !== pr.headSha;
  });
}

/**
 * 自動運転が扱い終えた PR に新しいコミットが来ても、前回レビューした中身から変わっていなければ、
 * 扱いはそのままにして head だけを進め、true を返す。関係する変更が無いのに AI レビューをやり直さない
 */
async function unchangedSinceSettled(
  api: ApiClient,
  store: SessionStore,
  pr: PRSummary,
): Promise<boolean> {
  const session = store.get(pr);
  const auto = session.autopilot;
  if (auto === null || auto.status === "reviewing") return false;
  if (!(await hasSameContent(api, pr, pr.headSha, session.digest))) return false;
  store.update(pr, (s) =>
    s.autopilot === null ? s : { ...s, autopilot: { ...s.autopilot, pr, headSha: pr.headSha } },
  );
  return true;
}

/** レビュー依頼の一覧を取り、まだ扱っていない PR を自動運転のモデルで AI レビューする */
export async function pollAutopilot(
  api: ApiClient,
  store: SessionStore,
  auto: AutopilotStore,
  now: number = Date.now(),
): Promise<void> {
  auto.update({ polledAt: new Date(now).toISOString() });
  let list: PRListResponse;
  try {
    list = await api.fetchPRs();
  } catch (e: unknown) {
    auto.update({ error: e instanceof Error ? e.message : t().list.fetchFailed });
    return;
  }
  auto.update({ list, error: null });

  const targets: PRSummary[] = [];
  for (const pr of autopilotCandidates(list.prs, store.all())) {
    // eslint-disable-next-line no-await-in-loop -- 1 件ずつ確認する。gh をまとめて叩かない
    if (await unchangedSinceSettled(api, store, pr)) continue;
    targets.push(pr);
  }
  const updatedAt = new Date(now).toISOString();
  for (const pr of targets) {
    // 実行中の印も同じ更新で付ける。別々に付けると、その間に前回の結果を見て動いてしまう
    store.update(pr, (s) => ({
      ...s,
      phase: "running",
      progress: QUEUED,
      error: null,
      // 依頼が付き直って一覧に戻ってきた PR は、見守りではなく一覧の側で扱う。二重にレビューしない
      watch: null,
      autopilot: {
        status: "reviewing",
        pr,
        headSha: pr.headSha,
        rounds: s.autopilot?.rounds ?? 0,
        withheld: s.autopilot?.withheld ?? [],
        note: null,
        updatedAt,
      },
    }));
  }
  await runReviews(api, store, targets);
}

/**
 * 人に回された PR を確かめた人が、以降は人の判断なしで進めると決めたときに呼ぶ。
 * PR に自動判断のラベルを付け、自動運転の AI レビューをやり直す。
 * 結果はほかの回と同じく settleAutopilot が扱い、ラベルを見て人には回さない
 */
export async function allowAutoJudge(
  api: ApiClient,
  store: SessionStore,
  pr: PRSummary,
  now: number = Date.now(),
): Promise<void> {
  await api.markAutoJudge(pr);
  store.update(pr, (s) => ({
    ...s,
    // 実行中の印も同じ更新で付ける。別々に付けると、その間に前回の結果を見て動いてしまう
    phase: "running",
    progress: QUEUED,
    error: null,
    watch: null,
    autopilot: {
      status: "reviewing",
      pr,
      headSha: pr.headSha,
      rounds: s.autopilot?.rounds ?? 0,
      withheld: s.autopilot?.withheld ?? [],
      note: null,
      updatedAt: new Date(now).toISOString(),
    },
  }));
  await runReviews(api, store, [pr]);
}

/**
 * 人に回された PR を、ほかの人がレビューしたなどで人が引き取ったときに呼ぶ。
 * 「人の判断が要る」から下ろし、以降は新しいコミットが来ても自動運転では AI レビューしない。
 * GitHub には何も書かない
 */
export function releaseFromAutopilot(
  store: SessionStore,
  pr: PRSummary,
  now: number = Date.now(),
): void {
  store.update(pr, (s) =>
    s.autopilot?.status !== "human"
      ? s
      : {
          ...s,
          autopilot: {
            ...s.autopilot,
            status: "released",
            held: false,
            note: t().autopilot.releasedNote,
            updatedAt: new Date(now).toISOString(),
          },
        },
  );
}

/**
 * 見守りで修正か返信を見つけた PR を、自動運転の AI レビューに回す。
 * 自動運転がコメントした PR だけが対象。人が投稿した PR は人が確かめる
 */
export function takeOverRereview(store: SessionStore, pr: PRSummary, now: number): boolean {
  const session = store.get(pr);
  if (session.autopilot?.status !== "commented") return false;
  store.update(pr, (s) =>
    s.autopilot === null
      ? s
      : {
          ...s,
          // 実行中の印も同じ更新で付ける。別々に付けると、その間に前回の結果を見て動いてしまう
          phase: "running",
          progress: QUEUED,
          error: null,
          autopilot: {
            ...s.autopilot,
            status: "reviewing",
            pr: { ...s.autopilot.pr, headSha: pr.headSha },
            headSha: pr.headSha,
            note: null,
            updatedAt: new Date(now).toISOString(),
          },
        },
  );
  return true;
}

/**
 * 完全自動運転を始める。ページを開いている間だけ動き、オフの間は何もしない。
 * 止めるための関数を返す
 */
export function startAutopilot(
  api: ApiClient,
  store: SessionStore,
  auto: AutopilotStore,
  notify: HumanNotifier = () => {},
): () => void {
  let polling = false;
  let settling = false;

  const settle = (): void => {
    if (settling || !auto.get().enabled) return;
    settling = true;
    void settleAutopilot(api, store, notify).finally(() => {
      settling = false;
    });
  };

  const tick = (): void => {
    settle();
    const now = Date.now();
    if (polling || !auto.get().enabled || now < nextPollAt(auto.get(), now)) return;
    polling = true;
    auto.update({ busy: true });
    void pollAutopilot(api, store, auto, now).finally(() => {
      polling = false;
      auto.update({ busy: false });
      settle();
    });
  };

  // オンにしたら、次の目盛りを待たずに動く
  let wasEnabled = auto.get().enabled;
  const unsubscribe = auto.subscribe(() => {
    const { enabled } = auto.get();
    if (enabled && !wasEnabled) tick();
    wasEnabled = enabled;
  });
  // 見守りがやり直した AI レビューの結果も、終わり次第扱う
  const unwatch = store.subscribe(() => {
    const ready = Object.values(store.all()).some(
      (s) => s.autopilot?.status === "reviewing" && (s.phase === "done" || s.phase === "failed"),
    );
    if (ready) settle();
  });

  tick();
  const timer = setInterval(tick, TICK_MS);
  return () => {
    clearInterval(timer);
    unsubscribe();
    unwatch();
  };
}
