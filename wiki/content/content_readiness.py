"""Release sprint evidence; source/tests and installer acceptance are distinct."""

ARTICLES = [dict(
    slug="open-source-readiness", title="Open-source readiness", category="docs",
    path="OPEN_SOURCE_READINESS.md", lang="Markdown", status="REVIEW",
    pkg="docs", phase="pre-publication", related=["doc-readme", "agent-tests", "plugins", "host-main", "local-url"],
    lead=[
        "Apache-2.0 is applied locally for Xtracsys LLC. The release sprint adds source-bound plugin consent, imported-rule removal, native-tar restore tests, provider response limits and awaited MCP cleanup diagnostics. No commit, push or publication has occurred.",
        "Mac arm64 DMG/ZIP integrity, architecture, notices/resources, unpacked/ZIP/read-only-DMG payload equality and isolated actual UI/preload/init/startup/quit checks passed. The app emitted XTRAC_PACKAGE_SMOKE_OK and exited 0. These are local-test artifacts: code-signature verification and Gatekeeper both returned 1; no Developer ID/notarization or trusted public release is established.",
    ],
    sections=[
        ("Observed application checks", [
            "The integrated test run passed skills 36, plugins 29, security 133, document plugins 57, provider/MCP release regressions 24, plugin/restore release regressions 27 and ZIP teardown regressions 20, plus compatible-provider fixtures. Typecheck and production packaging build passed (45 renderer modules). Final source changes are reflected in the verified artifacts; later edits are tests/docs only.",
            "Tests include actual loopback response fixtures, process cleanup, and native tar creation/listing/extraction/staging/sanitization/swap/rollback. They do not prove live GMLX/MLX LM compatibility, hostile Electron IPC behavior, Windows tree termination or comprehensive security.",
        ]),
        ("Implemented release protections", [
            "OSR-02/03: consent binds launch details and the original source tree, including hidden files/local dependencies; changes require re-review. Review caps are 2,048 entries, depth 24, 8 MiB/file and 32 MiB total; links/special files fail closed. Plugin testing revalidates the dialog token and obtains a checked descriptor before spawning.",
            "OSR-04/18: staged restore validates documents and disables/unreviews plugins, pauses schedules, removes project MCP commands and imported allow-always rules, and resets global/project/chat/archive approvals to Ask. Native-tar staged restore and rollback regressions pass; Electron IPC/relaunch and concurrent filesystem attacks remain distinct acceptance gaps.",
            "The restore barrier rejects active/detached persistence, turns/queues/shutdown, tasks, cleanup/backups and concurrent imports before admission. Successful swap stays frozen through restart; failures resume only after confirmed rollback. Production-function tests exercise IPC, session/window writes, scheduled work and failure recovery; real Electron restore/relaunch remains untested.",
            "OSR-12: MCP cleanup tracks startup/abort children, awaits bounded termination, clears pending calls/timers/listeners and surfaces shutdown diagnostics. External group escape/OS termination failures remain possible; Windows tests are simulations on macOS.",
            "OSR-17: compatible responses are bounded before retention/parsing: models 1 MiB, HTTP errors 16 KiB, SSE line 256 KiB, event 1 MiB/256 lines, stream 16 MiB, tool fragments 1 MiB/128 calls. Timeout/cancellation and oversized fixtures are covered.",
        ]),
        ("Residual boundaries", [
            "Commands, MCP and plugins remain ordinary unsandboxed user processes. Plugin source hashing does not pin external interpreters, environment or libraries, revoke running code, or eliminate final-check-to-spawn mutation races.",
            "Backup selection is still a mutable path used separately for tar listing/extraction. Private snapshotting would narrow that race. Staged validations and test success are not a filesystem sandbox or security certification.",
            "Loopback destination validation cannot establish the server's bind interface. Keep backends bound to localhost; live model/server acceptance remains unverified.",
        ]),
        ("Source and licensing hygiene", [
            "LICENSE, README and package metadata identify Apache-2.0. Sole human authorship and company-formation context are owner-reported and are not an independent chain-of-title audit. THIRD_PARTY_NOTICES.md retains inspected upstream notices; bundled asset/content provenance and full dependency clearance remain bounded rather than certified.",
            "Coordinator history audit completed with review-required: 40 commit message bodies and 343 historical text blobs scanned; internal-material hits require public-file selection. The scanner's single candidate was independently verified as the public AWS example fixture, not a private credential. No selected secret-pattern candidate was found in scanned history; binaries/excluded surfaces remain unscanned. Keep raw private audit metadata out of the public export.",
            "CONTRIBUTING, SECURITY and issue/PR templates now exist. A private vulnerability-reporting destination has not yet been verified. Hosted CI and native Windows/Linux acceptance were not run.",
        ]),
        ("Mac installer acceptance", [
            "Packaging includes project and Electron/Chromium notices, Marked license, bundled skills and existing branding. The final verifier passed DMG/ZIP integrity and unpacked/ZIP/read-only-DMG byte equivalence, plus actual isolated packaged UI/preload/init/normal quit. SHA256SUMS.txt and mac-verification.json describe the exact artifacts. Client installation and internet-quarantined Gatekeeper acceptance were not tested.",
            "The build remains unsigned/unnotarized. Current signature/Gatekeeper diagnostics must be recorded, not hidden by removing quarantine or disabling protections. Existing installed builder contains an AppleDouble ASAR-integrity fix; a clean exFAT dependency install has not been verified.",
            "Screenshots/demos are deferred to the owner. ZIP cancellation guards/disposes late callbacks and awaits bounded stream/archive teardown; legacy-yauzl close semantics have regression coverage. Focused independent follow-up source review supports the restore and ZIP fixes, with no concrete introduced regression; it did not execute runtime checks. Public files/history, reporting/provenance/signing and publication remain separate decisions.",
        ]),
        ("Wiki source of truth", [
            "Edit wiki/content/content_*.py, then regenerate JSON/HTML/Markdown through the existing generator. Direct-file metrics refresh at generation; grouped counts and prior verified labels are historical unless remeasured. A new generation timestamp is not runtime certification.",
        ]),
    ],
),
    dict(slug="sec-audit-2026-10", title="Security audit & remediation", category="docs",
         path="SECURITY_AUDIT_2026-10-28.md", lang="Markdown", status="REVIEW",
         pkg="docs", phase="2026-10", related=["open-source-readiness", "host-main", "agent-tools", "host-storage"],
         lead=[
             "Two full adversarial audits of the v5 tree (same day, 2026-10-28): an initial five-track audit (Electron core, agent runtime, plugin/supply chain, renderer, build/test) and a round-2 re-review of the fixes themselves. Every finding was verified against source and dispositioned in the report; the remediation is covered by an expanded security test suite.",
             "Round-1 headline fixes: skill-ID IPC validation (arbitrary file read/write path closed), markdown link-label HTML injection (now routed through parseInline/escaping), the allowlist redirect bypass, provider stream bounds for ollama/llamacpp, grep ReDoS caps, 0700/0600 data-root permissions, SHA-pinned CI actions, Electron security fuses + ad-hoc re-seal in afterPack, and the electron 45 / electron-builder 26 upgrade (npm audit fully clean).",
             "Round-2 headline fixes (found by reviewing the new code adversarially): a linear wildcard matcher + worker-bounded regex for grep (two empirically proven main-process freezes), the shared rules sanitizer closing an allow-always blanket-rule bypass, storage-cap floors so a crafted backup cannot wipe all chats, permission handler inverted to an allowlist, sender-resolved consent dialogs, restored-chat-record schema validation plus an app-level ErrorBoundary (backup-to-crash-loop path closed), and HTML-escaped markdown transcripts.",
         ],
         key_items=[
             ("Verification", "357/357 tests (security suite 164), typecheck clean, npm audit 0 vulnerabilities incl. dev deps, packaged-app smoke passed on Electron 45 with fuses verified on the binary."),
             ("Deferred by owner decision", "Code signing, notarization and the ASAR-integrity fuse (needs a Developer ID); marked enablement points live in scripts/afterPack.js and electron-builder.yml."),
         ]),
    dict(slug="feature-proposals", title="Feature proposals", category="docs",
         path="FEATURE_PROPOSALS.md", lang="Markdown", status="META",
         pkg="docs", phase="2026-10", related=["sec-audit-2026-10", "doc-readme"],
         lead=[
             "Post-audit feature backlog, ordered by value-to-effort within four tracks: Security & robustness (macOS Seatbelt sandbox for run_command, worker-thread tools, approval-card risk annotations, orphaned-backup recovery), Agent capability (Ollama model manager, per-turn snapshot & rollback, per-server MCP env vars, project-defined slash commands), UX (drag-drop file context, timeline virtualization, chat branching, PDF export via the bundled doc-pdf plugin), and Platform (R12 native Windows/Linux verification, signed auto-update channel later).",
         ],
         key_items=[
             ("Sequencing", "Quick wins first, then the sandboxing and snapshot tracks in parallel with model management and platform verification."),
         ]),
    dict(slug="release-readiness", title="Release readiness 2026-10-31", category="docs",
         path="RELEASE_READINESS_2026-10-31.md", lang="Markdown", status="REVIEW",
         pkg="docs", phase="pre-publication", related=["sec-audit-2026-10", "open-source-readiness", "cfg-package"],
         lead=[
             "Report-only release-readiness pass (1/1) over the public export artifact (single fresh-history commit, 205 files) using a structured checklist: baseline (secrets, dependencies, real build/tests, clean-copy, docs, UX states), a general security review, a debug review, and the Data/recovery, Operations, AI/agents and Privacy/legal profiles.",
             "Fresh evidence on 2026-10-31: typecheck clean, build clean, 357/357 tests, npm audit 0 vulnerabilities (both views), secret scanner 0 candidates, private-string sweep clean, dist:dir packaging with fuses flipped + ad-hoc re-seal, packaged smoke XTRAC_PACKAGE_SMOKE_OK exit 0, fuse wire verified on the binary, git history exactly one commit.",
             "Verdict: initially NOT READY on two owner gates (RR-001 bundled asset/skill provenance, RR-002 private vulnerability-reporting channel); RESOLVED same day by owner statements recorded in THIRD_PARTY_NOTICES.md and a designated reporting channel in SECURITY.md — final verdict READY. Ten further findings are low/informational with dispositions. The full report stays in the private tree (operator context); this article summarizes it.",
         ],
         key_items=[
             ("Open owner gates", "RR-001 origin statements for bundled skills/logo assets; RR-002 enable GitHub private vulnerability reporting and finalize SECURITY.md."),
             ("Untested scope", "Live-model E2E (needs a local model server), real-user restore/relaunch on hardware, Windows/Linux on-hardware acceptance (R12)."),
             ("Corrective loop 2026-11-01", "Four requested corrective passes completed, all CLEAN (28 battery checks each: secrets, deps, build, full 357-test suite, packaging, docs, security-fix presence, debug sweep, git hygiene), packaging + packaged smoke + fuse wire verified fresh every pass; no application-code changes required. One new finding RR-013 (low, dev-chain-only): glob GHSA-3g3m-2fjr-6pw4 via electron-builder/@electron/asar, moderate, prod tree stays at 0 vulnerabilities; no non-breaking fix upstream — monitored. Final verdict READY."),
         ]),
]
