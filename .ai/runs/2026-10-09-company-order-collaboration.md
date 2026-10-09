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

- [x] 1.1 Entities, validators, migration — 1b9442f（`Migration20261009044102_order_hub.ts`：仅 4 列追加，snapshot 同步；未应用）
- [x] 1.2 Commands (snapshots + links-at-create + clear-to-null) — 1b9442f（主体解析+冻结、`links` 同事务落关联；422 码 `customer_party_not_found`/`supplier_not_found`/`link_not_found`/`duplicate_link`；Party 名走 `findOneWithDecryption`，供应商走 scoped 直读）
- [x] 1.3 Create/edit form pickers + link section — d002fb7（客户/供应商 combobox + `resolveLabel`；两个搜索多选，仅建单）
- [x] 1.4 Child-form default prefill — 6fe4130（采购表单填供应商；销售表单填客户名，买方引用仅对外类型——对内买方是兄弟组织）
- [x] 1.5 TEST-007 + unit helpers — d0473de / 0e09e85。证据：`yarn typecheck` 干净；focused jest **6 suites · 34 tests**；`company-order-create-fields` **4/4 passed**；order_hub 全量集成 **22/22 passed**（含既有 18）；`yarn db:generate` 复跑 `order_hub: no changes`。

### Phase 4.B: 协作组织白名单（REQ-014/016）

- [x] 2.1 Collaborators table + replace command — 000d337（`order_hub_company_order_collaborators`：唯一 `(company_order_id, organization_id)` + 反查索引 + FK 级联；`order_hub.orders.collaborators.replace` owner-only、去重、排除根单自组织、未知组织 422、根 `updatedAt` 乐观锁；事件 `collaborators.updated` + 缓存失效）
- [x] 2.2 Read paths merged with the collaborator set — 000d337 + 本轮修复：订单/链接列表改为**显式可见 id 集**（`organization_id ∈ 我的可见组织集` 或我是其协作组织的根单），`stages` 的根读同法、子投影用「可见根单所有者组织 ∪ 我的组织」；实测引擎在「顶层 `id` 过滤 + `$or` 子树」并存时 OR 组不再匹配 → 落地为 id 集形态（规格原记的 contingency）
- [x] 2.3 Command field whitelist for collaborators — 000d337（`COLLABORATOR_WRITABLE_FIELDS` = id/updatedAt/status/notes；其它键 422 `collaborator_field_not_allowed`；delete/links.replace/collaborators.replace/link-child 对既有根 403 `company_order_owner_required`）
- [x] 2.4 Hub dialog + collaborator view + workbench marker — b6cce5d（`CompanyOrderCollaboratorsDialog`（组织多选 + 成套替换 + 409 冲突条）；协作者视图只留「修改状态与备注」；工作台「协作」徽标）
- [x] 2.5 TEST-008 + browser segment — `company-order-collaborators.spec.ts` **4/4 passed**（分支可见 + 徽标；协作者写 status 200 / 写 title 422 / delete 403；成套替换 + 409；未知组织 422）
- 实现期修复（本轮）：① `stages` 投影里 `childOrganizationIds` 在声明前被使用 → 运行时 ReferenceError → `/api/order_hub/stages` 500（改为先读协作根单再读根单）；② 集合 scope 的 `$or` 形态在引擎里与顶层 `id` 过滤冲突（协作者 search/`?ids=` 读全空）→ 改为显式 id 集；③ **跨组织缓存失效**：CRUD 列表缓存按组织打标签，`collaborators.replace` 原先只失效所有者组织，协作者会继续看到缓存的空页 → 失效入参扩为「所有者组织 + 协作组织（含被移除的）」，update/delete/links 各写路径统一带 `rootInvalidationOrganizations`（helper 读取；失败仅退化为 TTL）。

### Phase 4.C: 文件区块（REQ-015）

- [x] 3.1 AttachmentsSection + hub files block — b6cce5d（app 级共享件 `src/lib/attachments/AttachmentsSection.tsx`；hub 区块锚点 `files`，`entityId='order_hub:company_order'` + 根单 id；上传/列表/预览/下载/删除，区块级失败隔离）
- [x] 3.2 TEST-009 + browser segment — `company-order-files.spec.ts` **1/1 passed**（上传 → 列表含该件 → 删除后不含）
- 一致性修正（规格第四轮「写路径」节已记）：**一个子单只属于一张公司订单** —— `create.links[]` 与 `links.replace` 把子单从其它根**移动**过来（同事务删除其它根关联行并失效其缓存/发事件）；`link-child` 带显式目标沿用幂等（返回现有根）。`company-order-create-fields` 的旧断言（422 `link_already_attached`）改写为移动语义；`company-order-links` 增「attaching a child that already sits on another root moves it」回归。

### Phase 4.D: 收口

- [ ] 4.1 Docs
- [ ] 4.2 Broad gate
- [ ] 4.3 PR draft → ready
