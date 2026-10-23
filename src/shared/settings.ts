import { isReviewModel, type ReviewModel } from "./types.ts";

/**
 * レビューの観点 1 つ。プロンプトの「何を見るか」に、有効なものだけを順に並べる。
 * title と description は利用者が書き換えられる。どの言語で書いてもよい
 */
export interface Perspective {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
}

/**
 * レビューのやり方の一式。PR ごとにどれを使うかを選べる。
 * 観点のほかに、指摘しないこと、自由記述の指示（チームの規約やレビューの姿勢）、
 * claude に追加で許すツール（Skill や MCP）を持つ
 */
export interface ReviewProfile {
  id: string;
  name: string;
  perspectives: Perspective[];
  /** 指摘しないこと。1 行 1 項目 */
  exclusions: string[];
  /** 自由記述のレビュー指示。チームの規約、重視すること、口調など。空なら節ごと省く */
  instructions: string;
  /**
   * claude に追加で許すツール。"Skill"、"WebFetch"、"mcp__server" や "mcp__server__tool" など。
   * 書き込みのできるツールもあるので、既定では何も許さない
   */
  allowedTools: string[];
  /** 指摘の数の上限。0 なら上限なし。多すぎる指摘はノイズになるので、重いものから残させる */
  maxFindings: number;
}

/** パスの正規表現と、当たったときに人に回す理由 */
export interface PathRule {
  pattern: string;
  reason: string;
}

/** 完全自動運転で、PR に応じて使うプロファイルを変える規則。ラベルかメンションのどちらかで当てる */
export interface RoutingRule {
  /** PR に付いていれば当たる GitHub のラベル。空なら見ない */
  label: string;
  /** PR の説明かコメントに含まれていれば当たる文字列（@org/team など）。空なら見ない */
  mention: string;
  profileId: string;
}

export interface AutopilotConfig {
  /** 自動運転の AI レビューに使うモデル。null なら claude の設定に任せる */
  model: ReviewModel | null;
  /** 既定で使うプロファイル。ルーティングの規則に当たればそちらを使う */
  profileId: string;
  /** レビュー依頼の一覧を確認しに行く間隔（分） */
  intervalMinutes: number;
  /** 指摘をコメントする回数の上限。これを超えて指摘が残れば人に回す */
  maxRounds: number;
  /** 指摘が無いときに承認するか。false ならコメントだけで済ませ、承認は人に任せる */
  approve: boolean;
  /** 承認の本文に LGTM 画像を添えるか */
  lgtmImage: boolean;
  /** 人が確かめたうえで、以降は人に回さずに進めてよいと決めた PR に付けるラベル */
  autoJudgeLabel: string;
  /** AI にレビューさせないと決めた PR に付けるラベル */
  skipLabel: string;
  routing: RoutingRule[];
  /** 当たれば AI を呼ばずに人へ回すパス */
  sensitivePaths: PathRule[];
  /** 追加と削除の合計がこれを超えると人に回す。0 なら規模では回さない */
  maxChangedLines: number;
  /** 変更の規模に数えないパスの正規表現。ロックファイルやビルドの成果物 */
  ignoredPaths: string[];
}

export interface Settings {
  version: 1;
  profiles: ReviewProfile[];
  /** レビュー画面で最初に選ばれるプロファイル */
  defaultProfileId: string;
  /** 手で実行する AI レビューの既定のモデル。null なら claude の設定に任せる */
  defaultModel: ReviewModel | null;
  /** AI レビュー 1 回の制限時間（分） */
  timeoutMinutes: number;
  autopilot: AutopilotConfig;
}

/**
 * 既定の観点。指摘の精度を上げるため、どれも「確かめられる問題」に絞る。
 * プロンプトの本体と同じく英語で書く（指摘を書く言語は別に指定する）
 */
