# 2026-10-09 — company-order-root（公司订单根单化：新实体 + 关联表 + 工作台/详情重构 + 全量补录）

**Source doc:** `.ai/specs/2026-10-09-company-order-root.md`（owner 2026-10-09 选定「容器根单 + 全量补录」）
**Base:** `dev`（local，含 PR #147/#149 已并入的提交）；本单元取代 `.ai/specs/2026-10-08-order-centric-entry.md` 的工作台/详情口径（该文件 Status/Changelog 已标注）。
**PR:** 待开（draft → ready）

## Goal

owner 反馈（2026-10-09 01:49）：「不复用既有列表的 UI/服务端聚合，完全新增一个表存数据，用表的数据关联构成功能模块；点击工作台订单 item 不应直接跳采购单模块 item；要像购销合同（`/backend/trade-docs/contracts/<id>`）一样关联式填入不同模块的数据。」

实现：新增 `order_hub_company_orders`（根单）+ `order_hub_company_order_links`（关联表，冻结快照）；工作台每行 = 公司订单、点进 `/backend/orders/<companyOrderId>`；公司订单页给出 对内销售订单 / 对外销售订单 / 采购订单 三个可写关联区块（关联对话框 + 预填新建 + 移除）与五个下游只读区块（购销合同/单据/发运单/装箱单/收汇·退税，按子单并集）；`?companyOrderId=` 预填接入 internal_sales / purchasing；旧 `/backend/orders/<salesOrderId>` 经关联表解析归位；历史渠道内销售单 1:1 补录（`yarn mercato order_hub backfill-company-orders --apply`）。

## Scope

- `order_hub`：`data/entities.ts` + `data/validators.ts`、迁移（两新表）、`commands/companyOrders.ts`（create/update/delete/links.replace/link-child）、`lib/{companyOrder,companyOrderNumber,orderStages,companyOrderResolve}.ts`、`api/{orders,orders/links,orders/link-child,stages}`、`cli.ts`（补录）、`events.ts`、`acl.ts`/`setup.ts`（`order_hub.manage`）、工作台/详情/表单组件与页面、i18n。
- `internal_sales`：订单表单 `?companyOrderId=` 预填 + 保存后 `link-child` + 落点；`[id]` 重定向升级。
- `purchasing`：采购单表单 `?companyOrderId=` 预填 + 保存后 `link-child` + 落点。
- 文档：本 spec、`order_hub/README.md`、旧 spec 标注、状态板、`docs/plans/cross-border-erp.md`、`docs/dev/business-architecture.md`。

## Non-goals

- 不迁移销售引擎数据；不改造发运分摊/合同/单证/收汇链路；本期不做公司订单↔下游单据的直接关联表。
- 不动报价工作台、导航树、其他菜单与授权。

## Implementation Plan

### Phase 1: 数据与接口地基

1. 1.1 实体/校验/迁移（两新表 + 索引/唯一键）。
2. 1.2 命令五条（撤销/乐观锁/成套替换/幂等 link-child/自动建根）+ 事件 + 缓存失效。
3. 1.3 API：orders CRUD、links（GET/POST）、link-child、stages 改键+追加字段。
4. 1.4 `orderStages` 改键为公司订单并集口径。
5. 1.5 补录 CLI（dry-run 默认、幂等、按 scope）。
6. 1.6 单元 + 集成（company-orders / company-order-links / company-order-backfill）。

### Phase 2: 工作台与公司订单页

7. 2.1 工作台重写（行=公司订单、新建入口、阶段列、全字段抽屉适配、i18n）。
8. 2.2 公司订单页重写（抬头 + 三关联区块 + 五下游区块 + 锚点）。
9. 2.3 create/edit 页（CrudForm + `navHidden`）。
10. 2.4 旧 URL 解析（`lib/companyOrderResolve.ts` + 解析状态）与 internal/external `[id]` 重定向。
11. 2.5 删除 `mergeOrders.ts` 与其单测。

