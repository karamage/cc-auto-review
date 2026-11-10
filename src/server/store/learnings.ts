import type { LocalizedText } from "../../shared/i18n.ts";
import {
  type Learning,
  LEARNING_MAX_CANDIDATE_LENGTH,
  LEARNING_MAX_PENDING,
  LEARNING_MAX_PER_RUN,
  LEARNING_MAX_TEXT_LENGTH,
  LEARNING_PROMPT_LIMIT,
  type LearningPatch,
} from "../../shared/types.ts";
import { AppError } from "../errors.ts";

/** 入力の誤りと、無い項目の指定。ルートが status のまま返す */
export class LearningError extends AppError {
  constructor(
    message: LocalizedText,
    readonly status: 400 | 404,
  ) {
    super(message);
    this.name = "LearningError";
  }
}

/** 学びの保存先。本番はファイル、テストはメモリ */
export interface LearningFile {
  load(): Promise<string | null>;
  save(data: string): Promise<void>;
  /** 読めなかったファイルを脇へ移す。次の書き込みで元の内容を消さないため */
  quarantine(): Promise<void>;
}

type StoredLearning = Omit<Learning, "inPrompt">;

interface Book {
  nextId: number;
  items: StoredLearning[];
}

const REPO = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/;

function checkRepo(value: string): string {
  const repo = value.trim().toLowerCase();
  const valid = REPO.test(repo) && repo.split("/").every((n) => n !== "." && n !== "..");
  if (!valid) {
    throw new LearningError(
      {
        ja: `owner/repo の形で指定してください: ${value}`,
        en: `Use the owner/repo form: ${value}`,
      },
      400,
    );
  }
  return repo;
}

function checkText(value: string): string {
  const text = value.trim();
  if (text === "") {
    throw new LearningError({ ja: "学びの本文が空です", en: "The learning is empty" }, 400);
  }
  if (text.length > LEARNING_MAX_TEXT_LENGTH) {
    throw new LearningError(
      {
        ja: `学びの本文は ${LEARNING_MAX_TEXT_LENGTH} 文字以内にしてください`,
        en: `A learning can be at most ${LEARNING_MAX_TEXT_LENGTH} characters`,
      },
      400,
    );
  }
  return text;
}

/** 重複の判定に使う。空白の違いだけのものは同じとみなす */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 1 冊のうち、プロンプトに入れる項目の id。固定を残し、残りの枠に新しいものから入れる */
function promptIds(items: readonly StoredLearning[]): Set<number> {
  const active = items.filter((item) => item.status === "active");
  const pinned = active.filter((item) => item.pinned);
  const rest = active
    .filter((item) => !item.pinned)
    .sort((a, b) => b.id - a.id)
    .slice(0, Math.max(0, LEARNING_PROMPT_LIMIT - pinned.length));
  return new Set([...pinned, ...rest].map((item) => item.id));
}

function isStored(value: unknown): value is StoredLearning {
  const item = value as StoredLearning | null;
  return (
    typeof item === "object" &&
    item !== null &&
    Number.isInteger(item.id) &&
    typeof item.repo === "string" &&
    typeof item.text === "string" &&
    (item.status === "candidate" || item.status === "active") &&
    typeof item.pinned === "boolean" &&
    (item.source === "ai" || item.source === "human") &&
    (item.prNumber === null || typeof item.prNumber === "number") &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string"
  );
}

/** JSON として読めなければ例外。形の崩れた項目だけなら、読める分を使う */
function parseBook(raw: string): Book {
  const parsed = JSON.parse(raw) as { nextId?: unknown; items?: unknown } | null;
  if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.items)) {
    throw new Error("Unexpected shape");
  }
  const items = parsed.items.filter(isStored);
  const nextId = typeof parsed.nextId === "number" ? parsed.nextId : 1;
  return { nextId: Math.max(nextId, ...items.map((item) => item.id + 1)), items };
}

/**
 * 学び帳。repo ごとに、採用済みの項目と AI が出した候補を持つ。
 * レビューは並列で走るので、読み出しと書き込みを 1 列に並べる
 */
export class LearningStore {
  private book: Book | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: LearningFile,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  private async load(): Promise<Book> {
    if (this.book !== null) return this.book;
    const raw = await this.file.load();
    let book: Book = { nextId: 1, items: [] };
    if (raw !== null) {
      try {
        book = parseBook(raw);
      } catch {
        console.error("Could not parse the learnings file. Moving it aside.");
        await this.file.quarantine();
      }
    }
    this.book = book;
    return book;
  }

  /** 写しを change に渡し、保存できたものだけを手元の内容にする */
  private mutate<T>(change: (book: Book) => { result: T; changed: boolean }): Promise<T> {
    return this.enqueue(async () => {
      const current = await this.load();
      const next: Book = {
        nextId: current.nextId,
        items: current.items.map((item) => ({ ...item })),
      };
      const { result, changed } = change(next);
      if (changed) {
        await this.file.save(`${JSON.stringify(next, null, 2)}\n`);
        this.book = next;
      }
      return result;
    });
  }

  private view(book: Book, item: StoredLearning): Learning {
    const inPrompt = promptIds(book.items.filter((other) => other.repo === item.repo));
    return { ...item, inPrompt: inPrompt.has(item.id) };
  }

