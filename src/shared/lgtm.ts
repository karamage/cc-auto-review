// Approve のときに本文へ添える LGTM 画像（lgtmoon）。一覧は設定画面で編集できる
export const DEFAULT_LGTM_IMAGE_IDS: readonly number[] = [
  81571, 117501, 97687, 251379, 572085, 35685, 262994, 514370, 622569, 5157, 248931, 98383, 262299,
  3020, 131777, 174729,
];

/** 設定に残せる画像の数の上限 */
const MAX_LGTM_IMAGE_IDS = 200;

/** "random" は投稿のときに一覧から選ぶ。数値は人が選んだ画像の ID */
export type LgtmChoice = "random" | "none" | number;

function isLgtmImageId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

/** 保存する一覧を整える。1 枚も残らなければ既定に戻す。付けたくないときは「付けない」を選ぶ */
export function normalizeLgtmImageIds(raw: unknown): number[] {
  const ids = Array.isArray(raw) ? [...new Set(raw.filter(isLgtmImageId))] : [];
  return ids.length > 0 ? ids.slice(0, MAX_LGTM_IMAGE_IDS) : [...DEFAULT_LGTM_IMAGE_IDS];
}

/** 設定画面の入力行を ID にする。数字だけの行を使い、それ以外は捨てる */
export function parseLgtmImageIds(lines: readonly string[]): number[] {
  return lines
    .filter((line) => /^\d+$/.test(line))
    .map(Number)
    .filter(isLgtmImageId);
}

export function lgtmImageUrl(id: number): string {
  return `https://image.lgtmoon.dev/${id}`;
}

export function isLgtmChoice(value: unknown): value is LgtmChoice {
  return value === "random" || value === "none" || isLgtmImageId(value);
}

/** random は [0, 1) を返す関数。テストで固定できるよう差し替えられるようにしている */
function pickLgtmImageId(ids: readonly number[], random: () => number): number {
  return ids[Math.min(Math.floor(random() * ids.length), ids.length - 1)] as number;
}

/** "random" を一覧の 1 枚に確定する。それ以外の指定はそのまま返す */
export function settleLgtmChoice(
  choice: LgtmChoice,
  ids: readonly number[],
  random: () => number = Math.random,
): LgtmChoice {
  return choice === "random" ? pickLgtmImageId(ids, random) : choice;
}

export function resolveLgtmImage(
  choice: LgtmChoice,
  random: () => number = Math.random,
): string | null {
  if (choice === "none") return null;
  const id = settleLgtmChoice(choice, DEFAULT_LGTM_IMAGE_IDS, random);
  return `![LGTM](${lgtmImageUrl(id as number)})`;
}

/** 本文の末尾に LGTM 画像を足す。自分で lgtmoon の画像を貼っていれば足さない */
export function withLgtmImage(body: string, choice: LgtmChoice, random?: () => number): string {
  if (body.includes("image.lgtmoon.dev/")) return body;
  const image = resolveLgtmImage(choice, random);
  if (image === null) return body;
  return body.trim().length === 0 ? image : `${body}\n\n${image}`;
}
