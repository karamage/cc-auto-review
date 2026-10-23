/**
 * デスクトップアプリとして動くための部品。
 * webview ではブラウザの通知も新しいウィンドウも使えないので、サーバ経由で OS に頼む
 */

const TOKEN_KEY = "cc-auto-review:token";

/** API の合言葉。デスクトップアプリが URL の ?token= で渡す。再読み込みしても使えるよう覚えておく */
export function apiToken(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("token");
    if (fromUrl !== null) {
      sessionStorage.setItem(TOKEN_KEY, fromUrl);
      return fromUrl;
    }
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

type Post = (path: string, body: unknown) => Promise<unknown>;

/** 外部の URL を既定のブラウザで開く */
export function openExternal(post: Post, url: string): void {
  void post("/api/system/open", { url }).catch(() => {
    // サーバに頼めなければ、webview に任せる
    window.open(url, "_blank", "noopener,noreferrer");
  });
}

/**
 * 画面の外へのリンクを、webview の中ではなく既定のブラウザで開く。
 * リンクごとに書き換えずに済むよう、文書全体のクリックで拾う
 */
export function routeExternalLinks(post: Post): void {
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = (event.target as Element | null)?.closest?.("a[href]") as
      | HTMLAnchorElement
      | null
      | undefined;
    if (anchor === null || anchor === undefined) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin === window.location.origin) return;
    if (url.protocol !== "https:" && url.protocol !== "http:") return;
    event.preventDefault();
    openExternal(post, url.href);
  });
}

/** OS の通知を出す。出せなくても一覧には印が残るので、失敗は無視する */
export function notify(post: Post, title: string, body: string): void {
  void post("/api/system/notify", { title, body }).catch(() => {});
}
