// Approve のときに本文へ添える LGTM 画像（lgtmoon）
export const LGTM_IMAGE_IDS: readonly number[] = [
  185580, 210197, 648813, 648816, 108614, 198363, 157366, 157737, 118742, 114232, 141276, 163478,
  16343, 214434, 76333, 180650, 170892, 582278, 621603, 568897, 563366, 166624, 519225, 213227,
  218679, 121758, 512437, 228213,
];

/** "random" は投稿のときに一覧から選ぶ。数値は人が選んだ画像の ID */
export type LgtmChoice = "random" | "none" | number;

/** 画像を表示できない TUI で、キーを押すたびに順に切り替える並び */
export const LGTM_CHOICES: readonly LgtmChoice[] = ["random", "none", ...LGTM_IMAGE_IDS];

/** choice から step 個先の選択肢。端まで来たら反対側に回る */
export function cycleLgtm(choice: LgtmChoice, step: 1 | -1): LgtmChoice {
  const index = Math.max(0, LGTM_CHOICES.indexOf(choice));
  const next = (index + step + LGTM_CHOICES.length) % LGTM_CHOICES.length;
  return LGTM_CHOICES[next] as LgtmChoice;
}

export function lgtmImageUrl(id: number): string {
  return `https://image.lgtmoon.dev/${id}`;
}

export function isLgtmChoice(value: unknown): value is LgtmChoice {
  return value === "random" || value === "none" || LGTM_IMAGE_IDS.includes(value as number);
}

/** random は [0, 1) を返す関数。テストで固定できるよう差し替えられるようにしている */
export function resolveLgtmImage(
  choice: LgtmChoice,
  random: () => number = Math.random,
): string | null {
  if (choice === "none") return null;
  const id =
    choice === "random"
      ? LGTM_IMAGE_IDS[
          Math.min(Math.floor(random() * LGTM_IMAGE_IDS.length), LGTM_IMAGE_IDS.length - 1)
        ]
      : choice;
  return `![LGTM](${lgtmImageUrl(id as number)})`;
}

/** 本文の末尾に LGTM 画像を足す。自分で lgtmoon の画像を貼っていれば足さない */
export function withLgtmImage(body: string, choice: LgtmChoice, random?: () => number): string {
  if (body.includes("image.lgtmoon.dev/")) return body;
  const image = resolveLgtmImage(choice, random);
  if (image === null) return body;
  return body.trim().length === 0 ? image : `${body}\n\n${image}`;
}
