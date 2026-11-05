import { expect, test } from "bun:test";
import type { AnchoredFinding, ChatRequest, ChatStreamEvent } from "../../shared/types.ts";
import type { ApiClient } from "../api.ts";
import { ApiError } from "../api.ts";
import {
  addProposal,
  canChat,
  retryChat,
  sendChat,
  setChatReference,
  splitChatText,
} from "./chat.ts";
import { initDraft } from "./draft.ts";
import { createSessionStore, runReview, type SessionStorage } from "./sessions.ts";

const pr = { repo: "o/r", number: 1 };

function finding(id: string): AnchoredFinding {
  return {
    finding: {
      id,
      path: "a.ts",
      line: 1,
      severity: "should",
      title: "題",
      body: "本文",
      trigger: "",
      impact: "",
    },
    anchor: "line",
    reason: null,
  };
}

function reviewedStore(storage: SessionStorage | null = null) {
  const store = createSessionStore(storage);
  store.update(pr, (s) => ({
    ...s,
    phase: "done",
    headSha: "abc",
    draft: initDraft([finding("finding-1")], "ja"),
  }));
  return store;
}

function chatApi(
  respond: (request: ChatRequest, onEvent: (event: ChatStreamEvent) => void) => void | Promise<void>,
): ApiClient {
  return {
    async streamChat(_pr: unknown, request: ChatRequest, onEvent: (e: ChatStreamEvent) => void) {
      await respond(request, onEvent);
    },
  } as unknown as ApiClient;
}

test("レビュー完了後で、表示中の head と同じときだけ質問できる", () => {
  const store = reviewedStore();
  expect(canChat(store.get(pr), "abc")).toBe(true);
  expect(canChat(store.get(pr), "other")).toBe(false);
  store.update(pr, (s) => ({ ...s, phase: "running" }));
  expect(canChat(store.get(pr), "abc")).toBe(false);
});

test("質問を送り、回答を発言に加える。指摘案には下書きと重ならない ID を付ける", async () => {
  const store = reviewedStore();
  setChatReference(store, pr, { kind: "finding", findingId: "finding-1" });
  let request: ChatRequest | null = null;
  const api = chatApi((req, onEvent) => {
    request = req;
    expect(store.get(pr).chat.pending).toBe(true);
    onEvent({ type: "answer", answer: "回答", proposals: [finding("finding-1")] });
  });

  await sendChat(api, store, pr, "abc", " 質問 ");

  const { chat } = store.get(pr);
  expect(chat.pending).toBe(false);
  expect(chat.reference).toBeNull();
  expect(chat.messages.map((m) => [m.role, m.text])).toEqual([
    ["user", "質問"],
    ["assistant", "回答"],
  ]);
  expect(chat.messages[1]?.proposals[0]?.anchored.finding.id).not.toBe("finding-1");
  expect(request!.reference).toEqual({ kind: "finding", findingId: "finding-1" });
  expect(request!.findings[0]).toMatchObject({ id: "finding-1", number: 1, status: "pending" });
  expect(request!.history).toEqual([]);
});

test("失敗した質問は履歴に含めず、再送すると置き換わる", async () => {
  const store = reviewedStore();
  await sendChat(
    chatApi((_req, onEvent) => onEvent({ type: "error", message: "失敗", raw: null })),
    store,
    pr,
    "abc",
    "質問",
  );
  const failed = store.get(pr).chat.messages[0]!;
  expect(failed.error?.message).toBe("失敗");

  let history: ChatRequest["history"] = [{ role: "user", text: "未設定" }];
  await retryChat(
    chatApi((req, onEvent) => {
      history = req.history;
      onEvent({ type: "answer", answer: "回答", proposals: [] });
    }),
    store,
    pr,
    "abc",
    failed.id,
  );

  expect(history).toEqual([]);
  expect(store.get(pr).chat.messages.map((m) => m.text)).toEqual(["質問", "回答"]);
});

