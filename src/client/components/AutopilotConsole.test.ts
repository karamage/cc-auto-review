import { expect, test } from "bun:test";
import type { PRSummary } from "../../shared/types.ts";
import { emptySession, type AutopilotState, type Sessions } from "../state/sessions.ts";
import { countBands, formatCountdown, plotBlips, recentMoves } from "./AutopilotConsole.tsx";

function sessionsWith(statuses: AutopilotState["status"][]): Sessions {
  return Object.fromEntries(
    statuses.map((status, i) => {
      const pr = { repo: "o/r", number: i + 1, title: "", headSha: "s" } as PRSummary;
      return [
        `o/r#${i + 1}`,
        {
          ...emptySession("ja"),
          autopilot: {
            status,
            pr,
            headSha: "s",
            rounds: 1,
            note: null,
            updatedAt: new Date(Date.UTC(2026, 9, 20, 0, i)).toISOString(),
          },
        },
      ];
    }),
  );
}

test("バルーンは帯をまたいでも同じ角度に来ず、6 時の方向を空けて並ぶ", () => {
  const blips = plotBlips(
    sessionsWith(["human", "reviewing", "approved", "approved", "commented"]),
  );
  const angles = blips.map((b) => b.angle);
  expect(new Set(angles).size).toBe(angles.length);
  for (const angle of angles) {
    expect(Math.abs(angle - 180)).toBeGreaterThan(20);
  }
  expect(blips.map((b) => b.band)).toEqual([
    "human",
    "reviewing",
    "approved",
    "approved",
    "commented",
  ]);
});

test("帯ごとの件数と、新しい順の記録", () => {
  const sessions = sessionsWith(["human", "approved", "approved"]);
  expect(countBands(sessions)).toEqual({ approved: 2, commented: 0, reviewing: 0, human: 1 });
  expect(recentMoves(sessions, 2).map((m) => m.pr.number)).toEqual([3, 2]);
});

test("残り時間は分と秒を 2 桁ずつで出し、負にならない", () => {
  expect(formatCountdown(7 * 60_000 + 42_000)).toBe("07:42");
  expect(formatCountdown(500)).toBe("00:01");
  expect(formatCountdown(-1)).toBe("00:00");
});