export const DEFAULT_PERSPECTIVES: readonly Perspective[] = [
  {
    id: "correctness",
    title: "Correctness",
    description:
      "Logic errors, wrong conditions, off-by-one, null/undefined handling, error handling that swallows failures, race conditions, and broken edge cases (empty input, large input, unicode, time zones). Only report what you can show actually misbehaves under a concrete input or sequence.",
    enabled: true,
  },
  {
    id: "regression",
    title: "Regressions",
    description:
      "Whether the change breaks existing behavior. For every function, type, prop, config value, API response shape, or DB column that was changed or removed, find its callers with the `find`, `grep` and `cat` commands described above and name the caller that breaks and how. Behavior changes that the PR description does not mention and that have a wide blast radius are worth reporting even if intended.",
    enabled: true,
  },
  {
    id: "security",
    title: "Security",
    description:
      "Missing authorization checks, injection (SQL, shell, HTML/XSS, path traversal), unsafe deserialization, SSRF, secrets or personal data written to logs or responses, and weakened validation.",
    enabled: true,
  },
  {
    id: "data",
    title: "Data and compatibility",
    description:
      "Migrations that lose or lock data, non-backward-compatible changes to public APIs, persisted formats, or messages consumed by other services, and missing handling for existing records.",
    enabled: true,
  },
  {
    id: "performance",
    title: "Performance",
    description:
      "N+1 queries, unbounded loops or result sets, work moved onto hot paths, and missing pagination — only when the input sizes in this codebase make it a real problem.",
    enabled: true,
  },
  {
    id: "design",
    title: "Design",
    description:
      "Responsibilities mixed into the wrong layer, duplication of logic that already exists in the codebase, and deviations from the patterns the surrounding code and the repository's conventions (CLAUDE.md, AGENTS.md, REVIEW.md) establish.",
    enabled: true,
  },
  {
    id: "tests",
    title: "Tests",
    description:
      "Changed behavior with no test covering it, tests that cannot fail (asserting on mocks, missing awaits), and tests whose expectations were edited to match a bug.",
    enabled: true,
  },
  {
    id: "intent",
    title: "Matches the intent",
    description:
      "Whether the implementation does what the PR description and the linked issues say, and nothing silently beyond it.",
    enabled: true,
  },
];

export const DEFAULT_EXCLUSIONS: readonly string[] = [
  "Style preferences a formatter or linter can fix (indentation, quotes, line breaks, import order)",
  "General improvement ideas for code the PR did not touch",
  "Speculation you cannot back with code you read. If you cannot decide because the intent is unclear, ask a question instead of guessing a blocker or should",
  "Restating what the code does, or praising it",
];

export const DEFAULT_PROFILE_ID = "standard";

export function defaultProfiles(): ReviewProfile[] {
  return [
    {
      id: DEFAULT_PROFILE_ID,
      name: "Standard",
      perspectives: DEFAULT_PERSPECTIVES.map((p) => ({ ...p })),
      exclusions: [...DEFAULT_EXCLUSIONS],
      instructions: "",
      allowedTools: [],
      maxFindings: 0,
    },
    {
      id: "security",
      name: "Security focused",
      perspectives: DEFAULT_PERSPECTIVES.map((p) => ({
        ...p,
        enabled: p.id === "security" || p.id === "data" || p.id === "correctness",
      })),
      exclusions: [...DEFAULT_EXCLUSIONS],
      instructions:
        "Act as an application security reviewer. Trace untrusted input from where it enters (HTTP params, headers, files, webhooks, env) to where it is used, and check every authorization decision the change touches.",
      allowedTools: [],
      maxFindings: 0,
    },
    {
      id: "quick",
      name: "Quick (blockers only)",
      perspectives: DEFAULT_PERSPECTIVES.map((p) => ({
        ...p,
        enabled: p.id === "correctness" || p.id === "regression" || p.id === "security",
      })),
      exclusions: [
        ...DEFAULT_EXCLUSIONS,
        "Anything that is not a blocker or should. Do not report nits",
      ],
      instructions: "",
      allowedTools: [],
      maxFindings: 5,
    },
  ];
}

/**
 * どの変更でも人が見るべきパス。変更した人ではなく、変更そのものが段階を決める。
 * CI のワークフローと、壊れたときに取り返しがつきにくい領域（DB のスキーマ、インフラ、
 * 秘密情報、認証・権限・課金）、レビューのやり方そのものを変えるファイルを挙げる
 */
