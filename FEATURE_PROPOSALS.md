# XtracsysCode — Feature Proposals

*Compiled 2026-10-28 from the two security-audit engagements, the codebase deep-dives, and the product's own deferred backlog. Ordered within each category by value-to-effort. Effort: S (<1 day), M (1–3 days), L (3+ days).*

## Security & robustness

1. **Seatbelt sandbox for `run_command` (macOS)** — Effort: L · Value: High.
   The package description honestly states "shell commands are not sandboxed". On macOS, `sandbox-exec` profiles can confine writes to the project directory and deny network for read-only tools, turning the approval gate from a promise into an OS-enforced boundary. Windows/Linux equivalents (AppContainer/bubblewrap) can follow. This is the single biggest trust upgrade available.
2. **Move tool execution off the main process** — Effort: M · Value: Medium.
   The grep regex worker (added 2026-10) is the first step; a general worker for file tools and grep walks bounds any future main-process freeze. The provider bounds already protect the stream side.
3. **Approval-card risk annotations** — Effort: S · Value: Medium.
   The approval dialog shows the command string; statically annotate what it *touches*: "writes outside project", "uses network", "reads env", "spawns a shell" (the R8 detector already classifies most of this — surface it in the card).
4. **Orphaned-backup recovery prompt at startup** — Effort: S · Value: Medium.
   If the process dies mid-`swapDataRoot`, the next launch silently creates an empty data root while the old data sits in `<root>.backup-<uuid>`. Detect orphaned siblings at launch and offer to restore or dismiss.
5. **Per-timeline-row error boundary** — Effort: S · Value: Low.
   An app-level ErrorBoundary now exists; row-level boundaries would keep the rest of the timeline visible when one malformed restored item throws.

## Agent capability

6. **Ollama model manager** — Effort: M · Value: High.
   Pull/delete/list models with download progress via Ollama's `/api/pull` etc., straight from Settings → Backends. Removes the biggest out-of-app step in the local-model workflow.
7. **Snapshot & rollback for agent edits** — Effort: M · Value: High.
   Auto-commit (or stash) the project before each turn; per-turn "undo agent changes" button in the timeline. Complements the existing diffs with a real escape hatch — the most-requested pattern in agent tools.
8. **Per-server MCP environment variables** — Effort: S · Value: Medium.
   `childEnv()` deliberately withholds inherited credentials; some real MCP servers need tokens. Add an optional per-server env map (consent dialog displays it; values stored locally).
9. **Project-defined slash commands** — Effort: S · Value: Medium.
   Let `.xtracsys.md` (or a `commands/` folder) define `/name` → prompt-template shortcuts, validated and bounded like skills.
10. **Turn cost/token dashboards** — Effort: S · Value: Low.
    Usage data (turns, input/output tokens) is already persisted per chat and per project; surface a small per-turn sparkline and a project-level rollup view.

## UX

11. **Drag-and-drop text-file attachments** — Effort: S · Value: Medium.
    Images are supported; allow dropping text files to inline them as read-file context with explicit size caps.
12. **Timeline virtualization** — Effort: M · Value: Medium.
    Long chats re-render a growing list; memoization (2026-10) helps, but windowing (render only visible rows) removes the ceiling entirely.
13. **Chat branching / fork-from-any-message** — Effort: M · Value: Medium.
    Retry already rewinds; expose "fork from here" to keep both branches.
14. **Export chat to PDF via the bundled doc-pdf plugin** — Effort: S · Value: Low.
    Dogfooding: the transcript markdown → doc-pdf → one click. Also proves the plugin pipeline with a first-party consumer.
15. **Menu-bar / global-hotkey quick capture** — Effort: M · Value: Low.
    Send a prompt to the active project's chat without switching windows.

## Platform

16. **R12 completion: native Windows/Linux verification** — Effort: M · Value: High.
    Installers are cross-compiled and structurally tested; on-hardware acceptance (NSIS walkthrough, AppImage on real distros, taskkill/bsdtar paths) is the last open release blocker.
17. **Signed auto-update channel** — Effort: L · Value: Medium (later).
    electron-updater over a static host with signed artifacts; blocked on the signing decision (owner has explicitly deferred code signing).

## Suggested sequencing

Quick wins first (3, 4, 5, 8, 9, 11, 14), then the two high-value tracks (1 sandboxing, 7 snapshots) in parallel with 6 (model manager) and 16 (platform verification).
