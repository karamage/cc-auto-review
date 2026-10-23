import { expect, test } from "bun:test";
import {
  cycleLgtm,
  isLgtmChoice,
  LGTM_IMAGE_IDS,
  lgtmImageUrl,
  resolveLgtmImage,
  withLgtmImage,
} from "./lgtm.ts";

const first = `![LGTM](${lgtmImageUrl(LGTM_IMAGE_IDS[0] as number)})`;
const last = `![LGTM](${lgtmImageUrl(LGTM_IMAGE_IDS.at(-1) as number)})`;

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
  expect(isLgtmChoice(1)).toBe(false);
  expect(isLgtmChoice("16343")).toBe(false);
});

test("cycleLgtm は自動、付けない、各画像の順に回り、端で反対側に戻る", () => {
  expect(cycleLgtm("random", 1)).toBe("none");
  expect(cycleLgtm("none", 1)).toBe(LGTM_IMAGE_IDS[0] as number);
  expect(cycleLgtm(LGTM_IMAGE_IDS.at(-1) as number, 1)).toBe("random");
  expect(cycleLgtm("random", -1)).toBe(LGTM_IMAGE_IDS.at(-1) as number);
});
