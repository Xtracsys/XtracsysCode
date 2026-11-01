# Security

## Reporting a vulnerability

**Designated private channel: GitHub's private vulnerability reporting on this
repository** (repository Security tab → "Report a vulnerability"). Repository
maintainers: enable it via Settings → Security → Private vulnerability reporting
when the repository is created — this is part of the release checklist. As a
fallback contact for arranging private disclosure, write to
[opensource@xtracsys.com](mailto:opensource@xtracsys.com). Do not
post exploit details, credentials, private projects or sensitive logs in a
public issue or pull request; if the private reporting action is ever
unavailable, ask for a private channel without disclosing the issue.

A useful private report includes the affected version/commit, OS/architecture,
minimal reproduction using synthetic data, impact, prerequisites and any
mitigation. Remove tokens, personal paths and user content. Never attach a real
app-data backup. There is no stated response deadline, bounty program or
supported-version maintenance guarantee. This tree is not security-certified.

## Boundaries and operator responsibilities

- Built-in model clients target loopback servers. This does not establish that
  the model server is bound only to loopback or that arbitrary subprocesses
  cannot access the network.
- Shell commands, plugins and MCP child processes run with the user's OS
  permissions. Consent and project-path checks are not an OS process sandbox.
  Import/test/run only reviewed sources; dependencies and interpreters also
  affect execution. Do not use approval bypasses for untrusted tasks.
- Imported skill instructions and model/tool output are untrusted content, not
  authorization. Review tool requests and generated changes before approving.
- Chats, tool output, project paths, exports and backups may contain secrets.
  No encryption-at-rest guarantee is established. Review retention/export
  behavior and share only sanitized synthetic reproductions.
- Review restored settings and imported plugins before enabling execution.
  Validation and regression tests do not establish freedom from filesystem
  races or every hostile archive variation.
- Unsigned or unnotarized artifacts are not authenticated releases. Do not
  remove quarantine, disable OS protections, or treat a checksum from the same
  untrusted download channel as independent publisher authentication.

Read [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the bounded hygiene
review and bundled-content provenance statements. Current-file pattern checks do
not certify Git history as free of secrets. A public release needs its exact source
set, reachable history (if included), runtime notices and artifacts reviewed.
If a real secret is discovered, stop distribution and arrange private revocation
or rotation with its owner; deleting a working-tree line does not revoke it or
remove it from existing history/copies.
