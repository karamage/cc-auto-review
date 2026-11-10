import type { Learning } from "../../shared/types.ts";

export function candidateCount(learnings: readonly Learning[]): number {
  return learnings.filter((item) => item.status === "candidate").length;
}

/** 候補のある repo を先に並べる。人が確かめるべきものがそこにあるため */
export function learningRepos(learnings: readonly Learning[]): string[] {
  const pending = new Set(
    learnings.filter((item) => item.status === "candidate").map((item) => item.repo),
  );
  return [...new Set(learnings.map((item) => item.repo))].sort((a, b) => {
    const rank = Number(pending.has(b)) - Number(pending.has(a));
    return rank !== 0 ? rank : a.localeCompare(b);
  });
}
