---
name: Systematic Debugging
description: Find root causes with evidence instead of guess-and-check patching.
version: 1.0.0
scope: global
---

# Systematic Debugging

Use when a bug, failure, or wrong behavior needs a root cause. Optimized to avoid the
two classic failure modes: fixing symptoms, and changing three things at once.

## Procedure
1. **Reproduce** deterministically first. Find or write the smallest command/steps that
   show the failure. If it cannot be reproduced, say so and gather evidence instead.
2. **Characterize**: what exactly is wrong vs. expected? Capture the actual error/output
   with tools (read logs, run the failing command, show the value).
3. **Hypothesize** at least two candidate causes BEFORE editing anything. Rank them.
4. **Test the cheapest hypothesis** with a read-only probe (grep, read_file, a log, a
   print). One variable at a time.
5. **Fix the cause**, not the symptom — the smallest change that removes the root cause.
6. **Verify** with the same reproduction from step 1, plus adjacent cases that could
   regress (callers of the changed code).
7. Report: symptom → root cause → fix → verification. If you could not find the root
   cause, say what you ruled out and what evidence contradicts.

## Pitfalls
- Never "fix" by deleting the assertion/test that caught the bug.
- If two fixes tempt you, do one, verify, then the other.
- A failing test that stops failing for a DIFFERENT reason is not a pass.
