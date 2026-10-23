import { type ReactNode, useEffect, useState } from "react";
import {
  compilePattern,
  type Perspective,
  type ReviewProfile,
  type Settings,
} from "../../shared/settings.ts";
import { REVIEW_MODELS, type ReviewModel } from "../../shared/types.ts";
import { ApiError, browserClient } from "../api.ts";
import { LanguageSwitch } from "../components/LanguageSwitch.tsx";
import { t } from "../i18n.ts";
import { setSettings, useSettings } from "../settings.ts";

type Tab = "profiles" | "autopilot" | "general";

/** 画面で新しく作る観点やプロファイルの id。保存したときにサーバが形を確かめる */
function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 配列の index の要素を、change で置き換えた新しい配列 */
function replaceAt<T>(items: readonly T[], index: number, change: (item: T) => T): T[] {
  return items.map((item, i) => (i === index ? change(item) : item));
}

function move<T>(items: readonly T[], index: number, step: -1 | 1): T[] {
  const target = index + step;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target] as T, next[index] as T];
  return next;
}

/**
 * 1 行 1 項目の入力。打っている途中の空行を消さないよう、文字列は手元に持ち、
 * 親には空行を除いた配列だけを渡す。別のプロファイルを開いたときや既定に戻したときは、
 * 親が key を変えて作り直すので、そこで読み直す
 */
function LinesField({
  label,
  hint,
  value,
  onChange,
  rows = 4,
  mono = false,
}: {
  label: string;
  hint?: string;
  value: readonly string[];
  onChange: (lines: string[]) => void;
  rows?: number;
  mono?: boolean;
}) {
  const [text, setText] = useState(value.join("\n"));
  return (
    <label className="field">
      <span>{label}</span>
      <textarea
        rows={rows}
        value={text}
        data-mono={mono}
        spellCheck={!mono}
        onChange={(e) => {
          setText(e.target.value);
          onChange(
            e.target.value
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line !== ""),
          );
        }}
      />
      {hint === undefined ? null : <small className="muted">{hint}</small>}
    </label>
  );
}

function ModelSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ReviewModel | null;
  onChange: (model: ReviewModel | null) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(REVIEW_MODELS.find((m) => m === e.target.value) ?? null)}
      >
        <option value="">{t().modelName(null)}</option>
        {REVIEW_MODELS.map((m) => (
          <option key={m} value={m}>
            {t().modelName(m)}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, Math.round(next))));
        }}
      />
      {hint === undefined ? null : <small className="muted">{hint}</small>}
    </label>
  );
}

