import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { defaultSettings } from "../../shared/settings.ts";
import { dataDir, SettingsStore, StateStore } from "./files.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ccar-store-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("置き場所は環境変数で変えられ、無ければ ~/.config/cc-auto-review", () => {
  expect(dataDir({ CC_AUTO_REVIEW_HOME: "/x" })).toBe("/x");
  expect(dataDir({})).toEndWith(join(".config", "cc-auto-review"));
});

test("設定ファイルが無ければ既定値、壊れていても既定値で読む", async () => {
  expect(await new SettingsStore(join(dir, "none.json")).get()).toEqual(defaultSettings());
  await writeFile(join(dir, "broken.json"), "{");
  expect(await new SettingsStore(join(dir, "broken.json")).get()).toEqual(defaultSettings());
});

test("保存した設定は検証してから書き、読み直せる", async () => {
  const path = join(dir, "nested", "settings.json");
  const saved = await new SettingsStore(path).save({ ...defaultSettings(), timeoutMinutes: 5 });
  expect(saved.timeoutMinutes).toBe(5);
  expect(JSON.parse(await readFile(path, "utf8")).timeoutMinutes).toBe(5);
  expect((await new SettingsStore(path).get()).timeoutMinutes).toBe(5);
});

test("画面の状態はキーごとのファイルに置き、無ければ null", async () => {
  const state = new StateStore(join(dir, "state"));
  expect(await state.load("sessions")).toBeNull();
  await state.save("sessions", '{"a":1}');
  expect(await state.load("sessions")).toBe('{"a":1}');
});
