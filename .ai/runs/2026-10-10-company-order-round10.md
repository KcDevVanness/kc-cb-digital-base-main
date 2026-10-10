# 2026-10-10 — company-order-round10（根单持有字段 / 采购单明细回退 / 供应商产品库 Excel 导入）

**Source doc:** `.ai/specs/2026-10-09-company-order-root.md` 的「第十轮」节（REQ-040…REQ-046）
**Base:** `origin/dev`（`caa5598`）
**Branch:** `feat/company-order-round10`（worktree `../kc-cb-digital-base-min-co-round10`）
**PR:** 待开（draft 先行）

## Goal

owner 2026-10-10 对五个页面的 12 点设计反馈落地；当日问答定下七条口径（见 spec 第十轮「背景」）：

1. **根单持有（通用规则）**：「订单描述」「采购负责人」统一由公司订单持有；关联处只读、修改跳回根单；同类面一并审计。
2. 订单描述字典复用 `product_category`。
3. 预付款/尾款 = **实际口径**（已登记 deposit / balance 阶段合计）。
4. hub 抬头「供应商」：根单优先，空则取采购单。
5. 采购单详情**只撤三个关联区块**（发运单 `?purchaseOrderId=` 过滤保留）。
6. 供应商产品库：现在做 **Excel 上传 + 解析骨架**（AI/PDF 后续）。
7. 迁移生成并**在本地开发库应用**。

逐条对应：

| 反馈 | 落点 |
|---|---|
| hub 抬头新增「订单描述」（item 1） | REQ-040：根单加 `product_category` + 抬头只读格 + 表单选择器 |
| 工作台「金额」→「订单金额」，映射采购单金额（item 2） | REQ-042：列名 + 取值采购优先 |
| hub 采购行显示订单金额 / 预付款 / 尾款（item 3） | REQ-043：采购单列表投影 + hub 批量读 |
| hub 抬头「供应商」锚定采购单（item 4） | REQ-040：根单优先、空则回退采购行 |
| hub 采购区新增「采购负责人」（人员账号，item 5） | REQ-040/041：根单持有 + 采购单镜像只读 |
| 采购单列表列名/新增三列（item 6） | REQ-044 |
| 采购单详情撤三区块（item 7/8/9） | REQ-045 |
| 采购单详情「订单描述/采购负责人」不再单独入口（item 10） | REQ-041：表单去掉两字段、详情只读 + 跳回根单 |
| 供应商产品库预留 AI 导入入口（item 11） | REQ-046：Excel 上传 → 解析 → 复核 → 导入 |
| 采购单列表与工作台互相关联快速跳转（item 12） | REQ-044：行操作「打开公司订单」 |

## Scope

- `order_hub`：根单三列（`product_category`/`owner_user_id`/`owner_snapshot`）+ 迁移、表单两字段、抬头两格与供应商回退、采购行三金额、工作台金额口径、镜像事件发布、i18n/README/单测。
- `purchasing`：列表列与行操作、详情回退三区块与两字段只读、表单去两字段、`paidDeposit`/`paidBalance` 投影、镜像订阅者、供应商产品库 Excel 导入（lib/命令/路由/向导）、i18n/README/测试。
- `sourcing`：仅共享件搬迁的引用更新（`lib/workbook.ts` → `src/lib/workbook`）。
- 共享：`@/lib/workbook`（新）、`@/lib/dictionaries/codeListOptions`（新，由 purchasing 迁出）。
- 文档：spec 第十轮、本 run record、`docs/plans/cross-border-erp.md` 行、`docs/plans/README.md` 状态板、两个模块 README。

## Non-goals

- 不恢复 `order_product_category` 字典；不动 `cross_border` 的 `?purchaseOrderId=` 过滤与集成 spec（owner 口径：只撤 UI 区块）。
- 不做 PDF 与 AI 列映射（导入骨架只到 Excel；入口留扩展位）。
- 不改采购单 create/update 命令契约（字段仍在 schema 内，UI 不再发送）。
- 不做订单树之外其它模块的「重复入口」改造（审计结论：本轮只有采购单两字段同类）。

## Implementation Plan

### Phase 10.A: order_hub 根单字段与显示

- [ ] 1.1 实体/校验/API 三字段 + 迁移
- [ ] 1.2 公司订单表单两字段 + hub 抬头两格 + 供应商回退
- [ ] 1.3 采购行三金额（批量读）+ 工作台「订单金额」采购优先
- [ ] 1.4 镜像事件发布（create/update/links.replace/link-child）

### Phase 10.B: purchasing 台账

- [ ] 2.1 列表列改造 + `paidDeposit`/`paidBalance` 投影
- [ ] 2.2 行操作「打开公司订单」
- [ ] 2.3 详情撤三区块 + 两字段只读 + 跳回根单
- [ ] 2.4 表单去两字段 + 死代码清理 + 镜像订阅者
- [ ] 2.5 README/i18n/测试

### Phase 10.C: 供应商产品库 Excel 导入

- [ ] 3.1 解析库（别名/表头探测/行构建）+ 单测
- [ ] 3.2 命令 + 两个路由（parse/import）
- [ ] 3.3 三步向导 + 列表页入口 + i18n

### Phase 10.D: 收口

- [ ] 4.1 迁移在本地开发库应用 + 宽门禁
- [ ] 4.2 浏览器实测（五个页面逐点）
- [ ] 4.3 文档（spec/README/计划/状态板）
- [ ] 4.4 PR draft → ready

## Risks

- 镜像订阅者写失败 → 采购侧与根单不一致：幂等覆盖写、失败只记日志；采购详情保留跳回根单入口。
- 并发三个切片共享 purchasing 的 i18n/README：由父 agent 合并键与小节，冲突在收口时处理。
- 导入行校验与手填口径不一致：逐行复用 create schema；失败附原因。

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 10.A: order_hub 根单字段与显示

