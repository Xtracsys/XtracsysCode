"""Wiki content — documents, configs, and repo meta."""

ARTICLES = [
    dict(slug="doc-requirements", title='Product requirements', category="docs",
         path="BUILD_REQUIREMENTS.md", lines=219, lang="Markdown", status="SPEC",
         pkg="docs", phase="v0", related=["doc-readme", "usage-and-safety"],
         lead=['XtracsysCode is a desktop workspace for local-model conversations and tools. Its requirements cover project organization, loopback model providers, visible permissions, bounded storage, and portable JSON/Markdown data.'],
         key_items=[('Storage', 'Configurable chat, log and temporary-file limits keep local data growth visible and bounded.'), ('Local control', 'Model endpoints use loopback addresses; commands and plugins retain their own OS and network permissions.')]),



    dict(slug="doc-readme", title="README.md", category="docs",
         path="README.md", lines=177, lang="Markdown", status="META",
         pkg="docs", phase="v1–v4", related=["doc-requirements"],
         lead=['The project entry point covers installation, local-model setup, project conversations, skills, plugins, storage, and development. Download published installers from GitHub Releases or build from source.'],
         key_items=[('Setup', 'Select an operating-system guide and configure a local model server.'), ('Security', 'Read SECURITY.md for execution boundaries and private reporting contact.')]),



    dict(slug="cfg-package", title="package.json + electron-builder.yml", category="config",
         path="package.json", lines=104, lang="JSON/YAML", status="META",
         pkg="config", phase="v1–v4", related=["doc-readme"],
         lead=[
             "Build and dependency plumbing. Runtime dependency is marked only (for transcript rendering) — everything else is dev tooling. Scripts: dev (vite + electron concurrently), build:main/build:web, typecheck, start, smoke, and dist / dist:dir / dist:win / dist:linux. electron 45 + electron-builder 26 targets mac dmg+zip (arm64, unsigned), nsis (win.icon = dependency-free build/icon.ico), and AppImage, asar-packed with only dist-electron/dist-web shipped; bundled-skills/ ships inside the app and scaffolds into the data root on launch. Cross-platform CI uses the .github/workflows/build.yml matrix and passes `--publish never`, so CI stores artifacts without attempting a GitHub Release upload. scripts/afterPack.js flips the Electron security fuses on each packaged binary and resolves Linux through electron-builder's `executableName`; macOS bundles are re-sealed ad-hoc after fuses are changed. ASAR integrity computation stays disabled (`disableAsarIntegrity`) until the build is code-signed, because builder 26 hashes every *.asar in Resources including exFAT AppleDouble shadows. CI actions are pinned to full commit SHAs.",
         ],
         key_items=[
             ("main: dist-electron/electron/main.js", "v3 path fix — the compile layout keeps electron/ + shared/ under one rootDir."),
             ("version — 0.5.0", "Bumped at each release's final commit."),
         ]),

    dict(slug="cfg-tsconfig-vite", title="tsconfig*.json + vite.config.ts", category="config",
         path="vite.config.ts", lines=50, lang="TypeScript/JSON", status="META",
         pkg="config", phase="v1", related=["web-support"],
         lead=[
             "Two TypeScript programs: tsconfig.json compiles electron/ + shared/ to CommonJS in dist-electron (Node types, no Electron at type level in shared/); tsconfig.web.json typechecks web/src as a DOM/ESNext program with no emit (vite handles the build). vite.config.ts sets base './' — REQUIRED, absolute asset URLs blank-screen the packaged app — root web/, outDir dist-web, target chrome130, strictPort 5173 for dev.",
         ],
         key_items=[('Relative assets', "The './' Vite base keeps renderer assets resolvable inside packaged apps.")]),

    dict(slug="cfg-icon", title="scripts/icon.js + build/icon.icns", category="config",
         path="scripts/icon.js", lines=145, lang="JavaScript", status="META",
         pkg="config", phase="v1", related=["cfg-package"],
         lead=[
             "A dependency-free app icon generator: draws a 1024px RGBA buffer in pure Node (dark rounded square, ember X strokes, terminal-cursor block), hand-writes the PNG chunks with a CRC32 table, then macOS sips + iconutil convert it into build/icon.icns for electron-builder.",
         ],
         key_items=[
             ("pngFromRgba()", "IHDR/IDAT/IEND assembly with zlib.deflateSync — no image library."),
         ]),

    dict(slug="cfg-web-shell", title="web/index.html + .gitignore", category="config",
         path="web/index.html", lines=24, lang="HTML", status="META",
         pkg="config", phase="v1", related=["web-support"],
         lead=[
             "The HTML shell applies restrictive CSP including connect-src 'none', form-action 'none', and base-uri 'none' (the last two added 2026-10 — neither falls back to default-src, and both close injection paths like submittable phishing forms and <base> hijacks). This blocks page fetch/WebSocket-style connections, not all navigation or privileged IPC/child-process effects. See OSR-01 before treating CSP as complete isolation. .gitignore excludes dependencies, compiled outputs, releases, and OS metadata; exclusions do not establish clean Git history.",
         ],
         key_items=[
             ("connect-src 'none'", "Restricts page connection APIs; does not sandbox the privileged host or its child processes."),
         ]),

    dict(slug="bundled-skills", title="bundled-skills/ + plugins/example-text-formatter", category="config",
         path="bundled-skills/", lines=338, lang="Markdown/JS", status="SPEC",
         pkg="config", phase="v5", spec_refs=["v5 Phase C/D"], related=["skills", "plugins"],
         lead=[
             "bundled-skills/ ships via electron-builder extraResources and contains six starter skills scaffolded without overwriting user copies: skill-builder, project-orientation, systematic-debugging, test-first-development, completion-review, wiki-maintenance. Plugin examples, including example-text-formatter and Document Kit, live in the repository for import and are NOT included by the current extraResources config. The formatter exposes slugify/upper and supplies a real MCP test fixture. Skill Builder's draft workflow needs reconciliation with project confinement: create in the selected project, then use UI import/validation/enable.",
         ],
         key_items=[
             ("skill-builder SKILL.md", "Uses only the app's real tools; cannot self-approve writes or execute anything."),
             ("server.mjs", "~100 lines of pure Node NDJSON JSON-RPC: initialize, tools/list, tools/call. No network, no fs."),
         ]),

    dict(slug="doc-windows-install", title="INSTALL_WINDOWS.md", category="docs",
         path="INSTALL_WINDOWS.md", lines=77, lang="Markdown", status="SPEC",
         pkg="docs", phase="v5.1 (R12)", spec_refs=["cross-platform"], related=["doc-readme", "platform", "doc-linux-install"],
         lead=[
             "Windows install guide (x64 NSIS build): installer walkthrough including the unsigned-build SmartScreen step, the %USERPROFILE%\\XtracsysCode data root, Ollama/llama.cpp backend setup with loopback-only URLs, extras (git on PATH, cmd as the agent shell), Windows-specific behavior (taskkill /T tree kill, built-in bsdtar for backups, compound-command approval policy), build-from-source, and the VERIFY_PLATFORM.md per-box checklist. Carries the honest status note: the Windows build is cross-compiled and structurally tested, with on-hardware verification pending (R12).",
         ],
         key_items=[
             ("SmartScreen", "Builds are unsigned. Current bypass guidance needs artifact-authentication checks and explicit risk framing before public distribution."),
             ("Data root", "%USERPROFILE%\\XtracsysCode — plain files, survives app removal."),
         ]),

    dict(slug="doc-linux-install", title="INSTALL_LINUX.md", category="docs",
         path="INSTALL_LINUX.md", lines=92, lang="Markdown", status="SPEC",
         pkg="docs", phase="v5.1 (R12)", spec_refs=["cross-platform"], related=["doc-readme", "platform", "doc-windows-install"],
         lead=[
             "Linux install guide (x64 AppImage): chmod + run, the libfuse2 / --appimage-extract-and-run fallback, the ~/XtracsysCode data root, Ollama (install script) and llama.cpp backend setup, terminal-emulator fallback order (x-terminal-emulator → gnome-terminal → konsole → xfce4-terminal → alacritty), the Electron chrome-sandbox guidance (prefer the unprivileged_userns_clone sysctl over --no-sandbox), bash shell semantics with compound-command approval policy, build-from-source, and the verification checklist. Same honest status note as Windows: cross-compiled and structurally tested, on-hardware verification pending (R12).",
         ],
         key_items=[
             ("FUSE", "libfuse2, or --appimage-extract-and-run on minimal distros."),
             ("Sandbox", "Do not normalize global sysctl changes or --no-sandbox. Prefer supported sandbox-enabled environments; document any exceptional workaround and its risk."),
         ]),
]
