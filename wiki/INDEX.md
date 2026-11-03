# Code Wiki — Master Index

> Generated 2026-11-03 20:13 UTC · 42 articles


## Documents
*requirements and goals*

| # | article | file | path | lines | status |
|---|---------|------|------|-------|--------|
| 01 | [BUILD_REQUIREMENTS.md](docs/doc-requirements.html) | [json](data/doc-requirements.json) | `BUILD_REQUIREMENTS.md` | 219 | SPEC |
| 02 | [GOAL_PROMPT_V2/V3/V4.md](docs/doc-goals.html) | [json](data/doc-goals.json) | `GOAL_PROMPT_V2.md (+V3, V4)` | 377 | SPEC |
| 03 | [README.md](docs/doc-readme.html) | [json](data/doc-readme.json) | `README.md` | 201 | META |
| 04 | [STATUS.md](docs/doc-status.html) | [json](data/doc-status.json) | `STATUS.md` | 106 | META |
| 05 | [INSTALL_WINDOWS.md](docs/doc-windows-install.html) | [json](data/doc-windows-install.json) | `INSTALL_WINDOWS.md` | 80 | SPEC |
| 06 | [INSTALL_LINUX.md](docs/doc-linux-install.html) | [json](data/doc-linux-install.json) | `INSTALL_LINUX.md` | 95 | SPEC |
| 07 | [Open-source readiness](docs/open-source-readiness.html) | [json](data/open-source-readiness.json) | `OPEN_SOURCE_READINESS.md` | — | REVIEW |
| 08 | [Security audit & remediation](docs/sec-audit-2026-10.html) | [json](data/sec-audit-2026-10.json) | `SECURITY_AUDIT_2026-10-28.md` | 214 | REVIEW |
| 09 | [Feature proposals](docs/feature-proposals.html) | [json](data/feature-proposals.json) | `FEATURE_PROPOSALS.md` | 53 | META |
| 10 | [Release readiness 2026-10-31](docs/release-readiness.html) | [json](data/release-readiness.json) | `RELEASE_READINESS_2026-10-31.md` | — | REVIEW |

## Agent Core
*the loop and its tools*