- [x] 1.1 实体/校验/API 三字段 + 迁移（`Migration20261010025411_order_hub.ts`；本地开发库已由 dev supervisor 应用）
- [x] 1.2 公司订单表单两字段 + hub 抬头两格 + 供应商回退（`CompanyOrderForm.tsx` / `OrderDetail.tsx` / `companyOrderDisplay.ts`）
- [x] 1.3 采购行三金额（`?ids=` 批量读，按 100 分页）+ 工作台「订单金额」采购优先（`OrderWorkbench.tsx`）
- [x] 1.4 镜像事件发布（create/update/links.replace/link-child；`events.ts` 声明 `order_hub.company_order.order_fields_updated`）

### Phase 10.B: purchasing 台账

- [x] 2.1 列表列改造 + `paidDeposit`/`paidBalance` 投影（`api/purchase-orders/route.ts` 的 `afterList` + `lib/orderTotals.ts` 的 `stagePaidTotals`）
- [x] 2.2 行操作「打开公司订单」（`PurchaseOrdersTable.tsx`；未关联/403 → 置灰提示）
- [x] 2.3 详情撤三区块 + 两字段只读 + 跳回根单（`PurchaseOrderDetail.tsx`；来源单号回到抬头摘要格）
- [x] 2.4 表单去两字段 + 死代码清理（`purchaseOrderQuickEdit.ts` 删除）+ 镜像订阅者（`subscribers/mirror-root-order-fields.ts`）
- [x] 2.5 README/i18n/测试

### Phase 10.C: 供应商产品库 Excel 导入

- [x] 3.1 解析库（别名/表头探测/行构建）+ 单测（`lib/supplierProductExcelImport/**`）
- [x] 3.2 命令 + 两个路由（`commands/supplierProductImport.ts`、`api/supplier-products/excel-import{,/parse}/route.ts`）
- [x] 3.3 三步向导 + 列表页入口 + i18n（`SupplierProductImportDialog.tsx`；必填列在映射步拦截）

### Phase 10.D: 收口

- [x] 4.1 迁移在本地开发库应用（dev supervisor 启动时 `order_hub: 1 migration applied`）+ 宽门禁
- [x] 4.2 浏览器实测（五个页面逐点，见下）
- [x] 4.3 文档（spec 第十轮 + 状态/Changelog、`order_hub`/`purchasing`/`sourcing` README、计划行 六·补60、状态板、`business-architecture` 决策行、lesson）
- [ ] 4.4 PR draft → ready

## Evidence（实现期实测，2026-10-10）

- **宽门禁**（`yarn generate && yarn typecheck && yarn lint && node scripts/check-lessons.mjs && yarn ds:check && yarn test && yarn build`）：全部通过——typecheck 0 error；lint 0 error（12 条既有 warning）；`ds:check` 1106 files passed；`yarn test` **92 suites · 822 tests passed**；`yarn build` 成功（`yarn generate` 277 API paths）。
- **浏览器实测**（dev server 本 worktree，http://localhost:3000）：
  1. `/backend/orders`：列名「订单金额」，`CO-2026-0004` 行 = `¥2,000.00`（采购金额优先）。
  2. `/backend/orders/<id>`：抬头 8 格（订单描述/采购负责人/客户/供应商/是否已收款/…），供应商回退 = `CI E2E supplier mumhx0rr`；采购行 = 订单金额 ¥2,000.00 / 预付款金额 ¥0.00 / 尾款金额 ¥0.00。
  3. 编辑公司订单存「订单描述 = CL — 猫砂、采购负责人 = employee@acme.com」→ hub 抬头回读一致；DB 回读 `PO-2026-0008` 的 `product_category/owner_user_id/owner_snapshot` 已被镜像。
  4. `/backend/purchasing/orders`：列 = 单号/供应商/状态/订单金额/预付款金额/尾款金额/预计交货日期/操作；`PO-2026-0008` 行操作「打开公司订单」→ `/backend/orders/e9ad342f…`；未关联的 `PO-2026-0009` → 置灰「未关联公司订单」（不跳转）。
  5. `/backend/purchasing/orders/<PO-2026-0008>`：无三个关联区块；「订单描述 CL — 猫砂 + 去公司订单修改 → 根单」；编辑页无这两格。
  6. 从根单「新建」采购单（预填来源销售订单）→ 建档后详情 = 「来源销售订单 ORDER-20260929-00007 → /backend/internal-sales/orders/d245512a…」+ 两字段镜像就位；hub 采购行出现该单（三金额 ¥100.00/0.00/0.00）。实测后已「移除」该关联并删除该草稿单，根单回到一张采购单。
  7. `/backend/purchasing/supplier-products`：「Excel 导入」→ 选供应商 + 上传 9 列表 → 表头第 1 行、9/9 列映射（精确 + 别名）→ 预览 → 「成功导入 2 行」；库里 `SMOKE-IMP-SKU-1/2` 字段齐（货号/中英品名/PCS/装箱/MOQ/折扣 5·空）。缺「商品 SKU/品名」的表在映射步被拦（提交禁用 + 提示），接口层同样按行拒绝。
- **实现期自修**：hub 的采购金额批量读原先按 `pageSize: 200` 问（`purchasing/purchase-orders` 上限 100 → 400 被静默吞掉、金额全显示「—」），改为 100 分页并写进 `.ai/lessons/option-loaders-must-respect-page-size-caps.md`。
- **留验（写进 PR Assumptions）**：导入行沿用 create 契约 → `source` 记 `manual`（未扩枚举）；单价列本轮不导入（价格类型 × 币种 × 起订量另有二维）；只读第一个工作表。
