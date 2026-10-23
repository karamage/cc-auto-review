import type {
  MyReviewState,
  PostedReview,
  PRActivity,
  PRRef,
  PRSummary,
  ReviewedPR,
  ReviewEventKind,
} from "../../shared/types.ts";
import type { ApiClient } from "../api.ts";
import { t } from "../i18n.ts";
import {
  type PostedRecord,
  type ReviewSession,
  type WatchState,
  runReviews,
  type SessionStore,
  type Sessions,
  sessionKey,
} from "./sessions.ts";

/** 投稿した PR を確認しに行く間隔 */
export const WATCH_INTERVAL_MS = 10 * 60 * 1000;

/**
 * 確認の時期が来たかを見る間隔。確認そのものは WATCH_INTERVAL_MS ごとだが、
 * スリープ明けや再起動の直後にも遅れず確認できるよう、細かく見ておく
 */
const TICK_MS = 60 * 1000;

/**
 * 投稿できたレビューを記録する。見守りは始めない。
 * 見守るかどうかは、投稿後に人が startWatching で明示的に決める。
 * 完全自動運転が扱っていた PR でも、投稿したらその手を離す。自動運転が投稿したときは、自動運転が改めて状態を書く
 */
export function recordPosted(
  store: SessionStore,
  pr: PRSummary,
  posted: { review: PostedReview; headSha: string; event: ReviewEventKind; comments: number },
): void {
  store.update(pr, (s) => ({
    ...s,
    posted: { ...posted, pr },
    watch: null,
    autopilot: null,
  }));
}

export function stopWatching(store: SessionStore, pr: PRRef): void {
  store.update(pr, (s) => ({ ...s, watch: null }));
}

/**
 * 投稿した PR の見守りを始める。投稿より後の動きは、次の確認でまとめて拾う。
 * 投稿から確認の間隔（WATCH_INTERVAL_MS）以上たってから始めた場合は、すぐに確認しに行く
 */
export function startWatching(
  store: SessionStore,
  pr: PRRef,
  now: number = Date.now(),
  baseline?: WatchState["baseline"],
): void {
  const startedAt = new Date(now).toISOString();
  store.update(pr, (s) =>
    s.posted === null
      ? s
      : {
          ...s,
          watch: {
            status: "waiting",
            checkedAt: null,
            note: null,
            startedAt,
            ...(baseline === undefined ? {} : { baseline }),
          },
        },
  );
}

export type WatchChange = { kind: "closed" | "rereview" | "approved"; note: string };

/**
 * 投稿後に PR で起きたことから、見守りをどうするかを決める。何も起きていなければ null。
 * startedAt（見守りを始めた時刻）より前の承認は、人が承知のうえで見守っているので数えない
 */
export function detectChange(
  posted: PostedRecord,
  activity: PRActivity,
  startedAt: string = posted.review.submittedAt,
): WatchChange | null {
  const text = t().watch;
  if (activity.state === "MERGED") return { kind: "closed", note: text.merged };
  if (activity.state === "CLOSED") return { kind: "closed", note: text.closed };

  // 人が承認した PR は、新しいコミットや返信があっても AI でレビューし直さない。
  // 人の判断を AI が蒸し返さないためで、トークンも使わずに済む
  const approvers = [
    ...new Set(
      activity.approvals
        .filter((approval) => Date.parse(approval.submittedAt) > Date.parse(startedAt))
        .map((approval) => approval.author),
    ),
  ];
  if (approvers.length > 0) {
    return { kind: "approved", note: text.approvedBy(approvers) };
  }

  const reasons: string[] = [];
  if (activity.headSha !== posted.headSha) {
    reasons.push(text.newCommit(activity.headSha.slice(0, 7)));
  }
  if (activity.replies.length > 0) {
    reasons.push(text.authorCommented(activity.replies.length));
  }
  if (reasons.length === 0) return null;
  return { kind: "rereview", note: text.reasons(reasons) };
}

const WATCH_STATUS: Record<WatchChange["kind"], WatchState["status"]> = {
  closed: "closed",
  rereview: "rereviewed",
  approved: "approved",
};

