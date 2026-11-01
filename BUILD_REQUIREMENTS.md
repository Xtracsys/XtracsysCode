# XtracsysCode — Local LLM App Build Requirements

**Project folder:** `the project checkout`

**Draft date:** 2026-09-11

**Author:** XS03-Tek (admin/operations)

**Status:** requirements draft from stakeholder interview

---

## 1. Goal

Build a **local-only LLM desktop app** that:

- Looks and feels like a **Codex / ChatGPT-style app**, not a TUI
- Supports **multitasking**: multiple chats, project/workspace view, tabs + sidebar
- Runs on **local LLMs only**: Ollama and/or llama.cpp
- Has **no call-home** behavior
- Is usable for **internal automations first**
- Has a possible future path to **client distribution**
- Does **not destroy the hard drive** — storage behavior is a hard constraint

---

## 2. Target users

### Primary
- You, for internal automation work

### Secondary / future
- Clients who can run the same app locally and be taught to use it

---

## 3. Product feel

### Must have
- Desktop app, not a terminal UI
- Multiple chats open at once
- Project/workspace view with chats grouped under projects
- Tabs plus a sidebar for projects, tools, or runs
- Local model backends, not cloud-only
- Visible, understandable storage behavior

### Nice to have
- Linux and Windows support, behind macOS first
- Client-friendly installer or portable app later
- Automation features that a non-technical user can eventually understand

### Out of scope for v1
- Cloud model providers
- Call-home telemetry, update checks, analytics, beacons
- Full client distribution package
- Anything that requires network access at runtime

---

## 4. Core requirements

### 4.1 Chat and workspace
- Multiple concurrent chats
- Each chat belongs to a project/workspace
- Project view shows chats, files, and runs together
- Sidebar navigation for projects, tools, runs, or similar
- Tabbed chat UX

### 4.2 Local model backends
- Support **Ollama**
- Support **llama.cpp**
- User can choose or switch backends
- Backend is local; no implicit cloud fallback

### 4.3 No call-home
- No telemetry
- No analytics
- No update check that reaches out
- No analytics beacons
- No implicit online status probing that phones home
- Runtime should not require network

### 4.4 Automation model
- Mix of:
  - Saved prompts/tasks run on demand
  - Scheduled or repeat jobs
  - Tools/scripts the agent can call locally
- Start simple; let the app UX shape the first version

### 4.5 Storage and disk protection — hard requirement
This is not optional.

- Bounded logs and history
- Bounded session storage
- Temp/scratch on a controlled path
- Cleanup rules
- Visible storage use
- Safe defaults for non-technical users later
- Manual override possible for power users

### 4.6 Data model
- Chats, projects, and runs stored as **JSON + Markdown** where practical
- Inspectable and portable
- Easy to back up
- User-visible folder structure

---

## 5. Platform

### Primary
- **macOS**

### Bonus
- Linux
- Windows

### Implication
- Choose a stack that can ship on macOS cleanly first, without making Linux/Windows impossible later

---

## 6. Suggested technical direction

This is a recommendation, not a final decision. Adjust after review.

### 6.1 Stack
- **Frontend:** web tech with a desktop wrapper — likely **Tauri** or **Electron**
- **Backend:** local process for model/proxy/tool execution
- **Why:** gives the app feel you want, keeps local model integration manageable, and stays cross-platform-friendly

### 6.2 Local model layer
- One local backend that can talk to **Ollama** and/or **llama.cpp**
- Backend should be configurable per machine
- Keep model access behind a small, auditable local interface

### 6.3 Storage design
- Application data in a single user-visible local folder
- Subfolders for:
  - JSON data
  - Markdown indexes/files
  - Logs
  - Temp/scratch
- Cleanup policy enforced by default
- Visible storage meter or status

### 6.4 No-call-home enforcement
- Design the app so runtime does not need network
- Treat any future network path as explicit and gated
- Prefer local-only by default, not "local-only after you disable things"

---

## 7. Reference landscape

These are candidates and reference points, not commitments.

- **OpenCode** — closest open Codex-style coding agent with some desktop surface; MIT; worth examining for harness ideas
- **Jan** — closest open ChatGPT-shaped desktop app; Apache 2.0 variant; worth examining for app/chat UX ideas
- **Cline / Continue** — capable open coding assistants, editor-first; useful as harness references, weaker standalone-app fit
- **LM Studio** — polished local model app, proprietary but free for commercial use; useful as UX reference, not as open base
- **Grok Build** — already cloned; TUI, not app-like; useful as reference only unless you later want to reuse bits

---

## 8. License posture

### Known from earlier review
- Grok Build: **Apache 2.0** first-party
- OpenCode: **MIT**
- Jan: **Apache 2.0 variant with attribution request**
- Cline / Continue: **Apache 2.0** per public write-ups
- LM Studio: **proprietary but free for commercial use**

### Practical takeaway
- If you want an open, redistributable base later, MIT/Apache 2.0 candidates are the easiest to reason about
- If client distribution becomes real, audit the final dependency set and keep applicable notices
- Do not assume any candidate is fully clean until you audit its actual transitive deps in your final build

---

## 9. Out of scope for this doc

- Final UI mockups
- Final stack selection
- Final automation feature list
- Client distribution package design
- Detailed release/porting plan for Linux and Windows

Those should come after this requirements doc is approved.

---

## 10. Open questions / TBD

- Final frontend/backend stack
- Final model-backend priority between Ollama and llama.cpp
- Exact storage cap numbers and cleanup policy
- Exact automation v1 feature set
- Whether to reuse any code from Grok Build or start fresh
- Whether to base the app on an existing open app shell or build one
- Linux/Windows packaging approach
- Client distribution story, if it ever happens

---

## 11. Immediate next steps

1. Review this doc
2. Decide:
   - stack direction
   - whether to start from an existing app shell or build fresh
   - whether to reuse any Grok Build code
3. Turn approved requirements into a v1 scope list
4. Produce a storage/disk-protection plan before any build starts

---

**End of requirements draft.**