export const DEFAULT_SENSITIVE_PATHS: readonly PathRule[] = [
  {
    pattern:
      "(^|/)(\\.github/(workflows|actions)/|\\.circleci/|\\.gitlab-ci\\.yml$|Jenkinsfile$|\\.buildkite/)",
    reason: "Changes CI configuration",
  },
  {
    pattern:
      "(^|/)(db/migrate|migrations?)/|(^|/)(schema\\.rb|structure\\.sql|schema\\.prisma)$|\\.sql$",
    reason: "Changes the database schema or migrations",
  },
  {
    pattern:
      "(^|/)(Dockerfile[^/]*|docker-compose[^/]*\\.ya?ml)$|\\.tf$|(^|/)(terraform|k8s|kubernetes|helm|infra|deploy)/",
    reason: "Changes infrastructure or deployment settings",
  },
  {
    pattern: "(?i)(^|/)\\.env(\\.[^/]*)?$|\\.(pem|key|p12)$|(^|/)(secrets?|credentials?)(/|\\.)",
    reason: "Changes files that hold secrets",
  },
  {
    pattern:
      "(?i)(^|[/_.-])(auth|authn|authz|oauth|security|permissions?|policy|policies|payments?|billing|crypto)([/_.-]|$)",
    reason: "Changes authentication, permission, billing, or cryptography code",
  },
  {
    pattern:
      "(^|/)(CODEOWNERS|CLAUDE\\.md|CLAUDE\\.local\\.md|AGENTS\\.md|REVIEW\\.md|\\.mcp\\.json)$|(^|/)\\.claude/",
    reason: "Changes review conventions or code owners",
  },
];

/**
 * 人がレビューしないファイル。依存のロックファイルとビルドの成果物は、生成された結果でしかない。
 * 何千行になってもレビューの手間は増えないので、変更の規模に数えない
 */
export const DEFAULT_IGNORED_PATHS: readonly string[] = [
  "(^|/)dist/",
  "(^|/)(package-lock\\.json|npm-shrinkwrap\\.json|pnpm-lock\\.yaml|go\\.sum|Cargo\\.lock|poetry\\.lock|Gemfile\\.lock|composer\\.lock|[^/]+\\.lockb?)$",
];

export function defaultSettings(): Settings {
  return {
    version: 1,
    profiles: defaultProfiles(),
    defaultProfileId: DEFAULT_PROFILE_ID,
    defaultModel: null,
    timeoutMinutes: 10,
    autopilot: {
      model: "haiku",
      profileId: DEFAULT_PROFILE_ID,
      intervalMinutes: 10,
      maxRounds: 3,
      approve: true,
      lgtmImage: false,
      autoJudgeLabel: "auto-judge",
      skipLabel: "skip-ai-review",
      routing: [],
      sensitivePaths: DEFAULT_SENSITIVE_PATHS.map((rule) => ({ ...rule })),
      maxChangedLines: 1000,
      ignoredPaths: [...DEFAULT_IGNORED_PATHS],
    },
  };
}

/** id で探し、無ければ既定のプロファイル、それも無ければ先頭 */
export function findProfile(settings: Settings, id: string | null | undefined): ReviewProfile {
  return (
    settings.profiles.find((p) => p.id === id) ??
    settings.profiles.find((p) => p.id === settings.defaultProfileId) ??
    (settings.profiles[0] as ReviewProfile)
  );
}

/**
 * 設定の正規表現を JavaScript の RegExp にする。先頭の (?i) は大文字小文字を区別しない指定として読む。
 * 書き損じた正規表現は null（その規則は使わない）
 */
export function compilePattern(pattern: string): RegExp | null {
  const insensitive = pattern.startsWith("(?i)");
  try {
    return new RegExp(insensitive ? pattern.slice(4) : pattern, insensitive ? "i" : "");
  } catch {
    return null;
  }
}

// ここから下は、保存されたファイルや画面から来た値を検証して Settings にする。
// 足りない項目は既定値で補い、読めない値は捨てる。設定ファイルが壊れていても起動できるようにする

const str = (value: unknown, fallback: string, max = 20_000): string =>
  typeof value === "string" ? value.slice(0, max) : fallback;

const int = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const strings = (value: unknown, fallback: readonly string[]): string[] =>
  Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter(Boolean)
    : [...fallback];

const model = (value: unknown, fallback: ReviewModel | null): ReviewModel | null =>
  value === null ? null : isReviewModel(value) ? value : fallback;

/** id は claude の引数にも保存のキーにもならないが、画面の select に使うので形を揃える */
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function normalizePerspective(raw: unknown, index: number): Perspective | null {
  const item = raw as Partial<Perspective> | null;
  if (item === null || typeof item !== "object") return null;
  const title = str(item.title, "").trim();
  if (title === "") return null;
  return {
    id: typeof item.id === "string" && ID.test(item.id) ? item.id : `p${index + 1}`,
    title,
    description: str(item.description, ""),
    enabled: bool(item.enabled, true),
  };
}

