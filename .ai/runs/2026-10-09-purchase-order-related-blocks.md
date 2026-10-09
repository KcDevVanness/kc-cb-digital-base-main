# 2026-10-09 — purchase-order-related-blocks（采购单详情页关联区块 + 发运单 `?purchaseOrderId=`）

**Source doc:** `.ai/specs/2026-10-08-order-centric-entry.md`（第三轮：REQ-013 / TEST-307 / AC-013）
**Base:** `feat/order-workbench-restructure`（PR #147 的分支）——本单元要读的采购单页面与其来源锚三列由该波提供，`origin/dev` 尚未包含；按 AGENTS.md 的 stack 规则，父 PR 合入后 `gh pr edit --base dev` 并 rebase。

## Goal

采购单详情页（`/backend/purchasing/orders/<id>`，工作台采购行「打开详情」的落点）读作 hub：明细行之后给出
关联订单 / 关联合同 / 关联发运单三个只读区块（合同详情页与订单 hub 同款 `RelatedSection`），发运单列表新增
`?purchaseOrderId=` 过滤（scoped 投影 + 可清除横幅）供区块「查看全部」使用。owner 设计反馈（2026-10-09）：
公司订单要像 `/backend/trade-docs/contracts/<id>` 的「关联发票 / 关联订单」那样组织，而采购单详情页此前只有
摘要格里的一个来源单号。

## Scope

- `cross_border`：`loadShipmentIdsForPurchaseOrder`（scoped 只读 `cross_border_shipment_allocations`）、
  `shipments` 列表可选 `purchaseOrderId`（schema + `buildFilters`）、列表页横幅对两个来源参数通用、
  集成规格 `__integration__/shipment-purchase-order-filter.spec.ts`。
- `purchasing`：`PurchaseOrderDetail.tsx` 三个关联区块（各自读、各自失败/重试、组织切换重取）+ 词条；
  来源单号从抬头摘要格移入「关联订单」区块。
- 文档：spec 第三轮（REQ-013 / TEST-307 / AC-013 / Surface / Changelog / Status）、`purchasing` 与
  `cross_border` 的 README、`docs/plans/README.md` 状态板。

## Non-goals

- 不做合同页「管理订单关联」的等价写入口：挂单关系写在合同侧，本页只读。
- 不做采购单侧的发运单新建预填（`?orderKind=purchase_order` 的采购分摊预填是独立单元）。
- 不新增表、不迁移、不新增事件/命令 id；不改 `contractId` / `salesOrderId` 两个既有过滤的行为。

## Implementation Plan

### Phase 1: 关联区块与过滤

1. 1.1 `cross_border`：shipments-by-purchase-order 只读 + 列表过滤 + 横幅 + 集成规格。
2. 1.2 `purchasing`：详情页三个 `RelatedSection` 区块 + 词条 + 来源字段搬家。
3. 1.3 文档：spec / 两个模块 README / 状态板。
4. 1.4 集成 spec（TEST-307）在 ephemeral 环境跑绿。
5. 1.5 主目录本地 `dev` 合并后跑宽门禁（`validation.commands`）。
6. 1.6 浏览器冒烟：三个区块、行链接、「查看全部」的过滤横幅。

## Risks

- 列表新增可选 `purchaseOrderId` 属于 BC 允许的追加式扩展（`.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`）。
- 区块是只读面：无写路径、无乐观锁交互；失败隔离在区块级。
- 堆叠：父 PR #147 合并前，本 PR 的 base 是它的分支。

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: 关联区块与过滤

- [x] 1.1 Shipments-by-purchase-order read, list filter, banner, integration spec — 666e770
- [x] 1.2 Purchase order page association blocks + i18n — fc436c3
- [x] 1.3 Spec, module READMEs, status board — 9b6489f
- [x] 1.4 Integration spec TEST-307 green in the ephemeral env — `yarn test:integration:ephemeral shipment-purchase-order-filter` **3 passed**
- [x] 1.5 Broad gate green in the main tree after the local dev merge — `yarn generate` / `typecheck` / `lint`（0 error, 8 warning）/ `check-lessons` / `ds:check`（1053 files）/ `test`（76 suites · 636 tests）/ `build`（Compiled successfully）all green
- [x] 1.6 Browser smoke on /backend/purchasing/orders/&lt;id&gt; — 见下方「冒烟证据」；夹具（一张带来源锚的采购单 + 一张发运单）已软删，demo 库回到可见原状

## 冒烟证据（2026-10-09，主目录 dev @ :3000）

- `/backend/purchasing/orders/ac8f9a59-…`（PO-2026-0003）：`关联合同` 行 `SC-2026-0002 / ¥0.00 / 已签发` → `/backend/trade-docs/contracts/ae3f51cb-…`；`关联发运单` 行（临时夹具柜号 `PO-HUB-SMOKE-01`，draft）→ `/backend/cross_border/shipments/…`；`关联订单` 空态。
- `/backend/purchasing/orders/a78d47f3-…`（临时夹具，带来源锚 `ORDER-20261008-00003`）：`关联订单` 行 = 单号 + `对内销售订单` 徽章 → `/backend/orders/b21f9390-…`；合同/发运单两区空态。
- `/backend/purchasing/orders/d4b26c92-…`（owner 反馈钉住的页面）：三区空态（「这张采购单没有来源销售订单。」等），摘要格不再有来源单号。
- `/backend/cross_border/shipments?purchaseOrderId=ac8f9a59-…`：顶部横幅「仅显示指定来源订单的发运单 / 清除筛选」，只回该单的柜（显示 1 条）。
- 夹具：`POST /api/cross_border/shipments`（采购分摊 ×1）与 `POST /api/purchasing/purchase-orders {sourceSalesOrderId}`，冒烟后 `DELETE` 软删（`live_ship=0, live_po=0`）。

PR: #149（draft → ready 见 PR Progress）
