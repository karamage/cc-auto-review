import { isLang, LANGS } from "../../shared/i18n.ts";
import { setLang, t, useLang } from "../i18n.ts";

/** 画面の言語の切り替え。言語の名前は、それぞれの言語自身の表記で出す */
export function LanguageSwitch() {
  const lang = useLang();
  return (
    <label className="language-switch">
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="1.2">
          <circle cx="8" cy="8" r="6.4" />
          <ellipse cx="8" cy="8" rx="2.8" ry="6.4" />
          <path d="M1.6 8h12.8M2.6 4.8h10.8M2.6 11.2h10.8" />
        </g>
      </svg>
      <span className="visually-hidden">{t().languageSwitch}</span>
      <select
        value={lang}
        onChange={(e) => {
          if (isLang(e.target.value)) setLang(e.target.value);
        }}
      >
        {LANGS.map((option) => (
          <option key={option} value={option} lang={option}>
            {t().languageName[option]}
          </option>
        ))}
      </select>
      <svg
        className="language-switch-caret"
        viewBox="0 0 10 6"
        width="9"
        height="6"
        aria-hidden="true"
      >
        <path d="m1 1 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    </label>
  );
}
