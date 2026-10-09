# 2026-10-09 — company-order-document-slots（第七轮：字段级附件槽位）

**Source doc:** `.ai/specs/2026-10-09-company-order-root.md` 的「第七轮」节（REQ-020…REQ-025）
**Base:** `dev`（603dd77）
**PR:** 待开

## Goal

owner 2026-10-09 反馈：第五轮的「文件」区块太笼统——35 列的每个单据字段（KC 盖章、报关单、电放提单、水单、涉外收入证明……）没有一一对应的附件位。本轮按「新表 + 关联」给**每个单据字段一个槽位**：

1. 新表 `order_hub_company_order_documents`：一行 = 根单某槽位下的一个文件（文件本体仍存 installed `attachments`，行 id 就是它的 `recordId`）。
2. 槽位 API：列表（根单可见性）/ 登记（仅所有者）/ 删除（仅所有者）；上传本体仍走 installed `POST /api/attachments`。
3. 字节代理支持槽位附件（`order_hub:company_order_document`）。
4. 汇总按槽位（`documents.bySlot`）与本单文件 + 子单来源徽标；抽屉按槽位渲染。
5. hub「单据与附件」区块（新组件 `OrderDocumentsSection.tsx`），「其他文件」通用区保留。

## Scope

- `src/modules/order_hub/`：`data/{entities,validators}.ts`、`commands/**`、`api/orders/documents/**`、`api/orders/attachments/[id]/route.ts`（扩展）、`lib/companyOrderFields.ts`、`components/OrderDocumentsSection.tsx`、`components/OrderDetail.tsx`、`components/OrderFieldsDrawer.tsx`、i18n、集成/单测。
- 迁移（1 张新表 + 唯一键 + 索引）：`yarn db:generate` 生成、审阅、提交、**不应用**。
- 文档：本 run record、spec 第七轮、模块 README、状态板/计划行。

## Non-goals

- 不把子单事实搬进槽位（合同盖章、发运单证、收汇档案仍归各模块；槽位只是本单层的落点 + 来源徽标）。
- 不改 installed `attachments` 契约与分区/配额规则。
- 不做「其他」槽位（沿用根单通用文件区）。

## Implementation Plan

### Phase 7.A：数据与 API（REQ-020…REQ-022、REQ-025）

- 7.A.1 迁移生成 + 审阅（新表/唯一键/索引）。
- 7.A.2 校验器（登记输入、槽位枚举引用）+ 命令 `order_hub.orders.documents.attach`/`detach`（所有权、租户校验、事件、缓存失效、可撤销）。
- 7.A.3 路由：`GET|POST|DELETE /api/order_hub/orders/documents`（可见性/所有权）。
- 7.A.4 字节代理扩展（`order_hub:company_order_document` → 槽位行 → 根单 → 可见性）。
- 7.A.5 集成 TEST-015（槽位全链路 + 三视角）；单测 TEST-017（校验）。

### Phase 7.B：汇总与 UI（REQ-023、REQ-024）

- 7.B.1 `documents.bySlot`（本单文件 + 子单来源信号；既有布尔字段保留）。
- 7.B.2 `OrderDocumentsSection.tsx` + hub 接线（槽位行：文件 chips/上传/预览/下载/删除；来源徽标；「其他文件」保留）。
- 7.B.3 抽屉「单证与文件」按槽位渲染。
- 7.B.4 i18n（槽位标签、区块文案，双语言扁平键）。
- 7.B.5 集成 TEST-016（bySlot 与子单来源共存）。

### Phase 7.C：收口

- 7.C.1 浏览器实测（TEST-018：槽位上传/预览/下载/删除、抽屉、协作者只读）。
- 7.C.2 宽门禁 + 文档（README/spec/状态板）+ PR。

## Risks

- 与在飞单元 #152/#154 在 spec/i18n/hub 组件上冲突 → UI 收敛进新组件；PR 披露。
- 孤儿附件（先删行后删文件失败）→ 无 UI 引用，README 记录。
- 槽位与子单来源重复展示 → 以来源徽标区分，不合并。

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 7.A：数据与 API

- [ ] 7.A.1 Migration
- [ ] 7.A.2 Validators + commands
- [ ] 7.A.3 Documents routes
- [ ] 7.A.4 Byte proxy extension
- [ ] 7.A.5 TEST-015 + TEST-017

### Phase 7.B：汇总与 UI

- [ ] 7.B.1 `bySlot` projection
- [ ] 7.B.2 Documents section + hub wiring
- [ ] 7.B.3 Drawer by slot
- [ ] 7.B.4 i18n
- [ ] 7.B.5 TEST-016

### Phase 7.C：收口

- [ ] 7.C.1 Browser smoke (TEST-018)
- [ ] 7.C.2 Broad gate + docs + PR