/** 確認しに行く時期が来ているか。AI レビューの実行中はその結果を待つ */
export function isDue(session: ReviewSession, now: number, intervalMs: number): boolean {
  const { posted, watch } = session;
  if (posted === null || watch?.status !== "waiting" || session.phase === "running") return false;
  return now - Date.parse(watch.checkedAt ?? posted.review.submittedAt) >= intervalMs;
}

/** 一覧で上に出す順。手を動かす必要があるものほど先 */
const POSTED_ORDER: Record<"rereviewed" | "waiting" | "approved" | "off", number> = {
  rereviewed: 0,
  waiting: 1,
  approved: 2,
  off: 3,
};

/**
 * 一覧（review-requested）に出てこない、投稿済みの PR。投稿すると依頼が外れて一覧から消える。
 * 見守っていないものも残す。マージかクローズを見届けたものだけは外す。
 * 再レビュー済み → 返信待ち → ほかの人が承認 → 見守りなしの順に、それぞれ投稿の新しい順で並べる
 */
export function postedElsewhere(prs: readonly PRRef[], sessions: Sessions): PostedRecord[] {
  const listed = new Set(prs.map(sessionKey));
  return Object.values(sessions)
    .flatMap((s) =>
      s.posted !== null && s.watch?.status !== "closed" && !listed.has(sessionKey(s.posted.pr))
        ? [{ posted: s.posted, order: POSTED_ORDER[s.watch?.status ?? "off"] }]
        : [],
    )
    .sort(
      (a, b) =>
        a.order - b.order ||
        Date.parse(b.posted.review.submittedAt) - Date.parse(a.posted.review.submittedAt),
    )
    .map((entry) => entry.posted);
}

/**
 * GitHub でレビュー済みの PR のうち、このアプリの投稿記録が無いもの。
 * 記録のある PR は postedElsewhere が見守りの状態付きで出すので、重ねて出さない
 */
export function reviewedElsewhere(
  reviewed: readonly ReviewedPR[],
  sessions: Sessions,
): ReviewedPR[] {
  return reviewed.filter((pr) => sessions[sessionKey(pr)]?.posted == null);
}

/** GitHub 上の自分のレビューの種類を、一覧に添える短い説明にする */
export function myReviewLabel(state: MyReviewState): string {
  return t().myReview[state];
}

/** 最後に投稿したレビューが承認（Approve）だったか */
export function isApproved(session: ReviewSession | undefined): boolean {
  return session?.posted?.event === "APPROVE";
}

/**
 * 一覧やレビュー画面に添える、投稿と見守りの状態の短い説明。投稿していなければ null。
 * 承認した PR は、指摘を返しただけの PR と見分けられるよう「承認済み」と出す
 */
export function postedLabel(session: ReviewSession | undefined): string | null {
  if (session?.posted == null) return null;
  const text = t().watch;
  const head = isApproved(session) ? text.approved : text.posted;
  switch (session.watch?.status) {
    case "waiting":
      return text.waiting(head);
    case "rereviewed":
      return text.rereviewed;
    case "closed":
      return text.ended(head);
    case "approved":
      return text.othersApproved(head);
    default:
      return head;
  }
}

/**
 * PR のいまの head（headSha）の変更の中身が、前回 AI レビューした中身（digest）と同じか。
 * base を取り込んだだけのマージや、中身を変えない rebase なら同じになる。
 * 確かめられなければ違うものとして扱い、レビューし直す。見落とすよりはトークンを使う方がよい
 */
export async function hasSameContent(
  api: ApiClient,
  pr: PRRef,
  headSha: string,
  digest: string | null,
): Promise<boolean> {
  if (digest === null) return false;
  try {
    const current = await api.fetchDigest(pr);
    // 確かめている間に push されていたら、その head はまだ確かめていない
    return current.headSha === headSha && current.digest === digest;
  } catch {
    return false;
  }
}

/**
 * 再レビューの直前に呼ぶ。完全自動運転が引き取る PR なら、自動運転の印を付けて true を返す。
 * 引き取った PR は、結果が出たら自動運転が投稿まで行う
 */
