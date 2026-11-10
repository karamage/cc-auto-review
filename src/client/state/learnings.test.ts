import { expect, test } from "bun:test";
import type { Learning } from "../../shared/types.ts";
import { candidateCount, learningRepos } from "./learnings.ts";

function learning(repo: string, status: Learning["status"]): Learning {
  return {
    id: 1,
    repo,
    text: "t",
    status,
    pinned: false,
    source: "ai",
    prNumber: null,
    inPrompt: false,
    createdAt: "",
    updatedAt: "",
  };
}

test("候補のある repo を先に、同じ扱いの中は名前順に並べる", () => {
  expect(
    learningRepos([
      learning("o/a", "active"),
      learning("o/c", "candidate"),
      learning("o/b", "candidate"),
      learning("o/c", "active"),
    ]),
  ).toEqual(["o/b", "o/c", "o/a"]);
});

test("候補の数を数える", () => {
  expect(candidateCount([learning("o/a", "active"), learning("o/b", "candidate")])).toBe(1);
  expect(candidateCount([])).toBe(0);
});
