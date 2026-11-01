# Contributing

## Before sending a change

- Keep the change focused. Explain the behavior, threat boundary or bug it fixes.
- For a fix, add a regression that fails for the original reason before changing
  production code. Do not weaken unrelated tests to make a run pass.
- Do not include chats, credentials, user projects, private paths, backups or
  unrelated generated artifacts. Review staged files and their history locally.
- Identify copied/adapted code, skills, plugins and assets by upstream URL and
  revision; preserve copyright, license and NOTICE files and document changes.
  Read [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The root Apache-2.0
  license does not relicense someone else's material.
- Submit only work you have the right to contribute. Contributions intentionally
  submitted for inclusion are subject to Apache-2.0 section 5 unless explicitly
  stated otherwise; disclose separately licensed material for review.

## Development and verification

Use Node.js 20 or newer and the checked-in npm lockfile. Follow the README setup
instructions in a disposable development environment. Dependency installation
can execute package lifecycle scripts and use the network; inspect them first.
Do not treat a script name as permission to run it on private user data.

After dependencies are available, run from the repository root:

```sh
npm run typecheck
npm test
npm run build
```

Focused tests require `npm run build:main` first; tests live in `tests/*.test.mjs`.
Check the current `package.json` test script rather than assuming it includes
newly added tests. Report exact commands, results, OS/architecture and anything
not run. Passing unit tests or building does not verify an installer, live model
server, native platform behavior, code signing or security certification.

Tests use temporary fixtures and can start local servers/child processes.
Use a dedicated disposable temporary directory (configure `TMPDIR` on POSIX or
`TEMP`/`TMP` on Windows before starting Node); do not point tests at real app
data. Some cleanup is prefix-based, so do not share test scratch with valuable
files. Review fixture paths before running new tests.

## Trust boundaries

Shell commands, MCP servers and plugins run with the user's OS permissions and
are not a process sandbox. Plugin import/testing is code execution once
consented. A changed source tree, interpreter or dependency may change what
runs; review it. Skill text is guidance, not authority to approve tools. Do not
introduce remote-model requests or claim zero-egress from arbitrary subprocesses.
Document the limits of any protection you add.

## Issues, support and pull requests

Use this repository's issue tracker for non-sensitive reproducible bugs and
focused feature proposals, when available. Include version, OS/architecture,
expected/actual behavior and a minimal sanitized reproduction. Attach only
reviewed excerpts, not complete logs or backups. Use the PR template and list
untested platforms and residual risks. Follow [SECURITY.md](SECURITY.md) for
vulnerabilities; do not post exploit details or credentials in public issues.

No response time, maintenance duration, platform support commitment or security
certification is promised. Release claims must be backed by recorded execution
on the relevant artifact and platform.
