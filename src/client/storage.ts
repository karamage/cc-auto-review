import type { SessionStorage } from "./state/sessions.ts";

/**
 * 画面の状態をサーバに保存する。デスクトップアプリは起動のたびにポートが変わり、
 * localStorage はオリジンごとに分かれて引き継げないので使わない。
 * 起動時にまとめて読み込んでおき、load は同期で返す。save は直前の書き込みが終わってから最新だけを送る
 */
export interface RemoteStorage extends SessionStorage {
  /** 書き込みを待つ。終了前などに使う */
  flush(): Promise<void>;
}

export async function openRemoteStorage(
  key: string,
  fetcher: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<RemoteStorage> {
  let loaded: string | null = null;
  try {
    const res = await fetcher(`/api/state/${key}`);
    if (res.ok) loaded = ((await res.json()) as { data: string | null }).data;
  } catch {
    // 読めなければ空から始める
  }

  let pending: string | null = null;
  let writing: Promise<void> = Promise.resolve();
  const write = async (): Promise<void> => {
    while (pending !== null) {
      const data = pending;
      pending = null;
      try {
        // eslint-disable-next-line no-await-in-loop -- 書き込みは順に 1 つずつ
        await fetcher(`/api/state/${key}`, { method: "PUT", body: data });
      } catch {
        // 保存に失敗しても、開いている間は手元の状態で動き続ける
      }
    }
  };

  return {
    load: () => loaded,
    save(data) {
      loaded = data;
      const idle = pending === null;
      pending = data;
      if (idle) writing = writing.then(write);
    },
    flush: () => writing,
  };
}
