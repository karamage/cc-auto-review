import { expect, test } from "bun:test";
import {
  compilePattern,
  DEFAULT_HANDOFF_RULES,
  DEFAULT_PROFILE_ID,
  defaultSettings,
  findProfile,
  hasI18nPerspective,
  I18N_PERSPECTIVE_ID,
  normalizeSettings,
} from "./settings.ts";

test("何も無ければ既定の設定になる", () => {
  expect(normalizeSettings(null)).toEqual(defaultSettings());
  expect(normalizeSettings("broken")).toEqual(defaultSettings());
});

test("保存したものをそのまま読み直せる", () => {
  const settings = defaultSettings();
  expect(normalizeSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
});

test("既定のプロファイルは、有効な観点を持ち、ツールを何も許さない", () => {
  const profile = findProfile(defaultSettings(), null);
  expect(profile.id).toBe(DEFAULT_PROFILE_ID);
  expect(profile.perspectives.filter((p) => p.enabled).length).toBeGreaterThan(3);
  expect(profile.allowedTools).toEqual([]);
});

test("プロファイルを全部消したら既定に戻し、存在しない id の参照は先頭に寄せる", () => {
  const settings = normalizeSettings({ profiles: [], defaultProfileId: "nope" });
  expect(settings.profiles.length).toBeGreaterThan(0);
  const custom = normalizeSettings({
    profiles: [{ id: "a", name: "A", perspectives: [] }],
    defaultProfileId: "nope",
    autopilot: { profileId: "nope", routing: [{ label: "x", mention: "", profileId: "nope" }] },
  });
  expect(custom.defaultProfileId).toBe("a");
  expect(custom.autopilot.profileId).toBe("a");
  // 消えたプロファイルを指す規則は捨てる
  expect(custom.autopilot.routing).toEqual([]);
});

test("振り分けの規則はリポジトリだけでも残し、古い規則にはリポジトリの欄を空で足す", () => {
  const settings = normalizeSettings({
    profiles: [{ id: "a", name: "A", perspectives: [] }],
    autopilot: {
      routing: [
        { repo: " acme/web ", label: "", mention: "", profileId: "a" },
        { label: "docs", mention: "", profileId: "a" },
        { repo: "", label: "", mention: "", profileId: "a" },
      ],
    },
  });
  expect(settings.autopilot.routing).toEqual([
    { repo: "acme/web", label: "", mention: "", profileId: "a" },
    { repo: "", label: "docs", mention: "", profileId: "a" },
  ]);
});

test("名前の無いプロファイルや見出しの無い観点は捨て、同じ id には番号を足す", () => {
  const settings = normalizeSettings({
    version: 2,
    profiles: [
      { id: "a", name: "A", perspectives: [{ title: "", description: "x" }, { title: "T" }] },
      { id: "a", name: "B" },
      { id: "c", name: "  " },
    ],
  });
  expect(settings.profiles.map((p) => p.id)).toEqual(["a", "a-2"]);
  expect(settings.profiles[0]?.perspectives.map((p) => p.title)).toEqual(["T"]);
});

test("数値は範囲に丸め、モデルは決めた別名か null だけを通す", () => {
  const settings = normalizeSettings({
    timeoutMinutes: 999,
    defaultModel: "--dangerously-skip-permissions",
    autopilot: { intervalMinutes: 0, model: null },
  });
  expect(settings.timeoutMinutes).toBe(60);
  expect(settings.defaultModel).toBeNull();
  expect(settings.autopilot.intervalMinutes).toBe(1);
  expect(settings.autopilot.model).toBeNull();
});

test("操作盤のアニメーションは既定で動かし、切った設定はそのまま読み直せる", () => {
  expect(normalizeSettings({ autopilot: {} }).autopilot.animations).toBe(true);
  expect(normalizeSettings({ autopilot: { animations: false } }).autopilot.animations).toBe(false);
});

test("ツールの指定に使えない文字を含むものは捨てる", () => {
  const settings = normalizeSettings({
    profiles: [{ id: "a", name: "A", allowedTools: ["Skill", "mcp__docs", "Bash;rm -rf /", ""] }],
  });
  expect(settings.profiles[0]?.allowedTools).toEqual(["Skill", "mcp__docs"]);
});

test("正規表現は (?i) で大文字小文字を区別せず、書き損じは null", () => {
  expect(compilePattern("(?i)auth")?.test("src/AUTH/a.ts")).toBe(true);
  expect(compilePattern("auth")?.test("src/AUTH/a.ts")).toBe(false);
  expect(compilePattern("(")).toBeNull();
});

test("i18n の観点はどの既定プロファイルにもあり、切ってある", () => {
  for (const profile of defaultSettings().profiles) {
    const i18n = profile.perspectives.find((p) => p.id === I18N_PERSPECTIVE_ID);
    expect(i18n?.enabled).toBe(false);
    expect(hasI18nPerspective(profile)).toBe(false);
  }
});

test("version 1 の設定には i18n の観点を切った状態で足し、version 2 で消したものは足さない", () => {
  const old = normalizeSettings({
    version: 1,
    profiles: [{ id: "a", name: "A", perspectives: [{ id: "x", title: "X" }] }],
  });
  expect(old.version).toBe(2);
  expect(old.profiles[0]?.perspectives.map((p) => [p.id, p.enabled])).toEqual([
    ["x", true],
    [I18N_PERSPECTIVE_ID, false],
  ]);

  const removed = normalizeSettings({
    version: 2,
    profiles: [{ id: "a", name: "A", perspectives: [{ id: "x", title: "X" }] }],
  });
  expect(removed.profiles[0]?.perspectives.map((p) => p.id)).toEqual(["x"]);
});

test("人に任せる基準は、無ければ既定で補い、空にしたらそのままにする", () => {
  expect(normalizeSettings({ autopilot: {} }).autopilot.handoffRules).toEqual([
    ...DEFAULT_HANDOFF_RULES,
  ]);
  expect(normalizeSettings({ autopilot: { handoffRules: [] } }).autopilot.handoffRules).toEqual([]);
  expect(
    normalizeSettings({ autopilot: { handoffRules: ["  決済の変更  ", "", 3] } }).autopilot
      .handoffRules,
  ).toEqual(["決済の変更"]);
});
