/**
 * node:fs/promises のうち、サーバが使う関数だけを txiki.js の API で書いたもの。
 * tjs 向けにまとめるときだけ、scripts/build-server.ts が node:fs/promises をこれに差し替える
 */

const decoder = new TextDecoder();

export async function readFile(path: string, _encoding: "utf8"): Promise<string> {
  return decoder.decode(await tjs.readFile(path));
}

export async function writeFile(
  path: string,
  data: string,
  options: { mode?: number } = {},
): Promise<void> {
  await tjs.writeFile(path, data, options);
}

export async function mkdir(path: string, options: { recursive?: boolean } = {}): Promise<void> {
  await tjs.makeDir(path, options);
}

export async function mkdtemp(prefix: string): Promise<string> {
  return await tjs.makeTempDir(`${prefix}XXXXXX`);
}

export async function readdir(path: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of await tjs.readDir(path)) names.push(entry.name);
  return names;
}

/** tjs.remove は rm -rf と同じで、無いパスでも失敗しない */
export async function rm(path: string, _options?: { recursive?: boolean; force?: boolean }) {
  await tjs.remove(path);
}

export async function unlink(path: string): Promise<void> {
  await tjs.remove(path);
}

export async function rename(path: string, newPath: string): Promise<void> {
  await tjs.rename(path, newPath);
}

export async function chmod(path: string, mode: number): Promise<void> {
  await tjs.chmod(path, mode);
}

export async function stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean }> {
  const result = await tjs.stat(path);
  return { isDirectory: () => result.isDirectory, isFile: () => result.isFile };
}
