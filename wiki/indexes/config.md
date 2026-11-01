# Config & Meta
*repo plumbing*

- **[package.json + electron-builder.yml](../docs/cfg-package.html)** — `package.json` (47 lines): Build and dependency plumbing. Runtime dependency is marked only (for transcript rendering) — everything else is dev tooling. Scripts: dev (vite + electron concurrently), build:mai
- **[tsconfig*.json + vite.config.ts](../docs/cfg-tsconfig-vite.html)** — `vite.config.ts` (18 lines): Two TypeScript programs: tsconfig.json compiles electron/ + shared/ to CommonJS in dist-electron (Node types, no Electron at type level in shared/); tsconfig.web.json typechecks we
- **[scripts/icon.js + build/icon.icns](../docs/cfg-icon.html)** — `scripts/icon.js` (187 lines): A dependency-free app icon generator: draws a 1024px RGBA buffer in pure Node (dark rounded square, ember X strokes, terminal-cursor block), hand-writes the PNG chunks with a CRC32
- **[web/index.html + .gitignore](../docs/cfg-web-shell.html)** — `web/index.html` (16 lines): The HTML shell applies restrictive CSP including connect-src 'none', form-action 'none', and base-uri 'none' (the last two added 2026-10 — neither falls back to default-src, and bo
- **[bundled-skills/ + plugins/example-text-formatter](../docs/bundled-skills.html)** — `bundled-skills/` (338 lines): bundled-skills/ ships via electron-builder extraResources and contains six starter skills scaffolded without overwriting user copies: skill-builder, project-orientation, systematic
