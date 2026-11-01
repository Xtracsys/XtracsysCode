"""Wiki content — React renderer."""

ARTICLES = [
    dict(slug="web-app", title="web/src/App.tsx", category="renderer",
         path="web/src/App.tsx", lines=514, lang="TypeScript", status="CORE",
         pkg="renderer", phase="v1–v4", related=["use-xtrac", "web-sidebar", "web-chat", "web-settings"],
         lead=[
             "The layout root and top-level state composition. Since v4.4 the window is a two-column grid — sidebar | main (header, tab strip, permission card, chat) — with the former right-hand Inspector panel replaced by the Settings modal (⚙ Settings header button, ⌘,, or the command palette). Still owns the sidebar/composer drag-resize machinery (M2), the command palette (⌘K), new-chat shortcut (⌘T), the settings shortcut (⌘,), the shortcut cheatsheet (? or ⌘/), the tab-strip context menu (right-click → open in new window). The tab X and middle-click now remove only the tab from the tab strip; chat records remain in the project list and are not archived or deleted.",
         ],
         sections=[
             ("Drag-resize machinery", [
                 "startDrag installs window-level pointermove/pointerup listeners; each handle maps pointer position through clamp() to a Layout patch (sidebar 180–480, composer 80–300). applyLayout debounces settings persistence to one write per 400 ms and applies immediately for zero-lag feedback. The sidebar collapse renders a 44px rail with an expand button; the inspector column, its resize handle, and its collapsed flag are retired from the UI (v4.4) — settings.json layout keys of the old shape are still tolerated on read.",
             ]),
             ("Settings modal wiring", [
                 "settingsOpen state renders <Settings> with the same data props the Inspector received plus onDeleteProject (wired to useXtrac.deleteProject) for the Project → Danger zone. The modal component stays mounted while closed so the last-visited section is remembered.",
             ]),
         ],
         key_items=[
             ("useXtrac()", "Everything below comes from this hook — see its own article."),
             ("startDrag / applyLayout", "The M2 resize system; layout persists in settings.json under `layout`."),
             ("paletteItems", "⌘K entries: new project, open folder, Settings (⌘,), new chat, shortcuts, and chat switching."),
         ]),

    dict(slug="use-xtrac", title="web/src/hooks/useXtrac.ts", category="renderer",
         path="web/src/hooks/useXtrac.ts", lines=352, lang="TypeScript", status="CORE",
         pkg="renderer", phase="v1–v4", related=["web-app", "timeline-model", "web-api"],
         lead=[
             "The renderer's brain. One hook exposes settings, projects, chats, tasks, usage, the active chat and its live timeline, permission requests, models, and every action (send, queue via sendOrQueue, cancel, retry, archive, delete, move, rename, approve). On mount it refreshes state, probes models, opens the ?chat=<id> boot target, and subscribes to the xtrac:event broadcast.",
         ],
         sections=[
             ("Live event handling", [
                 "agent-event payloads are folded by applyEventToTimeline into a per-chat timelines map — background chats keep streaming while another is on screen. plan events update chat.plan; chat-rewound replaces the timeline wholesale (retry rewind); chat-changed upserts the summary list; permission-request shows the approval card; init-chat (P7 session restore) opens the stored chat on boot.",
             ]),
             ("Action wrappers", [
                 "sendPrompt (queue-aware), cancel, retryLast, answerPermission (allow/always → rule save), setChatApproval, setChatModel, archiveChats, deleteChats, moveChat, renameChat, renameProject, deleteProject — each mutates local state optimistically where safe and refreshes from main otherwise.",
             ]),
         ],
         key_items=[
             ("useXtrac(): XtracState", "The single hook every component consumes."),
             ("openChat(id)", "Loads the record, seeds the timeline map, notifies main for session restore."),
             ("answerPermission(allow, always)", "Approve/deny plus optional Always-allow rule capture."),
         ]),

    dict(slug="web-sidebar", title="web/src/components/Sidebar.tsx", category="renderer",
         path="web/src/components/Sidebar.tsx", lines=503, lang="TypeScript", status="CORE",
         pkg="renderer", phase="v1–v4", related=["web-app", "host-main"],
         lead=[
             "Project/chat navigator with three v3+ layers: a global transcript SearchBox (debounced, hits open the chat), per-project ⋯ popover menus (new chat, Finder, rename, delete with chats), and a Select mode for bulk operations with a sticky action bar (Delete N with confirm preview, Archive N, Move to project via the chat:move picker). Chat rows show ask-mode 🔒 badges, busy pulses, and per-row delete/archive.",
         ],
         sections=[
             ("v4.4 project-menu fixes", [
                 "The ⋯ menu button used to live INSIDE the ellipsis-clamped .project-name div, so a long project name hid it and project deletion became unreachable. The name now ellipsizes in a dedicated .project-name-text span while the button keeps a fixed flex slot.",
                 "The menu itself is position:fixed at the button's rect (top clamped to the viewport, left clamped to stay on screen), so the .project-sessions scroll container can no longer clip it. It closes on Esc, outside click, and window resize; the opening click calls stopPropagation so the window-level closer can't consume it, and clicks inside the menu stop propagation the same way.",
             ]),
         ],
         key_items=[
             ("Select mode + bulk-bar", "Checkbox multi-select → Delete/Archive/Move with confirmation showing truncated titles."),
             ("project-menu popover", "Fixed-position menu; two-step delete confirm with 'also delete its N chats' default-checked."),
             ("SearchBox", "api.searchChats with 250 ms debounce; results render with matching snippets."),
         ]),

    dict(slug="web-chat", title="web/src/components/Chat.tsx", category="renderer",
         path="web/src/components/Chat.tsx", lines=404, lang="TypeScript", status="CORE",
         pkg="renderer", phase="v1–v4", related=["web-app", "timeline-model", "use-xtrac"],
         lead=[
             "The conversation surface: scroll-anchored timeline, status strip (approvals toggle, per-chat model picker, plan progress, context meter, turn count), the composer with image attachments and focus mode, and retry/cancel affordances.",
         ],
         sections=[
             ("Status strip", [
                 "Approvals: ask/auto switch; model <select> per chat (disabled while streaming); ☑ plan N/M; the ContextMeter (amber ≥70%, red ≥90% of numCtx or the char-budget estimate); instruction-count pill when project instructions load.",
             ]),
             ("Composer, attachments, focus", [
                 "Textarea plus 🖼 file picker and clipboard paste (≤4 images, ≤5 MB each, previewed as removable chips). Enter sends (or queues while streaming — the button becomes Queue and Cancel sits beside it); ⇧Enter newlines. ⤢ Focus opens the 90% modal with char/image counts. The composer height is drag-resizable and persisted (M2).",
             ]),
             ("Retry", [
                 "When the last timeline item is an error, ↻ Retry appears; it triggers retryLast, which rewinds cleanly and re-runs.",
             ]),
         ],
         key_items=[
             ("ContextMeter", "used/total with numCtx denominator or chars/4 estimate; tone classes ok/warn/crit."),
             ("addImageFiles", "FileList/paste ingestion with type+size validation and base64 conversion."),
             ("submit()", "One path for send and queue — the queue decision happens main-side."),
         ]),

    dict(slug="web-settings", title="web/src/components/Settings.tsx", category="renderer",
         path="web/src/components/Settings.tsx", lines=1866, lang="TypeScript", status="CORE",
         pkg="renderer", phase="v4.4", related=["web-api", "host-main", "web-app"],
         lead=[
             "The Settings modal (v4.4) — the former docked Inspector panel, rebuilt as a centered dialog with a grouped section navigator like a proper settings app. Left rail: Application (General, Backends, Skills, Plugins, Tasks, Storage, Logs) and Project (Project, Git, Usage, Plan); v5 adds the Skills catalog (import/create/enable/scope/edit/export/remove + ✨ Create with Skill Builder) and the Plugins review/test/enable UI with the plain-language trust notice; right pane: a section header plus the same panels the Inspector hosted. Opens from the ⚙ Settings header button, ⌘,, or the command palette; closes on Esc, backdrop click, or ✕. The component stays mounted while closed so the last-visited section is remembered.",
         ],
         sections=[
             ("Section map", [
                 "General (new): accent swatches and reduce-motion (applied immediately via useAppearance) plus the notifications toggle — moved out of Backends, which keeps provider/URL/model, num_ctx/temperature, default approvals, max steps, extra system instructions, Save/Probe/Test-connection. Project is the v3/v4 control center: per-project overrides form, AGENTS.md/.xtracsys.md editor, allowlist rule editors, MCP servers — and since v4.4 a Danger zone. Storage owns the meter, caps, cleanup, backup schedule, and archive browser; Tasks the saved-prompt automations; Logs the filtered viewer; Git the branch/staged/unstaged lists with stage/unstage/discard/commit; Usage the per-project token rollup; Plan the active chat's set_plan entries.",
             ]),
             ("Danger zone (project deletion)", [
                 "DeleteProjectPanel lists the projects in a select with an 'also delete this project's chats' checkbox and a confirm-guarded Delete project… button wired to the existing project:delete IPC — the guaranteed-visible deletion path alongside the sidebar's ⋯ menu. The selection self-corrects when the chosen project disappears.",
             ]),
             ("Data flow", [
                 "Models are probed when the Backends or Project section opens (ProjectSettingsPanel's model picker consumes them). Settings edits use the draft pattern in Backends (explicit Save settings) while General applies immediately; storage actions refresh usage through onRefreshUsage, and structural changes call onSettingsChanged (a full useXtrac refresh).",
             ]),
         ],
         key_items=[
             ("NAV_GROUPS / SECTION_META", "The two-group navigator and per-section titles/blurbs rendered in the right-pane header."),
             ("ProjectSettingsPanel / ConfigFilesPanel", "M4's override form and config editor (config:read/write, 256 KB cap)."),
             ("RulesPanel / McpPanel / DeleteProjectPanel", "Allowlist editor, MCP server config, and the v4.4 delete-project danger zone."),
             ("GitPanel / UsagePanel / LogViewer / PlanPanel / TaskEditor", "M6/M8/P9 panels, plan viewer, and saved-prompt tasks with interval + history."),
         ]),

    dict(slug="web-modals-wizard", title="web/src/components/Modals.tsx + WelcomeWizard.tsx", category="renderer",
         path="web/src/components/", lines=365, lang="TypeScript", status="CLIENT",
         pkg="renderer", phase="v2/v4", related=["web-app"],
         lead=[
             "Two modal families. Modals.tsx holds NewProjectModal (folder browse/up/Choose…/new-folder creation, optional project name — M4 scaffolds AGENTS.md/.xtracsys.md into new projects) and PermissionCard (the approval dialog with Deny/Allow/Always allow, where Always allow captures the command pattern or write scope). WelcomeWizard.tsx is the P8 first-run flow: backend probe with model counts, folder pick, and a create-project finish that writes provider/model settings and boots the first chat.",
         ],
         key_items=[
             ("NewProjectModal", "Browse + create folder inline; scaffolds config files on create when scaffoldOnCreate is on."),
             ("PermissionCard", "three-way approval including the Always-allow rule capture (N2)."),
             ("WelcomeWizard", "Skippable 2-step wizard shown only when no projects exist."),
         ]),

    dict(slug="web-timeline", title="web/src/components/timeline/*", category="renderer",
         path="web/src/components/timeline/", lines=210, lang="TypeScript", status="CLIENT",
         pkg="renderer", phase="v1–v4", related=["timeline-model"],
         lead=[
             "The row renderers. TimelineRow dispatches on item kind: user bubbles (with 📎 image counts and hover-copy), assistant bubbles (markdown via renderMarkdown with hover-copy), ThoughtBlock (live-expanding thinking), ToolCard (icon, status tone, args summary, live output tail, unified diff for writes/edits), and system/error notices. TimelineRow is memoized and assistant bodies cap rendering at 50k characters with a truncation notice, so a per-delta streaming update re-parses only the changed row (2026-10 hardening).",
         ],
         key_items=[
             ("ToolCard", "Auto-expands while a run_command streams; diffs render with patch-add/patch-del coloring."),
             ("CopyBtn", "Clipboard write with a ✓ confirmation flicker."),
         ]),

    dict(slug="web-support", title="web/src/{api.ts, hooks, lib, types, main.tsx}", category="renderer",
         path="web/src/", lines=416, lang="TypeScript", status="CLIENT",
         pkg="renderer", phase="v1–v4", related=["use-xtrac", "host-preload"],
         lead=[
             "Support layer (354 TS lines, plus the stylesheets app.css (~2.8k, incl. the v4.4 settings-modal and project-menu rules) and themes.css (~240)). api.ts is the typed facade over window.xtrac (one method per IPC channel, ~40 of them). types.ts mirrors host shapes (Settings, ChatRecord, Project, Task, StorageUsage…) and re-exports the shared timeline model. lib/format.ts has the markdown sanitizer — raw HTML escaped, links restricted to credential-free http(s), and link labels routed through parseInline/escaping so untrusted label text can never inject markup (2026-10 fix) — plus byte/time formatting and basename. main.tsx mounts React inside an app-level ErrorBoundary (a malformed restored chat record degrades to a recoverable message instead of crash-looping the app), and the rules editor surfaces IPC errors instead of failing silently (2026-10). index.html carries the connect-src 'none' CSP, now also pinning form-action 'none' and base-uri 'none' (2026-10).",
         ],
         sections=[
             ("Appearance and theme hooks", [
                 "useTheme persists dark/light in localStorage and sets data-theme; useAppearance (P4) applies the accent preset as a --accent custom property plus data-reduce-motion, persisting both to settings.json.",
             ]),
         ],
         key_items=[
             ("api facade", "Every channel the renderer may call, typed end-to-end."),
             ("renderMarkdown(text)", "Escape-first markdown with sanitizer pass — model output is untrusted."),
         ]),
]
