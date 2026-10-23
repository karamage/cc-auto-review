import { useEffect, useState } from "react";
import type { PRRef } from "../shared/types.ts";
import { PRListPage } from "./pages/PRListPage.tsx";
import { ReviewPage } from "./pages/ReviewPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { useLang } from "./i18n.ts";
import type { SessionStore } from "./state/sessions.ts";
import type { AutopilotStore } from "./state/autopilot.ts";

export type Screen = { kind: "list" } | { kind: "review"; pr: PRRef } | { kind: "settings" };

export function App({
  sessions,
  autopilot,
}: {
  sessions: SessionStore;
  autopilot: AutopilotStore;
}) {
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  // 文言は描画のたびに引くので、言語が変わったら最上位から描き直す
  const lang = useLang();
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const toList = () => setScreen({ kind: "list" });
  if (screen.kind === "settings") return <SettingsPage onBack={toList} />;
  if (screen.kind === "review") {
    return <ReviewPage sessions={sessions} pr={screen.pr} onBack={toList} />;
  }
  return (
    <PRListPage
      sessions={sessions}
      autopilot={autopilot}
      onSelect={(pr) => setScreen({ kind: "review", pr })}
      onOpenSettings={() => setScreen({ kind: "settings" })}
    />
  );
}