test("接続が結果なしで閉じたら失敗として出す", async () => {
  const store = reviewedStore();
  await sendChat(chatApi(() => {}), store, pr, "abc", "質問");
  expect(store.get(pr).chat.messages[0]?.error).not.toBeNull();
  expect(store.get(pr).chat.pending).toBe(false);
});

test("API の例外は発言の失敗として出す", async () => {
  const store = reviewedStore();
  await sendChat(
    chatApi(() => {
      throw new ApiError("開始できない", null);
    }),
    store,
    pr,
    "abc",
    "質問",
  );
  expect(store.get(pr).chat.messages[0]?.error?.message).toBe("開始できない");
});

test("実行中と利用できない状態では送らない", async () => {
  const store = reviewedStore();
  let calls = 0;
  const api = chatApi(() => {
    calls += 1;
  });
  store.update(pr, (s) => ({ ...s, chat: { ...s.chat, pending: true } }));
  await sendChat(api, store, pr, "abc", "質問");
  store.update(pr, (s) => ({ ...s, chat: { ...s.chat, pending: false } }));
  await sendChat(api, store, pr, "other", "質問");
  await sendChat(api, store, pr, "abc", "  ");
  expect(calls).toBe(0);
});

test("指摘案を未判定で下書きに追加し、二重には追加しない", async () => {
  const store = reviewedStore();
  await sendChat(
    chatApi((_req, onEvent) =>
      onEvent({ type: "answer", answer: "回答", proposals: [finding("finding-1")] }),
    ),
    store,
    pr,
    "abc",
    "質問",
  );
  const messageId = store.get(pr).chat.messages[1]!.id;

  addProposal(store, pr, messageId, 0);
  addProposal(store, pr, messageId, 0);

  const { draft, chat } = store.get(pr);
  expect(draft.items).toHaveLength(2);
  expect(draft.items[1]?.status).toBe("pending");
  expect(chat.messages[1]?.proposals[0]?.added).toBe(true);
});

test("再レビューを始めると会話を消し、前の回答が遅れて届いても捨てる", async () => {
  const store = reviewedStore();
  let finish: (() => void) | null = null;
  const pending = sendChat(
    chatApi(
      (_req, onEvent) =>
        new Promise<void>((resolve) => {
          finish = () => {
            onEvent({ type: "answer", answer: "遅れた回答", proposals: [] });
            resolve();
          };
        }),
    ),
    store,
    pr,
    "abc",
    "質問",
  );

  const reviewApi = {
    async streamReview(_pr: unknown, _sha: unknown, _options: unknown, onEvent: (e: unknown) => void) {
      onEvent({ type: "findings", findings: [], priorChecks: [] });
    },
  } as unknown as ApiClient;
  await runReview(reviewApi, store, pr, "abc");
  expect(store.get(pr).chat.messages).toEqual([]);

  finish!();
  await pending;
  expect(store.get(pr).chat.messages).toEqual([]);
  expect(store.get(pr).chat.pending).toBe(false);
});

test("実行中に保存された会話は、読み込むと失敗として出す。chat の無い保存データは空にする", () => {
  const stored = {
    "o/r#1": {
      phase: "done",
      chat: {
        pending: true,
        progress: "取得中",
        reference: null,
        messages: [
          { id: "1", role: "user", text: "質問", reference: null, proposals: [], error: null },
        ],
      },
    },
    "o/r#2": { phase: "done" },
  };
  const data = JSON.stringify(stored);
  const store = createSessionStore({ load: () => data, save: () => {} });

  const { chat } = store.get(pr);
  expect(chat.pending).toBe(false);
  expect(chat.messages[0]?.error).not.toBeNull();
  expect(store.get({ repo: "o/r", number: 2 }).chat.messages).toEqual([]);
});

test("回答を文とコードブロックに分ける", () => {
  expect(splitChatText("前\n```ts\nconst a = 1;\n```\n後")).toEqual([
    { kind: "text", text: "前\n" },
    { kind: "code", text: "const a = 1;" },
    { kind: "text", text: "\n後" },
  ]);
  expect(splitChatText("文だけ")).toEqual([{ kind: "text", text: "文だけ" }]);
});
