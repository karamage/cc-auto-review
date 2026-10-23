import { useSyncExternalStore } from "react";
import type {
  PostedReview,
  PriorFindingCheck,
  PRRef,
  PRSummary,
  ReviewEventKind,
  ReviewModel,
} from "../../shared/types.ts";
import type { Lang } from "../../shared/i18n.ts";
import type { RiskAssessment } from "../../shared/risk.ts";
import { ApiError, type ApiClient } from "../api.ts";
import { getLang, t } from "../i18n.ts";
import { type DraftState, initDraft } from "./draft.ts";

export type ReviewPhase = "idle" | "running" | "done" | "failed";

/** GitHub に投稿したレビューの記録 */
export interface PostedRecord {
  review: PostedReview;
  /** 投稿すると review-requested の一覧から消えるので、一覧に出すための PR の情報を覚えておく */
  pr: PRSummary;
  /** 投稿したときの head。これより先に進んでいれば作成者が修正を push している */
  headSha: string;
  event: ReviewEventKind;
  /** 投稿した指摘の数（行コメントと本文にまとめたものの合計） */
  comments: number;
}

/**
 * 投稿後の見守り。waiting の間は作成者の修正か返信を定期的に確認し、
 * どちらかがあれば AI レビューをやり直して rereviewed にする
 */
export interface WatchState {
  /** approved は、ほかの人が承認したので自動の再レビューを止めた状態。人が始め直せる */
  status: "waiting" | "rereviewed" | "closed" | "approved";
  /** 最後に GitHub を確認した時刻（ISO 8601）。まだなら null */
  checkedAt: string | null;
  /**
   * 見守りを始めた時刻（ISO 8601）。これより前の承認では止めない。
   * 承認を見たうえで人が始め直したなら、それは再レビューの依頼に当たる。
   * この項目ができる前に保存した見守りには無いので、そのときは投稿時刻で代える
   */
  startedAt?: string;
  /**
   * 投稿した回の代わりに、再レビューするかを見る基準にする head と時刻。あれば、これより後の修正と返信だけを拾う。
   * 完全自動運転が投稿せずに見送った回や、中身の変わらないコミットだけが来た回で付け、
   * 同じ動きで再レビューを繰り返さないようにする
   */
  baseline?: { headSha: string; since: string };
  /** waiting 以外になった理由。画面にそのまま出す */
  note: string | null;
}

/**
 * 完全自動運転がこの PR をどう扱ったか。
 * reviewing は AI レビューの結果待ち。approved / commented は GitHub に投稿した。
 * human は人の判断が要ると決めて、投稿せずに人へ回した。
 * skipped は AI レビューを見送るラベルが付いていたので、何もしなかった。
 * released は人に回した PR を、ほかの人がレビューしたなどで人が引き取り、自動運転の対象から外した
 */
export interface AutopilotState {
  status: "reviewing" | "approved" | "commented" | "human" | "skipped" | "released";
  /**
   * commented のうち、残った指摘がすべて既存のコメントと同じだったので、
   * 新しく投稿せずに修正を待っているもの。同じ指摘を重ねて投稿しないため
   */
  held?: boolean;
  /**
   * 承認を保留する理由として、これまでにコメントで伝えた過去の指摘のコメント ID。
   * 直ったか確かめられないままでも、同じ指摘について保留の知らせを重ねて投稿しないため
   */
  withheld?: number[];
  /** 投稿と一覧の表示に使う PR の情報。見守りから戻ってきた PR は一覧に無いので覚えておく */
  pr: PRSummary;
  /** どのコミットを扱ったか。一覧に同じ head で残っている間は扱い直さない */
  headSha: string;
  /** 指摘をコメントした回数。何度やり取りしても収束しなければ人に回す */
  rounds: number;
  /** 人に回した理由や、投稿した内容の要約。画面にそのまま出す */
  note: string | null;
  /** 最後に状態が変わった時刻（ISO 8601） */
  updatedAt: string;
}