  /** 画面に出す一覧。repo ごとにプロンプトに入るかの印を付ける */
  list(): Promise<Learning[]> {
    return this.enqueue(async () => {
      const book = await this.load();
      const inPrompt = new Set<number>();
      for (const repo of new Set(book.items.map((item) => item.repo))) {
        for (const id of promptIds(book.items.filter((item) => item.repo === repo))) {
          inPrompt.add(id);
        }
      }
      return book.items.map((item) => ({ ...item, inPrompt: inPrompt.has(item.id) }));
    });
  }

  /** プロンプトに入れる本文。古いものから順に並べる */
  forPrompt(repo: string): Promise<string[]> {
    const key = repo.toLowerCase();
    return this.enqueue(async () => {
      const items = (await this.load()).items.filter((item) => item.repo === key);
      const ids = promptIds(items);
      return items.filter((item) => ids.has(item.id)).map((item) => item.text);
    });
  }

  /** 人が書き足す。確かめる必要が無いので、そのまま採用済みにする */
  async add(repoValue: string, textValue: string): Promise<Learning> {
    const repo = checkRepo(repoValue);
    const text = checkText(textValue);
    return this.mutate((book) => {
      const at = this.now().toISOString();
      const item: StoredLearning = {
        id: book.nextId,
        repo,
        text,
        status: "active",
        pinned: false,
        source: "human",
        prNumber: null,
        createdAt: at,
        updatedAt: at,
      };
      book.nextId += 1;
      book.items.push(item);
      return { result: this.view(book, item), changed: true };
    });
  }

  /** AI が出した候補を足す。既にある内容と空のものは足さない。足した件数を返す */
  async addCandidates(
    repoValue: string,
    prNumber: number,
    texts: readonly string[],
  ): Promise<number> {
    const repo = checkRepo(repoValue);
    return this.mutate((book) => {
      const at = this.now().toISOString();
      const known = new Set(
        book.items.filter((item) => item.repo === repo).map((item) => normalize(item.text)),
      );
      let added = 0;
      for (const raw of texts) {
        if (added >= LEARNING_MAX_PER_RUN) break;
        const text = normalize(raw).slice(0, LEARNING_MAX_CANDIDATE_LENGTH);
        if (text === "" || known.has(text)) continue;
        known.add(text);
        book.items.push({
          id: book.nextId,
          repo,
          text,
          status: "candidate",
          pinned: false,
          source: "ai",
          prNumber,
          createdAt: at,
          updatedAt: at,
        });
        book.nextId += 1;
        added += 1;
      }
      const pending = book.items.filter(
        (item) => item.repo === repo && item.status === "candidate",
      );
      const dropped = new Set(
        pending.slice(0, Math.max(0, pending.length - LEARNING_MAX_PENDING)).map((item) => item.id),
      );
      book.items = book.items.filter((item) => !dropped.has(item.id));
      return { result: added, changed: added > 0 };
    });
  }

  /** 本文の修正、固定の切り替え、候補の採用と、採用済みを候補に戻すこと */
  async update(id: number, patch: LearningPatch): Promise<Learning> {
    const text = patch.text === undefined ? undefined : checkText(patch.text);
    return this.mutate((book) => {
      const item = book.items.find((candidate) => candidate.id === id);
      if (item === undefined) throw notFound(id);
      const status =
        patch.adopt === true ? "active" : patch.adopt === false ? "candidate" : item.status;
      // 候補は固定しない。固定は採用済みの中でプロンプトに残すためのもの
      const pinned = status === "candidate" ? false : (patch.pinned ?? item.pinned);
      if (pinned && !item.pinned) {
        const count = book.items.filter((other) => other.repo === item.repo && other.pinned).length;
        if (count >= LEARNING_PROMPT_LIMIT) {
          throw new LearningError(
            {
              ja: `固定できるのは ${LEARNING_PROMPT_LIMIT} 件までです`,
              en: `You can pin at most ${LEARNING_PROMPT_LIMIT} learnings`,
            },
            400,
          );
        }
      }
      item.text = text ?? item.text;
      item.status = status;
      item.pinned = pinned;
      item.updatedAt = this.now().toISOString();
      return { result: this.view(book, item), changed: true };
    });
  }

  /** 採用済みの削除と、候補の却下の両方に使う */
  remove(id: number): Promise<void> {
    return this.mutate((book) => {
      if (!book.items.some((item) => item.id === id)) throw notFound(id);
      book.items = book.items.filter((item) => item.id !== id);
      return { result: undefined, changed: true };
    });
  }

  /** repo を省くと、すべての repo を空にする。消した件数を返す */
  async reset(repoValue?: string): Promise<number> {
    const repo = repoValue === undefined ? undefined : checkRepo(repoValue);
    return this.mutate((book) => {
      const before = book.items.length;
      book.items = repo === undefined ? [] : book.items.filter((item) => item.repo !== repo);
      const removed = before - book.items.length;
      return { result: removed, changed: removed > 0 };
    });
  }
}

function notFound(id: number): LearningError {
  return new LearningError(
    { ja: `学び ${id} が見つかりません`, en: `Learning ${id} was not found` },
    404,
  );
}