### Phase 3: 预填与自动关联

12. 3.1 `internal_sales` 表单预填 + 保存后关联/自动建根 + 落点。
13. 3.2 `purchasing` 表单预填 + 保存后关联 + 落点。
14. 3.3 区块「新建」目标子单解析与关联对话框（三种类共用）。
15. 3.4 浏览器全链路冒烟。

### Phase 4: 收口

16. 4.1 docs（模块 README / business-architecture / 计划进度表 / spec changelog）。
17. 4.2 宽门禁（`yarn generate && yarn typecheck && yarn lint && yarn check-lessons && yarn ds:check && yarn test && yarn build`）。
18. 4.3 PR draft → ready（labels + 迁移应用说明 + 补录步骤）。

## Risks

- 迁移未应用前新表不存在 → PR/README 写明升级步骤（dev 由 supervisor 在下次 `yarn dev` 应用）。
- 销售单硬删 → 关联冻结快照 + 反查容忍缺失。
- `?companyOrderId=` 关联调用需要 `order_hub.manage`（既有租户 `yarn mercato auth sync-role-acls`）。
- 补录 1:1 会让同一笔生意的对内+对外两单成为两张根单 → 用关联对话框成套替换可手工并单（README 说明）。

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: 数据与接口地基

- [x] 1.1 Entities, validators, migration — c614a90（`Migration20261009024200_order_hub.ts`：仅两张新表 + 索引/唯一键/级联 FK，未应用）
- [x] 1.2 Commands, events, cache invalidation — bda0d3c（create/update/delete 可撤销 + 乐观锁；links.replace 成套替换；link-child 幂等 + 销售类自动建根、采购类 422）
- [x] 1.3 API routes (orders / links / link-child / stages) — b91ed67（含 links `?refId=` 反查；`order_hub.manage`）
- [x] 1.4 orderStages re-keyed to company orders — bda0d3c（并集口径；`source` 字段保留为派生值）
- [x] 1.5 Backfill CLI — bd8b864（dry-run 默认 / `--apply` / `--tenant` / `--organization`；复用 link-child 的建单+快照函数）
- [x] 1.6 Unit + integration specs green — 103ab4d / dac2a4c / 4292ad1 / 2ec0b6b / 79346a0 / 1de9d56。证据：`yarn jest src/modules/order_hub` **3 suites · 28 tests passed**；`yarn typecheck` 全仓干净；`yarn db:generate` 复跑 `order_hub: no changes`；ephemeral 集成 **company-orders 6 / company-order-links 7 / company-order-backfill 3 = 16 passed, 0 failed**（`JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral <spec>` 逐套跑）。实现中修正 5 处自身缺陷：CLI 直接 import `.server.ts` 会把 `next/server` 拉进 CLI bundle（抽出 HTTP-free `internal_sales/lib/tradeTypeChannelIds.ts`）；search/kind 子读用单组织而非工厂的可见组织集（改为 `ctx.organizationIds`）；空候选集 `id $in []` 触发查询引擎 500（改不可能 uuid 哨兵）；自动建根在 flush 前读 id 返回 "undefined"（改 create 时 `randomUUID()`）；补录 CLI 写完不清缓存（补失效）。旧聚合/stages 两个 spec 属旧契约，Phase 2 删除。

### Phase 2: 工作台与公司订单页

- [ ] 2.1 Workbench rewrite
- [ ] 2.2 Company-order hub rewrite
- [ ] 2.3 create/edit pages
- [ ] 2.4 Legacy URL resolution
- [ ] 2.5 Delete mergeOrders + tests

### Phase 3: 预填与自动关联

- [ ] 3.1 internal_sales prefill + link
- [ ] 3.2 purchasing prefill + link
- [ ] 3.3 Hub block create flows + link dialogs
- [ ] 3.4 Browser smoke

### Phase 4: 收口

- [ ] 4.1 Docs
- [ ] 4.2 Broad gate
- [ ] 4.3 PR draft → ready
