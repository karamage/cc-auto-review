import { expect, test } from "bun:test";
import { LEARNING_MAX_PENDING, LEARNING_PROMPT_LIMIT } from "../../shared/types.ts";
import { LearningError, LearningStore } from "./learnings.ts";
import { MemoryLearningFile } from "./memory.ts";

function build(file = new MemoryLearningFile()) {
  return { file, store: new LearningStore(file, () => new Date("2026-11-10T00:00:00Z")) };
}

test("人が書いた学びは採用済みで保存し、repo は小文字に揃える", async () => {
  const { store } = build();
  const item = await store.add("Owner/Repo", "  意図的なパターン  ");
  expect(item).toMatchObject({
    repo: "owner/repo",
    text: "意図的なパターン",
    status: "active",
    source: "human",
    prNumber: null,
    inPrompt: true,
  });
  expect(await store.forPrompt("OWNER/repo")).toEqual(["意図的なパターン"]);
});

test("候補は採用するまでプロンプトに入らない", async () => {
  const { store } = build();
  await store.addCandidates("o/r", 12, ["候補"]);
  expect(await store.forPrompt("o/r")).toEqual([]);
  const [candidate] = await store.list();
  expect(candidate).toMatchObject({
    status: "candidate",
    source: "ai",
    prNumber: 12,
    inPrompt: false,
  });
  await store.update(candidate!.id, { adopt: true, text: "直した候補" });
  expect(await store.forPrompt("o/r")).toEqual(["直した候補"]);
});

test("候補は 1 回 3 件まで、500 文字まで。重複と空は足さない", async () => {
  const { store } = build();
  await store.add("o/r", "採用済み の 内容");
  await store.addCandidates("o/r", 1, [
    "採用済み  の\n内容",
    "",
    "a",
    "a ",
    "x".repeat(600),
    "b",
    "c",
  ]);
  const candidates = (await store.list()).filter((l) => l.status === "candidate");
  expect(candidates.map((l) => l.text.length)).toEqual([1, 500, 1]);
  expect(candidates.map((l) => l.text[0])).toEqual(["a", "x", "b"]);
});

test("候補は上限を超えると古いものから捨てる", async () => {
  const { store } = build();
  for (let i = 0; i < LEARNING_MAX_PENDING + 1; i += 1) {
    await store.addCandidates("o/r", 1, [`候補${i}`]);
  }
  const texts = (await store.list()).map((l) => l.text);
  expect(texts).toHaveLength(LEARNING_MAX_PENDING);
  expect(texts).not.toContain("候補0");
});

test("プロンプトには固定を残し、残りの枠に新しいものから入れ、古い順に並べる", async () => {
  const { store } = build();
  const first = await store.add("o/r", "固定する最古");
  await store.update(first.id, { pinned: true });
  for (let i = 0; i < LEARNING_PROMPT_LIMIT; i += 1) await store.add("o/r", `学び${i}`);
  const prompt = await store.forPrompt("o/r");
  expect(prompt).toHaveLength(LEARNING_PROMPT_LIMIT);
  expect(prompt[0]).toBe("固定する最古");
  expect(prompt).not.toContain("学び0");
  expect(prompt.at(-1)).toBe(`学び${LEARNING_PROMPT_LIMIT - 1}`);
  const dropped = (await store.list()).find((l) => l.text === "学び0");
  expect(dropped?.inPrompt).toBe(false);
});

test("固定は上限の数までで、超えると 400 にする", async () => {
  const { store } = build();
  for (let i = 0; i < LEARNING_PROMPT_LIMIT; i += 1) {
    const item = await store.add("o/r", `学び${i}`);
    await store.update(item.id, { pinned: true });
  }
  const extra = await store.add("o/r", "もう 1 件");
  const error = await store.update(extra.id, { pinned: true }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(LearningError);
  expect((error as LearningError).status).toBe(400);
});

test("採用済みを候補に戻すと固定も外れる", async () => {
  const { store } = build();
  const item = await store.add("o/r", "学び");
  await store.update(item.id, { pinned: true });
  expect(await store.update(item.id, { adopt: false })).toMatchObject({
    status: "candidate",
    pinned: false,
    inPrompt: false,
  });
});

test("空の本文、長すぎる本文、不正な repo は 400、無い id は 404", async () => {
  const { store } = build();
  const statusOf = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: LearningError) => e.status,
    );
  expect(await statusOf(store.add("o/r", "  "))).toBe(400);
  expect(await statusOf(store.add("o/r", "x".repeat(2001)))).toBe(400);
  expect(await statusOf(store.add("not-a-repo", "学び"))).toBe(400);
  expect(await statusOf(store.add("../r", "学び"))).toBe(400);
  expect(await statusOf(store.update(999, { pinned: true }))).toBe(404);
  expect(await statusOf(store.remove(999))).toBe(404);
});

test("remove は 1 件消し、reset は repo ごと、または全部を消して件数を返す", async () => {
  const { store } = build();
  const item = await store.add("o/a", "1");
  await store.add("o/a", "2");
  await store.add("o/b", "3");
  await store.addCandidates("o/c", 1, ["4"]);
  await store.remove(item.id);
  expect(await store.reset("O/A")).toBe(1);
  expect((await store.list()).map((l) => l.repo)).toEqual(["o/b", "o/c"]);
  expect(await store.reset()).toBe(2);
  expect(await store.list()).toEqual([]);
});

test("並列の書き込みでも失わず、id は重複しない", async () => {
  const { store } = build();
  await Promise.all(["a", "b", "c", "d"].map((t, i) => store.addCandidates("o/r", i, [t])));
  const items = await store.list();
  expect(items.map((l) => l.text).sort()).toEqual(["a", "b", "c", "d"]);
  expect(new Set(items.map((l) => l.id)).size).toBe(4);
});

test("保存した内容を読み直せて、id は続きから振る", async () => {
  const file = new MemoryLearningFile();
  const first = await build(file).store.add("o/r", "学び");
  const reloaded = build(file).store;
  expect(await reloaded.forPrompt("o/r")).toEqual(["学び"]);
  expect((await reloaded.add("o/r", "次")).id).toBeGreaterThan(first.id);
});

test("壊れたファイルは退避して空で始める", async () => {
  const file = new MemoryLearningFile();
  file.data = "{ 壊れている";
  const { store } = build(file);
  expect(await store.list()).toEqual([]);
  expect(file.quarantined).toBe(1);
  await store.add("o/r", "学び");
  expect(JSON.parse(file.data).items).toHaveLength(1);
});

test("形の崩れた項目は読み飛ばす", async () => {
  const file = new MemoryLearningFile();
  file.data = JSON.stringify({ nextId: 2, items: [{ id: "x" }, null] });
  expect(await build(file).store.list()).toEqual([]);
  expect(file.quarantined).toBe(0);
});

test("保存に失敗したら、メモリの内容も変えない", async () => {
  const file = new MemoryLearningFile();
  const { store } = build(file);
  file.failSave = true;
  await expect(store.add("o/r", "学び")).rejects.toThrow();
  file.failSave = false;
  expect(await store.list()).toEqual([]);
});

test("候補が足されなかったときは書き込まない", async () => {
  const file = new MemoryLearningFile();
  const { store } = build(file);
  expect(await store.addCandidates("o/r", 1, [])).toBe(0);
  expect(file.data).toBeNull();
});
