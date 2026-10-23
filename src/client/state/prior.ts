import type { PriorFindingCheck, PriorFindingStatus } from "../../shared/types.ts";
import { t } from "../i18n.ts";

export function priorStatusLabel(status: PriorFindingStatus): string {
  return t().priorStatus[status];
}

/** 手を動かす必要があるものほど先に出す */
const PRIOR_STATUS_ORDER: Record<PriorFindingStatus, number> = {
  unfixed: 0,
  unverified: 1,
  fixed: 2,
};

export function sortPriorChecks(checks: readonly PriorFindingCheck[]): PriorFindingCheck[] {
  return [...checks].sort((a, b) => PRIOR_STATUS_ORDER[a.status] - PRIOR_STATUS_ORDER[b.status]);
}

/** 既存コメントの横に判定を添えるため、コメント ID から判定を引けるようにする */
export function priorCheckLookup(
  checks: readonly PriorFindingCheck[],
): (commentId: number) => PriorFindingCheck | undefined {
  const byId = new Map(checks.map((check) => [check.comment.id, check]));
  return (commentId) => byId.get(commentId);
}

/** どの指摘の話かを一覧で示すための、元のコメントの書き出し */
export function excerpt(body: string, length = 120): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length)}…` : flat;
}

/** 判定の件数を「未修正 2 / 確認できず 1 / 修正済み 3」のように表す。0 件の判定は省く */
export function describePriorChecks(checks: readonly PriorFindingCheck[]): string {
  return (["unfixed", "unverified", "fixed"] as const)
    .map((status) => ({ status, count: checks.filter((c) => c.status === status).length }))
    .filter((entry) => entry.count > 0)
    .map((entry) => `${priorStatusLabel(entry.status)} ${entry.count}`)
    .join(" / ");
}
