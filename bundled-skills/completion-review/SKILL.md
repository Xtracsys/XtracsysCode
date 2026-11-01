---
name: Completion Review
description: Self-review finished work for correctness, leftovers, and honesty before declaring done.
version: 1.0.0
scope: global
---

# Completion Review

Run this BEFORE telling the user the work is done.

## Checklist (verify with tools, not memory)
1. **Requirement match**: re-read the user's request; list each ask and where it was
   addressed. Anything not addressed must be named, not papered over.
2. **Diff review**: re-read every file you changed. Look for: debug leftovers,
   commented-out code, accidental reformatting, files you touched but didn't need to.
3. **Verification evidence**: what command/output proves it works? Run the project's
   build/tests if they exist. Report the actual result — never claim a pass you
   didn't see.
4. **Side effects**: any new files that shouldn't exist? Any change outside the scope
   (config, lockfiles, formatting churn)?
5. **Honest summary**: state what works, what was verified, what wasn't, and any
   known limitations — in that order.

## Pitfalls
- "It should work" is not verification. Run the thing.
- If you cannot verify something, the summary must say so plainly.
