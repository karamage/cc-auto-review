import { expect, test } from "bun:test";
import { openRemoteStorage, SAVE_DELAY_MS } from "./storage.ts";

function fakeServer() {
  const writes: string[] = [];
  const fetcher = (_path: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === "PUT") writes.push(init.body as string);
    return Promise.resolve(Response.json({ data: "saved" }));
  };
  return { writes, fetcher };
}

test("saveLazy は続けて呼んでも、最後の状態だけを 1 回 JSON にして送る", async () => {
  const { writes, fetcher } = fakeServer();
  const storage = await openRemoteStorage("sessions", fetcher);
  let serialized = 0;
  for (const n of [1, 2, 3]) {
    storage.saveLazy?.(() => {
      serialized += 1;
      return `v${n}`;
    });
  }
  expect(writes).toEqual([]);

  await Bun.sleep(SAVE_DELAY_MS + 50);
  await storage.flush();
  expect(serialized).toBe(1);
  expect(writes).toEqual(["v3"]);
});

test("flush は待たずに書き出す。load は書き出す前の最新の状態を返す", async () => {
  const { writes, fetcher } = fakeServer();
  const storage = await openRemoteStorage("sessions", fetcher);
  expect(storage.load()).toBe("saved");

  storage.saveLazy?.(() => "v1");
  expect(storage.load()).toBe("v1");
  await storage.flush();
  expect(writes).toEqual(["v1"]);
});

test("後から save したものは、待っている saveLazy で上書きされない", async () => {
  const { writes, fetcher } = fakeServer();
  const storage = await openRemoteStorage("sessions", fetcher);
  storage.saveLazy?.(() => "lazy");
  storage.save("direct");
  await Bun.sleep(SAVE_DELAY_MS + 50);
  await storage.flush();
  expect(writes).toEqual(["direct"]);
});