export type RereviewTakeOver = (pr: PRSummary, now: number) => boolean;

/**
 * 時期の来た PR を確認し、修正か返信があれば AI レビューをやり直す。
 * 投稿はしない。新しい指摘を採用して投稿するかは人が決める。
 * ただし完全自動運転がコメントした PR は、自動運転が引き取って投稿まで行う
 */
export async function checkWatched(
  api: ApiClient,
  store: SessionStore,
  now: number = Date.now(),
  intervalMs: number = WATCH_INTERVAL_MS,
  takeOver: RereviewTakeOver = () => false,
): Promise<void> {
  const checkedAt = new Date(now).toISOString();
  const due = Object.values(store.all()).filter((s) => isDue(s, now, intervalMs));
  const rereview: PRSummary[] = [];

  for (const { posted, watch } of due) {
    if (posted === null) continue;
    const pr = posted.pr;
    // 自動運転が投稿せずに見送った回や、中身の変わらないコミットがあれば、それより後の動きだけを見る
    const baseline = watch?.baseline;
    const since = baseline?.since ?? posted.review.submittedAt;
    let activity: PRActivity;
    try {
      // 1 件ずつ確認する。見守る PR が多くても gh をまとめて叩かない
      // eslint-disable-next-line no-await-in-loop
      activity = await api.fetchActivity(pr, since);
    } catch {
      // 通信の失敗では見守りをやめない。次の時期にもう一度確認する
      store.update(pr, (s) => (s.watch === null ? s : { ...s, watch: { ...s.watch, checkedAt } }));
      continue;
    }

    const baseHead = baseline?.headSha ?? posted.headSha;
    // 作成者の返信もほかの人の承認も無く、新しいコミットの中身が前回レビューしたものと同じなら、
    // そのコミットは無かったものとして扱う。関係する変更が無いのに AI レビューをやり直さない
    const sameContent =
      activity.state === "OPEN" &&
      activity.headSha !== baseHead &&
      activity.replies.length === 0 &&
      activity.approvals.length === 0 &&
      // eslint-disable-next-line no-await-in-loop -- 1 件ずつ確認する
      (await hasSameContent(api, pr, activity.headSha, store.get(pr).digest));

    const startedAt = store.get(pr).watch?.startedAt;
    const change = detectChange(
      { ...posted, headSha: baseHead },
      sameContent ? { ...activity, headSha: baseHead } : activity,
      startedAt,
    );
    store.update(pr, (s) => {
      // 確認している間に見守りを止められていたら、そのままにする
      if (s.watch?.status !== "waiting") return s;
      return change === null
        ? {
            ...s,
            watch: {
              ...s.watch,
              checkedAt,
              // 次からは、この head より後の動きだけを見る。同じ確認を繰り返さない
              ...(sameContent ? { baseline: { headSha: activity.headSha, since } } : {}),
            },
          }
        : {
            ...s,
            watch: {
              ...s.watch,
              status: WATCH_STATUS[change.kind],
              checkedAt,
              note: change.note,
            },
          };
    });
    if (change?.kind === "rereview" && store.get(pr).watch?.status === "rereviewed") {
      const next = { ...pr, headSha: activity.headSha };
      takeOver(next, now);
      rereview.push(next);
    }
  }

  await runReviews(api, store, rereview);
}

/**
 * 見守りを始める。ページや TUI を開いている間だけ動く。
 * 止めるための関数を返す
 */
export function startWatcher(
  api: ApiClient,
  store: SessionStore,
  intervalMs: number = WATCH_INTERVAL_MS,
  takeOver: RereviewTakeOver = () => false,
): () => void {
  let checking = false;
  const tick = (): void => {
    // 再レビューは数分かかる。終わるまでは次の確認を重ねない
    if (checking) return;
    checking = true;
    void checkWatched(api, store, Date.now(), intervalMs, takeOver).finally(() => {
      checking = false;
    });
  };
  tick();
  const timer = setInterval(tick, TICK_MS);
  return () => clearInterval(timer);
}
