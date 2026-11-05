import type {
  AnchoredFinding,
  ChatFinding,
  ChatReference,
  ChatTurn,
  PRRef,
} from "../../shared/types.ts";
import { ApiError, type ApiClient } from "../api.ts";
import { t } from "../i18n.ts";
import { addFinding, type DraftState } from "./draft.ts";
import type { ReviewSession, SessionStore } from "./sessions.ts";

/** AI の発言に添える指摘案。added なら下書きに追加済み */
export interface ChatProposal {
  anchored: AnchoredFinding;
  added: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** 利用者の発言が引用した箇所 */
  reference: ChatReference | null;
  proposals: ChatProposal[];
  /** 回答を受け取れなかった質問の失敗 */
  error: { message: string; raw: string | null } | null;
}

export interface ChatState {
  messages: ChatMessage[];
  pending: boolean;
  progress: string;
  /** 入力欄に付いている、次の質問で引用する箇所 */
  reference: ChatReference | null;
}

export const EMPTY_CHAT: ChatState = {
  messages: [],
  pending: false,
  progress: "",
  reference: null,
};

/** 結果がある回のコミットを表示しているときだけ質問できる。指摘の番号と diff がずれないように */
export function canChat(session: ReviewSession, headSha: string): boolean {
  return session.phase === "done" && session.headSha === headSha;
}

function updateChat(store: SessionStore, pr: PRRef, change: (chat: ChatState) => ChatState): void {
  store.update(pr, (s) => ({ ...s, chat: change(s.chat) }));
}

export function setChatReference(
  store: SessionStore,
  pr: PRRef,
  reference: ChatReference | null,
): void {
  updateChat(store, pr, (chat) => ({ ...chat, reference }));
}

/** 失敗した質問と、それより前の発言だけを AI に渡す。失敗した質問は回答が無いので文脈にならない */
function historyOf(messages: ChatMessage[]): ChatTurn[] {
  return messages
    .filter((message) => message.error === null)
    .map((message) => ({ role: message.role, text: message.text }));
}

function findingsOf(draft: DraftState): ChatFinding[] {
  return draft.items.map((item, index) => ({
    id: item.anchored.finding.id,
    number: index + 1,
    path: item.anchored.finding.path,
    line: item.anchored.finding.line,
    severity: item.anchored.finding.severity,
    title: item.anchored.finding.title,
    body: item.body,
    status: item.status,
  }));
}

export async function sendChat(
  api: ApiClient,
  store: SessionStore,
  pr: PRRef,
  headSha: string,
  text: string,
): Promise<void> {
  const question = text.trim();
  const session = store.get(pr);
  if (question === "" || session.chat.pending || !canChat(session, headSha)) return;

  const { chat, draft, model, profileId } = session;
  const id = `${Date.now()}-${chat.messages.length}`;
  const reference = chat.reference;
  const history = historyOf(chat.messages);
  updateChat(store, pr, (current) => ({
    ...current,
    pending: true,
    progress: t().chat.fetching,
    reference: null,
    messages: [
      ...current.messages,
      { id, role: "user", text: question, reference, proposals: [], error: null },
    ],
  }));

  // 再レビューや消去で会話が消えていたら、届いた結果は捨てる
  const patch = (change: (current: ChatState) => ChatState): void => {
    if (store.get(pr).chat.messages.some((message) => message.id === id)) {
      updateChat(store, pr, change);
    }
  };
  const fail = (message: string, raw: string | null = null): void => {
    patch((current) => ({
      ...current,
      pending: false,
      progress: "",
      messages: current.messages.map((item) =>
        item.id === id ? { ...item, error: { message, raw } } : item,
      ),
    }));
  };

  let finished = false;
  try {
    await api.streamChat(
      pr,
      { headSha, question, reference, history, findings: findingsOf(draft), model, profileId },
      (event) => {
        if (event.type === "snapshot_ready") {
          patch((current) => ({ ...current, progress: t().chat.reading }));
        }
        if (event.type === "answering") {
          patch((current) => ({ ...current, progress: t().chat.answering }));
        }
        if (event.type === "answer") {
          finished = true;
          patch((current) => ({
            ...current,
            pending: false,
            progress: "",
            messages: [
              ...current.messages,
              {
                id: `${id}-answer`,
                role: "assistant",
                text: event.answer,
                reference: null,
                error: null,
                // 下書きの指摘と ID が重ならないようにする
                proposals: event.proposals.map((anchored, index) => ({
                  added: false,
                  anchored: {
                    ...anchored,
                    finding: { ...anchored.finding, id: `chat-${id}-${index + 1}` },
                  },
                })),
              },
            ],
          }));
        }
        if (event.type === "error") {
          finished = true;
          fail(event.message, event.raw);
        }
      },
    );
    if (!finished) fail(t().chat.disconnected);
  } catch (e: unknown) {
    fail(e instanceof ApiError ? e.message : t().chat.failed);
  }
}

/** 失敗した質問を取り除いて、同じ内容と引用で送り直す */
export async function retryChat(
  api: ApiClient,
  store: SessionStore,
  pr: PRRef,
  headSha: string,
  messageId: string,
): Promise<void> {
  const session = store.get(pr);
  const failed = session.chat.messages.find((message) => message.id === messageId);
  if (failed === undefined || session.chat.pending || !canChat(session, headSha)) return;
  updateChat(store, pr, (chat) => ({
    ...chat,
    reference: failed.reference,
    messages: chat.messages.filter((message) => message.id !== messageId),
  }));
  await sendChat(api, store, pr, headSha, failed.text);
}

/** 指摘案を下書きに足す。下書きと発言の状態を同時に変えて、二重に追加させない */
export function addProposal(
  store: SessionStore,
  pr: PRRef,
  messageId: string,
  index: number,
): void {
  store.update(pr, (session) => {
    const message = session.chat.messages.find((item) => item.id === messageId);
    const proposal = message?.proposals[index];
    if (proposal === undefined || proposal.added) return session;
    return {
      ...session,
      draft: addFinding(session.draft, proposal.anchored),
      chat: {
        ...session.chat,
        messages: session.chat.messages.map((item) =>
          item.id !== messageId
            ? item
            : {
                ...item,
                proposals: item.proposals.map((p, i) => (i === index ? { ...p, added: true } : p)),
              },
        ),
      },
    };
  });
}

/** 実行中のまま保存された質問は、読み込んだ時点でもう走っていない */
export function restoreChat(chat: ChatState): ChatState {
  if (!chat.pending) return chat;
  const last = chat.messages.at(-1);
  return {
    ...chat,
    pending: false,
    progress: "",
    messages:
      last?.role !== "user"
        ? chat.messages
        : [
            ...chat.messages.slice(0, -1),
            { ...last, error: { message: t().chat.interrupted, raw: null } },
          ],
  };
}

/** 回答を文とコードブロックに分ける。Markdown 全体は解釈しない */
export function splitChatText(text: string): { kind: "text" | "code"; text: string }[] {
  const parts = text.split(/```[^\n]*\n([\s\S]*?)\n?```/);
  return parts.flatMap((part, index): { kind: "text" | "code"; text: string }[] => {
    if (index % 2 === 1) return [{ kind: "code", text: part }];
    return part === "" ? [] : [{ kind: "text", text: part }];
  });
}