/**
 * PR ごとの AI レビューの状態と下書き。
 * レビュー画面を離れても消えないよう、画面ではなくストアが持つ
 */
export interface ReviewSession {
  phase: ReviewPhase;
  progress: string;
  error: { message: string; raw: string | null } | null;
  draft: DraftState;
  /** 過去の指摘が今のコードで直っているかの、AI の判定。draft と同じ回の AI レビューのもの */
  priorChecks: PriorFindingCheck[];
  instructions: string;
  /** AI レビューに使うモデル。"default" なら設定の既定、null なら claude の設定に任せる */
  model: ReviewModel | null | "default";
  /**
   * AI レビューのやり方（プロファイル）。null なら設定の既定。
   * 完全自動運転がルーティングの規則で別のものを使った回は、その id が入る
   */
  profileId: string | null;
  /** 結果がどのコミットに対するものか。一度も結果が出ていなければ null */
  headSha: string | null;
  /** 結果を受け取った時刻（ISO 8601）。一度も結果が出ていなければ null */
  reviewedAt: string | null;
  /** 最後に GitHub へ投稿したレビュー。投稿していなければ null */
  posted: PostedRecord | null;
  /** 投稿後の見守り。見守っていなければ null */
  watch: WatchState | null;
  /** 変更のリスク。完全自動運転で判定を頼んだ回のものだけが入る */
  risk: RiskAssessment | null;
  /** PR の説明文の言語。draft と同じ回の AI レビューのもの。読み取れなければ null */
  descriptionLang: Lang | null;
  /** draft と同じ回の AI レビューの時点で、PR に自動判断のラベルが付いていたか */
  autoJudge: boolean;
  /** 完全自動運転の回で、見送りのラベルが付いていたので AI レビューしなかったか */
  skipped: boolean;
  /**
   * draft と同じ回の AI レビューで見た変更の中身の要約。新しいコミットが来ても、
   * これと変わらなければレビューし直さない。diff を読む前に終わった回なら null
   */
  digest: string | null;
  /** 完全自動運転がこの PR を扱っていれば、その状態。扱っていなければ null */
  autopilot: AutopilotState | null;
}

const emptySessions = new Map<Lang, ReviewSession>();

/**
 * まだ何もしていない PR の状態。投稿する言語の初期値を画面の言語に合わせるため、言語ごとに作る。
 * 描画のたびに別のオブジェクトにならないよう、言語ごとに使い回す
 */
export function emptySession(lang: Lang = getLang()): ReviewSession {
  let session = emptySessions.get(lang);
  if (session === undefined) {
    session = {
      phase: "idle",
      progress: "",
      error: null,
      draft: initDraft([], lang),
      priorChecks: [],
      instructions: "",
      model: "default",
      profileId: null,
      headSha: null,
      reviewedAt: null,
      posted: null,
      watch: null,
      risk: null,
      descriptionLang: null,
      autoJudge: false,
      skipped: false,
      digest: null,
      autopilot: null,
    };
    emptySessions.set(lang, session);
  }
  return session;
}

export type Sessions = Readonly<Record<string, ReviewSession>>;

/** 保存先。アプリではサーバ、テストではメモリ */
export interface SessionStorage {
  load(): string | null;
  save(data: string): void;
}

export interface SessionStore {
  all(): Sessions;
  get(pr: PRRef): ReviewSession;
  update(pr: PRRef, change: (session: ReviewSession) => ReviewSession): void;
  /** 保存した結果を消す。明示的に消すまで結果は残る */
  clear(pr: PRRef): void;
  subscribe(listener: () => void): () => void;
}

export function sessionKey(pr: PRRef): string {
  return `${pr.repo}#${pr.number}`;
}

