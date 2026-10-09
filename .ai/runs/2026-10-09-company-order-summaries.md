# 2026-10-09 — company-order-summaries（第五轮：35 列汇总 + 附件协作可见 + 草稿单据可选）

**Source doc:** `.ai/specs/2026-10-09-company-order-root.md` 的「第五轮」节（REQ-017…REQ-019）
**Base:** `dev`（8905b6b，前四轮已合入）
**PR:** 待开（draft → ready）

## Goal

owner 2026-10-09 确认实作三件（第 4 项「订单描述长文本」不做）：

1. **35 列汇总到公司订单视角**：金额（按币种，销售/采购/定金/已付/应付）、日期（下单/预计交货/出运）、单据号（含 INV.NO）、发运层级单证按 `doc_type` 计数、采购水单及发票条数、收汇/退税（状态与金额）、KC 盖章；hub 的「全字段」入口渲染它，工作台补金额列。
2. **附件协作可见**：协作组织能列出/预览/下载所有者名下的文件（order_hub 侧代理路由按根单可见性授权）；上传/删除仍 owner-only。
3. **草稿单据可选**：建单表单与关联对话框的采购选择器在按单号搜不到时按供应商名/id 前缀回退，让**无号草稿**可被选到。

## Scope

- `order_hub`：`lib/companyOrderFields.ts`（新只读投影）、`api/orders/fields/route.ts`、`api/orders/attachments/route.ts` + `api/orders/attachments/[id]/route.ts`、`lib/orderStages.ts`（`amounts` 追加）、`components/companyOrderOptions.ts`、`components/{OrderDetail,OrderFieldsDrawer,CompanyOrderLinkDialog}.tsx`、i18n。
- 文档：本 run record、spec 第五轮、模块 README、状态板/计划行。

## Non-goals

- 不做「订单描述长文本」（owner 明确）。
- 不做跨币种换算/加总（按币种分组；CNY 折算仍由既有组件负责）。
- 不改 installed `attachments` 的契约（只新增本模块的只读代理路由；上传/删除仍走 installed）。
- 无 schema 变更、无迁移。

## Implementation Plan

### Phase 5.A: 35 列汇总（REQ-017）

1. 1.1 `lib/companyOrderFields.ts` 投影（scoped，照 `orderStages.ts` 的跨模块只读法）。
2. 1.2 `GET /api/order_hub/orders/fields?companyOrderId=`（`order_hub.view`；owner/协作可见，否则空对象）。
3. 1.3 `stages` 追加 `amounts`（按币种）；工作台金额列。
4. 1.4 hub「全字段」渲染分组（订单 / 金额与日期 / 单证与文件 / 财务）。
5. 1.5 TEST-011（集成）+ 纯函数单测（分组/币种聚合）。

### Phase 5.B: 附件协作可见（REQ-018）

6. 2.1 `GET /api/order_hub/orders/attachments`（列表，按根单可见性）。
7. 2.2 `GET /api/order_hub/orders/attachments/[id]`（字节代理，先反查根单再校验）。
8. 2.3 文件区块改用本模块列表/字节路由（上传保持 installed；协作组织隐藏写入口）。
9. 2.4 TEST-012（集成：owner/协作/无关三视角 + 字节一致）。

### Phase 5.C: 草稿单据可选（REQ-019）

10. 3.1 loader 合并（无 search 第 1 页 + 带 search 第 1 页）+ 客户端回退过滤（单号/供应商名/id 前缀）。
11. 3.2 TEST-013（单测：合并去重、无号草稿命中、空输入）。

### Phase 5.D: 收口

12. 4.1 浏览器实测（全字段入口 / 协作组织看文件 / 建单选无号草稿）。
13. 4.2 文档（README/spec/状态板/计划）+ 宽门禁。
14. 4.3 PR draft → ready。

## Risks

- 字节代理绕开 installed 组织作用域 → 授权只放给根单可见方；按记录反查根单；不改 installed 契约。
- 汇总读放大 → 每段一次 scoped 批量查询，沿用既有上限。
- 回退过滤放宽选择面 → 仍以 loader 结果为全集，去重后按字段匹配，不引入跨组织数据。

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 5.A: 35 列汇总（REQ-017）

- [x] 1.1 Projection — 0f89ddf
- [x] 1.2 Fields route — 0f89ddf
- [x] 1.3 `amounts` on stages + workbench column — 0f89ddf / a94aa74
- [x] 1.4 Hub full-fields rendering — a94aa74
- [x] 1.5 TEST-011 + unit tests — df5ed71 / 6d18605

### Phase 5.B: 附件协作可见（REQ-018）

- [ ] 2.1 Attachments list route
- [ ] 2.2 Byte proxy route
- [ ] 2.3 Files block rewiring
- [ ] 2.4 TEST-012

### Phase 5.C: 草稿单据可选（REQ-019）

- [x] 3.1 Loader merge + fallback filter — 6d18605
- [x] 3.2 TEST-013 — 6d18605

### Phase 5.D: 收口

- [ ] 4.1 Browser smoke
- [ ] 4.2 Docs + broad gate
- [ ] 4.3 PR draft → ready
