# XtracsysCode

A local-model agent app for macOS. It reads, writes, searches, and runs commands in your project folders. There is no built-in cloud inference, telemetry, or updater; model requests go only to a configured loopback server.

File writes and shell commands ask first by default, with per-chat policies and per-project allowlists. Approved shell commands and MCP/plugin processes are ordinary local processes, not sandboxed.

[Read the Xtracsys orchestration playbook](https://github.com/Xtracsys/Xtracsys/blob/main/docs/ORCHESTRATION_GUIDE.md) for the planning and review workflow behind this project.

---

```
┌──────────────────────────────────────────────────────────────┐
│  XtracsysCode (Electron desktop app, macOS)                  │
│                                                              │
│  React UI  ←── IPC (contextBridge, sandboxed) ──→  Agent host │
│                                                    │         │
│                              Ollama HTTP API ──────┤         │
│                       OpenAI-compatible local servers ┘     │
│                                                              │
│  Data: ~/XtracsysCode — JSON + Markdown, user-visible        │
└──────────────────────────────────────────────────────────────┘
```

## Why a desktop app (and not the old web front-end)

An earlier prototype bridged to a hosted Grok CLI over ACP. XtracsysCode replaces that bridge with a **self-contained agent harness** running inside the app: multi-step tool loop, approvals, bounded storage, and saved automations. Built-in model requests go to loopback servers; approved commands and plugins run locally but are not sandboxed and may use the network.

## Features

- **Agent loop** — streaming responses, multi-step tool use (up to `maxSteps` per turn), reasoning-model "thinking" blocks
- **Tools** — `list_dir`, `read_file`, `write_file`, **`edit_file`** (surgical, unique-match replace with diff preview), `run_command` (streams live output into the tool card), `grep`, **`set_plan`** (todo list the agent keeps updated; Settings → Plan)
- **Approvals** — read-only tools auto-approved; file writes and shell commands ask first (per-chat `ask` / `auto`), with **per-project allowlists**: command globs (`git *`) and writable scopes (`src/**`). The approval dialog has "Always allow", and Settings → Rules manages rules
- **Model parameters** — `num_ctx` and temperature per backend; **context meter** in each chat (amber ≥70%, red ≥90% of the window)
- **Projects & chats** — multiple concurrent chats, grouped by project folder; per-chat model picker; queue follow-up messages while streaming; **Retry** re-runs a failed turn cleanly
- **Slash commands** — `/compact` (summarize + shrink context), `/clear`, `/model <name>`, `/help`
- **Project instructions** — `.xtracsys.md` or `AGENTS.md` in the project root is loaded into the system prompt
- **Backends** — Ollama (native `/api/chat`), llama.cpp, GMLX, and MLX LM server (OpenAI-compatible `/v1` for the latter three), switchable in Settings; models auto-probed; **image attachments** for vision models (paste or 🖼 button; actual server/model vision support varies)
- **Local MCP servers** — per-project stdio MCP config (Settings → Rules); discovered tools appear as `mcp__<server>__<tool>`, approval-gated, spawned locally but not sandboxed
- **Automations (Tasks)** — saved prompts run on demand or on a repeat interval (while the app is open); completion notifications (toggleable)
- **Search & export** — global transcript search (sidebar), **backup export/import** (tar.gz of the app data root, validated in staging with rollback; restore pauses schedules, removes project MCP commands and allow-always rules, resets approvals to Ask, and disables/unreviews plugins)
- **Polish** — ⌘K command palette, ⌘T new chat, dark/light themes
- **Bounded storage** (hard requirement) — size-capped logs with rotation, total chat cap with oldest-first pruning, age-based retention, auto-wiped scratch dir, cleanup on launch and every 10 minutes, visible storage meter with manual "Run cleanup now"
- **No built-in call-home** — the renderer has a strict CSP (`connect-src 'none'`), the IPC bridge allows an explicit channel list, and built-in model requests are restricted to configured loopback URLs. This does not sandbox shell commands or plugins.

## Windows & Linux install guides

See [INSTALL_WINDOWS.md](./INSTALL_WINDOWS.md) and [INSTALL_LINUX.md](./INSTALL_LINUX.md) — the platform builds are cross-compiled; per-box verification is tracked in VERIFY_PLATFORM.md.

## Install & run (development)

Prerequisites: **Node.js 20+** and a local model backend.

```bash
npm install
npm run build        # compile agent host + renderer
npm start            # launch the app (loads dist-web)
# or, for UI development with reload:
npm run dev
```

### Set up a backend

**Ollama** (easiest):

```bash
ollama serve                      # usually already running on macOS
ollama pull qwen2.5-coder:7b     # a tool-calling-capable model is recommended
```

**llama.cpp**: build or download `llama-server`, then:

```bash
llama-server -m /path/to/model.gguf --host 127.0.0.1 --port 8080
```

**GMLX**: start its OpenAI-compatible server (`gmlx serve`, default port 8080), then select **GMLX** in Settings → Backends. See the [GMLX HTTP API](https://github.com/asher/gmlx/blob/main/docs/api.md).

**MLX LM**: start `mlx_lm.server --model <local-model-path-or-repo>` (default port 8080), then select **MLX LM server** in Settings → Backends. A Hugging Face repo ID may download weights if they are not cached; pre-cache the model for offline use. This is the MLX LM HTTP server, not the bare MLX framework; see the [upstream server guide](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md).

The compatible-server transport is covered by local API fixtures; GMLX and MLX LM were not exercised against live servers in this work. Tool calling, image handling, and usage reporting depend on the specific server/model combination.

The app validates that its configured destination is loopback, but it cannot verify which interfaces the backend server listens on. Keep the server bound to localhost and do not expose an unauthenticated endpoint. The [MLX LM server guide](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md) warns that the server is not recommended for production because it implements only basic security checks.

In the app, open **Settings → Backends**, pick the provider + URL + model, and save. With no model configured, the app auto-picks the first available one on first send.

> Model choice matters for tool calling. Recommended: `qwen2.5-coder:7b`, `qwen3:8b`, `llama3.1:8b`, or Granite 4.x coder models — all run fine on Apple Silicon.

## Package a macOS .app / .dmg

```bash
npm run dist       # macOS DMG + ZIP (unsigned; version comes from package.json)
npm run dist:dir   # release/mac-arm64/XtracsysCode.app only
npm run dist:win   # Windows nsis installer (cross-build from mac downloads the platform Electron)
npm run dist:linux # Linux AppImage
```

## v4 additions

- **Chat archive** — sidebar 🗄 or bulk "Archive (N)" moves chats to `~/XtracsysCode/archive/` (excluded from sidebar/search/usage/cleanup); restore or delete-forever from Settings → Storage → Archived chats
- **Git write ops** — Settings → Git: stage, unstage, discard (confirmed), and commit with message via a hardened allow-listed `git:run`
- **Focus mode** — "⤢ Focus" expands the composer to a full-screen editor (Esc to close); send/queue/images all work
- **Appearance** — accent presets + reduce-motion in Backends, persisted in `settings.json`
- **Context guardrail** — a one-time notice at ≥90% context suggests `/compact`; task runs append summary lines to their chat
- **Scheduled backups** — daily tar.gz of the data root into `~/XtracsysCode/backups/` with retention pruning (Storage tab)
- **Session restore** — your active chat and open chat windows are remembered across launches (Window → Reopen chat windows)
- **Onboarding wizard** — first-run backend probe + first project in three steps
- **Log viewer** — level/text filters, auto-scroll, export
- **Polish** — Esc closes popovers, 🔒 icon marks ask-approval chats, middle-click closes tabs, backend "Test connection" with latency

## v5 additions

- **Skills** — reusable instructions (plus inert reference/template files), managed in **Settings → Skills**: import a folder (needs `SKILL.md` with `name`/`description` frontmatter), create drafts, enable/disable, per-project or global scope, edit/export/remove (removal never touches an imported source). Attach enabled skills to a chat with **`/skill <id>`** (or `/skill` to list) — the catalog's metadata rides in context and full instructions load only for attached chats (max 3, size-bounded). App-managed copies live under `skills/` in the data root
- **Skill Builder (bundled)** — a first-party `skill-builder` skill ships with the app (plus five starters: project orientation, systematic debugging, test-first development, completion review, wiki maintenance). **✨ Create with Skill Builder** in Settings → Skills starts a chat with it attached; generated skills are drafts until validated and enabled
- **Local plugins (v1)** — a plugin is a manifest (`plugin.json`) for a local stdio tool process on the existing MCP transport. Import from a folder in **Settings → Plugins**; plugins are **disabled on import**, gated behind an explicit command/tool review, scopeable per project, testable ("Test connection" lists discovered tools), and removable without touching the source folder. No marketplace, no renderer-code loading, no eval. The trust boundary is stated plainly: an enabled plugin is an ordinary local process, not sandboxed — every tool it exposes stays approval-gated. A harmless first-party example lives at `plugins/example-text-formatter/`
- **Hardening** — file-tool paths now resolve through realpath with explicit rejection of outside/symlink-escaped targets (residual TOCTOU documented); compound commands (`&&`, `;`, `|`, `$()`, backticks, redirects) never inherit a first-token glob approval; backend URLs are validated loopback-only (schemes, credentials, hosts, redirects refused); `run_command` bounds output as it arrives and kills the whole process group on timeout; backups exclude `backups/` (no recursive growth) and import validates every archive member before extraction
- **Tests** — `npm test` runs skills, plugins (including a real MCP roundtrip), security/provider fixtures, document plugins, provider/MCP release regressions, and native-tar/plugin/restore regressions in disposable data roots. Configure a dedicated temporary directory before execution; tests are not a security certification.

## v4.4 additions

- **Settings modal** — the right-hand Inspector panel is now a **⚙ Settings popup** (header button or **⌘,**) with a section navigator like a proper settings dialog: General (appearance, notifications), Backends, Tasks, Storage, Logs | Project, Git, Usage, Plan. The window is a two-column layout again
- **Project deletion, actually reachable** — the sidebar project ⋯ menu button is always visible (long names ellipsize, not the button) and the menu now pops over content instead of being clipped by the chat-list scroll; **Settings → Project → Danger zone** deletes a project (optionally with its chats) too

## v3 additions

- **Bulk management** — sidebar "Select" mode: multi-select chats, then Delete (N) or Move to project…; per-project ⋯ menu: New chat, Open in Finder, Rename project, Delete project (optionally with all its chats)
- **Resizable layout** — drag the sidebar, inspector, and composer edges; both panels collapse; layout persists in `settings.json` (`layout` key) and restores on launch and in new windows
- **Chat windows** — "⧉ Window" in the chat header or right-click a tab opens the chat in a dedicated window; agent events stream to every window showing that chat; `?chat=<id>` query param boots a window into a chat
- **Project settings + config files** — per-project model/num_ctx/temperature/approvals/maxSteps/instructions overrides (Settings → Project); `AGENTS.md` and `.xtracsys.md` are scaffolded into new projects automatically (toggle in settings.json: `scaffoldOnCreate`), editable in-app (256 KB cap), never overwritten if they exist
- **Git panel** — Settings → Git: branch, dirty files, per-file diff (read-only)
- **Task history** — each task keeps its last 20 runs (expandable in Tasks tab)
- **Usage dashboard** — Settings → Usage: per-project turns/token totals with per-chat bars
- **Transcript & copy** — "Transcript" button reveals the chat's `.md` in Finder; hover any user/assistant message for a copy button
- **Shortcuts** — `?` or ⌘/ opens the cheatsheet (⌘K palette, ⌘T new chat)

## Roadmap (not yet shipped)

Planned work is tracked in [FEATURE_PROPOSALS.md](FEATURE_PROPOSALS.md). Roadmap items are proposals, not delivery commitments.

The macOS build is ad-hoc signed and not notarized. Gatekeeper may flag downloaded builds. See [MAC_RELEASE.md](MAC_RELEASE.md) for verification and signing limitations.

## Air-gapped / offline machines

Built-in model requests use loopback URLs. For an offline Mac:

1. On a connected machine, run `npm run dist` and copy `release/*.dmg` (plus `ollama` and model files if needed).
2. Ollama offline install: copy the Ollama `.app`/installer and your GGUF models. For manual model imports: `ollama create mystream -f Modelfile` pointing at the copied GGUF, or copy an existing `~/.ollama/models` tree.
3. For llama.cpp: copy the `llama-server` binary + GGUF model, run it on `127.0.0.1:8080`, then select the llama.cpp provider in **Settings → Backends**.
4. Chats, transcripts, and logs stay in the local data root. Shell commands and MCP/plugin processes are not sandboxed; restrict them under your network policy if the machine must remain air-gapped.

## Data & storage layout

App-managed state lives in one user-visible folder (default `~/XtracsysCode`). Project folders and imported plugins' original source folders remain at their selected paths:

```
~/XtracsysCode/
  settings.json     # provider URLs, model, caps, prompt extras
  projects.json     # projects (name + folder path)
  tasks.json        # saved automation tasks
  chats/<id>.json   # full chat: messages, timeline, stats
  chats/<id>.md     # human-readable transcript (inspectable/portable)
  logs/xtrac.log    # rotated at 5 MB (configurable)
  tmp/              # agent scratch; wiped on launch + 24h / size cap
```

Caps (all configurable in `settings.json`): **200 MB** total chats (oldest pruned first), **90 days** retention, **5 MB** log rotation, **100 MB** scratch. Deleting a chat removes both JSON and Markdown transcript.

## Security posture

- Renderer uses Electron sandboxing, `contextIsolation: true`, `nodeIntegration: false`, and a CSP that blocks direct renderer network requests; main-process IPC also checks the trusted frame and URL.
- Built-in model requests are restricted to configured loopback URLs; the app does not include cloud inference, telemetry, or an updater. This check cannot verify which interfaces the backend server listens on.
- File tools resolve paths inside the selected project folder. Shell commands and MCP/plugin processes run as the user, are not sandboxed, and may access other permitted paths or use the network; approvals are not an OS-level confinement boundary.
- Plugin consent binds launch details and a bounded original source tree (including hidden files and local dependencies): 2,048 entries, depth 24, 8 MiB/file, 32 MiB total; links/special files fail closed. Changes require fresh review. External interpreters/environment/dependencies and final-check-to-spawn races remain outside that guarantee; running processes are not revoked by later file edits.
- Compatible-provider decoded response limits: model discovery 1 MiB, error bodies 16 KiB, SSE lines 256 KiB, events 1 MiB/256 lines, stream total 16 MiB, tool fragments 1 MiB/128 calls. Oversized responses fail with an error rather than growing without bound.
- MCP shutdown waits for bounded termination attempts and surfaces diagnostics. POSIX descendants that escape the owned process group and Windows tree-termination failures remain residual risks; native Windows lifecycle behavior has not been verified here.

See [MAC_RELEASE.md](./MAC_RELEASE.md) for installer verification/signing limits, [SECURITY.md](./SECURITY.md) for vulnerability-reporting guidance, [CONTRIBUTING.md](./CONTRIBUTING.md) for development checks, and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for upstream terms.

## Project layout

```
electron/            # main process: agent host, storage, IPC
  agent/             #   loop, tools, prompt, providers (ollama, llamacpp), smoke test
shared/timelineModel # timeline model shared by main (persistence) + renderer (live view)
web/                 # React UI (Vite)
scripts/icon.js      # generates build/icon.png (no image deps)
```

## Verify the agent core without the UI

```bash
npm run build:main && npm run smoke
# → runs a real turn against the local backend: find a planted secret, write a file, report
```

## License

Copyright © 2026 Xtracsys LLC.

This project is licensed under the Apache License, Version 2.0. See [LICENSE](./LICENSE). The license permits use, modification, and redistribution without an ongoing software-license fee, subject to its terms. Third-party components remain under their own licenses; review their notices before redistribution.

The Xtracsys name and logo identify the upstream project. Apache-2.0 does not grant trademark rights. Forks may remove or replace Xtracsys branding, but should not imply that modified versions are official or endorsed by Xtracsys.
