/** node:os のうち、サーバが使う関数だけを txiki.js の API で書いたもの */

export function homedir(): string {
  return tjs.homeDir;
}

export function tmpdir(): string {
  return tjs.tmpDir;
}
