/** node:path のうち、サーバが使う関数だけを txiki.js の tjs:path で書いたもの */
import path from "tjs:path";

export const sep = path.sep;
export const delimiter = path.delimiter;

export function join(...paths: string[]): string {
  return path.join(...paths);
}

export function resolve(...paths: string[]): string {
  return path.resolve(...paths);
}

export function dirname(p: string): string {
  return path.dirname(p);
}

export function basename(p: string): string {
  return path.basename(p);
}
