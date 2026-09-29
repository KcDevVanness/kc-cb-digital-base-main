# docs drift fix — execution plan (2026-09-29)

Tracking plan: `.ai/runs/2026-09-29-docs-drift-fix.md`
Source doc: — (no spec drives this run; the requirement record is the 2026-09-29 documentation-drift audit, findings summarized below and in the PR body)

## Goal

Bring the human documentation back in line with the system at `origin/dev` (`626ee15`): the 2026-09-29 audit (11 read-only slices over `docs/**`, `.ai/specs/**` Status lines, `AGENTS.md`, and every app-owned `src/modules/<id>/README.md`) found ~90 deduped drift findings — statuses that lag the shipped wave, READMEs that misstate routes/commands/migrations, dev/deploy guides that contradict the scripts and workflows, and a set of dated records whose conclusions no longer apply.

## Scope

In scope: `docs/**`, `.ai/specs/2026-09-*.md` (Status/Changelog consistency only), `src/modules/<id>/README.md`, `AGENTS.md`.
Non-goals: no code changes; frozen RU target contracts keep their semantics (dated correction notes only); dated log entries in plans keep their history (supersession markers instead of rewrites); `pr-11/` stays untouched (tracked evidence assets referenced by an external PR comment).

## Implementation Plan

### Phase 1: Status truth (specs, plan boards, PRDs)

- 1.1 finance spec Status line + 16→17 endpoint wording; change-analysis Phase 4 close-out; three-system-metric 7→8 endpoint caliber
- 1.2 `docs/plans/README.md` board rows + re-dated cross-check note; `docs/plans/cross-border-erp.md` transport-layer/阶段七/migration-inventory/supersession fixes; `docs/plans/finance-and-cockpit.md` menu roster
- 1.3 `docs/prd/cross-border-erp.md` Q4–Q6 answered; `docs/prd/finance-and-cockpit.md` pre-project framing + anchors

### Phase 2: Module READMEs + AGENTS ownership map

- 2.1 finance (Phase 6 status, ACL list), ru_sync (17 endpoints, suites, draft-pos route), product_codes (underscore paths), cross_border (migrations, cache resources), platform_ops/currency_policy/export_finance/internal_sales/products/purchasing corrections
- 2.2 `AGENTS.md` ownership map rows for product_codes/finance/ru_sync/boss_cockpit/storage_ops + docs-folder enumeration

### Phase 3: docs/dev + docs index

- 3.1 business-architecture (subscribers/enrichers claim, storage_ops row, group counts, supersession marker, pointers), architecture (module counts 39/16, official-modules.json), setup (port block, curl example, gate list), parallel-development (fullapp.dev ports)
- 3.2 multi-company-org-model, currency-policy, i18n corrections; `docs/README.md` folder table (deploy row, pitfalls row, ru-petkit row)

### Phase 4: docs/deploy

- 4.1 cicd.md (GHCR login removal, lessons/guard-tree, password policy, skip-build list, dated table snapshot, set-domain path), runtime.md (worker row, omuser caveat, REDIS fallback)
- 4.2 storage.md + storage-cutover-runbook (preflight wording, Phase 0/1 status, compose claim, MINIO_PORT)

### Phase 5: RU dossier + pitfalls

- 5.1 docs/ru-petkit (README counts/§A.4, dated landing-map corrections, token credential, evidence path, supply-sync-tech factual fixes)
- 5.2 pitfalls (agent-sandbox fix landed marker; dev-runtime lesson link)

### Phase 6: Verification and close-out

- 6.1 Re-verify each fixed claim against the tree; run the docs gate (`yarn lint`, `node scripts/check-lessons.mjs`, diff re-read)
- 6.2 Refresh the PR body, post the summary comment, flip the draft to ready, apply labels (`review`, `documentation`, `priority-medium`, `risk-low`, `skip-qa`)

## Risks

- The board/plan edits touch files the #56 wave just rewrote — every statement is re-verified against the current tree before editing.
- Some audit items were fixed by the wave; those are reported ALREADY_FIXED and left untouched.
- Numbers that need a live DB (table counts in cicd.md) are re-dated rather than re-invented.

## Progress

PR: #57

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Status truth (specs, plan boards, PRDs)

- [x] 1.1 spec Status lines + endpoint wording — 7710865, 1f61c8b
- [x] 1.2 plan boards and cross-border plan — 7710865, 1f61c8b
- [x] 1.3 PRD open questions and framing — 7710865

### Phase 2: Module READMEs + AGENTS ownership map

- [x] 2.1 module README corrections — 1aa6154
- [x] 2.2 AGENTS.md ownership map — 1aa6154

### Phase 3: docs/dev + docs index

- [x] 3.1 dev guides (business-architecture, architecture, setup, parallel-development) — 9d858a4
- [x] 3.2 model/i18n docs + docs/README.md index — 9d858a4

### Phase 4: docs/deploy

- [x] 4.1 cicd + runtime — 20adbc8
- [x] 4.2 storage + cutover runbook — 20adbc8

### Phase 5: RU dossier + pitfalls

- [x] 5.1 docs/ru-petkit corrections — 4405563
- [x] 5.2 pitfalls corrections — 4405563

### Phase 6: Verification and close-out

- [x] 6.1 docs gate + re-verification pass — gate green (`yarn lint` 0 errors / 8 pre-existing warnings, `node scripts/check-lessons.mjs` OK); reviewer pass over the full diff: approve
- [x] 6.2 PR body refresh, summary comment, ready flip, labels
