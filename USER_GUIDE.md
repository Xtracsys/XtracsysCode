# XtracsysCode — User Guide

Everything you need to use XtracsysCode day to day. Version 0.5.0.

XtracsysCode is a local-model coding agent in a desktop app. Give it a task in plain language; it reads your project, edits files, runs commands, and reports back — using a model server on your machine. Built-in model requests are restricted to loopback URLs; there is no bundled cloud inference, telemetry, or updater. Approved shell commands and MCP/plugin processes are not sandboxed and may use the network.

---

## 1. Install & first launch

1. Mount the macOS DMG for your release and drag **XtracsysCode.app** to Applications.
2. The app is unsigned and not notarized, so Gatekeeper may block it. Proceed only if you have independently verified the artifact and accept the risk under your security policy; do not remove quarantine attributes as a routine workaround.
3. The **welcome wizard** appears on first run: pick your backend, click *Probe models*, choose a default model, then pick a project folder — the app creates the project and your first chat.

Only one instance runs at a time. Launching a second copy focuses the first.

### Setting up a backend

- **Ollama** (simplest): install from ollama.com, then `ollama pull qwen2.5-coder:7b`. The app finds your models automatically.
- **llama.cpp**: run `llama-server -m model.gguf --host 127.0.0.1 --port 8080`, then choose the llama.cpp provider in **Settings → Backends**. Note: context size is controlled by llama-server's `--ctx-size` flag, not the app.
- **GMLX**: run `gmlx serve` (default port 8080), then choose **GMLX** in **Settings → Backends**. See the [GMLX API docs](https://github.com/asher/gmlx/blob/main/docs/api.md).
- **MLX LM server**: run `mlx_lm.server --model <local-model-path-or-repo>` (default port 8080), then choose **MLX LM server** in **Settings → Backends**. A Hugging Face repo ID may download uncached weights; use a local path or pre-cache for offline use. This is the MLX LM HTTP server, not the bare MLX framework; see [upstream docs](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md).

The GMLX/MLX LM adapters use the OpenAI-compatible HTTP protocol and passed local fixtures; live server/model compatibility has not been verified. Tool calls, image input, and usage reports vary by server and model.

The app validates its destination URL but cannot verify the server's listen interface. Keep local backends bound to localhost; do not expose an unauthenticated endpoint. Upstream warns that the MLX LM server is not recommended for production because it implements only basic security checks.

**Model choice matters.** Tool-calling models work best: qwen2.5-coder, qwen3, llama3.1, granite-4 coder. Small models (≤3B) sometimes skip tools or answer from imagination — see Troubleshooting.

### Air-gapped machines

Copy the DMG, backend software, and model files. Built-in model traffic stays on loopback. In an air-gapped deployment, also review any approved shell commands and MCP/plugin processes: they are ordinary local processes and can access the network if one exists.

---

## 2. Core concepts

- **Project** = a folder on disk the agent's file tools are scoped to. Shell commands and plugin processes are not sandboxed and may access other paths permitted by your user account.
- **Chat** = a conversation bound to a project. Run many chats at once; each remembers its own model, transcript, and plan.
- **Approval** = file writes and shell commands ask you first unless something says otherwise (project rules, per-chat auto mode).

## 3. The window at a glance

- **Left sidebar** — projects with their chats, transcript search, project ⋯ menu (new chat, Finder, rename, **delete project**), and a **Select** mode for bulk actions.
- **Center** — tab strip, chat header, the timeline (your messages, agent replies, thinking, tool cards with diffs and live command output), and the composer.
- **Settings** — a popup dialog (⚙ Settings in the header, or **⌘,**) with a section navigator: **General**, **Backends**, **Tasks**, **Storage**, **Logs**, **Project** (settings, config files, rules, MCP, delete project), **Git**, **Usage**, **Plan**.
- **Composer** — type and Enter; **⤢ Focus** expands it full-screen; 🖼 attaches images; paste works too.

**Shortcuts**: ⌘K palette · ⌘T new chat · ⌘, settings · ? (or ⌘/) cheatsheet · Enter send · ⇧Enter newline. Middle-click a tab closes that chat.

## 4. Working with the agent

1. **Pick or create a chat** (sidebar → + chat, or ⌘T).
2. **Describe a task.** Be specific: "add retry logic to download.ts and run the tests".
3. **Approve when asked.** File writes and commands show an approval card: **Deny**, **Allow** (once), or **Always allow** — which saves a rule (e.g. `git *`) to the project so future identical actions skip the prompt.
4. **Watch the timeline.** Tool cards expand: commands stream live output; file edits show before/after diffs; thinking blocks collapse.
5. **Follow up.** Type while it's working — your message **queues** and sends when the turn ends. If a turn fails, **↻ Retry** re-runs it cleanly.

### Slash commands

| Command | Effect |
| --- | --- |
| `/compact` | Summarizes the conversation and shrinks the model's context (use when the meter runs high) |
| `/clear` | Wipes what the model remembers; your transcript stays |
| `/model <name>` | Switch this chat's model |
| `/skill` | List skills available to this chat (Settings → Skills) |
| `/skill <id>` | Attach/detach a skill to this chat — its instructions load with your next message |
| `/help` | List commands |

### Plans

For multi-step tasks the agent maintains a plan (Settings → **Plan**) and checks steps off as it goes. Nudge it: "update the plan" if it forgets.

### Images

Attach with 🖼 or paste. Vision models (e.g. LFM2.5-VL, llava) can describe screenshots — great for "make this UI look like that".

### MCP servers

Settings → **Project** → MCP servers: add a local stdio server (`node /path/server.js`). Its tools appear to the agent as `mcp__name__tool` and follow the same approval rules. Local processes only.

## 5. Projects & config files

- **New project** (sidebar) or **Open folder…**. New projects are scaffolded with `AGENTS.md` and `.xtracsys.md` — instructions files loaded into the agent's system prompt every turn. Edit them in Settings → **Project** → Config files, or in your own editor.
- **Project settings** (same tab) override the global Backends settings for this project: model, num_ctx, temperature, approval mode, max steps, extra instructions. Blank = inherit.
- **Rules**: allowlisted command patterns (`git *`) and writable scopes (`src/**`). "Always allow" on an approval card adds rules automatically; remove them in the Rules editor.
- **MCP servers** are configured per project in the same tab.

## 6. Backends & context

- **Settings → Backends**: provider, URL, model, `num_ctx` (Ollama context window — raise it for long tasks!), temperature, max steps, notifications.
- **Context meter** (chat status strip): how full the model's window is. Amber ≥70%, red ≥90% → run `/compact` or start a fresh chat. Long sessions on a small `num_ctx` silently degrade — watch the meter.
- **Test connection** shows round-trip time and model count.

## 7. Chats: archive, delete, bulk actions

- **Archive** (🗄 on a chat row, or select several → Archive) hides a chat but keeps its files in `~/XtracsysCode/archive/`. Restore from Settings → **Storage** → Archived chats.
- **Delete** removes the transcript from disk (confirm first). Bulk-select deletes/archives/moves many at once.
- The project ⋯ menu renames projects and deletes them (optionally with all chats).

## 8. Automations (Tasks)

Settings → **Tasks**: save a prompt bound to a project, run it on demand, or set "every N minutes" to repeat while the app is open. Each run is recorded in the task's history, a summary line lands in the chat, and you get a notification when it finishes.

## 9. Storage, backups, safety

- App-managed state lives in `~/XtracsysCode/`: `chats/` (JSON + readable `.md` transcripts), `archive/`, `backups/`, `logs/`, `tmp/`, plus `settings.json` / `projects.json` / `tasks.json`. Project directories and imported plugins' original source folders remain at their selected paths.
- **Caps are enforced**: oldest chats are pruned past 200 MB total and 90 days of age; logs rotate at 5 MB; `tmp/` wipes itself. Storage tab shows the meter and a manual **Run cleanup now**.
- **Backups**: Export/Import a full `.tar.gz` of the app data root, or enable **daily backups** (keep 7 by default). Project directories and original plugin source folders are not included. Restore validates the archive in staging, pauses scheduled tasks, removes project MCP command configurations and allow-always rules, resets global/project/chat/archive approval modes to Ask, and disables/unreviews plugins. Inspect retained task prompts before re-enabling automation.
- **Log viewer**: filter by level/text, export the raw log (Settings → Logs). Renderer errors appear here too — check it first when something looks wrong.

## 10. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Model ignores tools / answers from imagination | Use a tool-calling model (qwen2.5-coder 7B+); smaller models are unreliable |
| Answers get worse mid-task | Context full — run `/compact` or start a new chat; raise `num_ctx` in Backends |
| Blank window | Old build — reinstall the current DMG (asset paths were fixed in 0.2.0) |
| "No local backend reachable" | Start the selected server (Ollama, llama-server, GMLX, or MLX LM); check the loopback URL in Backends |
| Something odd | Settings → **Logs** — renderer errors are recorded there |
| App won't launch twice | One instance at a time by design |

## 11. Power-user extras

- **⌘K** command palette — switch chats, open dialogs, run actions.
- **Open in new window** — chat header ⧉ Window, or right-click a tab. Both windows update live.
- **Reveal transcript** — the chat header's Transcript button opens the `.md` file in Finder.
- **Everything is files** — copying `~/XtracsysCode` carries app-managed history/settings/backups; project folders and original plugin source folders must be migrated separately.
- **Regenerate the wiki** — `python3 wiki/generate_wiki.py --source . --out wiki wiki/content`.

### Skills (v5)

Skills are reusable instruction sets the agent follows — not code, and they grant no permissions.

- **Manage**: Settings → **Skills**. Import a folder (it needs a `SKILL.md` with `name:`/`description:` frontmatter), create a draft, enable/disable, scope globally or to one project, edit/export/remove. Removing an imported skill deletes only the app's copy — your original folder is untouched.
- **Use**: in a chat, type `/skill` to list what's available, `/skill <id>` to attach or detach. Attached skills show a 📚 pill above the composer; their full instructions load with your next message (up to 3 attached).
- **Create**: click **✨ Create with Skill Builder** to open a chat where the bundled Skill Builder walks the agent through drafting, validating, and saving a new skill through normal write approval. Generated skills start disabled — review, then enable.

### Plugins (v5, local only)

A plugin is a manifest for a local tool process (stdio MCP) — e.g. the bundled `plugins/example-text-formatter` in the app repository.

1. Settings → **Plugins** → **Import plugin folder…** (the folder needs a `plugin.json`). Nothing executes at import; the plugin is disabled.
2. Read the review info (command, source folder, declared tools), inspect the source, then **Test connection** to start it once and list its real tools. Consent binds the source tree as well as launch details; changed files require review again. Use a small dedicated folder: links are rejected and review is capped at 2,048 entries, depth 24, 8 MiB/file and 32 MiB total. External runtimes/libraries and changes racing the final check are not pinned.
3. Enable it. Its tools appear to the agent as `mcp__<plugin>__<tool>` and are approval-gated like any other tool.

Honest trust boundary: a plugin is an ordinary local process — **not sandboxed**. It can do what your user account can do. Declared tools are metadata for review, not enforcement.

### Document Kit plugins (v5.1)

Five importable plugins for document creation live in the app repo under `plugins/`: **doc-text** (Markdown/text/HTML), **doc-pdf** (real PDFs), **doc-spreadsheets** (real `.xlsx` workbooks + CSV), **doc-presentations** (`.pptx` decks), and **doc-email** (reusable `{{variable}}` templates rendered to `.eml` files — nothing is ever sent). Import them via Settings → Plugins (see the local-plugins section above); all tools write only inside the project folder and are approval-gated. Sample output for a quick format check: `node tests/generate-doc-samples.mjs`.
