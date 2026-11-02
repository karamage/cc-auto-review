import { expect, test } from "bun:test";
import {
  detectTextLang,
  isUnreviewedPath,
  matchRouting,
  mentions,
  mergeRisk,
  reviewedChangedLines,
  ruleRisk,
} from "./risk.ts";
import { defaultSettings } from "./settings.ts";
import type { DiffFile } from "./types.ts";

const config = defaultSettings().autopilot;
const MAX = config.maxChangedLines;
const ignored = config.ignoredPaths;

test.each([
  [".github/workflows/ci.yml", "CI"],
  ["db/migrate/20261020_add_users.rb", "database"],
  ["infra/main.tf", "infrastructure"],
  ["config/.env.production", "secrets"],
  ["app/services/billing/charge.ts", "billing"],
  ["src/auth/login.ts", "authentication"],
  ["CODEOWNERS", "conventions"],
  [".claude/settings.json", "conventions"],
])("%s は人が見るべき変更とみなす", (path, reason) => {
  const risk = ruleRisk([path], 10, config, "ja");
  expect(risk?.level).toBe("high");
  expect(risk?.reasons[0]).toContain(reason);
  expect(risk?.reasons[0]).toContain(path);
});

test.each(["src/author.ts", "docs/README.md", "src/client/state/sessions.ts"])(
  "%s のような普通の変更は、規則では決めない",
  (path) => {
    expect(ruleRisk([path], 10, config, "ja")).toBeNull();
  },
);

test("大きすぎる変更は、パスにかかわらず人に回す", () => {
  expect(ruleRisk(["src/a.ts"], MAX, config, "en")).toBeNull();
  const risk = ruleRisk(["src/a.ts"], MAX + 1, config, "en");
  expect(risk?.level).toBe("high");
  expect(risk?.reasons[0]).toContain("large");
});

test.each([
  "package-lock.json",
  "web/yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "Gemfile.lock",
  "go.sum",
  "dist/index.js",
  "packages/ui/dist/style.css",
])("%s は人がレビューしないファイルとみなす", (path) => {
  expect(isUnreviewedPath(path, ignored)).toBe(true);
});

test.each(["package.json", "src/lock.ts", "src/distance.ts", "docs/dist.md"])(
  "%s はレビューするファイルとみなす",
  (path) => {
    expect(isUnreviewedPath(path, ignored)).toBe(false);
  },
);

test("変更の規模には、ロックファイルとビルドの成果物の行を数えない", () => {
  const file = (path: string, added: number, removed: number): DiffFile => ({
    path,
    oldPath: null,
    status: "modified",
    isBinary: false,
    hunks: [
      {
        header: "@@",
        oldStart: 1,
        oldLines: removed + 1,
        newStart: 1,
        newLines: added + 1,
        lines: [
          { type: "context", content: "", oldLine: 1, newLine: 1 },
          ...Array.from({ length: added }, () => ({
            type: "add" as const,
            content: "",
            oldLine: null,
            newLine: 2,
          })),
          ...Array.from({ length: removed }, () => ({
            type: "del" as const,
            content: "",
            oldLine: 2,
            newLine: null,
          })),
        ],
      },
    ],
  });
  expect(
    reviewedChangedLines(
      [
        file("package-lock.json", 4075, 1810),
        file("dist/app.js", 500, 0),
        file("package.json", 10, 1),
      ],
      ignored,
    ),
  ).toBe(11);
});

test("同じ種類のパスが多いときは、3 件まで挙げて残りは件数にする", () => {
  const paths = ["a", "b", "c", "d", "e"].map((name) => `.github/workflows/${name}.yml`);
  const reason = ruleRisk(paths, 10, config, "ja")?.reasons[0] ?? "";
  expect(reason).toContain(".github/workflows/c.yml");
  expect(reason).not.toContain(".github/workflows/d.yml");
  expect(reason).toContain("ほか 2 件");
});

test("2 つの判定を合わせると、重い方の段階になり理由はどちらも残る", () => {
  expect(
    mergeRisk({ level: "high", reasons: ["CI"] }, { level: "low", reasons: ["文言だけ"] }),
  ).toEqual({ level: "high", reasons: ["CI", "文言だけ"] });
  expect(mergeRisk(null, { level: "medium", reasons: [] })).toEqual({
    level: "medium",
    reasons: [],
  });
  expect(mergeRisk(null, null)).toBeNull();
});

test("説明文の言語は、かなか漢字があれば日本語、英字だけなら英語", () => {
  expect(detectTextLang("ログインの不具合を直す")).toBe("ja");
  expect(detectTextLang("Fix the login bug")).toBe("en");
  expect(detectTextLang("")).toBeNull();
  expect(detectTextLang("#123")).toBeNull();
});

test("PR テンプレートの説明書きやコードは、言語の判定に使わない", () => {
  const body = [
    "<!-- 変更の概要を書いてください -->",
    "## Summary",
    "Fix the login bug.",
    "```ts",
    "// 日本語のコメント",
    "```",
    "`設定`",
  ].join("\n");
  expect(detectTextLang(body)).toBe("en");
});

test("規模の上限を 0 にすると、規模では人に回さない", () => {
  expect(ruleRisk(["src/a.ts"], 100_000, { ...config, maxChangedLines: 0 }, "en")).toBeNull();
});

test("書き損じた正規表現の規則は無視する", () => {
  expect(
    ruleRisk(["src/a.ts"], 1, { ...config, sensitivePaths: [{ pattern: "(", reason: "x" }] }, "en"),
  ).toBeNull();
});

test.each([
  ["@acme/translators \r\nplease check", true],
  ["@someone @acme/translators \r\nthanks", true],
  ["cc @Acme/Translators.", true],
  ["@acme/translators-vi please", false],
  ["@acme/team-admin please", false],
  ["see acme/translators", false],
])("チームへのメンションを見分ける: %p", (text, expected) => {
  expect(mentions(["", text], "@acme/translators")).toBe(expected);
});

test("ルーティングはラベルかメンションのどちらかに当たる最初の規則を使う", () => {
  const rules = [
    { repo: "", label: "docs", mention: "", profileId: "quick" },
    { repo: "", label: "", mention: "@acme/security", profileId: "security" },
  ];
  expect(matchRouting(rules, "o/r", ["docs"], [])?.profileId).toBe("quick");
  expect(matchRouting(rules, "o/r", [], ["cc @acme/security"])?.profileId).toBe("security");
  expect(matchRouting(rules, "o/r", ["bug"], ["hello"])).toBeNull();
});

test("リポジトリを書いた規則は、そのリポジトリの PR にだけ当たる", () => {
  const rules = [
    { repo: "acme/web", label: "docs", mention: "", profileId: "web-docs" },
    { repo: "Acme/API", label: "", mention: "", profileId: "api" },
  ];
  expect(matchRouting(rules, "acme/web", ["docs"], [])?.profileId).toBe("web-docs");
  expect(matchRouting(rules, "acme/other", ["docs"], [])).toBeNull();
  expect(matchRouting(rules, "acme/web", ["bug"], [])).toBeNull();
  // ラベルもメンションも書かなければ、そのリポジトリの PR はすべて当たる。大文字小文字は区別しない
  expect(matchRouting(rules, "acme/api", ["bug"], [])?.profileId).toBe("api");
});
