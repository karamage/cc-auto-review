import { expect, test } from "bun:test";
import { formatRelative, isLongComment, sizeRatio, splitPath } from "./format.ts";

const NOW = new Date("2026-10-05T12:00:00Z").getTime();

test("相対時刻は分・時間・日の単位で丸める", () => {
  expect(formatRelative("2026-10-05T11:59:40Z", NOW)).toBe("たった今");
  expect(formatRelative("2026-10-05T11:15:00Z", NOW)).toBe("45 分前");
  expect(formatRelative("2026-10-05T07:00:00Z", NOW)).toBe("5 時間前");
  expect(formatRelative("2026-10-02T12:00:00Z", NOW)).toBe("3 日前");
});

test("パスをディレクトリとファイル名に分ける", () => {
  expect(splitPath("src/a/b.ts")).toEqual({ dir: "src/a/", name: "b.ts" });
  expect(splitPath("README.md")).toEqual({ dir: "", name: "README.md" });
});

test("変更規模は最大値に対する対数比で 0〜1 に収まる", () => {
  expect(sizeRatio(0, 600)).toBe(0);
  expect(sizeRatio(600, 600)).toBe(1);
  expect(sizeRatio(10, 600)).toBeGreaterThan(0.3);
});

test("行数か文字数が多いコメントだけを長いとみなす", () => {
  expect(isLongComment("短いコメント")).toBe(false);
  expect(isLongComment(["1", "2", "3", "4", "5", "6"].join("\n"))).toBe(false);
  expect(isLongComment(["1", "2", "3", "4", "5", "6", "7"].join("\n"))).toBe(true);
  expect(isLongComment("あ".repeat(401))).toBe(true);
});
