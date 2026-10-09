# 2026-10-09 — company-order-status-payment（第六轮：订单状态词表 + 是否已收款）

**Source doc:** `.ai/specs/2026-10-09-company-order-root.md` 的「第六轮」节（REQ-020/REQ-021）
**Base:** `dev`（8905b6b，前四轮已合入；第五轮 `feat/company-order-summaries` 在另一棵树并行，无 schema 交集）
**PR:** 待开（draft → ready）

## Goal

owner 2026-10-09 在 `/backend/orders/create` 给出的两条口径：

1. **订单状态换成业务词表**（替换现有 草稿/进行中/已完成/已取消，按业务流转排序）：已下单 → 生产 → 工厂提货 → 已报关 →
   已装运 → 路上 → 到仓库。
2. **新增「是否已收款」**：选项 已收全款 / 未收款，新单默认 未收款。

owner 已确认（本轮问答）：① 用这 7 个**替换**；② 按业务流转排序（生产在工厂提货之前）；③ 字段加在**公司订单**上
（订单档案里 `export_finance` 的按采购单「收款状态」不动）。

## Scope

- `order_hub`：`data/{validators,entities}.ts`、`commands/companyOrders.ts`、`api/orders/route.ts`、`lib/companyOrder.ts`、
  `cli.ts`、`components/{CompanyOrderForm,CompanyOrderStatusDialog,OrderWorkbench,OrderDetail}.tsx`、i18n；
  迁移 `Migration20261009064750_order_hub.ts`（`payment_status` 列 + `status` 默认值）。
- 测试：`data/__tests__/validators.test.ts`（新）、`commands/__tests__/companyOrders.test.ts`、
  `__integration__/company-orders.spec.ts`。
- 文档：本 run record、spec 第六轮、模块 README。

## Non-goals

- 不动 `export_finance`（收汇档案的选项/金额/日期语义原样）。
- 不回填既有行的状态（`in_progress`/`draft` 等旧值如实保留、按旧标签渲染）；不做状态机（可选值，不是受限流转）。
- 不下拉里保留旧词表（仅“该行自己的旧值”可再次选中）；不改工作台列集合（不加收款列）。
- 不迁移 `src/i18n/{en,zh}.json`（生成物）以外的叙事文档到别的分支。

## Implementation Plan

### Phase A: 数据与写路径

1. A.1 `COMPANY_ORDER_STATUSES` 换成 7 值 + `LEGACY_COMPANY_ORDER_STATUSES`/`COMPANY_ORDER_STORED_STATUSES` +
   `companyOrderStatusOptions(current)`；create/update/list schema 用拓宽后的枚举，update 加 `paymentStatus` 三态。
2. A.2 实体：`status` 默认 `placed`；新列 `payment_status text NULL`。
3. A.3 命令：create 默认 `placed`/`unpaid`（显式 `null` 存 null）；update apply；undo（update/delete 两路）；
   `serializeCompanyOrder`；`createCompanyOrderFromRef` 默认 `placed`/`unpaid`（可选 `paymentStatus: null`）。
4. A.4 路由：`listFields`/`transformItem`/列表项 schema 追加 `paymentStatus`；`cli.ts` 补录映射 `…→placed`、`paymentStatus: null`。
5. A.5 `yarn db:generate` → 迁移审阅（加列 + 默认值，无回填）。

### Phase B: UI 与词表渲染

6. B.1 建单/编辑表单：状态选项走 helper（+ 该行旧值）、新「是否已收款」字段（建单默认 `unpaid`）、payload/初值/回读。
7. B.2 「修改状态」对话框同 helper。
8. B.3 工作台：状态筛选/徽章用新词表 + 旧值配色；hub 抬头卡显示「是否已收款」。
9. B.4 i18n：7 个状态 + 2 个收款标签 + 表单/抬头标签（zh/en）。

### Phase C: 收口

10. C.1 单测（词表/三态/schema）+ 命令单测更新；集成 `company-orders` 更新（默认值、旧值可写可读可筛、`shipped`+`paid_full`）。
11. C.2 迁移应用到共享 dev 库（owner 既有指令：默认开发完毕即迁移）+ 主目录合并 + dev runtime 重启 + 浏览器实测
    （建单页、编辑旧行、hub 抬头、工作台筛选）。
12. C.3 宽门禁（`generate/typecheck/lint/ds:check/test/build`）+ 文档 + PR。

## Risks

- 两套标签并存 → 有意（旧行如实）；README/AC 写明“编辑一次即迁入新词表”。
- 与第五轮并行改 `order_hub` → 文件交集（README/spec/i18n/OrderDetail）；本单元改动刻意小、只追加锚点，冲突按“取并集”处理。
- 新列在迁移应用 + dev runtime 重启前写入会被静默丢弃 → 见 lesson `entity-property-needs-dev-runtime-restart`；收口步骤里显式重启。

## Evidence

- 单测：`yarn jest --config jest.config.cjs src/modules/order_hub` → **5 suites · 29 tests passed**（含新 `data/__tests__/validators.test.ts` 4 例）。
- 集成（ephemeral，生产模式 + 一次性库）：`JWT_SECRET=<random> yarn test:integration:ephemeral company-orders` → **7 passed**
  （默认 `placed`/`unpaid`、旧值可写可读可筛、`shipped`+`paid_full` 更新、版本锁、软删、跨组织不可见）。
- 宽门禁：`yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build` → 全绿（82 suites · 658 tests；lint 仅既有 warning）。
- 浏览器（主目录 dev，重启 runtime 后实测）：`/backend/orders/create` 状态下拉 = 这 7 个值（默认已下单）、是否已收款 = 已收全款/未收款（默认未收款）；
  建单 `CO-2026-0002` → hub 抬头 `已报关` + `是否已收款 已收全款`，DB 回读 `status='customs_declared', payment_status='paid_full'`；
  工作台徽章新词表（`已报关`）与旧值（`进行中`）并存。
- 迁移：`Migration20261009064750_order_hub.ts` 已由 dev supervisor（`yarn db:migrate`）应用到共享 dev 库；`information_schema` 回读
  `payment_status text null` 与 `status default 'placed'`。
- 注意（环境）：旧 dev runtime 由带 `CI=true` 的会话启动 → 诊断面板被禁用、且 MikroORM 元数据是启动时构建的，新增实体属性在重启前**写入被静默丢弃**
  （lesson `entity-property-needs-dev-runtime-restart`）。本轮已重启 dev runtime（`env -u CI yarn dev`，持久服务），诊断恢复可用。

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase A: 数据与写路径

- [x] A.1 Validators（词表 + 三态） — 7328c89
- [x] A.2 Entity（默认值 + 新列） — 7328c89
- [x] A.3 Commands（默认值/apply/undo/快照/自动建根） — 7328c89
- [x] A.4 Route + CLI — 7328c89
- [x] A.5 Migration generated + reviewed（`Migration20261009064750_order_hub.ts`：加列 + 默认值，无回填） — 7328c89

### Phase B: UI 与词表渲染

- [x] B.1 Create/edit form（默认 `placed`/`unpaid`；旧值行保留自身选项） — 7328c89
- [x] B.2 Status dialog — 7328c89
- [x] B.3 Workbench + hub header — 7328c89
- [x] B.4 i18n — 7328c89

### Phase C: 收口

- [x] C.1 Unit + integration tests（`jest src/modules/order_hub` 5 suites · 29 tests；ephemeral `company-orders` 7 passed） — f39df71
- [x] C.2 Migration applied + browser smoke — 220bfaf
- [x] C.3 Broad gate + docs + PR draft → ready — 220bfaf
