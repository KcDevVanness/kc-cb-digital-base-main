# 2026-10-09 — order-hub-layout-preview（第六轮：板块布局 / 关联预览 / 回到订单）

**Source doc:** `.ai/specs/2026-10-09-company-order-root.md` 的「第六轮」节（REQ-020…REQ-027）
**Base:** `feat/company-order-summaries`（第五轮，stacked；本分支是其 stack child，父 PR 合入后改基 `dev`）
**PR:** 待开（draft → ready）

## Goal

owner 2026-10-09 八点反馈落地：

1. 对内/对外销售订单不再各占一个区块 —— 合并为「出口销售」区块，行级徽标区分（单据与通道标记不变）。
2. 采购单「订单描述」改读字典库「Product categories」（`product_category`），弃用模块私有 `order_product_category`。
3. 公司订单表单去掉「标题」输入（字段与历史值保留）。
4. 抬头「默认客户/默认供应商」改称「客户/供应商」。
5. hub 按 采购 / 出口销售 / 合同与单据 / 发运与装箱 四板块分区（与导航树同构）+ 收汇·退税 / 文件。
6. 已关联/下游记录「点开」= 右侧只读预览抽屉；编辑是独立按钮。
7. hub 跳出的模块页面「返回」回到该订单页（`?returnTo=` 白名单）。
8. 工作台「全字段」展示数据分组（第五轮投影），无关联分组显式「未关联」。

## Scope

- `order_hub`：`components/OrderDetail.tsx`（板块 + 合并销售 + 预览接线 + returnTo 生成）、新 `components/LinkedRecordPreviewDrawer.tsx` + `linkedRecordPreviewSources.tsx`、`components/CompanyOrderForm.tsx`（标题）、`i18n/*`。
- `src/lib/navigation/returnTo.ts`（新共享件）+ 单测。
- 目标页 `returnTo` 消费：`purchasing`（详情/编辑）、`internal_sales`（编辑）、`trade_docs`（合同详情、单据/发票表单）、`cross_border`（发运详情、装箱单）、`export_finance`（收汇/退税档案）。
- `purchasing`：字典 key 切换 + 停止播种 `order_product_category`；`export_finance` 投影补标签。
- 文档：本 run record、spec 第六轮、模块 README、状态板/计划行。

## Non-goals

- 不改 `order_hub_company_order_links` 的 kind 模型与通道标记（对内/对外仍是两种单据）。
- 无 schema 变更、无迁移；不动 installed `attachments` 契约。
- 不做公司订单的字段级权限/协作语义变更（沿用第四轮）。

## Implementation Plan

### Phase 6.A: hub 板块布局与出口销售合并（REQ-020, REQ-024）

- [ ] 1.1 板块标题（采购/出口销售/合同与单据/发运与装箱/收汇·退税/文件）+ 锚点
- [ ] 1.2 合并销售区块（行徽标 对内/对外；关联对话框带种类选择；新建弹两类入口）

### Phase 6.B: 关联预览抽屉（REQ-025, REQ-027）

- [ ] 2.1 `LinkedRecordPreviewDrawer`（复用 `SourcePreviewDrawer`）+ 各 kind 读法与字段映射
- [ ] 2.2 hub 行接线：点开=预览、「编辑」=模块页（带 returnTo）
- [ ] 2.3 全字段抽屉的分组空态

### Phase 6.C: 返回、表单与字典（REQ-021…REQ-023, REQ-026）

- [ ] 3.1 共享 `readReturnTo`/`useReturnHref` + 单测（TEST-015）
- [ ] 3.2 目标页消费 `?returnTo=`（purchasing/internal_sales/trade_docs/cross_border/export_finance）
- [ ] 3.3 订单描述改读 `product_category` + 显示标签解析
- [ ] 3.4 表单去「标题」；抬头标签改名

### Phase 6.D: 收口

- [ ] 4.1 目标测试（jest 相关套 + 新增单测）
- [ ] 4.2 浏览器实测（分区/预览/返回/全字段/字典选项）
- [ ] 4.3 文档 + 宽门禁
- [ ] 4.4 PR draft → ready

## Risks

- `returnTo` 开放跳转 → 白名单校验（仅 `/backend/` 同站路径）+ 单测。
- 合并区块削弱类型清晰度 → 行徽标 + 显式类型选择；入口页保留。
- 字典切换后存量代码不可解析 → 回退显示原值（本库采购单该字段为空）。
- 与父分支（第五轮，进行中）同文件 → 本分支以其为基，收口时 rebase 到父分支最新头。

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 6.A: hub 板块布局与出口销售合并（REQ-020, REQ-024）

- [x] 1.1 板块标题 + 锚点
- [x] 1.2 合并销售区块

### Phase 6.B: 关联预览抽屉（REQ-025, REQ-027）

- [x] 2.1 `LinkedRecordPreviewDrawer` + 来源映射
- [x] 2.2 hub 行接线
- [x] 2.3 全字段抽屉分组空态（第五轮投影已给数据分组，本轮浏览器验证 + 抽屉「明细行」空段修复）

### Phase 6.C: 返回、表单与字典（REQ-021…REQ-023, REQ-026）

- [x] 3.1 共享 returnTo 助手 + 单测
- [x] 3.2 目标页消费 `?returnTo=`
- [x] 3.3 订单描述字典
- [x] 3.4 表单去标题 + 标签改名

### Phase 6.D: 收口

- [x] 4.1 目标测试（`yarn jest` 84 suites · 681 tests；`yarn typecheck` 干净；`yarn lint` 0 error；`yarn ds:check` 1088 files）
- [x] 4.2 浏览器实测（六板块 / 合并销售区块双边徽标 / 预览抽屉 / 返回回到订单页 / 伪造 returnTo 回退 / 建单页无标题 / 订单描述 = Product categories / 工作台全字段分组）
- [x] 4.3 文档（spec 第六轮 + README + 状态板 + 计划行 + lesson）+ 宽门禁
- [x] 4.4 PR draft → ready
