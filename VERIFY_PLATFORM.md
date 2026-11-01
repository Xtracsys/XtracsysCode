# Verifying XtracsysCode on Windows & Linux test boxes

The workflow builds and packages artifacts across supported platforms and uploads them
as workflow artifacts. It does not publish GitHub Releases. This guide covers Windows
and Linux: a successful CI build/package is not native acceptance; verify each artifact
on the target OS and hardware using this checklist, then record the result. Estimated
time: ~10 minutes per box.

## Artifacts

| Box | File |
| --- | --- |
| Windows x64 | `XtracsysCode Setup 0.5.0.exe` |
| Linux x64 | `XtracsysCode-0.5.0.AppImage` |

## 1. Deterministic suites (no model needed, ~1 min)

On the box, with Node 20+, copy the repo and run:

```
npm ci
npm test
```

`npm test` runs the skills, plugins, security, and Document Kit plugin suites. Expected:
all suites pass with zero failures. Record the actual output and any platform-specific
skips; do not infer native acceptance from these suites alone.

If copying the repo is inconvenient, the artifact checks below cover the critical
runtime paths; the suites mainly matter when changing code.

## 2. App boot + storage (2 min)

1. Install/launch:
   - Windows: run the Setup exe. It is unsigned and may trigger SmartScreen; do not
     routinely bypass the warning. Proceed only after confirming provenance and
     accepting the risk under local security policy.
   - Linux: `chmod +x XtracsysCode-0.5.0.AppImage && ./XtracsysCode-0.5.0.AppImage`.
     Some minimal distros need FUSE (`libfuse2`) or `--appimage-extract-and-run` — note which.
2. Confirm the data root was created: Windows `%USERPROFILE%\XtracsysCode`, Linux `~/XtracsysCode`
   (or the wizard lets you pick a folder).
3. Settings → Storage shows the meter. Run "Run cleanup now" — no errors.

## 3. Real-model turn (needs Ollama on the box)

1. Install/start Ollama, `ollama pull qwen2.5-coder:7b` (or any tool-calling model).
2. Create a project pointing at any folder, send: "Create hello.txt containing OK, then tell me what you wrote."
3. Expect: approval card appears → Allow → write_file runs → file exists on disk.

## 4. Platform-specific behaviors

- **Command execution**: ask the agent to run `echo hello` (Windows: same via cmd).
  Live output should stream into the tool card, exit code 0.
- **Timeout kill**: run something like `ping -n 30 127.0.0.1` (Windows) /
  `sleep 30` (Linux) — the command should be killed at the timeout and NOT leave the
  process running (`tasklist | findstr ping` / `pgrep sleep` afterwards).
- **Terminal button**: chat header → "Terminal" opens a terminal in the project folder.
- **Git tab**: open a git repo as a project — branch + status render; stage/commit works
  (needs git on PATH).
- **Skills**: Settings → Skills shows the six bundled starters. `/skill` in a chat lists
  them; attach one and confirm the 📚 pill appears.
- **Plugins**: Settings → Plugins → import the `plugins/example-text-formatter` folder
  from the repo → Test connection shows slugify/upper → enable → agent can call the tools.
- **Backups**: Settings → Storage → enable daily backup → "Export backup…" produces a
  tar.gz; re-import it (roundtrip).

## 5. Report

Record per box: OS version, artifact used, each check ✓/✗, and any console/log output
(Settings → Logs → Export log). Anything ✗ goes back into the tracker with the log.