function TextField({
  label,
  hint,
  value,
  onChange,
  invalid,
  mono = false,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: string | null;
  mono?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        data-mono={mono}
        spellCheck={!mono}
        aria-invalid={invalid !== null && invalid !== undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {invalid === null || invalid === undefined ? null : (
        <small className="error">{invalid}</small>
      )}
      {hint === undefined ? null : <small className="muted">{hint}</small>}
    </label>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-field">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <strong>{label}</strong>
        {hint === undefined ? null : <small className="muted">{hint}</small>}
      </span>
    </label>
  );
}

function Section({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      {intro === undefined ? null : <p className="muted">{intro}</p>}
      <div className="settings-fields">{children}</div>
    </section>
  );
}

function PerspectiveEditor({
  perspectives,
  onChange,
}: {
  perspectives: readonly Perspective[];
  onChange: (perspectives: Perspective[]) => void;
}) {
  const text = t().settings.profiles;
  return (
    <div className="perspectives">
      <ol>
        {perspectives.map((p, index) => (
          <li key={p.id} data-enabled={p.enabled}>
            <div className="perspective-head">
              <input
                type="checkbox"
                checked={p.enabled}
                aria-label={p.title}
                onChange={(e) =>
                  onChange(
                    replaceAt(perspectives, index, (x) => ({ ...x, enabled: e.target.checked })),
                  )
                }
              />
              <input
                type="text"
                className="perspective-title"
                value={p.title}
                aria-label={text.perspectiveTitle}
                placeholder={text.perspectiveTitle}
                onChange={(e) =>
                  onChange(replaceAt(perspectives, index, (x) => ({ ...x, title: e.target.value })))
                }
              />
              <span className="perspective-actions">
                <button
                  type="button"
                  aria-label={text.moveUp}
                  title={text.moveUp}
                  disabled={index === 0}
                  onClick={() => onChange(move(perspectives, index, -1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={text.moveDown}
                  title={text.moveDown}
                  disabled={index === perspectives.length - 1}
                  onClick={() => onChange(move(perspectives, index, 1))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={text.removePerspective}
                  title={text.removePerspective}
                  onClick={() => onChange(perspectives.filter((_, i) => i !== index))}
                >
                  ×
                </button>
              </span>
            </div>
            <textarea
              rows={2}
              value={p.description}
              aria-label={text.perspectiveDescription}
              placeholder={text.perspectiveDescription}
              onChange={(e) =>
                onChange(
                  replaceAt(perspectives, index, (x) => ({ ...x, description: e.target.value })),
                )
              }
            />
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() =>
          onChange([...perspectives, { id: newId("p"), title: "", description: "", enabled: true }])
        }
      >
        + {text.addPerspective}
      </button>
    </div>
  );
}

function ProfileEditor({
  draft,
  profile,
  index,
  onChange,
  onPreview,
}: {
  draft: Settings;
  profile: ReviewProfile;
  index: number;
  onChange: (settings: Settings) => void;
  onPreview: (profile: ReviewProfile) => void;
}) {
  const text = t().settings.profiles;
  const update = (change: (p: ReviewProfile) => ReviewProfile): void =>
    onChange({ ...draft, profiles: replaceAt(draft.profiles, index, change) });
  const isDefault = draft.defaultProfileId === profile.id;

  return (
    <div className="profile-editor">
      <div className="profile-editor-head">
        <TextField
          label={text.name}
          value={profile.name}
          onChange={(name) => update((p) => ({ ...p, name }))}
        />
        <div className="profile-editor-actions">
          {isDefault ? (
            <span className="badge">{text.isDefault}</span>
          ) : (
            <button
              type="button"
              onClick={() => onChange({ ...draft, defaultProfileId: profile.id })}
            >
              {text.makeDefault}
            </button>
          )}
          <button type="button" onClick={() => onPreview(profile)}>
            {text.preview}
          </button>
          <button
            type="button"
            onClick={() => {
              const copy = { ...profile, id: newId("profile"), name: text.copyName(profile.name) };
              onChange({ ...draft, profiles: [...draft.profiles, copy] });
            }}
          >
            {text.duplicate}
          </button>
          <button
            type="button"
            disabled={draft.profiles.length <= 1}
            onClick={() => {
              if (!window.confirm(text.confirmRemove(profile.name))) return;
              const profiles = draft.profiles.filter((_, i) => i !== index);
              const fallback = (profiles[0] as ReviewProfile).id;
              const keep = (id: string): string => (id === profile.id ? fallback : id);
              onChange({
                ...draft,
                profiles,
                defaultProfileId: keep(draft.defaultProfileId),
                autopilot: {
                  ...draft.autopilot,
                  profileId: keep(draft.autopilot.profileId),
                  routing: draft.autopilot.routing.filter((r) => r.profileId !== profile.id),
                },
              });
            }}
          >
            {text.remove}
          </button>
        </div>
      </div>

      <Section title={text.perspectives} intro={text.perspectivesIntro}>
        <PerspectiveEditor
          perspectives={profile.perspectives}
          onChange={(perspectives) => update((p) => ({ ...p, perspectives }))}
        />
      </Section>

      <Section title={text.instructions} intro={text.instructionsHint}>
        <textarea
          rows={6}
          value={profile.instructions}
          aria-label={text.instructions}
          placeholder={text.instructionsPlaceholder}
          onChange={(e) => update((p) => ({ ...p, instructions: e.target.value }))}
        />
      </Section>

      <Section title={text.exclusions}>
        <LinesField
          label={text.exclusions}
          hint={text.exclusionsHint}
          value={profile.exclusions}
          onChange={(exclusions) => update((p) => ({ ...p, exclusions }))}
        />
        <NumberField
          label={text.maxFindings}
          hint={text.maxFindingsHint}
          value={profile.maxFindings}
          min={0}
          max={100}
          onChange={(maxFindings) => update((p) => ({ ...p, maxFindings }))}
        />
        <LinesField
          label={text.tools}
          hint={text.toolsHint}
          value={profile.allowedTools}
          rows={3}
          mono
          onChange={(allowedTools) => update((p) => ({ ...p, allowedTools }))}
        />
      </Section>
    </div>
  );
}

function ProfilesTab({
  draft,
  onChange,
  onPreview,
}: {
  draft: Settings;
  onChange: (settings: Settings) => void;
  onPreview: (profile: ReviewProfile) => void;
}) {
  const text = t().settings.profiles;
  const [selected, setSelected] = useState(draft.defaultProfileId);
  const index = Math.max(
    0,
    draft.profiles.findIndex((p) => p.id === selected),
  );
  const profile = draft.profiles[index] as ReviewProfile;

  return (
    <div className="profiles">
      <p className="muted settings-intro">{text.intro}</p>
      <div className="profiles-layout">
        <nav className="profile-list" aria-label={t().settings.tabs.profiles}>
          {draft.profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-current={p.id === profile.id ? "true" : undefined}
              onClick={() => setSelected(p.id)}
            >
              <span>{p.name}</span>
              {p.id === draft.defaultProfileId ? (
                <small className="badge">{text.isDefault}</small>
              ) : null}
            </button>
          ))}
          <button
            type="button"
            data-variant="text"
            onClick={() => {
              const created: ReviewProfile = {
                ...(draft.profiles.find((p) => p.id === draft.defaultProfileId) ?? profile),
                id: newId("profile"),
                name: text.newName,
              };
              onChange({ ...draft, profiles: [...draft.profiles, created] });
              setSelected(created.id);
            }}
          >
            + {text.add}
          </button>
        </nav>
        <ProfileEditor
          key={profile.id}
          draft={draft}
          profile={profile}
          index={index}
          onChange={onChange}
          onPreview={onPreview}
        />
      </div>
    </div>
  );
}

function ProfileSelect({
  label,
  draft,
  value,
  onChange,
}: {
  label: string;
  draft: Settings;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {draft.profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function AutopilotTab({
  draft,
  onChange,
}: {
  draft: Settings;
  onChange: (settings: Settings) => void;
}) {
  const text = t().settings.autopilot;
  const auto = draft.autopilot;
  const set = (change: Partial<Settings["autopilot"]>): void =>
    onChange({ ...draft, autopilot: { ...auto, ...change } });

  return (
    <div className="settings-tab">
      <p className="muted settings-intro">{text.intro}</p>
      <Section title={t().settings.tabs.autopilot}>
        <ModelSelect label={text.model} value={auto.model} onChange={(model) => set({ model })} />
        <ProfileSelect
          label={text.profile}
          draft={draft}
          value={auto.profileId}
          onChange={(profileId) => set({ profileId })}
        />
        <NumberField
          label={text.interval}
          value={auto.intervalMinutes}
          min={1}
          max={1440}
          onChange={(intervalMinutes) => set({ intervalMinutes })}
        />
        <NumberField
          label={text.maxRounds}
          hint={text.maxRoundsHint}
          value={auto.maxRounds}
          min={1}
          max={20}
          onChange={(maxRounds) => set({ maxRounds })}
        />
        <Toggle
          label={text.approve}
          hint={text.approveHint}
          checked={auto.approve}
          onChange={(approve) => set({ approve })}
        />
        <Toggle
          label={text.lgtmImage}
          checked={auto.lgtmImage}
          onChange={(lgtmImage) => set({ lgtmImage })}
        />
        <TextField
          label={text.autoJudgeLabel}
          hint={text.autoJudgeLabelHint}
          value={auto.autoJudgeLabel}
          onChange={(autoJudgeLabel) => set({ autoJudgeLabel })}
        />
        <TextField
          label={text.skipLabel}
          hint={text.skipLabelHint}
          value={auto.skipLabel}
          onChange={(skipLabel) => set({ skipLabel })}
        />
      </Section>

      <Section title={text.routing} intro={text.routingIntro}>
        <div className="rule-table">
          {auto.routing.map((rule, index) => (
            // eslint-disable-next-line react/no-array-index-key -- 規則は並び順そのものが意味を持つ
            <div className="rule-row" key={index}>
              <TextField
                label={text.routingLabel}
                value={rule.label}
                onChange={(label) =>
                  set({ routing: replaceAt(auto.routing, index, (r) => ({ ...r, label })) })
                }
              />
              <TextField
                label={text.routingMention}
                value={rule.mention}
                onChange={(mention) =>
                  set({ routing: replaceAt(auto.routing, index, (r) => ({ ...r, mention })) })
                }
              />
              <ProfileSelect
                label={text.routingProfile}
                draft={draft}
                value={rule.profileId}
                onChange={(profileId) =>
                  set({ routing: replaceAt(auto.routing, index, (r) => ({ ...r, profileId })) })
                }
              />
              <button
                type="button"
                onClick={() => set({ routing: auto.routing.filter((_, i) => i !== index) })}
              >
                {text.removeRule}
              </button>
            </div>
          ))}
          <button
            type="button"
            data-variant="text"
            onClick={() =>
              set({
                routing: [...auto.routing, { label: "", mention: "", profileId: auto.profileId }],
              })
            }
          >
            + {text.addRule}
          </button>
        </div>
      </Section>

      <Section title={text.sensitive} intro={text.sensitiveIntro}>
        <div className="rule-table">
          {auto.sensitivePaths.map((rule, index) => (
            // eslint-disable-next-line react/no-array-index-key -- 規則は並び順そのものが意味を持つ
            <div className="rule-row" data-kind="path" key={index}>
              <TextField
                label={text.pattern}
                value={rule.pattern}
                mono
                invalid={compilePattern(rule.pattern) === null ? text.invalidPattern : null}
                onChange={(pattern) =>
                  set({
                    sensitivePaths: replaceAt(auto.sensitivePaths, index, (r) => ({
                      ...r,
                      pattern,
                    })),
                  })
                }
              />
              <TextField
                label={text.reason}
                value={rule.reason}
                onChange={(reason) =>
                  set({
                    sensitivePaths: replaceAt(auto.sensitivePaths, index, (r) => ({
                      ...r,
                      reason,
                    })),
                  })
                }
              />
              <button
                type="button"
                onClick={() =>
                  set({ sensitivePaths: auto.sensitivePaths.filter((_, i) => i !== index) })
                }
              >
                {text.removeRule}
              </button>
            </div>
          ))}
          <button
            type="button"
            data-variant="text"
            onClick={() =>
              set({ sensitivePaths: [...auto.sensitivePaths, { pattern: "", reason: "" }] })
            }
          >
            + {text.addRule}
          </button>
        </div>
        <NumberField
          label={text.maxLines}
          hint={text.maxLinesHint}
          value={auto.maxChangedLines}
          min={0}
          max={1_000_000}
          onChange={(maxChangedLines) => set({ maxChangedLines })}
        />
        <LinesField
          label={text.ignored}
          hint={text.ignoredHint}
          value={auto.ignoredPaths}
          mono
          onChange={(ignoredPaths) => set({ ignoredPaths })}
        />
      </Section>
    </div>
  );
}

function GeneralTab({
  draft,
  onChange,
}: {
  draft: Settings;
  onChange: (settings: Settings) => void;
}) {
  const text = t().settings.general;
  return (
    <div className="settings-tab">
      <Section title={t().settings.tabs.general}>
        <ModelSelect
          label={text.defaultModel}
          value={draft.defaultModel}
          onChange={(defaultModel) => onChange({ ...draft, defaultModel })}
        />
        <NumberField
          label={text.timeout}
          value={draft.timeoutMinutes}
          min={1}
          max={60}
          onChange={(timeoutMinutes) => onChange({ ...draft, timeoutMinutes })}
        />
      </Section>
      <p className="muted">{t().settings.storedAt}</p>
    </div>
  );
}

function PromptPreview({
  title,
  prompt,
  onClose,
}: {
  title: string;
  prompt: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="prompt-preview" role="dialog" aria-modal="true" aria-label={title}>
      <div className="prompt-preview-sheet">
        <header>
          <h3>{title}</h3>
          <button type="button" onClick={onClose}>
            {t().settings.profiles.close}
          </button>
        </header>
        <pre>{prompt ?? "…"}</pre>
      </div>
    </div>
  );
}

export function SettingsPage({ onBack }: { onBack: () => void }) {
  const text = t().settings;
  const saved = useSettings();
  const [draft, setDraft] = useState<Settings>(saved);
  const [tab, setTab] = useState<Tab>("profiles");
  const [status, setStatus] = useState<
    { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [preview, setPreview] = useState<{ title: string; prompt: string | null } | null>(null);
  // 既定に戻す・破棄するときに増やし、手元に文字列を持つ入力欄を読み直させる
  const [resetCount, setResetCount] = useState(0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const change = (next: Settings): void => {
    setDraft(next);
    setStatus({ kind: "idle" });
  };

  const save = async (): Promise<void> => {
    setStatus({ kind: "saving" });
    try {
      const result = await browserClient.saveSettings(draft);
      setSettings(result);
      setDraft(result);
      setStatus({ kind: "saved" });
    } catch (e: unknown) {
      setStatus({ kind: "error", message: e instanceof ApiError ? e.message : String(e) });
    }
  };

  const openPreview = (profile: ReviewProfile): void => {
    const title = text.profiles.previewHeading(profile.name);
    setPreview({ title, prompt: null });
    browserClient
      .previewPrompt(draft, profile.id)
      .then((prompt) => setPreview({ title, prompt }))
      .catch((e: unknown) =>
        setPreview({ title, prompt: e instanceof Error ? e.message : String(e) }),
      );
  };

  const back = (): void => {
    if (dirty && !window.confirm(`${text.unsaved}. ${text.discard}?`)) return;
    onBack();
  };

  return (
    <main className="page settings">
      <nav className="back">
        <button type="button" onClick={back}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          {text.back}
        </button>
        <LanguageSwitch />
      </nav>

      <header className="settings-head">
        <h1>{text.title}</h1>
        <div className="settings-tabs" role="tablist">
          {(["profiles", "autopilot", "general"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {text.tabs[key]}
            </button>
          ))}
        </div>
      </header>

      <div key={resetCount}>
        {tab === "profiles" ? (
          <ProfilesTab draft={draft} onChange={change} onPreview={openPreview} />
        ) : tab === "autopilot" ? (
          <AutopilotTab draft={draft} onChange={change} />
        ) : (
          <GeneralTab draft={draft} onChange={change} />
        )}
      </div>

      <footer className="settings-bar" data-dirty={dirty}>
        <span role="status" className={status.kind === "error" ? "error" : "muted"}>
          {status.kind === "saving"
            ? text.saving
            : status.kind === "saved"
              ? text.saved
              : status.kind === "error"
                ? text.saveFailed(status.message)
                : dirty
                  ? text.unsaved
                  : ""}
        </span>
        <button
          type="button"
          data-variant="text"
          onClick={() => {
            if (!window.confirm(text.confirmReset)) return;
            void browserClient.fetchDefaultSettings().then((defaults) => {
              change(defaults);
              setResetCount((n) => n + 1);
            });
          }}
        >
          {text.resetDefaults}
        </button>
        <button
          type="button"
          disabled={!dirty || status.kind === "saving"}
          onClick={() => {
            change(saved);
            setResetCount((n) => n + 1);
          }}
        >
          {text.discard}
        </button>
        <button
          type="button"
          data-variant="primary"
          disabled={!dirty || status.kind === "saving"}
          onClick={() => void save()}
        >
          {text.save}
        </button>
      </footer>

      {preview === null ? null : (
        <PromptPreview
          title={preview.title}
          prompt={preview.prompt}
          onClose={() => setPreview(null)}
        />
      )}
    </main>
  );
}
