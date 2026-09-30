# Execution plan — copy-source preview + trade-typed sources for contract lines (2026-09-30)

The contract's 「从订单/报价单复制行」 dialog copied rows blind: the source type read
「销售订单/销售报价单」 even though sales documents come in two trade types, and the only way to see
what a source contained was to copy it and look at the result. The internal-sales order already had
the answer for its own source quote — a read-only preview drawer — so this run generalizes that
affordance and makes the source type name its trade type.

## Goal

`/backend/trade-docs/contracts/create` → 「从订单/报价单复制行」 must (a) offer source types that name
their trade type (对内/对外 × 订单/报价单), aligned with the contract's counterparty, and (b) let the
operator preview the picked source — head and lines — before copying. The same preview must reach
the PI/CI copy dialogs, and the pattern must be reusable for every future "copy rows from elsewhere"
feature.

## Scope

- `src/lib/source-preview/SourcePreviewDrawer.tsx` (new, app-level): read-only drawer shell (loading /
  error / empty states, head fields, line list), the reusable half of the pattern.
- `src/i18n/{zh,en}.json`: `ui.sourcePreview.*` + `ui.actions.preview` (append-only).
- `src/modules/trade_docs/lib/contractLineSource.ts`: kinds split by trade type
  (`internal_sales_order` / `internal_sales_quote` / `external_sales_order` / `external_sales_quote`),
  `sourceKindsForDirection(direction, tradeType)`, head-fact readers for order/quote and contract rows.
- `src/modules/trade_docs/components/{ContractLineSourceDialog,DocumentsForm}.tsx`: kind vocabulary +
  preview button + shared drawer; PI/CI 从订单复制行 and 从合同引用商品行 get the same preview.
- `src/modules/trade_docs/components/{formOptions,sourcePreview}.tsx`: head loaders by id
  (`loadOrderSourceHeadFacts` / `loadContractSourceHeadFacts`) and display mapping for preview rows.
- Tests: `lib/__tests__/contractLineSource.test.ts` (kind rules + head facts).
- Docs: the line-reuse spec (REQ-005 / AC-005 / UI row / Changelog), `src/modules/trade_docs/README.md`,
  `docs/plans/README.md`, `docs/plans/cross-border-erp.md`.
- Non-goals: no entity/migration/API-contract change; the PI/CI dialog's own source-type vocabulary
  (single `sales_order` kind, unfiltered list) stays as it is — giving a PI/CI copy source a trade
  type needs its own decision; no change to the copy semantics (one-shot append, per-row
  `source_snapshot`, head anchor).

## Implementation plan

### Phase 1: shared preview + trade-typed source kinds

- 1.1 `SourcePreviewDrawer` + `ui.sourcePreview.*` keys.
- 1.2 Kind split, `sourceKindsForDirection(direction, tradeType)`, head-fact readers + unit tests.
- 1.3 Contract dialog: kind vocabulary, hint line, preview button, drawer; copy reuses the previewed
  lines.

### Phase 2: the same pattern on the PI/CI copy dialogs

- 2.1 Head loaders + preview-row mapping (`formOptions`, `sourcePreview`).
- 2.2 从订单复制行 and 从合同引用商品行: preview buttons + shared drawer; copy reuses the read lines.
- 2.3 Fix the order-lines read back to the installed collections' page cap (100 on `sales/*-lines`: asking for 500 answers 400; the module's own contract lines stay at 500).

### Phase 3: docs, gate, browser smoke

- 3.1 Spec / module README / plan rows updated.
- 3.2 Gate: generate, typecheck, lint, lessons, ds:check, test, build.
- 3.3 Browser smoke on the worktree dev server: contract (对内 resolved / unresolved / 采购) preview +
  copy, PI 从订单复制行 preview + copy, PI 从合同引用商品行 preview + copy.

## Risks / Assumptions

- The contract's counterparty decides which trade types may be offered; an unresolved counterparty
  offers all four kinds so the operator states the type instead of the picker guessing (the same
  rule the spec's REQ-005 already set for filtering).
- `orderKind` in line snapshots gains two values; old rows stay readable (free-form snapshot, no
  migration).
- The installed `sales/*-lines` collections cap `pageSize` at 100 (500 answers 400) — the preview
  read shares the copy's fetch, so it must use the same cap.
- PI/CI copy sources keep their existing single-kind vocabulary (see Non-goals).

## Verification

| 项 | 结果 |
|---|---|
| `yarn generate` | ✓（工作树 `.env` 端口块 +1000） |
| `yarn typecheck` | 0 错 |
| `yarn lint` | 0 error（8 warnings，全部既有） |
| `node scripts/check-lessons.mjs` | ✓ |
| `yarn ds:check` | 958 files passed |
| `yarn test` | 61 suites / 524 passed |
| `yarn build` | ✓（Next 16.3.3，编译 + TS + 静态页生成全过） |
| 浏览器（dev server 3002，中文字典） | 合同（销售 + 分公司）：来源类型「对内销售订单/对内销售报价单」+ 说明；选 ORDER-20260929-00007 → 预览抽屉（单号/对方/贸易类型 对内销售/币种 CNY/金额 ¥22,500.00/日期 + 2 行）→ 复制行 → 2 行追加 + 锚点「来源: ORDER-20260929-00007」；报价来源同样预览正常；无对方时四个类型 + 提示；采购方向「采购订单」+ PO 预览（供应商/¥2,000.00/1 行）。PI：「从订单复制行」预览 + 复制 2 行；「从合同引用商品行」预览（SC-2026-0002/¥100.00/1 行）+ 引用成功 |
| 截图 | 合同来源预览抽屉（见 PR） |

## Progress

PR: #69

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: shared preview + trade-typed source kinds

- [x] 1.1 `SourcePreviewDrawer` + app i18n keys — 5bdc52e
- [x] 1.2 trade-typed kinds + head-fact readers + unit tests — 021edfc
- [x] 1.3 contract dialog wiring — 021edfc

### Phase 2: the same pattern on the PI/CI copy dialogs

- [x] 2.1 head loaders + preview-row mapping — 1625e05
- [x] 2.2 PI/CI dialog previews — 1625e05
- [x] 2.3 order-lines page cap fix — 1625e05

### Phase 3: docs, gate, browser smoke

- [x] 3.1 spec / README / plan rows — bb0e976
- [x] 3.2 full gate（generate/typecheck/lint/lessons/ds:check/test/build 全过）
- [x] 3.3 browser smoke
