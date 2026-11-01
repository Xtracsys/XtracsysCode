---
name: Project Orientation
description: Build a quick, accurate map of an unfamiliar codebase before making changes in it.
version: 1.0.0
scope: global
---

# Project Orientation

Use when entering an unfamiliar project. Goal: a verified map of what this project is
and how to work in it — in a few minutes, without guessing.

## Procedure
1. Read the project instructions you were given (.xtracsys.md / AGENTS.md content is in
   your context) and the top-level README if present.
2. `list_dir` the root. Identify: language(s), package manifest, entry points, tests,
   build config, docs folder.
3. Read the package/dependency manifest (package.json, requirements.txt, Cargo.toml, …)
   — note the stack, scripts, and entry points.
4. `list_dir` the main source folders (2 levels deep max). Note the architectural
   pattern (layers, modules, plugins).
5. Grep for the run/build/test commands actually referenced in CI or docs rather than
   inventing them.
6. Report a compact map: stack, entry points, how to build/test/run, folder layout,
   conventions observed, and anything that looks risky to touch.

## Verify
- Every command you report comes from the repo itself (manifest scripts, CI config, or
  docs) — never invented.
- State explicitly anything you did NOT check.

## Pitfalls
- Don't read every file — sample the structurally important ones.
- Don't run install/build commands during orientation; just report them.
