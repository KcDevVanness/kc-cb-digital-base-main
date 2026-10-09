# 2026-10-09 — company-order-document-slots（第七轮：字段级附件槽位）

**Source doc:** `.ai/specs/2026-10-09-company-order-root.md` 的「第七轮」节（REQ-022…REQ-027）
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

### Phase 7.A：数据与 API（REQ-022…REQ-024、REQ-027）

- 7.A.1 迁移生成 + 审阅（新表/唯一键/索引）。
- 7.A.2 校验器（登记输入、槽位枚举引用）+ 命令 `order_hub.orders.documents.attach`/`detach`（所有权、租户校验、事件、缓存失效、可撤销）。
- 7.A.3 路由：`GET|POST|DELETE /api/order_hub/orders/documents`（可见性/所有权）。
- 7.A.4 字节代理扩展（`order_hub:company_order_document` → 槽位行 → 根单 → 可见性）。
- 7.A.5 集成 TEST-017（槽位全链路 + 三视角）；单测 TEST-019（校验）。

### Phase 7.B：汇总与 UI（REQ-025、REQ-026）

- 7.B.1 `documents.bySlot`（本单文件 + 子单来源信号；既有布尔字段保留）。
- 7.B.2 `OrderDocumentsSection.tsx` + hub 接线（槽位行：文件 chips/上传/预览/下载/删除；来源徽标；「其他文件」保留）。
- 7.B.3 抽屉「单证与文件」按槽位渲染。
- 7.B.4 i18n（槽位标签、区块文案，双语言扁平键）。
- 7.B.5 集成 TEST-018（bySlot 与子单来源共存）。

### Phase 7.C：收口

- 7.C.1 浏览器实测（TEST-020：槽位上传/预览/下载/删除、抽屉、协作者只读）。
- 7.C.2 宽门禁 + 文档（README/spec/状态板）+ PR。

## Risks

- 与在飞单元 #152/#154 在 spec/i18n/hub 组件上冲突 → UI 收敛进新组件；PR 披露。
- 孤儿附件（先删行后删文件失败）→ 无 UI 引用，README 记录。
- 槽位与子单来源重复展示 → 以来源徽标区分，不合并。

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 7.A：数据与 API

- [x] 7.A.1 Migration — 9cd123e
- [x] 7.A.2 Validators + commands — 9cd123e, 67040ca
- [x] 7.A.3 Documents routes — d5ee172
- [x] 7.A.4 Byte proxy extension — d5ee172
- [x] 7.A.5 TEST-017 + TEST-019 — 484e424, 9cd123e

### Phase 7.B：汇总与 UI

- [x] 7.B.1 `bySlot` projection — 9652852, 4d33cdf（修复无号盖章合同漏计 + fields OpenAPI 补 `bySlot`）
- [x] 7.B.2 Documents section + hub wiring — d422155
- [x] 7.B.3 Drawer by slot — d422155
- [x] 7.B.4 i18n — fedc8c3
- [x] 7.B.5 TEST-018 — 27781f8

### Phase 7.C：收口

- [x] 7.C.1 Browser smoke (TEST-020)（见下）
- [ ] 7.C.2 Broad gate + docs + PR

## Evidence

- **集成（ephemeral，`--keep --filter order_hub`）**：**42 passed**（含 TEST-017 六项：登记/列表元数据/重复 409/非本单附件 422/代理字节/删除/协作只读/无关组织；TEST-018 bySlot 本单文件 + 子单来源）。
- **单测**：`data/__tests__/companyOrderDocuments.test.ts` 7 passed；`lib/__tests__/documentSlots.test.ts`；模块合计 7 suites · 43 tests；i18n 2 suites · 7 tests。
- **浏览器实测（ephemeral，admin@acme.com + 协作账号）**：
  - hub「Document files」逐槽位 10 行：每行独立「Upload」；已上传行显示文件 chips（名/大小/时间 + Preview/Download/Delete，删除有确认对话框）。
  - 把 `co7-packing.txt` 上传到 **Packing list (PL)** 槽位 → 该行立即可见（名/大小/时间）；确认删除 → 该行回到「Not uploaded on this order」，服务端列表从 3 行回到 2 行。
  - 「All fields」抽屉按槽位显示：`Customs declaration → On this order · customs-declaration.txt · 2026-10-09`、`KC invoice stamp → On this order · kc-stamp.txt`，其余槽位「Not uploaded on this order」。
  - 协作账号（`partner@slots-smoke.test`，仅 `order_hub.view`）：槽位文件可见、**0 个 Upload 按钮**、下载链接指向代理；字节 sha 与所有者一致（`0a5a31e4…`）；登记/删除 → **403**。
  - 「Other files」通用区保留。
- **实现期修复**：无号草稿合同已盖章但无单号时，KC 槽位的合同来源被漏计（原实现只在有单号时入列）——改为按盖章存在计数（TEST-018 抓到，4d33cdf）。
