"""Wiki content — Electron host: main, preload, runner, storage, store."""

ARTICLES = [
    dict(slug="host-main", title="electron/main.ts", category="host",
         path="electron/main.ts", lines=1672, lang="TypeScript", status="CORE",
         pkg="main", phase="v1–v4", related=["runner", "store", "storage", "preload"],
         lead=[
             "The Electron main process: owns the window registry, central IPC sender/frame validation, navigation restrictions, the slash-command interpreter, scheduler, backups, and headless E2E harness. Renderer calls pass through one wrapper that checks the main frame and exact trusted renderer URL; new windows are denied and untrusted navigations are blocked.",
         ],
         sections=[
             ("Windows and routing (v3)", [
                 "createWindow({chatId}) builds the primary or a chat window; the chatWindows map binds webContents.id → chatId. It denies popups, blocks untrusted navigation/redirects, and opens only HTTP(S) external links through the system browser. Secondary windows use a validated ?chat=<id> query param; closed handlers avoid destroyed webContents.",
                 "The ipcMain.handle surface covers state:get, settings:set (with the -1 temperature sentinel that survives IPC), backends:models, project create/rename/delete (optionally with chats), chats:delete (bulk, aborting turns first), chat move/archive/rename/approval/model/send/cancel/retry/approve, rules and MCP config, config file read/write/scaffold, git status/diff/run, storage usage/cleanup, archive list/restore/delete, search:chats, usage:project, data export/import, logs read/export, and windows:new-chat. The 2026-10 hardening passes tightened the boundary: skill ids pass a requireSkillId regex (SkillStore additionally requires a registered id), settings:set validates the merged document against the backup-import schema and bounds caps/session, mcp:set requires a main-process consent dialog for every new or changed server command (fingerprints on the sanitized name form, consent dialog resolves the SENDER window so it works with only chat windows open), rules:set and rules:allow-always share one sanitizer so blanket patterns like '* *' and over-long lists are rejected on both paths, git:run allowlists its flags and scopes the traversal check to pathspecs, open:finder/open:terminal accept project folders or data-root paths in either lexical or realpath spelling, data:import re-hashes the archive between listing and extraction, Chromium permissions are allowlist-deny-all except sanitized clipboard writes, DevTools are removed from the packaged menu, and the restored-chat-record schema + per-project settings schema are validated on import (with chat workspaces re-pinned to their project's cwd).",
             ]),
             ("Slash commands (v2)", [
                 "handleSlashCommand intercepts leading '/' in chat:send: /compact (await the runner's summarization), /clear (wipe agent memory, keep transcript, reset the pressure flag), /model <name|auto>, /help, and unknown-command notices — none ever reach the model. pushNotice writes a system timeline item, broadcasts, and persists.",
             ]),
             ("Scheduler and E2E", [
                 "startScheduler ticks every 60 s for due interval tasks; a parallel 10-min loop runs storage.cleanup() and scheduledBackup() (P6 daily tar.gz with retention pruning). runE2E() is the mission-grade self-test: it drives a real project through secret-hunt, allowlisted command, edit_file, plan, queue, slash, images, MCP echo, git write ops, archive roundtrip, accent persistence, pressure notice, and session restore — printing one [e2e] PASS/FAIL line with per-check detail.",
             ]),
         ],
         key_items=[
             ("registerIpc()", "Every renderer-callable channel; the allow-list in preload must mirror it."),
             ("handleSlashCommand(rec, raw)", "Local command interpreter; /compact awaits runner.compactChat."),
             ("runE2E()", "Headless self-test behind XTRAC_E2E=1 — must print [e2e] PASS for a release to ship."),
             ("approvalUi / pendingApprovals", "Per-request approval promises with a 180 s timeout and per-chat attempt counters for the E2E."),
         ]),

    dict(slug="host-preload", title="electron/preload.ts", category="host",
         path="electron/preload.ts", lines=96, lang="TypeScript", status="CORE",
         pkg="main", phase="v1–v4", related=["host-main"],
         lead=[
             "The context-isolated bridge exposes window.xtrac with invoke(channel, payload) and onEvent(cb), rejects channels outside a hardcoded allow-list, and provides no renderer Node access. The main process separately validates the sending frame and renderer URL before any privileged handler runs.",
         ],
         key_items=[
             ("allowed channel set", "The definitive list of renderer capabilities — reviewed each release to keep the no-call-home posture demonstrable."),
             ("onEvent(cb)", "Subscribes to the single xtrac:event broadcast channel and returns an unsubscribe function."),
         ]),

    dict(slug="host-runner", title="electron/runner.ts", category="host",
         path="electron/runner.ts", lines=410, lang="TypeScript", status="CORE",
         pkg="main", phase="v1–v4", related=["agent-loop", "store", "storage", "host-main"],
         lead=[
             "The orchestration layer between UI requests and the agent core. AgentRunner turns a chat record into a live turn: it resolves per-project settings overrides (chat → project → global), starts the project's MCP servers, builds the system prompt, wraps the approval callback with the allowlist gate, streams events to all windows, and persists the chat + transcript when the turn settles.",
         ],
         sections=[
             ("Approvals and allowlists (v2)", [
                 "approvalGate(chat) consults project.rules before asking the user: command globs match via commandMatchesPattern, write paths via pathInWriteScopes. 'Always allow' in the UI derives patterns from the invocation (first 1–2 tokens for commands, directory prefix for writes) and saves them into projects.json. commandHasShellControl treats ANY '>' (unspaced, appended, or fd-prefixed like 2>), bare $VAR interpolation, and approved-tool shell escapes (find -exec, xargs, awk system(), git -c alias) as control syntax, so a glob like 'echo *' can never silently auto-run 'echo x>$HOME/.zshenv' or 'find . -exec … +' (2026-10). rules:set and rules:allow-always share sanitizeRulesPatterns — 100 entries × 500 chars, and allow-everything patterns like '* *' are rejected on both paths.",
             ]),
             ("Queue, retry, compact (v2)", [
                 "sendOrQueue starts a turn or parks the prompt (max 5) with a notice; the runTurn finally block dequeues automatically. retryLast rolls the message list AND timeline back to just before the last user message — no duplicate appears — then re-runs. compactChat summarizes the conversation with the current model and replaces LLM-visible history with a single summary message, resetting the pressure flag.",
             ]),
             ("MCP and pressure notices", [
                 "Per-turn MCP lifecycle: McpManager.start for configured servers, discovered tools merged into the tool list, stopAll in finally. maybePressureNotice (public, P5) fires the 90% context warning once per chat; /compact and /clear reset chat.pressureNoticed. Task summaries land as system notices after scheduled and manual task runs.",
             ]),
         ],
         key_items=[
             ("AgentRunner.runTurn(chat, text, images?)", "done|busy|error — the single entry point every send path funnels into."),
             ("sendOrQueue / retryLast / compactChat", "The three user-facing turn operations beyond plain sending."),
             ("approvalGate(chat)", "Rules-first approval resolution feeding the agent loop."),
         ]),

    dict(slug="host-storage", title="electron/storage.ts", category="host",
         path="electron/storage.ts", lines=867, lang="TypeScript", status="CORE",
         pkg="main", phase="v1–v4", spec_refs=["§4.5 Storage", "§4.6 Data model"], related=["store", "host-main"],
         lead=[
             "The hard-constraint module. Everything user-visible lives in one root — default ~/XtracsysCode — with chats/, archive/, logs/, tmp/, and JSON docs at the top. cleanup() enforces the three bounds (chat total cap with oldest-first pruning, age retention, log rotation); it runs at launch and every 10 minutes, and never touches archive/.",
         ],
         sections=[
             ("Settings surface (v1–v4 growth)", [
                 "Settings carries Ollama, llama.cpp, and OpenAI-compatible local-server URLs plus provider/model, approval defaults, maxSteps, historyCharBudget, systemPromptExtra, numCtx/temperature, notifications, backups, session, layout, and storage caps. New backends are migrated from defaults; settings:set rejects non-loopback URLs and unknown provider IDs, and (2026-10) validates the merged document against the same strict schema used for backup imports, bounding storage caps (1 KiB–1 TB, keepChatDays ≥ 1) and session.openChats (≤10 strings) before anything is saved. Per-project settings get the same schema treatment (approval enum, maxSteps 1–200, systemPromptExtra ≤ 8 KB), and backup restore re-validates chat-record shapes (timeline kinds, string fields) and re-pins chat workspaces to their project's cwd.",
             ]),
             ("Durability details", [
                 "writeJsonAtomic writes to a unique temp name (pid + timestamp + random — the v4 fix for a real concurrent-write collision) with mode 0600 and renames; the data root and subdirectories are created 0700 and the root is chmod'ed on launch (2026-10 hardening). Logs rotate at logMaxBytes keeping one .1 file. cleanup() prunes chats by total size (oldest mtime first), deletes past-keepChatDays records, wipes tmp entries older than 24 h or past tmpMaxBytes, and sweeps crash-orphaned .*.tmp files in the root after 24 h. usage() walks the tree for the storage meter.",
             ]),
             ("Backup restore validation", [
                 "parseTarVerboseListing accepts typed BSD/GNU tar output with LF or Windows CRLF line endings. Restore allows only regular files and directories under the expected root, with bounded depth and expanded size; links, duplicate paths, traversal, and unsafe member names fail closed before extraction.",
             ]),
         ],
         key_items=[
             ("cleanup(): CleanupReport", "The enforcement arm — tmp wiped, aged chats deleted, total pruned oldest-first."),
             ("usage(): StorageUsage", "Per-folder breakdown + chat count for the meter and dashboards."),
             ("logFile() / log(line)", "Rotated app log; also receives renderer console errors (did-fail-load included)."),
         ]),

    dict(slug="host-store", title="electron/store.ts", category="host",
         path="electron/store.ts", lines=368, lang="TypeScript", status="CORE",
         pkg="main", phase="v1–v4", related=["host-storage", "host-main", "runner"],
         lead=[
             "The domain store on top of Storage: projects (with approval rules, MCP configs, per-project settings), chats (in-memory cache over chats/<id>.json), and tasks (with run history). All writes go through Storage.writeJsonAtomic; all ids are UUIDs; projects.json/tasks.json are whole-doc rewrites.",
         ],
         sections=[
             ("Project capabilities", [
                 "A Project carries rules (command globs + write scopes), mcps (stdio server configs), and settings (model/numCtx/temperature/approvalMode/maxSteps/systemPromptExtra overrides). setProjectRules, setProjectMcps, and saveProjectSettings sanitize and persist each. scaffoldConfigFiles creates AGENTS.md/.xtracsys.md templates, never overwriting existing files.",
             ]),
             ("Chat capabilities", [
                 "Chats cache in memory and persist via persistChat (messageCount, updatedAt maintained). renameChat, deleteChat (json+md), and writeTranscript (Markdown mirror via the shared model) round it out. commandMatchesPattern and pathInWriteScopes — the pure allowlist matchers shared by runner and E2E — live here too.",
             ]),
         ],
         key_items=[
             ("Store.createChat / getChat / persistChat", "The chat lifecycle; the cache invalidates on delete/archive."),
             ("setProjectRules / setProjectMcps / saveProjectSettings", "Sanitized per-project configuration writers."),
             ("commandMatchesPattern / pathInWriteScopes", "The approval matcher primitives, unit-asserted in the E2E."),
         ]),

    dict(slug="skills", title="electron/skills.ts", category="host",
         path="electron/skills.ts", lines=438, lang="TypeScript", status="CORE",
         pkg="host", phase="v5", spec_refs=["v5 Phase B"], related=["plugins", "runner", "host-storage"],
         lead=[
             "The local skills system (v5 Phase B). A skill is reusable instructions plus inert reference/template files — never executable code, never permissions. App-managed copies live under <root>/skills/<id>/ with a skills.json registry; SKILL.md carries strict simple `key: value` frontmatter (name, description, version, scope) validated with actionable SkillError messages.",
             "Hard bounds are enforced everywhere: 100 skills max, 1 MB per file, 25 MB per import (raised in v5.1 for real-world skills like archify), 8 KB of prompt text per skill, 4 KB catalog block, 3 attached skills per chat. Imports copy the folder (skipping ._/.DS_Store junk), refuse symlinks that escape the source tree, and reject duplicates by id. Removing a skill deletes only the app-managed copy — the imported source folder is never touched. Every skill id entering the file APIs must match the ID_RE slug grammar AND name a registered skill; folder reads/writes lstat their target and refuse symlinks (2026-10 hardening).",
         ],
         sections=[
             ("Trust model", [
                 "Skill content is untrusted, lower-priority instructions: the system prompt frames attached skills as guidance that cannot override system rules or the user. The catalog metadata (id + description) rides in context for enabled available skills; full instructions load only for explicitly attached ones — and only if still enabled and in scope at turn time.",
             ]),
             ("Adoption", [
                 "adoptUnregistered() registers folders that appear under skills/ outside the registry — used by the bundled-skills scaffold on launch (those start enabled) and for user-dropped folders. Folders containing a symlink that escapes the folder are rejected too (2026-10). Invalid folders are reported in the log and left on disk, never auto-deleted.",
             ]),
         ],
         key_items=[
             ("SkillStore.importFrom/create/remove/exportTo", "Copy-in/copy-out lifecycle; removal and export never touch the original source."),
             ("parseFrontmatter / validateSkillMd", "Strict, simple frontmatter with actionable rejections (nested YAML, oversized, missing fields)."),
             ("availableFor(projectId) / catalogBlock / loadInstructions", "The prompt-integration surface used by AgentRunner each turn."),
         ]),

    dict(slug="plugins", title="electron/plugins.ts", category="host",
         path="electron/plugins.ts", lines=214, lang="TypeScript", status="CORE",
         pkg="host", phase="v5", spec_refs=["v5 Phase D"], related=["skills", "runner", "agent-mcp"],
         lead=[
             "Local plugins v1 (v5 Phase D): an app-managed manifest/configuration for a LOCAL stdio tool process, riding the existing MCP transport. A plugin is NOT code injected into Electron: import copies only plugin.json into <root>/plugins/<id>/ and records the original source folder. Test and runtime use that same resolved folder and source-bound consent.",
             "Plugins import DISABLED and unreviewed. Enabling/testing requires native-dialog consent tied to launch details and a bounded source-tree hash; changed source requires review again. Test and runtime use the same resolved source cwd. Review rejects links/special files and caps entries/depth/bytes. External runtimes/environment/dependencies and final-check-to-spawn races remain unpinned. Enabled in-scope configs join project MCP configs; these are ordinary unsandboxed processes and tool approvals do not gate startup side effects.",
         ],
         sections=[
             ("Validation", [
                 "Strict manifest rules: id pattern, name/description required, entry.command must be local (no URLs, no .. climbs), args capped at 32, declared tools/capabilities capped. Import never executes anything; remote-source and malformed manifests are rejected with actionable errors.",
             ]),
         ],
         key_items=[
             ("PluginStore.importFrom / setEnabled(reviewed) / mcpConfigsFor", "The safe lifecycle: import inert → review → enable → scoped contribution."),
             ("cwdFor(rec)", "Test connection uses sourcePath, falling back to data root. Real turns currently discard this directory and use chat.cwd: unresolved publication blocker."),
         ]),

    dict(slug="platform", title="electron/platform.ts", category="host",
         path="electron/platform.ts", lines=98, lang="TypeScript", status="CORE",
         pkg="host", phase="v5.1", spec_refs=["cross-platform prep"], related=["host-storage", "agent-tools", "host-main"],
         lead=[
             "The single OS seam (cross-platform prep): run_command's shell invocation (zsh on macOS, bash on Linux, cmd /d /s /c on Windows), descendant-safe process-tree kills (POSIX process groups vs Windows taskkill /T /F), best-effort terminal opening (Terminal / start cmd / x-terminal-emulator family), git/tar binary lookup (/usr/bin defaults on macOS, PATH elsewhere — Windows 10+ ships bsdtar), the per-platform data-root bootstrap file location, and childEnv() — the minimal allowlist environment (PATH/HOME/SHELL/locale/tmp; no inherited cloud or CI tokens) handed to run_command and MCP/plugin spawns (2026-10 hardening). Everything OS-specific funnels here so platform differences live in exactly one module plus electron-builder.yml.",
         ],
         key_items=[
             ("shellInvocation() / killTree(child)", "The two seams that actually behave differently per OS."),
             ("bootstrapFile(appName)", "AppData Roaming / ~/Library / XDG_CONFIG_HOME conventions."),
         ]),

    dict(slug="doc-kit", title="plugins/doc-*", category="host",
         path="plugins/", lines=1412, lang="JavaScript", status="CORE",
         pkg="host", phase="v5.1", spec_refs=["document creation"], related=["plugins", "agent-tests"],
         lead=[
             "The Document Kit: five self-contained, importable first-party plugins for document creation, each a plugin.json manifest plus a dependency-free stdio MCP server following the example-text-formatter pattern. doc-text (write_markdown/write_text/write_html with a shared Markdown→HTML converter), doc-email (create_email_template with {{variables}} → create_eml rendering multipart plain+HTML), doc-pdf (create_pdf — hand-rolled PDF writer: Letter pages, Helvetica + Helvetica-Bold, approximate-metric word wrap, automatic pagination, Latin-1 sanitization), doc-spreadsheets (create_xlsx — hand-rolled ZIP writer with CRC-32 + minimal Office Open XML parts, inline strings and numbers, multiple named sheets — plus RFC-4180 create_csv), doc-presentations (create_pptx — minimal OOXML part set: presentation + master + layout + theme + slides).",
             "The tools reject lexical traversal and detected symlink escapes for output paths (and email template reads); Markdown-to-HTML links reject unsafe schemes; email variable CR/LF is stripped; CSV formula-leading values are escaped. This is defense-in-depth, not a sandbox: plugins are ordinary local processes and path checks retain a TOCTOU race. Nothing is sent anywhere (the .eml files are opened by the user's own mail client). Independent current test run: 57 document-plugin assertions pass; QuickLook previously rendered sample PDF/XLSX/PPTX, but cross-platform application compatibility is unverified. Samples: node tests/generate-doc-samples.mjs.",
         ],
         key_items=[
             ("create_pdf blocks model", "h1/h2/p/bullet blocks → paginated Letter PDF."),
             ("create_xlsx sheets model", "Named sheets of string/number rows → real .xlsx."),
             ("doc-email flow", "Template .md with metadata header + {{vars}} → rendered .eml (never sent)."),
         ]),
]
