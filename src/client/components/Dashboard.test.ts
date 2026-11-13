import { expect, test } from "bun:test";
import type { PRSummary } from "../../shared/types.ts";
import { emptySession, type ReviewSession } from "../state/sessions.ts";
import {
  activityGrid,
  authorLoad,
  HEATMAP_DAYS,
  repoShares,
  severityTotals,
  stripState,
} from "./Dashboard.tsx";

function pr(repo: string, number: number, extra: Partial<PRSummary> = {}): PRSummary {
  return {
    repo,
    number,
    title: "",
    author: "a",
    headRefName: "h",
    baseRefName: "main",
    headSha: "s",
    additions: 0,
    deletions: 0,
    changedFiles: 1,
    updatedAt: "2026-10-20T00:00:00.000Z",
    url: "",
    ...extra,
  };
}

function reviewed(severities: ("blocker" | "should" | "question" | "nit")[]): ReviewSession {
  const session = emptySession("ja");
  return {
    ...session,
    draft: {
      ...session.draft,
      items: severities.map((severity, i) => ({
        anchored: {
          finding: {
            id: String(i),
            path: "a",
            line: 1,
            severity,
            title: "",
            body: "",
            trigger: "",
            impact: "",
          },
          anchor: "line",
          reason: null,
        },
        status: "pending",
        body: "",
      })),
    },
  } as ReviewSession;
}

test("指摘は重大度ごとに、すべての結果をまたいで合計する", () => {
  expect(severityTotals([reviewed(["blocker", "nit"]), reviewed(["blocker", "should"])])).toEqual({
    blocker: 2,
    should: 1,
    question: 0,
    nit: 1,
  });
});

test("リポジトリは多い順、同数なら名前順に並べる", () => {
  expect(repoShares([pr("o/b", 1), pr("o/a", 2), pr("o/c", 3), pr("o/c", 4)])).toEqual([
    { repo: "o/c", count: 2 },
    { repo: "o/a", count: 1 },
    { repo: "o/b", count: 1 },
  ]);
});

test("動きは日と時の表に数え、範囲より古いものと未来のものは数えない", () => {
  const now = new Date(2026, 9, 20, 15, 30).getTime();
  const at = (days: number, hour: number): string =>
    new Date(2026, 9, 20 - days, hour, 10).toISOString();
  const session = { ...emptySession("ja"), reviewedAt: at(0, 9) };
  const grid = activityGrid(
    [
      pr("o/r", 1, { updatedAt: at(0, 9) }),
      pr("o/r", 2, { updatedAt: at(6, 23) }),
      pr("o/r", 3, { updatedAt: at(7, 1) }),
      pr("o/r", 4, { updatedAt: at(-1, 1) }),
    ],
    [session],
    now,
  );
  expect(grid).toHaveLength(HEATMAP_DAYS);
  expect(grid[HEATMAP_DAYS - 1]?.[9]).toBe(2);
  expect(grid[0]?.[23]).toBe(1);
  expect(grid.flat().reduce((a, b) => a + b, 0)).toBe(3);
});

test("作成者は変更行数の多い順に、上限の人数まで出す", () => {
  const load = authorLoad(
    [
      pr("o/r", 1, { author: "x", additions: 5 }),
      pr("o/r", 2, { author: "y", additions: 9 }),
      pr("o/r", 3, { author: "x", deletions: 6 }),
      pr("o/r", 4, { author: "z", additions: 1 }),
    ],
    2,
  );
  expect(load).toEqual([
    { author: "x", lines: 11, count: 2 },
    { author: "y", lines: 9, count: 1 },
  ]);
});

test("依頼の帯は、人に回したものを最優先にし、古い head の結果は未レビューとして数える", () => {
  const fresh = pr("o/r", 1, { headSha: "new" });
  const stale = pr("o/r", 2, { headSha: "new" });
  const running = pr("o/r", 3);
  const handed = pr("o/r", 4);
  const untouched = pr("o/r", 5);
  const done = (headSha: string): ReviewSession => ({
    ...reviewed([]),
    headSha,
    reviewedAt: "2026-10-20T00:00:00.000Z",
  });
  const saved = {
    "o/r#1": done("new"),
    "o/r#2": done("old"),
    "o/r#3": { ...emptySession("ja"), phase: "running" } as ReviewSession,
    "o/r#4": done("s"),
  };
  const human = new Set(["o/r#4"]);
  expect(
    [fresh, stale, running, handed, untouched].map((p) => stripState(p, saved, human)),
  ).toEqual(["reviewed", "pending", "running", "human", "pending"]);
});
