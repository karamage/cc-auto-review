import { expect, test } from "bun:test";
import type { PriorFindingCheck, PriorFindingStatus } from "../../shared/types.ts";
import { describePriorChecks, excerpt, priorCheckLookup, sortPriorChecks } from "./prior.ts";

function check(id: number, status: PriorFindingStatus): PriorFindingCheck {
  return {
    status,
    evidence: "",
    comment: {
      id,
      author: "me",
      body: "指摘",
      path: null,
      line: null,
      side: null,
      createdAt: "2026-10-01T00:00:00Z",
      url: "",
    },
  };
}

test("未修正 → 確認できず → 修正済みの順に並べ、件数を要約する", () => {
  const checks = [
    check(1, "fixed"),
    check(2, "unverified"),
    check(3, "unfixed"),
    check(4, "fixed"),
  ];
  expect(sortPriorChecks(checks).map((c) => c.comment.id)).toEqual([3, 2, 1, 4]);
  expect(describePriorChecks(checks)).toBe("未修正 1 / 確認できず 1 / 修正済み 2");
  expect(describePriorChecks([check(1, "fixed")])).toBe("修正済み 1");
});

test("コメント ID から判定を引ける", () => {
  const checkOf = priorCheckLookup([check(7, "unfixed")]);
  expect(checkOf(7)?.status).toBe("unfixed");
  expect(checkOf(8)).toBeUndefined();
});

test("excerpt は改行をつぶし、長ければ切る", () => {
  expect(excerpt("一行目\n\n二行目")).toBe("一行目 二行目");
  expect(excerpt("あ".repeat(10), 4)).toBe("ああああ…");
});
