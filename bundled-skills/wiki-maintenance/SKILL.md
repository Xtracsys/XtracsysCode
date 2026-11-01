---
name: Wiki Maintenance
description: Keep a project's documentation or wiki accurate after code changes.
version: 1.0.0
scope: global
---

# Wiki Maintenance

Use after code changes that made documentation stale — or when asked to refresh docs.

## Procedure
1. **Find the truth first**: establish current behavior from the code (entry points,
   changed files, new/removed features). Documentation follows the code, never the
   reverse.
2. **Inventory stale claims**: grep the docs for the names of changed functions,
   commands, file paths, counts, and UI labels. Stale specifics matter more than stale
   prose.
3. **Update minimally**: fix what is wrong; don't rewrite style or restructure pages
   that weren't affected. Match each document's existing voice and format.
4. **Check cross-references**: renamed things usually break links/references — grep the
   old names everywhere.
5. **Verify counts and paths**: any number in docs (file counts, line counts, defaults)
   gets re-measured with commands, not estimated.
6. Summarize: which documents changed and why each was wrong.

## Pitfalls
- Do not document features that don't exist yet, and do not delete docs for features
  you can't find — ask.
- Generated docs (like this project's wiki) have a generator: regenerate through the
  project's own process instead of hand-editing artifacts.
