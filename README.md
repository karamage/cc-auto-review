> [!TIP]
> **⭐ Star the repo and follow [@kara_mage](https://x.com/kara_mage) on X for early access to `focus-cafe`**.

> [!NOTE]
> This project is not affiliated with, endorsed by, or sponsored by Anthropic. Claude is a trademark of Anthropic, PBC. This is an independent developer project using Claude.

<div align="center">
  <img src="assets/icon.png" alt="CC Auto Review logo" width="120" height="120">

  <h1>CC Auto Review</h1>

  <p>
    <strong>Worn out by reviewing a flood of PRs?</strong>
  </p>
  <p>
    I built a desktop app that lets Claude Code review PRs first and sends only the risky ones to you.
  </p>
  <p>
    It reviews GitHub pull requests on macOS and Linux with your local <code>claude -p</code>: AI findings next to the diff and a 0–100 risk score. You review only the risky PRs.
  </p>

  <p>
    <a href="#-features"><img src="https://img.shields.io/badge/Features-✨-blue?style=for-the-badge" alt="Features"></a>
    <a href="#-installation"><img src="https://img.shields.io/badge/Install-🚀-green?style=for-the-badge" alt="Install"></a>
    <a href="#-usage"><img src="https://img.shields.io/badge/Usage-📖-purple?style=for-the-badge" alt="Usage"></a>
    <a href="#-development"><img src="https://img.shields.io/badge/Develop-🛠-orange?style=for-the-badge" alt="Develop"></a>
  </p>
  <p>
    <a href="https://github.com/karamage/cc-auto-review/actions/workflows/ci.yml"><img src="https://github.com/karamage/cc-auto-review/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
    <img src="https://img.shields.io/badge/macOS-11%2B-000000?logo=apple&logoColor=white" alt="macOS 11+">
    <img src="https://img.shields.io/badge/Linux-x86__64-FCC624?logo=linux&logoColor=black" alt="Linux x86_64">
    <img src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" alt="Tauri 2">
    <img src="https://img.shields.io/badge/Claude_Code-required-555555" alt="Claude Code required">
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT License"></a>
  </p>

  <p><a href="https://karamage.github.io/cc-auto-review/#download"><strong>Download for macOS</strong></a> · <a href="https://karamage.github.io/cc-auto-review/#risk"><strong>Score a PR in your browser</strong></a> · <a href="https://karamage.github.io/cc-auto-review/">Website</a></p>

  <p><a href="README.ja.md">日本語の README はこちら</a></p>
</div>

<p align="center">
  <a href="https://karamage.github.io/cc-auto-review/"><img src="assets/demo/film-en.gif" alt="The 37-second CC Auto Review film: a person faces a mountain of pull requests, the app scores a PR, Claude finds a SQL injection, and the autopilot hands risky PRs back. The mountain clears, leaving only the PRs that need the person. (Sample data)" width="880"></a>
</p>

<p align="center">
  <img src="assets/demo/review-en.gif" alt="Opening a PR, running the AI review, jumping to a finding and accepting it" width="880">
  <br>
  <sub>Open a PR, run the AI review, jump to a finding and accept it. (Sample data)</sub>
</p>

> [!TIP]
> CC Auto Review stores no Claude credentials. It runs your locally installed, unmodified Claude Code as you have configured it, and GitHub access goes through your `gh` login. Your use is subject to [Anthropic's terms](https://code.claude.com/docs/en/legal-and-compliance). Check them before using the autopilot, or use an API key.

> [!NOTE]
> This project is not affiliated with, endorsed by, or sponsored by Anthropic. Claude is a trademark of Anthropic, PBC. Reviews the app posts come from **your** GitHub account.

## 🌟 Overview

**CC Auto Review** puts a pull request's diff and Claude's findings on one screen. You accept, reject, or edit each finding and post the review to GitHub. Every review runs through your locally installed Claude Code (`claude -p`), in a temporary directory that holds only the PR's changed files.

When you turn on the **autopilot**, the app works through your review requests by itself. It approves or comments, waits for the author, reviews again, and hands anything risky (CI, migrations, auth, secrets, huge diffs, high risk scores) to a human without posting.

## 📋 Table of Contents

- [🌟 Overview](#-overview)
- [✨ Features](#-features)
- [🚀 Installation](#-installation)
- [📖 Usage](#-usage)
  - [Findings](#findings)
  - [Risk score](#risk-score)
- [⚙️ Customizing reviews](#️-customizing-reviews)
  - [Review profiles](#review-profiles)
  - [Autopilot](#autopilot)
- [🏗 How it works](#-how-it-works)
- [🔒 Security](#-security)
- [🛠 Development](#-development)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)
- [🙏 Acknowledgments](#-acknowledgments)

## ✨ Features

### 🔍 AI review on one screen
- **Diff and findings side by side**: findings are anchored to diff lines and listed in a side panel; click one to jump to it.
- **You stay in control**: accept, reject, or edit every finding before anything is posted.
- **Ask after the review**: ask about findings, have code explained, and add problems you find together to the draft.
- **Verified, high-signal findings**: `blocker` and `should` must state a trigger and an impact, or they are downgraded to `question`.
- **Prior comments re-checked**: earlier review comments are marked *fixed / unfixed / unverified* against the current code.
- **Post in any language**: findings are translated right before posting when you post in another language.

### 📦 No clone needed
- **Only changed files** are fetched into a temporary directory.
- **Read-only helper** (`remote-read`): Claude reads callers, types and tests from GitHub with GET requests pinned to the PR's repository and commits.

### 🎯 Risk score
- **Deterministic baseline** from the diff alone: size, spread, sensitive areas, risky patterns, test gaps, change shape, context.
- **Bounded AI adjustment** of up to ±20, each item citing `file:line`. The server does the math.
- **Escalations** for verified serious problems send the PR to a human.

### 🧩 Customizable review profiles
- **Perspectives, guidelines, things not to report, a finding limit, and extra tools** (Skills, MCP) per profile.
- **Ships with** *Standard*, *Security focused* and *Quick (blockers only)*.
- **Prompt preview** shows exactly what Claude receives.
- **Repository conventions** (`CLAUDE.md`, `AGENTS.md`, `REVIEW.md`) are read from the base branch.

### 🤖 Autopilot (optional)
- **Sweeps your review requests** on an interval, approves or comments, and re-reviews when the author pushes or replies.
- **Hands risky PRs to a human**: by path, by changed lines, by risk score, or by natural-language criteria you write.
- **Profile routing** by repository, label, or mention (e.g. `@org/security`).

<p align="center">
  <img src="assets/demo/autopilot-en.gif" alt="Turning on the autopilot: it reviews five PRs, approves or comments, and hands the risky one to a human" width="880">
  <br>
  <sub>Turn on the autopilot: five PRs are reviewed, approved or commented on, and the risky one is handed to you. (Sample data)</sub>
</p>

### 🖥 Native macOS app
- **Small**: about 12 MB per CPU (23 MB universal). The server runs on [txiki.js](https://github.com/saghul/txiki.js), a ~6 MB JavaScript runtime.
- **Desktop notifications** when a review finishes or fails.
- **English and Japanese** UI.

## 🚀 Installation

### Download

**[Download the DMG](https://karamage.github.io/cc-auto-review/#download)** for Apple silicon or Intel, open it, and drag the app to Applications. It is signed with a Developer ID and notarized by Apple, so it opens normally. All versions are on the [releases page](https://github.com/karamage/cc-auto-review/releases).

On Linux x86_64, download the `.AppImage` or `.deb` from the [releases page](https://github.com/karamage/cc-auto-review/releases). They are not signed, so check them against the `.sha256` file next to each one. These builds are new: they start in CI but have not been tested on a real desktop yet, so please [report any problems](https://github.com/karamage/cc-auto-review/issues).

### Prerequisites

- macOS 11+, or Linux x86_64 with WebKitGTK 4.1
- [GitHub CLI](https://cli.github.com) (`gh`), signed in with `gh auth login`
- [Claude Code](https://claude.com/claude-code) (`claude`) 2.1.314 or later

The app looks for `gh` and `claude` in your login shell's `PATH`, so it works when launched from Finder or the Dock.

<details>
<summary><strong>Build from source</strong></summary>

```bash
git clone https://github.com/karamage/cc-auto-review.git
cd cc-auto-review
bun install
bun run app:build
```

Then drag `CC Auto Review.app` from `src-tauri/target/release/bundle/macos/` into `/Applications`.

| Command | Output |
| --- | --- |
| `bun run app:build` | `.app` for the CPU of the machine you build on (~12 MB) |
| `bun run app:build:x64` | `.app` for Intel Macs (can be built on Apple Silicon) |
| `bun run app:build:universal` | One `.app` for both Apple Silicon and Intel (~23 MB) |
| `bun run app:dmg` (`:x64`, `:universal`) | The same, packed as a `.dmg` |

> [!IMPORTANT]
> A locally built app is not signed. If macOS refuses to open it, allow it in **System Settings → Privacy & Security → Open Anyway**. Release DMGs built with `bun run release:mac` are signed and notarized and open normally.

On Linux, install `cmake`, a C compiler and [Tauri's system packages](https://tauri.app/start/prerequisites/#linux), then run `bun run app:build:linux`. The first build compiles txiki.js from source. Linux packages for releases are built by `.github/workflows/release-linux.yml` when a release is published.

</details>

## 📖 Usage

```
Dashboard → Open a PR → Pick profile & model → Run AI review → Accept / Reject / Edit → Post
```

1. **Dashboard**: lists PRs that request your review (the same query as github.com/pulls/review-requested). You can also open any PR by URL.
2. **Run AI review**: open a PR, pick a **review profile** and a **model**, optionally write what to focus on, and press **Run AI review**.
3. **Triage findings**: accept, reject, or edit each finding. Findings outside the diff are collected into the review body.
4. **Post**: choose *Comment / Approve / Request changes*. If your findings were written in another language than the one you post in, Claude translates them right before posting.
5. **Watch (optional)**: when the author pushes or replies, the AI review runs again. Nothing is re-posted without you.

### Findings

| Severity | Meaning |
| --- | --- |
| blocker | A verified defect that must be fixed before merging |
| should | Should be fixed, but safe to do later |
| question | The intent is unclear; says what would need to be known |
| nit | Taste-level suggestion (hidden by default) |

`blocker` and `should` must state a **trigger** (how it happens) and an **impact** (what goes wrong); otherwise they are downgraded to `question`. When a PR has earlier review comments, Claude re-checks each one against the current code and marks it *fixed / unfixed / unverified*. An author's "fixed it" or a resolved thread is never taken as evidence.

### Risk score

The review screen shows the PR's change risk as a 0–100 score (the scoring model is ported from [pr-risk-score](https://github.com/karamage/pr-risk-score)).

- **Baseline**: computed from the diff alone as soon as the PR opens. It adds seven factors: size, spread, sensitive areas (auth, payments, migrations, CI, …), risky patterns on added lines (secrets, eval, XSS sinks, destructive SQL, …), test gaps, change shape, and context. Some findings set a floor: a leaked secret (90), a destructive migration (75), text that tries to steer an AI reviewer (60).
- **AI adjustment**: when the AI review runs, Claude reads what the change means and proposes items citing `file:line` that move the score by up to ±20. A verified serious mechanism (authorization bypass, irreversible data loss at scale, …) is an *escalation*: the score is raised to at least 60 and the PR goes to a human. The server does the arithmetic; the AI cannot move caps or floors.

| Score | Level |
| --- | --- |
| 0–24 | LOW |
| 25–50 | MEDIUM |
| 51–75 | HIGH |
| 76–100 | CRITICAL |

Autopilot hands a PR to a human, without posting, when its score is **above** the threshold (50 by default) or it has an escalation.

## ⚙️ Customizing reviews

Open **Settings** (top right of the dashboard).

### Review profiles

A profile is a complete "how to review" recipe. The app ships with *Standard*, *Security focused* and *Quick (blockers only)*; edit them or add your own.

| Field | What it does |
| --- | --- |
| Perspectives | The only things the reviewer looks at. Toggle, reorder, rewrite, or add your own (e.g. "Accessibility", "Our API versioning rules"). Write them in any language. |
| Team review guidelines | Free text: conventions, priorities, tone, "always add a suggestion block", … |
| Do not report | Noise to suppress, one per line. |
| Maximum number of findings | Keep only the N most severe findings. |
| Extra allowed tools | e.g. `Skill`, `WebFetch`, `mcp__docs`. Nothing beyond read-only tools is allowed by default. **Never allow tools that can write** — instructions hidden in a PR description could trigger them. |

**Preview the prompt** shows exactly what Claude will receive.

The repository's own `CLAUDE.md`, `AGENTS.md` and `REVIEW.md` are also read — always **from the base branch**, so a PR cannot change the rules it is reviewed by. `.claude/`, `.mcp.json` and `CLAUDE.local.md` are never placed in the working directory.

### Autopilot

| Setting | Default |
| --- | --- |
| Model / profile | Haiku / Standard |
| Sweep interval | 10 minutes |
| Max comment rounds before handing to a human | 3 |
| Approve when there are no findings | on (turn off to only comment and leave approval to humans) |
| Attach an LGTM image to approvals | off |
| Label to trust autopilot | `auto-judge` |
| Label to skip AI review | `skip-ai-review` |
| Profile routing | Use another profile for a repository, or when a PR has a label or mentions someone (e.g. `@org/security`) |
| When to hand a PR to a human | Natural-language criteria the AI reads when judging risk (auth/billing, migrations, CI/infra, breaking API changes, …). Add, edit, or relax them, e.g. "Documentation-only changes do not need a human" |
| Paths handed to a human without calling the AI | CI, DB migrations, infra, secrets, auth/billing/crypto, review conventions (editable regexes) |
| Changed lines handed to a human | 1000 (lock files and `dist/` are not counted) |
| Risk score handed to a human | 50 (above this goes to a human) |

Autopilot runs only while the app is open. Reviews it posts come from **your** GitHub account and say they are automated. Autopilot runs Claude Code automatically, so check [Anthropic's terms](https://code.claude.com/docs/en/legal-and-compliance) before turning it on, or use an API key.

### Files

Settings and app state live in `~/.config/cc-auto-review/` (override with `CC_AUTO_REVIEW_HOME`).

## 🏗 How it works

```
CC Auto Review.app
├── Tauri shell (Rust)         starts the server, opens a window on it
├── cc-auto-review-server      txiki.js (a ~6 MB JavaScript runtime) that runs server.js
└── Resources/server.js        the Hono server, bundled into one JS file
    ├── serves the React UI and the API on 127.0.0.1 (random port, per-launch token)
    ├── gh  → PR list, diff, comments, posting reviews
    └── claude -p  → the review, in a temp dir with only the changed files
            └── remote-read (cat / cat-base / ls / find / grep / issue) → GitHub, GET only
```

- Before posting, the PR head is checked again; if it moved since the review, nothing is posted.
- A review times out after 10 minutes (configurable).

## 🔒 Security

1. **Local only**: the server listens on `127.0.0.1`. In the desktop app, the API only accepts requests that carry the token generated at launch, so other local apps and web pages cannot drive it.
2. **Confined file access**: Claude can read only the temporary directory that holds the PR's changed files and diff, and can write only its result file. Beyond that it gets `Grep`, `Glob` and the `remote-read` helper. `git`, arbitrary `gh` commands and other shell commands are denied, whatever your default permission mode is. Allow rules in your own Claude Code settings and a profile's extra tools still apply, so keep them narrow. Text in a PR can still try to influence the review itself, so read what the app posts.
3. **GET-only GitHub access for Claude**: `remote-read` is pinned to the PR's repository and commits through environment variables and never issues write requests.
4. **PRs cannot rewrite the rules**: conventions are read from the base branch, and `.claude/`, `.mcp.json` and `CLAUDE.local.md` from the PR are never placed in the working directory.
5. **No telemetry**: the app sends no usage data. It talks to GitHub through `gh` and to Claude through `claude`; the UI also loads web fonts and, if enabled, LGTM images.

## 🛠 Development

### Tech stack

- **Desktop shell**: [Tauri 2](https://tauri.app) (Rust)
- **Server**: [Hono](https://hono.dev), bundled and run on [txiki.js](https://github.com/saghul/txiki.js) in the app, on [Bun](https://bun.sh) in development
- **UI**: React 19 + TypeScript + Vite
- **Tooling**: Bun (package manager and test runner), Biome, oxlint

### Project structure

```
cc-auto-review/
├── src/
│   ├── client/        # React UI (pages, components, autopilot state)
│   ├── server/        # Hono API, gh / claude runners, diff parsing, snapshots
│   │   ├── reviewer/  # prompt building, claude -p runner, remote-read, translation
│   │   └── runtime/   # Bun and txiki.js adapters
│   └── shared/        # types, settings, risk score shared by client and server
├── src-tauri/         # Tauri shell that starts the bundled server
└── scripts/           # server bundling and signed release builds
```

### Commands

Requirements: [Bun](https://bun.sh), Rust (the repo pins `stable` via `rust-toolchain.toml`), Xcode Command Line Tools.

```bash
bun install
bun run check        # typecheck + lint + format check + tests
bun run app:build    # builds the UI, the server binary and CC Auto Review.app
bun run app:dmg      # also builds a .dmg (Finder automation permission may be required)
bun run app:build:x64         # .app for Intel Macs (can be built on Apple Silicon too)
bun run app:dmg:x64           # the same, as a .dmg
bun run app:build:universal   # one .app for both Apple Silicon and Intel Macs
bun run app:dmg:universal     # the same, as a .dmg
```

Browser-only development (no Tauri):

```bash
bun run dev:server   # API on localhost:4711
bun run dev:client   # Vite on localhost:5173, proxies /api to 4711
```

Tests never start real `gh` / `claude` / `git`; they use a fake `CommandRunner`.

<details>
<summary><strong>Releasing a signed, notarized DMG</strong></summary>

One-time setup (requires an Apple Developer Program membership):

1. Create a **Developer ID Application** certificate: Xcode → Settings → Accounts → Manage Certificates → `+`.
2. Save notarization credentials to the keychain (use an [app-specific password](https://support.apple.com/102654)):

   ```bash
   xcrun notarytool store-credentials cc-auto-review --apple-id <Apple ID> --team-id <Team ID>
   ```

Then:

```bash
bun run release:mac             # → release/CC-Auto-Review_<version>_arm64.dmg and _x64.dmg
bun run release:mac arm64       # Apple Silicon only
bun run release:mac universal   # one DMG for both
```

By default the script builds separate Apple Silicon and Intel versions. For each architecture it builds the app, signs it with Hardened Runtime, notarizes and staples the app, packs it into a DMG, and notarizes and staples the DMG. Set `APPLE_SIGNING_IDENTITY` to pick a certificate and `NOTARY_PROFILE` to use another keychain profile.

</details>

## 🤝 Contributing

Issues and pull requests are welcome. Please run `bun run check` before opening a PR.

Areas where help is especially welcome:

- 🐛 Bug reports and fixes
- 🧭 New default review perspectives and profiles
- 🌐 Translations of the UI beyond English and Japanese
- 🪟 Windows support
- 📚 Documentation and screenshots

## 📄 License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- [Claude Code](https://claude.com/claude-code) by Anthropic, which does the reviewing
- [Tauri](https://tauri.app), [txiki.js](https://github.com/saghul/txiki.js) and [Hono](https://hono.dev), which make a small native app possible
- [GitHub CLI](https://cli.github.com)
- [LGTMoon](https://lgtmoon.dev) for the LGTM images
- [opcode](https://github.com/winfunc/opcode) for README inspiration

---

<div align="center">
  <a href="https://github.com/karamage/cc-auto-review/issues">Report Bug</a>
  ·
  <a href="https://github.com/karamage/cc-auto-review/issues">Request Feature</a>
</div>
