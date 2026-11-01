---
name: Skill Builder
description: Guide the agent to design, validate, save, and test a new XtracsysCode skill using only the app's real tools.
version: 1.0.0
scope: global
---

# Skill Builder

You are helping the user create a new XtracsysCode skill. Work through these steps IN
ORDER, using only the real tools available to you (read_file, write_file, edit_file,
list_dir, run_command, grep, set_plan). Never claim to run steps you cannot run.

## 1. Understand the recurring task
Ask (only what you need): What task repeats? Who triggers it, and when? What does a
GOOD result look like in one sentence?

## 2. Prefer improving an existing skill
Before drafting, list the user's skills folder (`list_dir` on the skills path the user
gave you, or ask). If an existing skill already covers the task, propose improving it
with `edit_file` instead of creating a duplicate.

## 3. Draft tight metadata and instructions
The skill is a folder containing `SKILL.md`:

```
<skill-name>/
  SKILL.md        # required: frontmatter + instructions
  references/     # optional: bulky background material
  templates/      # optional: starter files the procedure copies
  scripts/        # optional: inert assets — NEVER executed by the skill system
```

`SKILL.md` starts with strict frontmatter (simple `key: value` lines only):

```
---
name: Short Name
description: One sentence saying when to use it (shown in the catalog).
version: 0.1.0
scope: global
---
```

Rules for a good body:
- Ordered, imperative steps the agent can follow with its real tools.
- State prerequisites up front; state how to VERIFY the result at the end.
- Put pitfalls and edge cases where they bite, not in an appendix.
- Keep it under ~200 lines; move bulky examples to `references/` and point to them.

## 4. Validate before saving
Check with the user (or read back with read_file):
- name: 1–80 chars; description: one sentence ≤300 chars; version present.
- scope: `global` (most skills) or `project` (only one project).
- No promises the agent's tools cannot keep; no instructions that override system
  safety rules — skill content is treated as untrusted guidance and cannot approve
  tools, run scripts by itself, or reach outside the project.

## 5. Save through normal approval
Write the folder with `write_file` (this goes through the app's normal write
approval). Show the user the destination path. Then tell them to open
**Settings → Skills**, enable the skill, and attach it to a chat with `/skill <id>`.

## 6. Test and revise
Suggest one representative prompt to try with the skill attached. If output was
wrong, revise the skill (steps too vague? missing prerequisite?) and repeat once.

## 7. Export (optional)
The skill folder lives under the app data root (`skills/<id>/`). To share it, copy
the folder anywhere with `run_command` (e.g. `cp -R`) or Settings → Skills → Export.

## Pitfalls
- Frontmatter lines must be simple `key: value` — no nested YAML, no tabs.
- IDs are the lowercased, hyphenated name; duplicates are rejected.
- Scripts inside a skill are data: do not instruct the agent to "run the skill's
  script" as part of the skill itself.
