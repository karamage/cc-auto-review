import { t } from "./i18n.ts";

/** 「3 時間前」のような相対時刻。一覧で更新の新しさを比べるためのもので、厳密さは要らない */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const text = t().relative;
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return text.justNow;
  if (minutes < 60) return text.minutes(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return text.hours(hours);
  const days = Math.floor(hours / 24);
  if (days < 30) return text.days(days);
  return new Date(iso).toLocaleDateString(text.locale);
}

/** パスをディレクトリとファイル名に分ける。ファイル名だけを強く見せるため */
export function splitPath(path: string): { dir: string; name: string } {
  const index = path.lastIndexOf("/");
  return index === -1
    ? { dir: "", name: path }
    : { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
}

/** 変更規模を 0〜1 に圧縮する。数千行の PR で他の行のバーが潰れないよう対数で取る */
export function sizeRatio(lines: number, max: number): number {
  if (lines <= 0 || max <= 0) return 0;
  return Math.log10(lines + 1) / Math.log10(max + 1);
}

/** 折りたたまずに見せるコメントの上限。これを超えると、diff の流れを追う邪魔になる */
const COMMENT_FOLD_LINES = 6;
const COMMENT_FOLD_CHARS = 400;

/** コメントを最初は折りたたんでおくか。行数か文字数のどちらかが多ければ折りたたむ */
export function isLongComment(body: string): boolean {
  return body.split("\n").length > COMMENT_FOLD_LINES || body.length > COMMENT_FOLD_CHARS;
}
