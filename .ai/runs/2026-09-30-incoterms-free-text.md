# Execution plan — 贸易术语 becomes free text without seeded options (2026-09-30)

The owner asked what 贸易术语 does; after the explanation (an Incoterms code that is only recorded
and printed, backed by a seeded dictionary of EXW…DDP) they answered: **不需要这些数据选项** — the
option list is not needed. This run removes the seeded dictionary and its picker plumbing, keeps the
field as free text, and fixes the round-trip defect the removal exposed on the contract form.

## Goal

Contracts and PI/CI keep their 贸易术语 field and keep printing it, but the field no longer offers a
seeded option list: it is a plain text input carrying whatever wording the deal was signed with.
`trade_docs/setup.ts` stops seeding the `incoterms` dictionary; the payment-terms and
shipping-method seeds are untouched.

## Scope

- `src/modules/trade_docs/setup.ts`: drop `INCOTERM_SEEDS`, `INCOTERM_DICTIONARY_KEY` and the
  `incoterms` entry from `DICTIONARY_SEEDS`.
- `src/modules/trade_docs/components/formOptions.ts`: drop `INCOTERM_DICTIONARY_KEY` and
  `loadIncotermOptions`.
- `ContractForm.tsx` / `DocumentsForm.tsx`: the `incoterms` field becomes `type: 'text'` with a
  free-text help string; the dictionary loader import goes away.
- `src/modules/trade_docs/api/contracts/route.ts`: **defect found while verifying** — the contract
  list projection neither selected nor returned `incoterms`, so the edit form always opened blank
  and the next save nulled a stored term. Add the column to `contractListFields` and the projection.
- i18n (`trade_docs/i18n/{zh,en}.json`): the two `incotermsHelp` strings.
- Docs: the PI/CI spec (REQ-008, the reuse row, F-005, the seed/ops rows, Status + Changelog),
  `src/modules/trade_docs/README.md`, `docs/plans/cross-border-erp.md`.
- Non-goals: no entity/column/migration change, no print-template change, no rewrite of stored
  values (the field keeps whatever rows already hold), no deletion of the rows the dev database
  already seeded (that needs separate approval), no change to payment terms / shipping methods.

## Implementation plan

### Phase 1: drop the option list, keep the field

- 1.1 setup.ts + formOptions loaders removed.
- 1.2 Both forms render the field as free text; help strings updated in zh/en.
- 1.3 Fix the contract list projection so a stored term survives an edit round trip.

### Phase 2: gate + smoke

- 2.1 Full gate (generate, typecheck, lint, lessons, ds:check, test, build).
- 2.2 Browser smoke: the field renders as a text input, loads a stored value, and a typed value
  saves and reads back.

## Risks / Assumptions

- Stored values are text, never ids: removing the option source cannot break an existing row.
- Existing seeded rows in the dev database stay; the form no longer reads them (deleting them is a
  separate, approval-gated data step).
- The integration specs that send `incoterms: 'FOB'` write it as free text, so they stay valid.

## Verification

| 项 | 结果 |
|---|---|
| `yarn generate` | ✓ |
| `yarn typecheck` | 0 错 |
| `yarn lint` | 0 error（8 既有 warning） |
| `node scripts/check-lessons.mjs` | ✓ |
| `yarn ds:check` | 956 files passed |
| `yarn test` | 61 suites / 517 passed |
| `yarn build` | ✓（Next 16.3.3） |
| 浏览器（dev server 3001） | 合同编辑页：贸易术语为普通文本输入（无下拉）、加载已存值 `FOB Shanghai 2026`、输入 `REACT-TYPED 2029` → 保存 PUT 200 → 库内值更新；修复前该字段永远回显空且保存会清空已存值（缺列 + 缺投影） |

## Progress

PR: #72

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: drop the option list, keep the field

- [x] 1.1 setup.ts + formOptions
- [x] 1.2 forms as free text + i18n
- [x] 1.3 contract list projection fix

### Phase 2: gate + smoke

- [x] 2.1 full gate
- [x] 2.2 browser smoke
