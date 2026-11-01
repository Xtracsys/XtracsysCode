---
name: Test-First Development
description: Write the failing test before the fix or feature, then make it pass without weakening the test.
version: 1.0.0
scope: global
---

# Test-First Development

Use for bug fixes and small features where a test can encode the requirement.

## Procedure
1. Restate the requirement as an observable behavior ("function X returns Y when Z").
2. Find where the project's tests live and how they run (read the manifest/scripts — do
   not invent a new framework).
3. Write ONE failing test that encodes the requirement. Run it and confirm it fails
   for the EXPECTED reason (assertion, not import error).
4. Implement the smallest change that makes the test pass.
5. Run the full relevant test suite. Fix regressions you caused; report pre-existing
   failures without "fixing" unrelated code.
6. Never weaken an existing test to make a pass. If a test is genuinely wrong, say why
   and change it in a separate, explained edit.

## Verify
- The new test failed before the change and passes after (say so explicitly).
- No test was deleted, skipped, or loosened without explanation.

## Pitfalls
- Testing implementation details (private calls) instead of behavior makes the suite
  brittle — test through the public surface.
- If the codebase has no test infrastructure, ask before scaffolding one.
