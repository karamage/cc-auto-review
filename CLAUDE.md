# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CC Auto Review is a macOS desktop app (Tauri 2) that reviews GitHub PRs by shelling out to the user's local `claude -p` and `gh`. A Hono server serves both the API and the React UI on `127.0.0.1`; the Tauri shell only spawns that server and points a webview at it. There is no API key and no clone: only the PR's changed files are written to a temp dir.

## Commands

Bun is the package manager, test runner and dev runtime.

```bash
bun install
bun run check                 # typecheck (tsc) + lint (oxlint) + format check (biome) + tests — run before PRs
bun test                      # all tests
bun test src/server/diff/parse.test.ts      # one file
bun test -t "name pattern"                  # filter by test name
bun run format                # biome format --write (biome's linter is disabled; oxlint is the linter)

bun run dev:server            # API on :4711 (bun --watch)
bun run dev:client            # Vite on :5173, proxies /api to 4711 (override with CC_AUTO_REVIEW_PORT)
bun run start                 # build client, then run server and open the browser

bun run app:build             # client + bundled server + .app for this CPU (also :x64, :universal, app:dmg*)
bun run release:mac           # signed + notarized DMGs (needs Developer ID + notarytool profile)
```

`bunfig.toml` preloads `src/test-setup.ts`, which sets the UI language to Japanese — test expectations are written against Japanese strings.

## Architecture

### Three source roots
- `src/server/` — Hono API, `gh`/`claude` invocation, diff parsing, snapshots, file stores.
- `src/client/` — React 19 UI. **The autopilot runs in the client** (`state/autopilot.ts`, `state/sessions.ts`, `state/watch.ts`), so it only runs while the app window is open. Client state is persisted through the server (`/api/state/:key` → `StateStore`).
- `src/shared/` — types, settings schema/normalization, i18n, and both risk models, imported by client and server.

### Two server runtimes
The server runs on **Bun in dev/tests** (`src/server/index.ts`) and on **txiki.js in the shipped app** (`src/server/index.tjs.ts`). Both call `start(runtime)` in `main.ts` with a `Runtime` (`runtime/types.ts`) that supplies the command runner, file reader, static file reader and HTTP server.

- `scripts/build-server.ts` bundles `index.tjs.ts` into `dist/server/server.js` and rewrites `node:*` imports to shims in `runtime/tjs-node/`. Only `node:fs/promises`, `node:os`, `node:path`, `node:crypto` have shims — **importing any other `node:` module, or a Bun-only API, from server code reachable from `main.ts` breaks the app build.** Keep Bun-specific code behind the `Runtime` interface.
- The same binary doubles as the `remote-read` helper: `start()` checks `argv[2] === "remote-read"`. `env.ts:installRemoteRead` writes a shell wrapper to `~/.config/cc-auto-review/bin/remote-read` (path without spaces, because Claude's `Bash(<cmd>:*)` permission is prefix-matched).
- `main.ts` rebuilds `PATH` from the login shell (`loginShellPath`) because Finder-launched apps lack it.
- Desktop handshake: Tauri (`src-tauri/src/lib.rs`) generates a token, passes it as `CC_AUTO_REVIEW_TOKEN`, and waits for a `CC_AUTO_REVIEW_READY <url>` line on stdout. When a token is set, every `/api/*` request must carry `x-cc-auto-review-token` (`app.ts`); the client reads it from `?token=` (`client/desktop.ts`).

### Review flow (`routes/review.ts`, SSE stream)
1. `SnapshotManager` writes changed files (head) plus `CLAUDE.md`/`AGENTS.md`/`REVIEW.md` **from the base branch** into a temp workDir, and never places `.claude/`, `.mcp.json`, `CLAUDE.local.md` there. This is a security boundary — a PR must not be able to change its own review rules.
2. `reviewer/prompt.ts` builds the prompt from the selected profile (`shared/settings.ts`), user instructions, prior comments and the risk baseline.
3. `reviewer/runner.ts` runs `claude -p --output-format stream-json --verbose --permission-mode dontAsk --settings ... --add-dir <root> --allowedTools ...` in the workDir. `CLAUDE_LOCKDOWN_ARGS` is a security boundary: it stops the user's `defaultMode` from being inherited and blocks file access outside the working directories (needs Claude Code 2.1.314+, enforced by `preflight.ts`). Allowed tools are only `Read,Grep,Glob,Edit(//<output file>),Bash(remote-read:*)` plus profile extras. The `Edit` rule also covers `Write` and must use the same path string as the prompt, not a resolved real path. Claude writes its JSON result to a file; `reviewer/parse.ts` validates it (one retry only on `FindingParseError`). `remote-read` gets repo/head/base via env vars, not arguments, so Claude can't redirect it.
4. `diff/anchor.ts` maps findings onto diff lines; `routes/submit.ts` re-checks the PR head SHA before posting and translates findings (`reviewer/translate.ts`) if the post language differs.

### Review chat (`routes/chat.ts`, SSE stream)
After a review, the client sends the question, history and current findings to `POST .../chat`. Each question builds a new snapshot and runs `claude -p` through `ReviewRunner.ask` with the same tool restrictions as a review; `--resume` is not used because the workDir does not outlive a run. The conversation lives in `ReviewSession.chat` (`client/state/chat.ts`) and is cleared when a re-review starts. Proposed findings only enter the draft when the user adds them.

### Risk: two separate models in `src/shared/`
- `risk.ts` — rule-based `low/medium/high` level (path regexes, changed-line limits, profile routing) used by autopilot handoff.
- `risk-score.ts` — 0–100 score ported from pr-risk-score: deterministic baseline from the diff + AI adjustment bounded to ±20, with floors and escalations. The server does the arithmetic; the AI output only proposes items. Autopilot hands a PR to a human when score > threshold (default 50) or on escalation.

### Testing conventions
- Tests never run real `gh`/`claude`/`git`. Use `FakeCommandRunner` (`exec.ts`), keyed by the space-joined command line; unregistered commands throw. In-memory stores and `RecordingSystemActions` live in `store/memory.ts`.
- The client `ApiClient` takes a `Fetcher`, so client tests call the Hono `app.fetch` directly.

### i18n
UI strings live in `client/messages.ts`: `ja` is the source of truth and `en` must match its shape (enforced by types). User-facing server errors are `AppError` with `{ ja, en }` text, localized per request (`lang.ts`). Code comments are written in Japanese.

## Website
`docs/` is the GitHub Pages site, plain HTML with no build: `docs/index.html` (EN) and `docs/ja/index.html` (JA) share `style.css`, `site.js`, `risk.js` and `download.js`. `download.js` looks up the latest release, so a new release needs no site change. `docs/engine.js` is generated from the real scoring code with `bun run build:site`; CI fails if it is stale, so rebuild it after changing `risk-score.ts` or `diff/parse.ts`.

## Settings / data
App settings and state: `~/.config/cc-auto-review/` (override with `CC_AUTO_REVIEW_HOME`). Snapshots go under `$TMPDIR/cc-auto-review-snapshots` and orphans are pruned on startup.