/** 実行中のまま保存されたものは、読み込んだ時点でもう走っていない */
function restore(data: string | null): Record<string, ReviewSession> {
  if (data === null) return {};
  try {
    const parsed = JSON.parse(data) as Record<string, ReviewSession>;
    return Object.fromEntries(
      Object.entries(parsed).map(([key, stored]) => {
        // 投稿の記録が無かった頃に保存したものは、足りない項目を空で補う
        const session: ReviewSession = { ...emptySession(), ...stored };
        return [
          key,
          session.phase === "running"
            ? {
                ...session,
                // 自動運転の回は、前の結果を残して done にすると、その結果で投稿してしまう
                phase:
                  session.reviewedAt === null || session.autopilot?.status === "reviewing"
                    ? "failed"
                    : "done",
                progress: "",
                error: { message: t().session.interrupted, raw: null },
              }
            : session,
        ];
      }),
    );
  } catch {
    // 壊れた保存データで起動できなくなるよりは、空から始める
    return {};
  }
}

export function createSessionStore(storage: SessionStorage | null = null): SessionStore {
  let sessions: Sessions = restore(storage?.load() ?? null);
  const listeners = new Set<() => void>();

  const commit = (next: Sessions): void => {
    sessions = next;
    try {
      storage?.save(JSON.stringify(sessions));
    } catch {
      // 保存に失敗しても、開いている間は手元の状態で動き続ける
    }
    for (const listener of listeners) listener();
  };

  return {
    all: () => sessions,
    get: (pr) => sessions[sessionKey(pr)] ?? emptySession(),
    update(pr, change) {
      const key = sessionKey(pr);
      commit({ ...sessions, [key]: change(sessions[key] ?? emptySession()) });
    },
    clear(pr) {
      const { [sessionKey(pr)]: _removed, ...rest } = sessions;
      commit(rest);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useSessions(store: SessionStore): Sessions {
  return useSyncExternalStore(store.subscribe, store.all);
}

export function useSession(store: SessionStore, pr: PRRef): ReviewSession {
  return useSessions(store)[sessionKey(pr)] ?? emptySession();
}

/**
 * 一覧からまとめて実行したとき、同時に走らせる数を超えた PR の progress に入れておく印。
 * 文言ではないので、画面には progressText で訳して出す
 */
export const QUEUED = "queued";

/** progress を画面に出す文言にする。順番待ちの印だけは、いまの言語の文言に置き換える */
export function progressText(progress: string): string {
  return progress === QUEUED ? t().session.queued : progress;
}

/** 同時に走らせる AI レビューの数。PR ごとにスナップショットと AI のプロセスを抱えるので絞る */
export const MAX_PARALLEL_REVIEWS = 3;

/** 一覧に出す、保存済みの結果の要約。結果も実行中の処理も無ければ null */
export function sessionBadge(
  session: ReviewSession | undefined,
):
  | { kind: "queued" }
  | { kind: "running" }
  | { kind: "saved"; findings: number; accepted: number }
  | null {
  if (session === undefined) return null;
  if (session.phase === "running") {
    return session.progress === QUEUED ? { kind: "queued" } : { kind: "running" };
  }
  if (session.reviewedAt === null) return null;
  return {
    kind: "saved",
    findings: session.draft.items.length,
    accepted: session.draft.items.filter((i) => i.status === "accepted").length,
  };
}

/**
 * AI レビューを実行し、結果をストアに書き込む。
 * 画面に結び付いていないので、途中で一覧へ戻ったりほかの PR を開いたりしても止まらない
 */
export async function runReview(
  api: ApiClient,
  store: SessionStore,
  pr: PRRef,
  headSha: string,
): Promise<void> {
  if (store.get(pr).phase === "running") return;
  store.update(pr, (s) => ({ ...s, phase: "running", error: null, progress: QUEUED }));
  await execute(api, store, pr, headSha);
}

/**
 * 一覧に並んだ PR のうち、まとめて実行する対象。
 * 実行中のものと、いまの head に対する結果を持っているもの（下書きを消さないため）は外す
 */
export function pendingReviews(prs: readonly PRSummary[], sessions: Sessions): PRSummary[] {
  return prs.filter((pr) => {
    const session = sessions[sessionKey(pr)];
    if (session === undefined) return true;
    if (session.phase === "running") return false;
    return session.reviewedAt === null || session.headSha !== pr.headSha;
  });
}

/**
 * 複数の PR の AI レビューを、同時に走らせる数を絞りながら順に実行する。
 * 待っている PR も一覧で分かるよう、先にすべて実行中（順番待ち）にしておく
 */
export async function runReviews(
  api: ApiClient,
  store: SessionStore,
  prs: readonly PRSummary[],
  concurrency: number = MAX_PARALLEL_REVIEWS,
): Promise<void> {
  // 呼び出し側が順番待ちの印を付けてから渡したもの（完全自動運転）も走らせる。
  // 二重に渡っても、execute が順番待ちのものだけを走らせるので 1 回しか走らない
  const queue = prs.filter((pr) => {
    const { phase, progress } = store.get(pr);
    return phase !== "running" || progress === QUEUED;
  });
  for (const pr of queue) {
    store.update(pr, (s) => ({ ...s, phase: "running", error: null, progress: QUEUED }));
  }
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      await execute(api, store, { repo: next.repo, number: next.number }, next.headSha);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}

/** 実行中（順番待ちを含む）にしてある PR の AI レビューを、実際に走らせる */
async function execute(
  api: ApiClient,
  store: SessionStore,
  pr: PRRef,
  headSha: string,
): Promise<void> {
  // 順番を待っている間に消されたり、レビュー画面から個別に走らせ直されたりしたら、ここでは走らせない
  const { phase, progress, instructions, model, profileId, autopilot } = store.get(pr);
  if (phase !== "running" || progress !== QUEUED) return;
  // 完全自動運転の回は、PR ごとに選んだものではなく自動運転の設定で走らせ、リスクも判定させる。
  // モデルとプロファイルはサーバが自動運転の設定から選ぶ
  const auto = autopilot?.status === "reviewing";

  // 実行中に消されたら、届いた結果は捨てる
  const patch = (change: Partial<ReviewSession>): void => {
    if (store.get(pr).phase !== "running") return;
    store.update(pr, (s) => ({ ...s, ...change }));
  };
  const fail = (message: string, raw: string | null = null): void => {
    patch({ phase: "failed", progress: "", error: { message, raw } });
  };

  patch({ progress: t().session.fetching });
  // 指摘はリクエストを送ったときの言語で返ってくる。途中で画面の言語を変えても、下書きはその言語で作る
  const lang = getLang();
  // findings か error のどちらかが来ないまま接続が閉じたら、黙って終わらせずに失敗として出す
  let finished = false;
  try {
    const options = auto
      ? { instructions, model, profileId: null, assessRisk: true }
      : { instructions, model, profileId };
    await api.streamReview(pr, headSha, options, (event) => {
      if (event.type === "snapshot_ready") patch({ progress: t().session.reading });
      if (event.type === "reviewing") patch({ progress: event.message });
      if (event.type === "findings") {
        finished = true;
        patch({
          phase: "done",
          progress: "",
          draft: initDraft(event.findings, lang),
          priorChecks: event.priorChecks,
          risk: event.risk ?? null,
          descriptionLang: event.descriptionLang ?? null,
          autoJudge: event.autoJudge === true,
          skipped: event.skipped === true,
          digest: event.digest ?? null,
          // 完全自動運転がルーティングで選んだ回も、画面で何を使ったのかが分かるようにする
          profileId: auto ? (event.profileId ?? profileId) : profileId,
          headSha,
          reviewedAt: new Date().toISOString(),
        });
      }
      if (event.type === "error") {
        finished = true;
        fail(event.message, event.raw);
      }
    });
    if (!finished) {
      fail(t().session.disconnected);
    }
  } catch (e: unknown) {
    fail(e instanceof ApiError ? e.message : t().session.failed);
  }
}
