import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isLang, langFromLocale } from "../shared/i18n.ts";
import { App } from "./App.tsx";
import { browserClient, browserFetch } from "./api.ts";
import { notify, routeExternalLinks } from "./desktop.ts";
import { getLang, setLang, subscribeLang, t } from "./i18n.ts";
import { setSettings } from "./settings.ts";
import { createAutopilotStore, startAutopilot, takeOverRereview } from "./state/autopilot.ts";
import { createSessionStore, watchReviewOutcomes } from "./state/sessions.ts";
import { startWatcher } from "./state/watch.ts";
import { openRemoteStorage } from "./storage.ts";
import "./styles.css";

async function bootstrap(): Promise<void> {
  const container = document.getElementById("root");
  if (container === null) throw new Error("#root not found");

  // 状態はサーバに置く。描画の前にまとめて読み込む
  const [sessionStorage, autopilotStorage, langStorage] = await Promise.all([
    openRemoteStorage("sessions", browserFetch),
    openRemoteStorage("autopilot", browserFetch),
    openRemoteStorage("lang", browserFetch),
  ]);
  try {
    setSettings(await browserClient.fetchSettings());
  } catch {
    // 読めなければ既定の設定で動く。サーバも同じ既定値を使う
  }

  // 画面で選んだ言語。選んだことが無ければ OS の言語に合わせる
  const saved = langStorage.load();
  setLang(isLang(saved) ? saved : langFromLocale(navigator.language));
  subscribeLang(() => langStorage.save(getLang()));

  /** AI レビューの結果はアプリを閉じても残す。明示的に消すまで保持する */
  const sessions = createSessionStore(sessionStorage);
  /** 完全自動運転のオン・オフ。オンにしたことはアプリを閉じても覚えておく */
  const autopilot = createAutopilotStore(autopilotStorage);

  routeExternalLinks(browserClient.post);

  // 投稿した PR に作成者の修正か返信が来たら、AI レビューをやり直す。アプリを開いている間だけ動く。
  // 完全自動運転がコメントした PR は、自動運転が引き取って投稿まで行う
  startWatcher(
    browserClient,
    sessions,
    undefined,
    (pr, now) => autopilot.get().enabled && takeOverRereview(sessions, pr, now),
  );

  // 人の判断が要る PR を、ほかのアプリを見ていても気づけるよう OS に通知する
  startAutopilot(browserClient, sessions, autopilot, (pr, reasons) =>
    notify(
      browserClient.post,
      t().autopilot.notifyTitle(`${pr.repo}#${pr.number}`),
      `${pr.title}\n${reasons.join("\n")}`,
    ),
  );

  // AI レビューが終わったら、ほかのアプリを見ていても気づけるよう OS に通知する。
  // アプリを見ている間は画面で分かるので、通知しない
  watchReviewOutcomes(sessions, (pr, session) => {
    if (document.hasFocus()) return;
    const text = t().session;
    const name = `${pr.repo}#${pr.number}`;
    if (session.phase === "failed") {
      notify(browserClient.post, text.notifyFailed(name), session.error?.message ?? "");
    } else {
      notify(
        browserClient.post,
        text.notifyDone(name),
        text.notifyFindings(session.draft.items.length),
      );
    }
  });

  createRoot(container).render(
    <StrictMode>
      <App sessions={sessions} autopilot={autopilot} />
    </StrictMode>,
  );
}

void bootstrap();