function normalizeProfile(raw: unknown, index: number): ReviewProfile | null {
  const item = raw as Partial<ReviewProfile> | null;
  if (item === null || typeof item !== "object") return null;
  const name = str(item.name, "").trim();
  if (name === "") return null;
  return {
    id: typeof item.id === "string" && ID.test(item.id) ? item.id : `profile-${index + 1}`,
    name,
    perspectives: Array.isArray(item.perspectives)
      ? item.perspectives.flatMap((p, i) => normalizePerspective(p, i) ?? [])
      : DEFAULT_PERSPECTIVES.map((p) => ({ ...p })),
    exclusions: strings(item.exclusions, DEFAULT_EXCLUSIONS),
    instructions: str(item.instructions, ""),
    allowedTools: strings(item.allowedTools, []).filter((tool) =>
      /^[A-Za-z0-9_*().:/ -]+$/.test(tool),
    ),
    maxFindings: int(item.maxFindings, 0, 0, 100),
  };
}

function normalizePathRules(raw: unknown, fallback: readonly PathRule[]): PathRule[] {
  if (!Array.isArray(raw)) return fallback.map((rule) => ({ ...rule }));
  return raw.flatMap((item) => {
    const rule = item as Partial<PathRule> | null;
    const pattern = str(rule?.pattern, "").trim();
    if (pattern === "") return [];
    return [{ pattern, reason: str(rule?.reason, "").trim() || pattern }];
  });
}

function normalizeRouting(raw: unknown, profileIds: Set<string>): RoutingRule[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const rule = item as Partial<RoutingRule> | null;
    const label = str(rule?.label, "").trim();
    const mention = str(rule?.mention, "").trim();
    const profileId = str(rule?.profileId, "");
    if ((label === "" && mention === "") || !profileIds.has(profileId)) return [];
    return [{ label, mention, profileId }];
  });
}

export function normalizeSettings(raw: unknown): Settings {
  const defaults = defaultSettings();
  const value = (raw ?? {}) as Partial<Settings>;
  if (typeof value !== "object") return defaults;

  const profiles = Array.isArray(value.profiles)
    ? value.profiles.flatMap((p, i) => normalizeProfile(p, i) ?? [])
    : defaults.profiles;
  // プロファイルが 1 つも無いと AI レビューを実行できない。消し切ったら既定に戻す
  const usable = profiles.length > 0 ? dedupeIds(profiles) : defaults.profiles;
  const ids = new Set(usable.map((p) => p.id));
  const pick = (id: unknown): string =>
    typeof id === "string" && ids.has(id) ? id : (usable[0] as ReviewProfile).id;

  const auto = (value.autopilot ?? {}) as Partial<AutopilotConfig>;
  const label = (v: unknown, fallback: string): string => str(v, fallback, 50).trim() || fallback;

  return {
    version: 1,
    profiles: usable,
    defaultProfileId: pick(value.defaultProfileId),
    defaultModel: model(value.defaultModel, defaults.defaultModel),
    timeoutMinutes: int(value.timeoutMinutes, defaults.timeoutMinutes, 1, 60),
    autopilot: {
      model: model(auto.model, defaults.autopilot.model),
      profileId: pick(auto.profileId),
      intervalMinutes: int(auto.intervalMinutes, defaults.autopilot.intervalMinutes, 1, 1440),
      maxRounds: int(auto.maxRounds, defaults.autopilot.maxRounds, 1, 20),
      approve: bool(auto.approve, defaults.autopilot.approve),
      lgtmImage: bool(auto.lgtmImage, defaults.autopilot.lgtmImage),
      autoJudgeLabel: label(auto.autoJudgeLabel, defaults.autopilot.autoJudgeLabel),
      skipLabel: label(auto.skipLabel, defaults.autopilot.skipLabel),
      routing: normalizeRouting(auto.routing, ids),
      sensitivePaths: normalizePathRules(auto.sensitivePaths, DEFAULT_SENSITIVE_PATHS),
      maxChangedLines: int(auto.maxChangedLines, defaults.autopilot.maxChangedLines, 0, 1_000_000),
      ignoredPaths: strings(auto.ignoredPaths, DEFAULT_IGNORED_PATHS),
    },
  };
}

/** 同じ id のプロファイルが並ぶと選べなくなる。2 つ目以降に番号を足す */
function dedupeIds(profiles: ReviewProfile[]): ReviewProfile[] {
  const seen = new Set<string>();
  return profiles.map((profile) => {
    let id = profile.id;
    for (let n = 2; seen.has(id); n += 1) id = `${profile.id}-${n}`;
    seen.add(id);
    return id === profile.id ? profile : { ...profile, id };
  });
}
