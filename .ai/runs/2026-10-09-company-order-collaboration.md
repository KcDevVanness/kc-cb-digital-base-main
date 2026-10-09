# 2026-10-09 — company-order-collaboration（第四轮：起手信息 + 建单即关联 + 协作组织 + 文件）

**Source doc:** `.ai/specs/2026-10-09-company-order-root.md` 的「第四轮」节（REQ-011…REQ-016）
**Base:** `feat/company-order-root`（PR #150，stacked——父 PR 合入 `dev` 后本 PR retarget 到 `dev`）
**PR:** 待开（draft → ready）

## Goal

owner 给出原飞书多维表格 35 列字段清单并定下三条口径（2026-10-09）：
① 建单抓起手信息——可选默认客户/供应商（作子单预填默认）+ 建单时直接关联已有销售/采购单；
② 「订单状态」支持协作组织白名单——被授权子公司可见并可改 状态/备注（其它只读）；
③ 未拆细的文件先以公司订单「文件」区块兜底（复用 installed `attachments`）。
已有模块承载的字段继续走关联读；「金额/单证汇总到公司订单视角」列为后续项（不在本轮）。

## Scope

- `order_hub`：4 列追加（默认客户/供应商）+ `order_hub_company_order_collaborators` 表、`create.links[]` 同事务落关联、`update` 字段白名单（协作者只写 status/notes）、列表读路径并入协作集、hub 抬头/协作对话框/文件区块、i18n。
- `internal_sales` / `purchasing`：两个表单的「默认客户/供应商」预填（字段为空时才填）。
- 共享件：`src/lib/attachments/AttachmentsSection.tsx`（本期只被文件区块使用）。
- 文档：spec 第四轮（已落）、模块 README、状态板/计划、架构决策（如口径变化需要）。

## Non-goals

- 不做「35 字段汇总到公司订单视角」（金额/单证并集列）——记录为后续项。
- 不改 `sales`/`trade_docs`/`cross_border`/`export_finance` 的既有链路与 schema。
- 文件区块不迁移其它模块既有附件实现（只新增共享件）。

## Implementation Plan

### Phase 4.A: 起手字段 + 建单即关联 + 子单预填默认（REQ-011/012/013）

1. 1.1 实体 4 列 + 校验器 + 迁移（yarn db:generate 探针）。
2. 1.2 命令：create 冻结主体快照 + 同事务落 `links`；update 主体验证与显式清空。
3. 1.3 建单/编辑表单：客户/供应商选择器 + 「关联已有单据」两个多选。
4. 1.4 子单预填默认（internal_sales / purchasing，字段为空才填、失败静默降级）。
5. 1.5 TEST-007（集成）+ 纯函数单测。

### Phase 4.B: 协作组织白名单（REQ-014/016）

6. 2.1 `collaborators` 表 + `order_hub.orders.collaborators.replace`。
7. 2.2 列表/汇总读路径并入协作集（`orgField: null` + `buildFilters` 自管 scope）。
8. 2.3 命令字段白名单（协作者只写 status/notes）。
9. 2.4 hub 协作对话框 + 协作者视图 + 工作台标记。
10. 2.5 TEST-008（集成）+ 浏览器段。

### Phase 4.C: 文件区块（REQ-015）

11. 3.1 `AttachmentsSection` 共享件 + hub「文件」区块（installed attachments）。
12. 3.2 TEST-009（集成）+ 浏览器段。

### Phase 4.D: 收口

13. 4.1 文档（README/spec 状态/状态板/计划/run record）。
14. 4.2 宽门禁（validation.commands 全跑）。
15. 4.3 PR（draft → ready；stacked 声明 + retarget 说明）。

## Risks

- 列表 scope 脱离 factory 单一组织过滤：`orgField: null` 后必须自管 scope（所有者 ∪ 协作）——集成测试三视角证明。
- 协作者越权写其它字段：服务端字段白名单强制，UI 隐藏只作 UX。
- 预填不得覆盖操作员手填；根单读取失败静默降级。
- 文件区块沿用 installed attachments 门禁（本模块不另造权限）。

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 4.A: 起手字段 + 建单即关联 + 子单预填默认（REQ-011/012/013）

- [ ] 1.1 Entities, validators, migration
- [ ] 1.2 Commands (snapshots + links-at-create + clear-to-null)
- [ ] 1.3 Create/edit form pickers + link section
- [ ] 1.4 Child-form default prefill
- [ ] 1.5 TEST-007 + unit helpers

### Phase 4.B: 协作组织白名单（REQ-014/016）

- [ ] 2.1 Collaborators table + replace command
- [ ] 2.2 Read paths merged with the collaborator set
- [ ] 2.3 Command field whitelist for collaborators
- [ ] 2.4 Hub dialog + collaborator view + workbench marker
- [ ] 2.5 TEST-008 + browser segment

### Phase 4.C: 文件区块（REQ-015）

- [ ] 3.1 AttachmentsSection + hub files block
- [ ] 3.2 TEST-009 + browser segment

### Phase 4.D: 收口

- [ ] 4.1 Docs
- [ ] 4.2 Broad gate
- [ ] 4.3 PR draft → ready
