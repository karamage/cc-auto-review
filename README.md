# CC Auto Review

A macOS desktop app that reviews GitHub pull requests with **your locally installed Claude Code** (`claude -p`).
You see the diff and the AI's findings on one screen, accept / reject / edit them, and post the review to GitHub. An optional autopilot handles your review requests on its own and hands only risky changes back to you.

[日本語の README はこちら](README.ja.md)

- **Uses your own Claude Code.** No API key to configure; reviews run on your Claude Code subscription or settings.
- **No clone needed.** Only the changed files are fetched from GitHub into a temporary directory. Claude reads anything else (callers, types, tests) through a read-only, GET-only helper pinned to the PR's repository and commits.
- **Customizable review.** Define *review profiles*: which perspectives to check, what not to report, team guidelines, a finding limit, and extra tools (Skills, MCP). The default profile already focuses on verified, high-signal problems.
- **Autopilot (optional).** Periodically reviews your requests, approves or comments, waits for the author, re-reviews — and routes anything risky (CI, migrations, auth, secrets, huge diffs, …) to a human.

## Requirements

- macOS 11+
- [GitHub CLI](https://cli.github.com) (`gh`), signed in with `gh auth login`
- [Claude Code](https://claude.com/claude-code) (`claude`)

The app looks for `gh` and `claude` in your login shell's `PATH`, so it works when launched from Finder or the Dock.

## Install

Build it from source (see [Development](#development)), then drag `CC Auto Review.app` into `/Applications`. `bun run app:build` builds the app for the CPU of the machine you build on, in `src-tauri/target/release/bundle/macos/`. To build the Intel version on an Apple Silicon Mac, use `bun run app:build:x64`. `bun run app:build:universal` produces a single app for both. The per-CPU app is about 12 MB and the universal one about 23 MB.

> A locally built app is not signed. If macOS refuses to open it, allow it in **System Settings → Privacy & Security → Open Anyway**. Release DMGs built with `bun run release:mac` are signed and notarized and open normally.

## Usage

1. The dashboard lists PRs that request your review (the same query as github.com/pulls/review-requested). You can also open any PR by URL.
2. Open a PR, pick a **review profile** and a **model**, optionally write what to focus on, and press **Run AI review**.
3. Accept, reject, or edit each finding. Findings outside the diff are collected into the review body.
4. Choose *Comment / Approve / Request changes* and post. If your findings were written in another language than the one you post in, Claude translates them right before posting.
5. Optionally **start watching**: when the author pushes or replies, the AI review is run again (nothing is re-posted without you).

### Findings

| Severity | Meaning |
| --- | --- |
| blocker | A verified defect that must be fixed before merging |
| should | Should be fixed, but safe to do later |
| question | The intent is unclear; says what would need to be known |
| nit | Taste-level suggestion (hidden by default) |

`blocker` and `should` must state a **trigger** (how it happens) and an **impact** (what goes wrong); otherwise they are downgraded to `question`. When a PR has earlier review comments, Claude re-checks each one against the current code and marks it *fixed / unfixed / unverified* — an author's "fixed it" or a resolved thread is never taken as evidence.

## Customizing reviews

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
| Profile routing | Use another profile when a PR has a label or mentions someone (e.g. `@org/security`) |
| Paths handed to a human without calling the AI | CI, DB migrations, infra, secrets, auth/billing/crypto, review conventions (editable regexes) |
| Changed lines handed to a human | 1000 (lock files and `dist/` are not counted) |

Autopilot runs only while the app is open. Reviews it posts come from **your** GitHub account and say they are automated.

### Files

Settings and app state live in `~/.config/cc-auto-review/` (override with `CC_AUTO_REVIEW_HOME`).

## How it works

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

- The API only accepts requests that carry the token the app generated at launch, so other local apps and web pages cannot drive it.
- Before posting, the PR head is checked again; if it moved since the review, nothing is posted.
- A review times out after 10 minutes (configurable).

## Development

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

### Releasing a signed, notarized DMG

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

## License

MIT
