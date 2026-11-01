# Installing XtracsysCode on Linux

XtracsysCode has no built-in cloud inference, telemetry, or updater; built-in model
requests use a configured local endpoint. Approved shell commands and MCP/plugin
processes are ordinary local processes, are not sandboxed, and may use the network.
This guide covers the Linux build (x64 AppImage).

> **Native acceptance:** a successful cross-build or CI package is not proof that
> the app works on a Linux machine. Run the native checklist in `VERIFY_PLATFORM.md`
> on the target system before treating the build as accepted.

## 1. Install the app

1. Get `XtracsysCode-0.5.0.AppImage` from a trusted Linux workflow artifact or from a
   local build's `release/` directory. The workflow artifact is not a published release.
2. Make it executable and run:
   ```bash
   chmod +x XtracsysCode-0.5.0.AppImage
   ./XtracsysCode-0.5.0.AppImage
   ```
3. First run shows the onboarding wizard (backend probe → project folder → done;
   skippable). You can also open a chat straight from the sidebar.

**FUSE note:** AppImages need FUSE. On minimal distros install `libfuse2`
(`sudo apt install libfuse2` / `dnf install fuse`), or extract-and-run without FUSE:

```bash
./XtracsysCode-0.5.0.AppImage --appimage-extract-and-run
```

Your data lives in a plain, user-visible folder — `~/XtracsysCode` (`settings.json`,
`projects.json`, `chats/` as JSON + Markdown transcripts, `logs/`, `skills/`,
`plugins/`). Deleting the app never touches it.

## 2. Install a local model backend

**Ollama:** install it using the official Linux instructions at <https://ollama.com/download>.
Review installation commands before running them; do not pipe a downloaded script directly to a shell.
Then pull a model:

```bash
ollama pull qwen2.5-coder:7b
```

Then in XtracsysCode: **Settings → Backends**, confirm provider *Ollama* at
`http://127.0.0.1:11434`, press *Probe backends*, pick the model, *Save settings*.

**llama.cpp:** build or download `llama-server`, run
`llama-server -m model.gguf --host 127.0.0.1 --port 8080`, then choose provider
*llama.cpp* in Settings → Backends. Context size is controlled by `--ctx-size`,
not the app.

The app refuses any backend URL that is not loopback — cloud endpoints are rejected
by design. With no model configured, the first send auto-picks the first available
local model.

## 3. Recommended extras

- **Git** — almost certainly already present; the Git panel needs `/usr/bin`-style
  `git` on PATH (the app calls `git`, not an absolute macOS path).
- **A terminal emulator** — the chat header's *Terminal* button tries
  `x-terminal-emulator`, `gnome-terminal`, `konsole`, `xfce4-terminal`, and
  `alacritty` in order.

## 4. Linux-specific behavior

- The agent's shell is `/bin/bash`. Compound commands (`&&`, pipes, substitutions)
  never inherit "Always allow" approvals — they ask again by design.
- Timeouts kill the whole process group (the command runs detached in its own group).
- Backups/restore use the system `tar`.
- **Sandbox note (Electron):** do not launch with `--no-sandbox` or weaken system
  security settings as a routine workaround. If the app fails with a sandbox error,
  consult your distribution's supported Electron/Chromium sandbox guidance. If the
  only available workaround disables a security control, stop and report the issue.
- Skills and plugins work identically to macOS. Plugin entry commands run from the
  selected source folder; inspect its code and required commands/tools before
  consenting. Plugin processes are not sandboxed.

## 5. Install from source (alternative)

```bash
# Node.js 20+ required
git clone <your-fork-url> XtracsysCode && cd XtracsysCode
npm install
npm run build
npm start          # dev launcher (loads dist-web)
npm test           # deterministic test suites
npm run dist:linux # build the AppImage locally
```

## 6. Verify and report

Follow `VERIFY_PLATFORM.md` in the repo for the per-box checklist (boot, one real
model turn, timeout-kill behavior, skills/plugins roundtrip, backup roundtrip).
Report failures with the exported log (Settings → Logs → Export log…).
