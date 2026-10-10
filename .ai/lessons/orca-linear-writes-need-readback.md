---
title: "Orca→Linear writes need a read-back; the write response alone is not proof"
modules: ["platform"]
areas: ["spec-pr", "ai-workflow"]
topics: ["orca-cli", "linear", "write-verification", "idempotency", "sync-tooling"]
---

# Orca→Linear writes need a read-back; the write response alone is not proof

**Context**: 2026-10-08, building `scripts/linear-sync` (docs → Linear project sync). Three observed
behaviors during the research phase, all on the same Orca CLI:

- a `linear create` returned `ok: true` with the correct title, project and state, but the description
  never landed (empty body for the probe issue);
- two large `save-issue` writes (55 KB / 87 KB bodies) returned `linear_write_unconfirmed` (exit 1)
  while the content actually landed, normalization included, verified by read-back;
- Linear normalized the markdown it stored: relative links came back wrapped in `<>`, table
  alignment rows were rewritten.

**Problem**: Orca's Linear writes are single-attempt. `linear_write_unconfirmed` means "may or may not
have applied" — a blind retry can duplicate a create or rewrite a body unnecessarily, and treating
"response ok" as proof lets a dropped body go unnoticed (the issue looks created, the content is
missing). Byte-exact content assertions also fail for a different reason: Linear rewrites markdown on
write, so equality checks must be structural, not literal.

**Rule**: After every non-trivial Orca→Linear write, read the issue back with
`orca linear issue <id> --workspace <id> --json` and check title, state, project and body
(length tolerance + leading content). On `linear_write_unconfirmed`, read back first; retry exactly
once with `--write-id` only when the error payload carries one and the read-back shows the change did
not land. Keep a committed manifest (anchor → issue id + content hash) so re-runs skip unchanged items
instead of rewriting them. When syncing docs, rewrite relative links to absolute URLs before writing
(Linear does not resolve them) and expect the stored markdown to differ from the source.

**Applies to**: `scripts/linear-sync/**`, any agent using `orca linear create` / `save-issue` /
`comment add` to move content into Linear; the same read-back discipline applies to any single-attempt
external write surface.