| # | article | file | path | lines | status |
|---|---------|------|------|-------|--------|
| 01 | [electron/agent/loop.ts](docs/agent-loop.html) | [json](data/agent-loop.json) | `electron/agent/loop.ts` | 265 | CORE |
| 02 | [electron/agent/tools.ts](docs/agent-tools.html) | [json](data/agent-tools.json) | `electron/agent/tools.ts` | 643 | CORE |
| 03 | [electron/agent/providers/*](docs/agent-providers.html) | [json](data/agent-providers.json) | `electron/agent/providers/` | 375 | CORE |
| 04 | [electron/agent/mcp.ts](docs/agent-mcp.html) | [json](data/agent-mcp.json) | `electron/agent/mcp.ts` | 455 | CORE |
| 05 | [electron/agent/types.ts](docs/agent-types.html) | [json](data/agent-types.json) | `electron/agent/types.ts` | 182 | CORE |
| 06 | [electron/agent/prompt.ts](docs/agent-prompt.html) | [json](data/agent-prompt.json) | `electron/agent/prompt.ts` | 42 | CORE |
| 07 | [electron/agent/smoke.ts](docs/agent-smoke.html) | [json](data/agent-smoke.json) | `electron/agent/smoke.ts` | 118 | TEST |
| 08 | [shared/timelineModel.ts](docs/timeline-model.html) | [json](data/timeline-model.json) | `shared/timelineModel.ts` | 246 | CORE |
| 09 | [electron/agent/providers/localUrl.ts](docs/local-url.html) | [json](data/local-url.json) | `electron/agent/providers/localUrl.ts` | 47 | CORE |
| 10 | [tests/*](docs/agent-tests.html) | [json](data/agent-tests.json) | `tests/` | 2636 | TEST |

## Electron Host
*main process*

| # | article | file | path | lines | status |
|---|---------|------|------|-------|--------|
| 01 | [electron/main.ts](docs/host-main.html) | [json](data/host-main.json) | `electron/main.ts` | 2073 | CORE |
| 02 | [electron/preload.ts](docs/host-preload.html) | [json](data/host-preload.json) | `electron/preload.ts` | 96 | CORE |
| 03 | [electron/runner.ts](docs/host-runner.html) | [json](data/host-runner.json) | `electron/runner.ts` | 450 | CORE |
| 04 | [electron/storage.ts](docs/host-storage.html) | [json](data/host-storage.json) | `electron/storage.ts` | 867 | CORE |
| 05 | [electron/store.ts](docs/host-store.html) | [json](data/host-store.json) | `electron/store.ts` | 415 | CORE |
| 06 | [electron/skills.ts](docs/skills.html) | [json](data/skills.json) | `electron/skills.ts` | 506 | CORE |
| 07 | [electron/plugins.ts](docs/plugins.html) | [json](data/plugins.json) | `electron/plugins.ts` | 325 | CORE |
| 08 | [electron/platform.ts](docs/platform.html) | [json](data/platform.json) | `electron/platform.ts` | 127 | CORE |
| 09 | [plugins/doc-*](docs/doc-kit.html) | [json](data/doc-kit.json) | `plugins/` | 1412 | CORE |

## Renderer
*React UI*

| # | article | file | path | lines | status |
|---|---------|------|------|-------|--------|
| 01 | [web/src/App.tsx](docs/web-app.html) | [json](data/web-app.json) | `web/src/App.tsx` | 529 | CORE |
| 02 | [web/src/hooks/useXtrac.ts](docs/use-xtrac.html) | [json](data/use-xtrac.json) | `web/src/hooks/useXtrac.ts` | 352 | CORE |
| 03 | [web/src/components/Sidebar.tsx](docs/web-sidebar.html) | [json](data/web-sidebar.json) | `web/src/components/Sidebar.tsx` | 503 | CORE |
| 04 | [web/src/components/Chat.tsx](docs/web-chat.html) | [json](data/web-chat.json) | `web/src/components/Chat.tsx` | 404 | CORE |
| 05 | [web/src/components/Settings.tsx](docs/web-settings.html) | [json](data/web-settings.json) | `web/src/components/Settings.tsx` | 1879 | CORE |
| 06 | [web/src/components/Modals.tsx + WelcomeWizard.tsx](docs/web-modals-wizard.html) | [json](data/web-modals-wizard.json) | `web/src/components/` | 365 | CLIENT |
| 07 | [web/src/components/timeline/*](docs/web-timeline.html) | [json](data/web-timeline.json) | `web/src/components/timeline/` | 210 | CLIENT |
| 08 | [web/src/{api.ts, hooks, lib, types, main.tsx}](docs/web-support.html) | [json](data/web-support.json) | `web/src/` | 416 | CLIENT |

## Config & Meta
*repo plumbing*

| # | article | file | path | lines | status |
|---|---------|------|------|-------|--------|
| 01 | [package.json + electron-builder.yml](docs/cfg-package.html) | [json](data/cfg-package.json) | `package.json` | 47 | META |
| 02 | [tsconfig*.json + vite.config.ts](docs/cfg-tsconfig-vite.html) | [json](data/cfg-tsconfig-vite.json) | `vite.config.ts` | 18 | META |
| 03 | [scripts/icon.js + build/icon.icns](docs/cfg-icon.html) | [json](data/cfg-icon.json) | `scripts/icon.js` | 187 | META |
| 04 | [web/index.html + .gitignore](docs/cfg-web-shell.html) | [json](data/cfg-web-shell.json) | `web/index.html` | 16 | META |
| 05 | [bundled-skills/ + plugins/example-text-formatter](docs/bundled-skills.html) | [json](data/bundled-skills.json) | `bundled-skills/` | 338 | SPEC |

## File coverage map

Article paths below are the declared coverage map; folder/group articles cover multiple files. Direct-file line counts are measured at generation; grouped metrics are historical, not a source inventory guarantee.

- `electron/agent/loop.ts` → [ agent-loop ](docs/agent-loop.html)
- `electron/agent/tools.ts` → [ agent-tools ](docs/agent-tools.html)
- `electron/agent/providers/` → [ agent-providers ](docs/agent-providers.html)
- `electron/agent/mcp.ts` → [ agent-mcp ](docs/agent-mcp.html)
- `electron/agent/types.ts` → [ agent-types ](docs/agent-types.html)
- `electron/agent/prompt.ts` → [ agent-prompt ](docs/agent-prompt.html)
- `electron/agent/smoke.ts` → [ agent-smoke ](docs/agent-smoke.html)
- `shared/timelineModel.ts` → [ timeline-model ](docs/timeline-model.html)
- `electron/agent/providers/localUrl.ts` → [ local-url ](docs/local-url.html)
- `tests/` → [ agent-tests ](docs/agent-tests.html)
- `BUILD_REQUIREMENTS.md` → [ doc-requirements ](docs/doc-requirements.html)
- `GOAL_PROMPT_V2.md (+V3, V4)` → [ doc-goals ](docs/doc-goals.html)
- `README.md` → [ doc-readme ](docs/doc-readme.html)
- `STATUS.md` → [ doc-status ](docs/doc-status.html)
- `package.json` → [ cfg-package ](docs/cfg-package.html)
- `vite.config.ts` → [ cfg-tsconfig-vite ](docs/cfg-tsconfig-vite.html)
- `scripts/icon.js` → [ cfg-icon ](docs/cfg-icon.html)
- `web/index.html` → [ cfg-web-shell ](docs/cfg-web-shell.html)
- `bundled-skills/` → [ bundled-skills ](docs/bundled-skills.html)
- `INSTALL_WINDOWS.md` → [ doc-windows-install ](docs/doc-windows-install.html)
- `INSTALL_LINUX.md` → [ doc-linux-install ](docs/doc-linux-install.html)
- `electron/main.ts` → [ host-main ](docs/host-main.html)
- `electron/preload.ts` → [ host-preload ](docs/host-preload.html)
- `electron/runner.ts` → [ host-runner ](docs/host-runner.html)
- `electron/storage.ts` → [ host-storage ](docs/host-storage.html)
- `electron/store.ts` → [ host-store ](docs/host-store.html)
- `electron/skills.ts` → [ skills ](docs/skills.html)
- `electron/plugins.ts` → [ plugins ](docs/plugins.html)
- `electron/platform.ts` → [ platform ](docs/platform.html)
- `plugins/` → [ doc-kit ](docs/doc-kit.html)
- `OPEN_SOURCE_READINESS.md` → [ open-source-readiness ](docs/open-source-readiness.html)
- `SECURITY_AUDIT_2026-10-28.md` → [ sec-audit-2026-10 ](docs/sec-audit-2026-10.html)
- `FEATURE_PROPOSALS.md` → [ feature-proposals ](docs/feature-proposals.html)
- `RELEASE_READINESS_2026-10-31.md` → [ release-readiness ](docs/release-readiness.html)
- `web/src/App.tsx` → [ web-app ](docs/web-app.html)
- `web/src/hooks/useXtrac.ts` → [ use-xtrac ](docs/use-xtrac.html)
- `web/src/components/Sidebar.tsx` → [ web-sidebar ](docs/web-sidebar.html)
- `web/src/components/Chat.tsx` → [ web-chat ](docs/web-chat.html)
- `web/src/components/Settings.tsx` → [ web-settings ](docs/web-settings.html)
- `web/src/components/` → [ web-modals-wizard ](docs/web-modals-wizard.html)
- `web/src/components/timeline/` → [ web-timeline ](docs/web-timeline.html)
- `web/src/` → [ web-support ](docs/web-support.html)
