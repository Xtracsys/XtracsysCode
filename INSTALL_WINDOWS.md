# Installing XtracsysCode on Windows

XtracsysCode has no built-in cloud inference, telemetry, or updater; built-in model
requests use a configured local endpoint. Approved shell commands and MCP/plugin
processes are ordinary local processes, are not sandboxed, and may use the network.
This guide covers the Windows build (x64, NSIS installer).

> **Native acceptance:** a successful cross-build or CI package is not proof that
> the app works on a Windows machine. Run the native checklist in `VERIFY_PLATFORM.md`
> on the target system before treating the build as accepted.

## 1. Install the app

1. Get `XtracsysCode Setup 0.5.0.exe` from a trusted Windows workflow artifact or from a
   local build's `release/` directory. The workflow artifact is not a published release.
2. Run the installer. It is unsigned by design and may trigger SmartScreen. Do not
   routinely bypass the warning; proceed only if you have independently confirmed the
   artifact's provenance and accept the risk under your local security policy.
3. Launch **XtracsysCode** from the Start menu. First run shows the onboarding
   wizard (backend probe → project folder → done; skippable).

Your data lives in a plain, user-visible folder — `%USERPROFILE%\XtracsysCode`
(`settings.json`, `projects.json`, `chats/` as JSON + Markdown transcripts, `logs/`,
`skills/`, `plugins/`). Deleting the app never touches it.

## 2. Install a local model backend

**Ollama (easiest):**

1. Install Ollama for Windows from <https://ollama.com/download> (runs in the system tray).
2. Pull a tool-calling-capable model:
   ```powershell
   ollama pull qwen2.5-coder:7b
   ```
3. In XtracsysCode: **Settings → Backends**, confirm provider *Ollama* at
   `http://127.0.0.1:11434`, press *Probe backends*, pick the model, *Save settings*.

**llama.cpp:** download/build `llama-server.exe`, run
`llama-server -m model.gguf --host 127.0.0.1 --port 8080`, then choose provider
*llama.cpp* in Settings → Backends. Note: context size is controlled by
`--ctx-size`, not the app.

The app refuses any backend URL that is not loopback — cloud endpoints are rejected
by design. With no model configured, the first send auto-picks the first available
local model.

## 3. Recommended extras

- **Git** (`git-scm.com`) — enables the Git panel (branch, diffs, stage/commit) and
  lets the agent use git via approved commands. The app calls `git` from PATH.
- **A terminal** — the chat header's *Terminal* button opens `cmd` in the project
  folder. The agent's `run_command` uses `cmd /d /s /c` on Windows.

## 4. Windows-specific behavior

- The agent's shell is `cmd`. Batch semantics apply (`&&` works, but compound
  commands never inherit "Always allow" approvals — they ask again by design).
- Timeouts kill the whole process tree via `taskkill /T /F`.
- Backups/restore use Windows' built-in `tar.exe` (bsdtar, ships with Windows 10+).
- Skills and plugins work identically to macOS. Plugin entry commands run from the
  selected source folder; inspect its code and required commands/tools before
  consenting. Plugin processes are not sandboxed.

## 5. Install from source (alternative)

```powershell
# Node.js 20+ required
git clone <your-fork-url> XtracsysCode ; cd XtracsysCode
npm install
npm run build
npm start          # dev launcher (loads dist-web)
npm test           # deterministic test suites
npm run dist:win   # build the NSIS installer locally
```

## 6. Verify and report

Follow `VERIFY_PLATFORM.md` in the repo for the per-box checklist (boot, one real
model turn, timeout-kill behavior, skills/plugins roundtrip, backup roundtrip).
Report failures with the exported log (Settings → Logs → Export log…).
