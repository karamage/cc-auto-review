// リスクの点数のデモ。docs/engine.js はアプリと同じ採点コードで、ブラウザの中だけで計算する
(() => {
  const form = document.querySelector("[data-risk-form]");
  if (!form || !window.CCAutoReviewRisk) return;
  const lang = document.documentElement.lang === "ja" ? "ja" : "en";
  const T = {
    en: {
      badUrl: "Enter a pull request URL like github.com/owner/repo/pull/123.",
      notFound: "GitHub could not find that pull request. Only public repositories work here. For a private one, paste its diff below, or use the app.",
      rate: "GitHub allows 60 anonymous API requests an hour from one network, and that limit is used up. Try again later, or paste the diff below.",
      tooBig: "GitHub would not return a diff this large. Pick a smaller pull request, or paste the diff below.",
      net: "Could not reach GitHub. Check your connection, or paste the diff below.",
      empty: "That text has no diff in it. Paste the output of git diff or gh pr diff.",
      scoring: "Scoring…",
      score: "Score it",
      human: "The autopilot would hand this to you and post nothing.",
      auto: "The autopilot would review it on its own.",
      pasted: "Pasted diff",
    },
    ja: {
      badUrl: "github.com/owner/repo/pull/123 の形で PR の URL を入力してください。",
      notFound: "GitHub でその PR が見つかりません。ここで採点できるのは公開リポジトリだけです。非公開の PR は下に diff を貼るか、アプリで開いてください。",
      rate: "GitHub API の匿名利用の上限（同じネットワークから 1 時間に 60 回）に達しました。時間をおくか、下に diff を貼ってください。",
      tooBig: "diff が大きすぎて GitHub から取得できません。小さい PR を選ぶか、下に diff を貼ってください。",
      net: "GitHub に接続できません。接続を確かめるか、下に diff を貼ってください。",
      empty: "diff が見つかりません。git diff か gh pr diff の出力を貼ってください。",
      scoring: "採点中…",
      score: "採点する",
      human: "完全自動運転なら、何も投稿せずにあなたへ回します。",
      auto: "完全自動運転なら、そのままレビューを進めます。",
      pasted: "貼り付けた diff",
    },
  }[lang];

  const LEVEL_COLOR = { LOW: "--mint", MEDIUM: "--amber", HIGH: "--coral", CRITICAL: "--pink" };
  const SEV = { critical: "blocker", high: "blocker", medium: "", low: "question" };

  const $ = (sel) => document.querySelector(sel);
  const num = $("[data-score-num]");
  const level = $("[data-score-level]");
  const source = $("[data-score-source]");
  const verdict = $("[data-verdict]");
  const dial = $("[data-dial]");
  const factors = $("[data-factors]");
  const hits = $("[data-hits]");
  const error = $("[data-risk-error]");
  const button = form.querySelector("button");
  const input = form.querySelector("input");
  const presetButtons = [...document.querySelectorAll("[data-preset]")];

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // 画面に入ってから数え上げる。そこまでの点数は pending に置く
  let seen = false;
  let pending = 0;
  let shown = 0;
  let raf = 0;
  const countTo = (target) => {
    cancelAnimationFrame(raf);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      shown = target;
      num.textContent = target;
      return;
    }
    const from = shown;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / 620);
      shown = Math.round(from + (target - from) * (1 - (1 - p) ** 3));
      num.textContent = shown;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };

  const render = (risk, label) => {
    dial.style.setProperty("--tone", `var(${LEVEL_COLOR[risk.level]})`);
    pending = risk.score;
    if (seen) countTo(risk.score);
    level.textContent = risk.level;
    source.textContent = label;
    verdict.textContent = risk.needsHuman ? T.human : T.auto;
    if (seen) dial.style.setProperty("--score", risk.score);
    factors.replaceChildren(
      ...risk.factors.map((f) => {
        const row = el("li", "factor");
        row.append(el("b", "", f.label), el("span", "pts", `${f.points}/${f.max}`));
        const bar = el("span", "bar");
        const fill = el("i");
        fill.style.width = `${(f.points / f.max) * 100}%`;
        bar.append(fill);
        row.append(bar);
        if (f.reasons.length > 0) row.append(el("p", "", f.reasons.join(" / ")));
        return row;
      }),
    );
    hits.replaceChildren(
      ...risk.findings.slice(0, 6).map((h) => {
        const row = el("li");
        row.append(el("span", `sev ${SEV[h.severity] ?? ""}`, h.severity), el("span", "", h.message));
        row.append(el("code", "", `${h.file}:${h.line}`));
        return row;
      }),
    );
  };

  const fail = (message) => {
    error.textContent = message;
  };

  const scoreDiff = (diff, meta, label) => {
    const risk = window.CCAutoReviewRisk.score({ diff, lang, ...meta });
    error.textContent = "";
    render(risk, label);
  };

  const press = (active) => {
    for (const b of presetButtons) b.setAttribute("aria-pressed", String(b === active));
  };

  const addLines = (lines) => lines.map((l) => `+${l}`).join("\n");
  const file = (path, added, deleted = []) =>
    `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,${deleted.length} +1,${added.length} @@\n${deleted.map((l) => `-${l}`).join("\n")}${deleted.length ? "\n" : ""}${addLines(added)}\n`;
  const filler = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

  // 実在しない見本の diff。点数はどれも engine.js が計算する
  const PRESETS = {
    typo: {
      title: { en: "Fix a typo in the README", ja: "README の誤字を直す" },
      diff: file("README.md", ["Install the CLI, then run the setup command."], ["Install the CLI, then rum the setup command."]),
    },
    feature: {
      title: { en: "Add coupon codes to checkout", ja: "チェックアウトにクーポンを追加する" },
      diff:
        file("src/checkout/coupon.ts", [
          "export interface Coupon { code: string; kind: 'percent' | 'fixed'; value: number }",
          "export function applyCoupon(coupon: Coupon, subtotal: number): number {",
          "  return coupon.kind === 'percent' ? subtotal * (coupon.value / 100) : coupon.value;",
          "}",
          "export async function findCoupon(db: Db, code: string): Promise<Coupon | null> {",
          "  const rows = await db.query(`SELECT * FROM coupons WHERE code = '${code}'`);",
          "  return rows[0] ?? null;",
          "}",
          ...filler(24, (i) => `export const rule${i} = ${i};`),
        ]) +
        file("src/checkout/total.ts", ["import { applyCoupon } from './coupon';", "  discount: number;", "  const discount = coupon ? applyCoupon(coupon, subtotal) : 0;"], ["export function computeTotals(cart: Cart): Totals {"]),
    },
    migration: {
      title: { en: "Drop the legacy sessions table", ja: "古い sessions テーブルを消す" },
      diff:
        file("db/migrations/20261105_drop_sessions.sql", ["DROP TABLE sessions;", "ALTER TABLE users DROP COLUMN session_id;"]) +
        file("src/auth/session.ts", filler(60, (i) => `export const sessionStep${i} = () => verify(${i});`), filler(40, (i) => `export const old${i} = ${i};`)),
    },
    secret: {
      title: { en: "Add the payment client", ja: "決済クライアントを追加する" },
      diff: file("src/billing/client.ts", [
        `const key = "${["AKIA", "IOSFODNN7", "EXAMPLE"].join("")}";`,
        "export const client = createClient(key);",
      ]),
    },
  };

  const runPreset = (name, btn) => {
    const p = PRESETS[name];
    press(btn);
    input.value = "";
    scoreDiff(p.diff, { title: p.title[lang] }, p.title[lang]);
  };
  for (const b of presetButtons) {
    b.addEventListener("click", () => runPreset(b.dataset.preset, b));
  }

  const parseUrl = (text) => {
    const m = text.trim().match(/(?:github\.com\/)?([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
    return m ? { owner: m[1], repo: m[2], number: m[3] } : null;
  };

  const httpError = (res) => {
    if (res.status === 403 || res.status === 429) return T.rate;
    if (res.status === 404 || res.status === 401) return T.notFound;
    if (res.status === 406 || res.status === 422) return T.tooBig;
    return T.net;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const pr = parseUrl(input.value);
    if (!pr) return fail(T.badUrl);
    error.textContent = "";
    button.disabled = true;
    button.textContent = T.scoring;
    try {
      const api = `https://api.github.com/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`;
      const [info, patch] = await Promise.all([
        fetch(api, { headers: { Accept: "application/vnd.github+json" } }),
        fetch(api, { headers: { Accept: "application/vnd.github.diff" } }),
      ]);
      if (!info.ok) return fail(httpError(info));
      if (!patch.ok) return fail(httpError(patch));
      const meta = await info.json();
      press(null);
      scoreDiff(
        await patch.text(),
        {
          title: meta.title ?? "",
          body: meta.body ?? "",
          draft: Boolean(meta.draft),
          authorIsBot: meta.user?.type === "Bot",
        },
        `${pr.owner}/${pr.repo}#${pr.number}`,
      );
    } catch {
      fail(T.net);
    } finally {
      button.disabled = false;
      button.textContent = T.score;
    }
  });

  const pasteBtn = $("[data-paste-score]");
  pasteBtn?.addEventListener("click", () => {
    const text = $("[data-paste]").value;
    if (!/^(diff --git |@@ |--- )/m.test(text)) return fail(T.empty);
    press(null);
    scoreDiff(text, {}, T.pasted);
  });

  runPreset("feature", presetButtons.find((b) => b.dataset.preset === "feature"));
  new IntersectionObserver(([e], io) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    seen = true;
    countTo(pending);
    dial.style.setProperty("--score", pending);
  }, { threshold: 0.3 }).observe(num);
})();
