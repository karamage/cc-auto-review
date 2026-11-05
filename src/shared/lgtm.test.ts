import { expect, test } from "bun:test";
import {
  DEFAULT_LGTM_IMAGE_IDS,
  isLgtmChoice,
  lgtmImageUrl,
  normalizeLgtmImageIds,
  parseLgtmImageIds,
  resolveLgtmImage,
  settleLgtmChoice,
  withLgtmImage,
} from "./lgtm.ts";

const first = `![LGTM](${lgtmImageUrl(DEFAULT_LGTM_IMAGE_IDS[0] as number)})`;
const last = `![LGTM](${lgtmImageUrl(DEFAULT_LGTM_IMAGE_IDS.at(-1) as number)})`;

test("random は乱数に応じて一覧から画像を選ぶ", () => {
  expect(resolveLgtmImage("random", () => 0)).toBe(first);
  expect(resolveLgtmImage("random", () => 0.9999)).toBe(last);
});

test("乱数が 1 を返しても一覧の外を指さない", () => {
  expect(resolveLgtmImage("random", () => 1)).toBe(last);
});

test("ID を選んでいればその画像を使う", () => {
  expect(resolveLgtmImage(16343)).toBe("![LGTM](https://image.lgtmoon.dev/16343)");
});

test("none なら画像を付けない", () => {
  expect(resolveLgtmImage("none")).toBeNull();
  expect(withLgtmImage("総評", "none")).toBe("総評");
});

test("本文に lgtmoon の画像がすでにあれば足さない", () => {
  const body = "いいですね\n\n![LGTM](https://image.lgtmoon.dev/16343)";
  expect(withLgtmImage(body, "random", () => 0)).toBe(body);
});

test("一覧にない ID は選択として認めない", () => {
  expect(isLgtmChoice("random")).toBe(true);
  expect(isLgtmChoice("none")).toBe(true);
  expect(isLgtmChoice(16343)).toBe(true);
  // 設定で一覧を編集できるので、一覧にない ID でも正の整数なら受け付ける
  expect(isLgtmChoice(1)).toBe(true);
  expect(isLgtmChoice(0)).toBe(false);
  expect(isLgtmChoice(-1)).toBe(false);
  expect(isLgtmChoice(1.5)).toBe(false);
  expect(isLgtmChoice("16343")).toBe(false);
});

test("既定の一覧は指定された 16 枚", () => {
  expect(DEFAULT_LGTM_IMAGE_IDS).toEqual([
    81571, 117501, 97687, 251379, 572085, 35685, 262994, 514370, 622569, 5157, 248931, 98383,
    262299, 3020, 131777, 174729,
  ]);
});

test("settleLgtmChoice は random だけを一覧の 1 枚に確定する", () => {
  expect(settleLgtmChoice("random", [10, 20], () => 0)).toBe(10);
  expect(settleLgtmChoice("random", [10, 20], () => 0.9999)).toBe(20);
  expect(settleLgtmChoice("none", [10, 20])).toBe("none");
  expect(settleLgtmChoice(5, [10, 20])).toBe(5);
});

test("normalizeLgtmImageIds は不正な値と重複を捨てる", () => {
  expect(normalizeLgtmImageIds([3, 3, "4", 0, -1, 1.5, null, 5])).toEqual([3, 5]);
});

test("normalizeLgtmImageIds は配列でないときと空になったときに既定へ戻す", () => {
  expect(normalizeLgtmImageIds(undefined)).toEqual([...DEFAULT_LGTM_IMAGE_IDS]);
  expect(normalizeLgtmImageIds([])).toEqual([...DEFAULT_LGTM_IMAGE_IDS]);
  expect(normalizeLgtmImageIds(["x", 0])).toEqual([...DEFAULT_LGTM_IMAGE_IDS]);
});

test("normalizeLgtmImageIds は多すぎる分を切る", () => {
  const many = Array.from({ length: 300 }, (_, i) => i + 1);
  expect(normalizeLgtmImageIds(many)).toHaveLength(200);
});

test("parseLgtmImageIds は数字だけの行を ID にする", () => {
  expect(parseLgtmImageIds(["12", "abc", "0", "1e3", "0x10", "34"])).toEqual([12, 34]);
  expect(parseLgtmImageIds(["99999999999999999999"])).toEqual([]);
});
