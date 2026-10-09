# 公司订单根单化（company order as a first-class root entity）

**Date**: 2026-10-09
**Status**: Ready for implementation

> owner 已批准两个结构决策（2026-10-09，见 Resolved decisions）：**容器根单**（新表 + 关联表，模块数据仍归各模块）与**全量补录**（现有渠道内销售单 1:1 生成公司订单）。本规格取代 `2026-10-08-order-centric-entry.md` 里「工作台合并三类既有列表 / 无实体」的口径（该文件的 Phase 4/REQ-001/009/010 与 Non-goals 第一条）。

## TLDR

把「公司订单」从**三张既有列表的 UI/服务端聚合**改成**一个 app 自有实体**：新增 `order_hub_company_orders`（根单）与 `order_hub_company_order_links`（关联表）两张表；订单工作台与订单详情页全部改读新表。工作台每行 = 一张公司订单，点进公司订单页（不再跳采购单页）；页面像购销合同一样给出**关联区块**（对内销售订单 / 对外销售订单 / 采购订单：可关联已有、可新建预填、可移除），下游（购销合同 / 单据 / 发运单 / 装箱单 / 收汇·退税）按关联子单据的并集只读展示 + 既有预填新建入口。历史订单一次性补录为 1:1 公司订单（`yarn mercato order_hub backfill-company-orders --apply`）；对内/对外销售单、采购单继续由各自模块持有、继续走既有链路（发运分摊、合同、单证、收汇都不改）。

## Problem Statement

**现状**（2026-10-08→10-09 已交付的三轮实现）：

- 工作台 `/backend/orders` 是**聚合列表**：路由把调用方凭证转发给 `/api/sales/orders`（每种贸易类型一次）与 `/api/purchasing/purchase-orders`，客户端/服务端合并分页（`order_hub/api/orders/route.ts`、`lib/mergeOrders.ts`；spec `2026-10-08-order-centric-entry.md`）。每行的身份是**别的模块的单据**——采购行的点开落点就是 `/backend/purchasing/orders/<id>`。
- 详情 hub `/backend/orders/<id>` 的 `<id>` 是 **sales order id**；六个分区（采购单/购销合同/单据/发运单/装箱单/收汇·退税）都以该 id 读各自的关联（`order_hub/components/OrderDetail.tsx`）。
- 于是「公司订单」没有自己的记录：既不能像购销合同（`trade_docs_contracts` + `trade_docs_contract_orders` 关联表 + 合同页五区块 + 「管理订单关联」对话框 + 预填新建）那样**先有一张单、再把别的模块的数据关联式填入**，也无法承载属于这笔生意本身的抬头数据。

**证据**（owner 反馈，原文要点）：

- 2026-10-09 01:49：希望「完全新增一个表进行存放数据，然后通过表的数据关联的方式」达到这个功能模块；「点击订单工作台的订单 item 而不是直接跳到采购单的模块的 item」；「之前一直复用以前的功能进行 UI 上的集合……导致我想要的类似于购销合同，进行关联方式的填入不同功能模块的数据，这个需求一直实现不出来」。
- 2026-10-08 09:01：同一诉求的前半段——「公司订单的单据来源不是取以前的采购单，是以新建一个单独维度的数据表进行组织」「先新建订单（草稿），然后新建对内/对外/采购单这些维度功能参考合同页」——当时被实现成入口层重排，未落地实体。

**为什么现有行为不够**：身份、生命周期和关联都寄居在别的模块；聚合层无法提供「关联管理/快照冻结/审计/乐观锁」这类属于根单的能力，采购行点开即离开订单语境。

## Overview and Success Measures

- **Primary outcome:** `/backend/orders` 每行 = 一张 `order_hub_company_orders` 记录；点击进入 `/backend/orders/<companyOrderId>`；在该页可对三类订单执行「关联已有 / 新建预填 / 移除」，关联关系与快照存在 `order_hub_company_order_links`；四个阶段列与下游区块从关联读取。
- **Leading indicators:** 工作台行的 `items[].id` 与 `GET /api/order_hub/orders` 返回的公司订单 id 一致；`order_hub.orders.links.replace` / `order_hub.orders.link-child` 的调用成功；补录 CLI 的 `created` 计数。
- **Baseline:** 现状行 id 是 sales/purchase order id；`order_hub` 无实体、无迁移、无写路径（`src/modules/order_hub/README.md`）。
- **Market / product reference:** owner 指定的参考实现是同一 app 内的购销合同页（`trade_docs/components/ContractDetail.tsx` + `ContractOrdersDialog.tsx` + `trade_docs.contracts.orders.replace`）；本规格沿用它的「关联表 + 成套替换 + 快照冻结 + 区块壳 `RelatedSection`」模式，不新造机制。

## Goals

- **REQ-001** — 新增两张表（唯一迁移）：`order_hub_company_orders`（根单：编号/标题/日期/状态/备注/租户组织/软删/`updated_at`）与 `order_hub_company_order_links`（关联：`kind`（`internal_sales_order`|`external_sales_order`|`purchase_order`）/`ref_id`/冻结的 `ref_number`/`ref_counterparty`/`ref_snapshot`，唯一键 `(company_order_id, kind, ref_id)`）。
- **REQ-002** — 订单工作台 `/backend/orders` 改读公司订单：服务端分页/搜索（公司订单号或标题或子单号）/状态过滤/类型过滤（按关联子单种类）；行点击进公司订单页；「新建订单」= 新建公司订单草稿；保留四个阶段列与「全字段」抽屉（抽屉按关联子单取数）；采购订单不再作为工作台的行。
- **REQ-003** — 公司订单详情页 `/backend/orders/<companyOrderId>`：抬头卡（编号/标题/日期/状态 + 编辑）+ 三个可写关联区块（对内销售订单 / 对外销售订单 / 采购订单：列出、关联对话框、移除、新建）+ 下游区块（购销合同 / 单据 / 发运单 / 装箱单 / 收汇·退税，按子单并集只读 + 既有预填新建）。
- **REQ-004** — 关联写路径两个命令：`order_hub.orders.links.replace`（按 kind 成套替换；乐观锁；跨组织/未知引用 422；快照冻结；非撤销型）与 `order_hub.orders.link-child`（幂等新增一条关联；给销售类子单在未指定公司订单时自动建一张公司订单并关联——保证「app 建出的对内/对外销售单必有根」）。
- **REQ-005** — 历史补录 CLI `yarn mercato order_hub backfill-company-orders [--apply] [--tenant=] [--organization=]`：对每张带贸易类型渠道的销售单生成 1:1 公司订单并关联（快照冻结）；按 `source_sales_order_id` 把采购单挂到对应公司订单；dry-run 默认、幂等、按 scope 输出计数。
- **REQ-006** — 预填：`?companyOrderId=` 接入 `internal_sales`（对内/对外同一表单）与 `purchasing` 新建表单，保存后自动关联并跳回公司订单页；区块「新建」把 `companyOrderId`（必要时带 `?orderKind=&orderId=` 子单来源）传下去；关联失败不阻断已创建单据，给出行内/闪讯提示。
- **REQ-007** — 旧 URL 兼容：`/backend/orders/<salesOrderId>`（旧通知、收藏、采购来源链接、旧列表重定向）与 `/backend/{internal,external}-sales/orders/<id>` 经关联表解析到公司订单页；解析不到时显示「未关联」状态（含把该销售单挂到已有公司订单的入口）而不是错页或 500。
- **REQ-008** — 权限：读沿用 `order_hub.view`；写新增 `order_hub.manage`（`setup.ts` 授予 `superadmin`/`admin`；既有租户 `yarn mercato auth sync-role-acls`）。
- **REQ-009** — 清收旧聚合：删除客户端合并件（`lib/mergeOrders.ts` 及其单测）与三源扫描逻辑；`GET /api/order_hub/orders` 改为公司订单 CRUD 路由；`GET /api/order_hub/stages` 保持 URL 与字段形状、ids 改键为公司订单、字段只做**追加**（`counterparty`/`childNumbers`/`kinds`）。
- **REQ-010** — 文档同步：本规格落档；`order_hub/README.md` 重写；`2026-10-08-order-centric-entry.md` 的 Status/Changelog 标注被取代；`docs/plans/README.md` 状态板 + `docs/plans/cross-border-erp.md` 进度表；`docs/dev/business-architecture.md` 的 order_hub 行。

## Non-goals

- **不迁移**销售引擎数据：对内/对外销售单与明细仍由安装层 `sales_*` 持有；本规格不改 `sales` 的任何表、路由、事件。
- **不改造下游链路**：发运分摊、合同↔订单关联、订单↔单据关联、收汇/退税读法都不改——公司订单页对下游是**只读并集 + 既有预填入口**。
- **不做公司订单↔下游单据的直接关联表**（合同/单证/发运/装箱/收汇本期不进入 `order_hub_company_order_links`；链路仍由子单承担）。
- **不动**报价工作台 `/backend/quotes`、nav_shell 导航树、工作台之外任何菜单/页面授权。
- **不引入**状态字典（公司订单状态用与 `purchasing` 相同的常量 + i18n 方案）、全局搜索 `search.ts`、自定义字段 `ce.ts`（与 `purchasing` 现状一致）。
- **不做**公司订单的并发编辑合并/自动归档、阶段列的口径重定义（沿用 `lib/orderStages.ts` 的四个口径，仅改键）。

## Proposed Solution

1. **数据层**：`order_hub` 增加两个实体与一次迁移（只建表，不写数据）；公司订单号 `CO-<年>-<4位>` 按 `(tenant, organization)` 由 create 命令生成（唯一索引兜底 + 撞号重试，照 `purchasing` 的 `nextOrderNumber`）。
2. **关联层**：`order_hub_company_order_links` 是唯一关联事实来源；写入只经两个命令（成套替换 / 幂等新增），读经 `GET /api/order_hub/orders/links`；快照在关联时冻结（子单改名不回写）。
3. **入口层**：工作台与详情页（`order_hub/components/*`）改读新表；三个关联区块复用 `RelatedSection` 壳与 `ContractOrdersDialog` 的对话框模式；下游区块把现有「单订单」读法泛化为「子单集合并集」。
4. **链路层**：`?companyOrderId=` 预填 + 保存后 `link-child`；旧 URL 经 `lib/companyOrderResolve.ts` 解析。
5. **补录层**：CLI（dry-run 默认）复用与 `link-child` 相同的建单/快照函数，保证口径单一。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| 公司订单是**容器根单**（新表 + 关联表；三类订单仍是各模块的真实单据） | owner 2026-10-09 选定；等于把购销合同页的「关联已有/预填新建」模式复用到订单根；下游链路零改造，本期可完整交付 | ①「订单本体」（新表自己存客户/币种/明细，销售单退化为引擎附件）②「1:1 包裹」（每条销售单自动包一张公司订单） | ① 发运分摊/合同行复制/单证/收汇要全部迁到公司订单维度，多期交付且期间有功能缺口（owner 已看过该权衡后未选）② 身份层之外不解决「关联式填入」，owner 视为又一版 UI 集合 |
| 关联存**本模块的关联表**，不在 `purchasing`/`trade_docs`/`cross_border` 加列 | 一张公司订单挂任意多张各类子单（同 `trade_docs_contract_orders` 的基数）；`order_hub` 独占该不变式；其他模块 schema 零改动 | 在采购单/销售单上加 `company_order_id` 列（销售单是安装层表，不可加列） | 安装层表无法加列；分散到多模块的多列写路径会漂移口径 |
| 关联行**冻结快照**（`ref_number`/`ref_counterparty`/`ref_snapshot`） | 列表与区块不依赖对端实时可读；对端改名不回写（照 `trade_docs_contract_orders`）；销售单可能被硬删（安装层 `sales.orders.delete` 是硬删） | 只存 id、实时读 | 对端删除后无法显示；列表要多跳一次跨模块读 |
| 未指定公司订单的销售单创建**自动建根**（`link-child`） | 保证「渠道内销售单必有根」的不变式，旧入口（报价「按此报价新建订单」）与旧 URL 不悬空；owner 选定「全量补录」的同一口径 | 允许无根销售单存在 | 旧 hub URL/通知解析不到，需要额外的「未关联」状态面 |
| 状态用**模块常量**（`draft`/`in_progress`/`completed`/`cancelled`） | 与 `purchasing` 的 `ORDER_STATUSES` 同一方案；公司订单状态是操作员自己的标记，不是引擎字典（销售状态字典仍归 `sales`） | 复用 `sales.order_status` 字典 / 引入新字典 | 语义不同（容器 vs 单据）；新字典走 `dictionaries` 是另一条规格 |
| 类型过滤 = **按关联子单种类**过滤 | 容器可能同时有对内与对外子单；「类型」不再是单值 | 给公司订单加单值 `trade_type` 字段 | 与业务不符（同一柜可能两种方向都有，见 `2026-09-29-sales-trade-type-and-line-reuse.md` REQ-004） |
| 下游区块按**子单并集**读（不改各模块 schema） | 合同/单证/发运/收汇的关联事实已存在（`trade_docs_contract_orders`、`trade_docs_order_documents`、`cross_border_shipment_sales_allocations`、`export_finance_collections/refunds`），并集读即可还原今天 hub 的信息量 | 让下游也进 `order_hub` 关联表 | 双份关联会漂移；且创建时下游单据本就必须写各自的链路（合同↔订单等），本模块再存一份没有读方 |
| 路由 URL 保留、载荷重定义 + 只做追加 | `/api/order_hub/orders` 与 `/api/order_hub/stages` 的唯一消费者是本 app 的浏览器 bundle（同 PR 发布）；URL 不删、`stages` 字段形状不动只追加 | 新 URL + 旧 URL 桥接一个版本 | app 内单一消费者同发布，桥接版本没有实际客户端；披露见 Migration & Backward Compatibility |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| 公司订单（根单） | `order_hub_company_orders` 的一行：一笔生意的根记录。它**不**持有客户/币种/金额/明细——那些归子单；它持有编号、标题、下单日期、预计交货日期、状态、备注 | `order_hub` | 读不到 → 工作台该行不出现；写失败 → 行内错误 |
| 子单关联 | `order_hub_company_order_links` 的一行：`(company_order_id, kind, ref_id)` 唯一；kind ∈ `internal_sales_order`/`external_sales_order`/`purchase_order`（本期） | `order_hub` | 引用跨组织/不存在 → 422（fail closed）；重复 → 幂等（link-child）/422（replace 去重后仍重复） |
| 快照冻结 | 关联时把对端 `number`/`counterparty`（买方或供应商快照的显示名）/`status`/`createdAt` 冻结进关联行；对端改名不回写 | 关联行 | 对端被硬删 → 行仍显示冻结值与「对端已不存在」提示（下游区块的实时读自然为空） |
| 自动建根 | 销售类子单创建时未带 `companyOrderId` → 建一张 `status=draft`（订单日=当天）的公司订单并关联 | `order_hub.orders.link-child` | 关联失败 → 子单照常存在，表单跳到子单编辑页 + 闪讯提示 |
| 阶段（四列） | 采购=关联子单里非 cancelled 的采购单数；发运=经子单（销售分摊/采购分摊）关联的去重发运单数；单证=子单自身的单据关联行 + 其合同的 PI/CI + 其发运单的出口单证数；收汇·退税=子单的收汇档案/退税档案 | `order_hub/lib/orderStages.ts`（改键为公司订单） | 任一读失败 → 该单元格计 0 并记录日志；工作台不整体失败（沿用现状口径） |
| 公司订单号 | `CO-<4位年>-<4位序号>`，按 `(tenant, organization)` 唯一；创建时生成；撞号重试一次 | `order_hub.orders.create` | 唯一索引冲突 → 重试 → 仍失败则 409 |
| 状态 | `draft` 草稿 / `in_progress` 进行中 / `completed` 已完成 / `cancelled` 已取消；可经 update 改 | `order_hub` 常量 + i18n | 非法值 → 400 |
| 全字段抽屉 | 行操作：有采购类子单 → 读第一张采购子单的 `GET /api/export_finance/order-files` 投影（订单/单证与文件/财务三组）；否则 → 抬头 + 四分支计数 | `export_finance`（既有投影） | 403 → 组内无权限文案，其余照常（沿用现状） |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 订单操作员（销售/单证） | 看工作台/公司订单页；从区块新建/关联子单；编辑公司订单 | 选中组织及其后代（`resolveOrganizationScopeForRequest().filterIds`） | `order_hub.view` + 写时 `order_hub.manage` + 各目标页面自身 feature（`sales.orders.*`、`purchasing.orders.*` 等） |
| 采购员 | 同上；采购子单的关联/新建 | 同上 | 同上 + `purchasing.orders.view/manage` |
| 财务 | 工作台阶段列、公司订单页的收汇·退税区块、抽屉财务组 | 同上 | `order_hub.view` + `export_finance.orders.view` / `finance.ledger.view` |
| 超管/管理员 | 全部；`order_hub.view` 与 `order_hub.manage` 由 `setup.ts` 默认授予 | 同上（超管跨租户语义不变） | 全部 |

- **Trusted scope:** 服务端从会话与目录解析 `tenantId` + `organizationIds`（`order_hub/lib/requestScope.ts` 现状不动）；请求体/查询参数**绝不**接受 `tenantId`/`organizationId`。
- **合法 system 作用域:** 无——两张新表都是组织持有；不做 `organizationId: null` 读。
- **写门禁:** 两个命令都要求 `order_hub.manage`；`link-child` 由别的表单调用时也走同一门禁，无权限时该调用 403（子单已创建，表单给提示）。
- **既有租户:** `order_hub.manage` 新功能位需要 `yarn mercato auth sync-role-acls`（照 `module-features-need-role-acl-sync` lesson 的口径写进 README/PR）。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 公司订单与关联 | app-own | `order_hub`（扩展：新增 `data/`、`commands/`、`cli.ts`、`events.ts`） | 本模块实体 + 迁移 | 根单与关联是同一不变式，同模块事务内一致 |
| 对内/对外销售单 | reuse | 安装层 `sales`（界面 `internal_sales`） | 标量 id + 快照；`sales.orders.*` API 只读/写仍归 `sales` | 不复制写路径 |
| 采购单 | reuse | `purchasing` | 标量 id + 快照；既有 `source_sales_order_id` 锚不参与本规格的关联 | 同上 |
| 合同/单据 | reuse | `trade_docs` | `trade_docs_contract_orders` / `trade_docs_order_documents` 只读并集 | 关联事实已存在，不存第二份 |
| 发运单/装箱单 | reuse | `cross_border` | 分摊/合同链路只读并集 + 既有 `?contractId=`/`?orderKind=&orderId=` 预填 | 同上 |
| 收汇/退税 | reuse | `export_finance` | 既有投影（采购单/发运单键）只读 | 同上 |
| 区块壳/对话框/抽屉 | reuse（app 内共享件） | `@/lib/related/RelatedSection`、`@/lib/quick-edit/QuickEditDialog`、`ContractOrdersDialog` 模式 | import | 一个壳只留一处 |
| 组织 scope | reuse | `order_hub/lib/requestScope.ts`、`resolveOrganizationScopeForRequest` | 直接调用 | 口径单一 |
| 贸易类型渠道解析 | reuse | `internal_sales/lib/tradeTypeChannels.server.ts`（`resolveTradeTypeChannelIds`）与 `setup.ensureTradeTypeChannels`（CLI 里复用） | 直接调用 | 通道归属 `internal_sales` |

## Architecture and Data Flow

```text
工作台 /backend/orders ──GET /api/order_hub/orders ──> order_hub_company_orders（分页/搜索/过滤）
                        └GET /api/order_hub/stages?ids= ──> 四个阶段计数（scoped 跨模块只读 SQL）

公司订单页 /backend/orders/<companyOrderId>
  ├─ GET /api/order_hub/orders?id=                抬头
  ├─ GET /api/order_hub/orders/links?companyOrderId=  三类子单关联（含冻结快照）
  ├─ 关联对话框 ──POST /api/order_hub/orders/links {companyOrderId,kind,refs[],updatedAt}
  │                 └─ order_hub.orders.links.replace（校验 scoped 存在 → 冻结快照 → 成套替换 → 事件/缓存）
  ├─ 下游区块（合同/单据/发运/装箱/收汇·退税）── 以子单 id 集合做既有 API 的并集只读
  └─ 区块「新建」──> 目标模块 create?companyOrderId=…[&orderKind=&orderId=…]
                        └─ 保存后 POST /api/order_hub/orders/link-child {kind,refId,companyOrderId?}
                              └─ order_hub.orders.link-child（幂等；销售类无根时自动建根）→ 跳回公司订单页

旧 URL /backend/orders/<salesOrderId> ── lib/companyOrderResolve（关联反查）──> 307 公司订单页
补录 CLI yarn mercato order_hub backfill-company-orders [--apply] ── 与 link-child 同一建单/快照函数
```

- **Module boundaries:** 两张新表与它们的命令/路由/页面全在 `order_hub`；对 `sales`/`purchasing`/`trade_docs`/`cross_border`/`export_finance` 只有 scoped 只读（照 `lib/orderStages.ts` 的「一次性 cast + 注释」投影法，见 lesson `kysely-bare-handle-types-tables-away`）。
- **Extension points:** 无新注入位；消费既有 app 内共享件。`order_hub` 的 `index.ts`/`acl.ts`/`setup.ts` 已存在，只做加法。
- **Alternatives considered:** 见 Design Decisions 表（本体/包裹/在目标模块加列/实时读）。
- **Compatibility:** `/backend/orders`、`/backend/orders/<id>`、`/backend/{internal,external}-sales/orders/<id>`、`/backend/purchasing/orders/<id>`（来源链接）与 `/api/order_hub/*` 的 URL 全部保留（见 Migration & Backward Compatibility 的载荷重定义披露）。

## User Journeys

### Journey J-001 — 早上打开工作台，从公司订单进入业务

1. 操作员登录 → 侧边栏「公司订单 → 订单工作台」→ `/backend/orders`。
2. 列表每行是一张公司订单（编号/标题/子单号/对方/下单日期/状态/四个阶段列）；输入 `ORDER-…` 子单号也能搜到它所在的公司订单；类型筛选「有采购」只留挂过采购单的根。
3. 点行 → `/backend/orders/<companyOrderId>`（**不是** `/backend/purchasing/orders/<id>`）。

### Journey J-002 — 新建公司订单并在其中建子单

1. 工作台「新建订单」→ `/backend/orders/create`（标题/下单日期/预计交货/状态/备注）→ 保存 → 公司订单页。
2. 「对内销售订单」区块「新建」→ `/backend/internal-sales/orders/create?companyOrderId=<id>` → 填单保存 → 自动关联 → 跳回公司订单页；区块出现该行（含冻结快照）。
3. 「采购订单」区块「新建」→ `/backend/purchasing/orders/create?companyOrderId=<id>[&orderKind=&orderId=]` → 保存 → 关联（同时保留既有来源锚）→ 跳回公司订单页 `#purchasing`。

### Journey J-003 — 把既有单据关联进来（合同式）

1. 公司订单页「采购订单」区块「关联…」→ 对话框（种类=采购订单、可搜索选择器）勾选 2 张 → 保存（成套替换，带 `updatedAt`）。
2. 成功 → 区块与阶段列刷新；若他人刚改过该公司订单 → 409 冲突条（平台冲突 UI）而不是静默覆盖。

### Journey J-004 — 旧链接归位

1. 老通知/收藏指向 `/backend/orders/<salesOrderId>` → 服务端解析到公司订单 → 307 到公司订单页。
2. 未关联（数据异常）→ 页面显示「该单据尚未关联公司订单」状态 + 「新建公司订单并关联」/「关联到已有公司订单」入口，而不是 404 空白。

### Journey J-005 — 补录（运维）

1. `yarn mercato order_hub backfill-company-orders`（dry-run）→ 打印每 scope 的待建/已建/跳过计数与样例。
2. `--apply` → 幂等落库；再跑一次 → 全部跳过（0 created）。

## UI and Interaction Contracts

参考页：`trade_docs/components/ContractDetail.tsx`（关联区块 + 对话框 + 预填入口）与 `trade_docs/components/ContractOrdersDialog.tsx`；表格与表单分别用 `DataTable`、`CrudForm`；共享壳 `@/lib/related/RelatedSection`。既有页面参考：`src/modules/order_hub/components/OrderWorkbench.tsx`（重写）、`OrderDetail.tsx`（重写）、`OrderFieldsDrawer.tsx`（小改）。

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/orders` | 公司订单工作台：分页/搜索/状态/类型过滤、行→详情、新建订单、行操作「全字段」 | `GET /api/order_hub/orders`、`GET /api/order_hub/stages`、`GET /api/export_finance/order-files` | 现状工作台（重写数据源）；`example` 的 `DataTable` 用法 | `Page`、`PageBody`、`DataTable`、`StatusBadge`、`Drawer` | loading / empty / error+retry / 阶段为空 / 抽屉 403 分组降级 / 暗色 / 窄屏 | REQ-002, REQ-009 |
| `/backend/orders/create`、（`/<id>/edit`） | 公司订单表单：标题/下单日期/预计交货/状态/备注；编辑含删除 | `POST/PUT/DELETE /api/order_hub/orders`（`order_hub.orders.create/update/delete`） | `purchasing/components/PurchaseOrderForm.tsx`（CrudForm 用法） | `CrudForm`、`Page` | loading / 校验错误 / 409 冲突 / 删除确认 / 403 | REQ-001, REQ-002 |
| `/backend/orders/<companyOrderId>` | 公司订单 hub：抬头 + 三关联区块 + 五下游区块 + 全字段入口 | 上面 Architecture 图内的读；关联写经 `links`/`link-child` | `trade_docs/components/ContractDetail.tsx` | `Page`、`RelatedSection`、`QuickEditDialog`、对话框（`Dialog`/`Button`/`ComboboxInput`/`Select`） | 每区独立 loading/empty/error+retry；关联对话框失败重读；409 冲突条；未关联状态（旧 id）；暗色/窄屏 | REQ-003, REQ-004, REQ-007 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| 全部订单角色 | 公司订单 → 订单工作台（不变） | 无新增 widget | 登录 → 订单工作台（≤2 击）→ 公司订单页 |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| 工作台表格 | 「还没有公司订单」+「新建订单」按钮；搜索无结果时提示清除筛选 | `DataTable` 既有横向滚动/列宽规则 | 行 Tab 可达；链接有可访问名；筛选 Enter 触发 |
| 公司订单页 | 每区块自己的空态 +「关联…/新建」；下游空态给「先建/关联销售或采购订单」提示 | 区块纵向堆叠；窄屏下对话框全宽 | 对话框 Esc 取消、Cmd/Ctrl+Enter 提交；图标按钮有 aria-label |

### `/backend/orders` — 订单工作台

```text
┌────────────────────────────────────────────────────────────────┐
│ 订单工作台                                   [新建订单]        │
│ [类型 ▾] [状态 ▾] [搜索 公司订单号/标题/子单号]                │
├────────────────────────────────────────────────────────────────┤
│ 编号 | 子单号 | 对方 | 下单日期 | 状态 | 采购|发运|单证|收汇退税 | ⋯全字段 │
│ CO-2026-0001 | ORDER-…, PO-… | XYZ | 2026-10-01 | 进行中 | 2|1|3|— | 抽屉 │
├────────────────────────────────────────────────────────────────┤
│ 分页 20/50/100                                                  │
└────────────────────────────────────────────────────────────────┘
```

- **Behavior:** 行点击/编号链接 → `/backend/orders/<id>`；类型/状态/搜索任一变更重置页码；阶段单元格 >0 链到 hub 对应锚点（`#purchasing`/`#shipments`/`#documents`/`#money`），=0 也链到锚点（hub 有新建入口）；「全字段」抽屉按 Domain Vocabulary 的口径。
- **Responsive / a11y:** 沿用现状工作台（列多时横向滚动；搜索有 label；抽屉可 Esc 关闭）。
- **Localization:** `order_hub.workbench.*` 命名空间沿用 + 新增键（`order_hub.workbench.columns.*`、`order_hub.companyOrders.status.*`）。
- **Theming:** 状态用 `StatusBadge`（语义 token），无硬编码颜色；明暗两态都验证。

### `/backend/orders/<companyOrderId>` — 公司订单 hub

```text
┌────────────────────────────────────────────────────────────────┐
│ CO-2026-0001 · <标题>            [编辑]                        │
│ 下单 2026-10-01 · 交货 2026-11-01 · 状态徽章                    │
├────────────────────────────────────────────────────────────────┤
│ 对内销售订单  [关联…] [新建]        │ 对外销售订单  [关联…] [新建] │
│  PO-… 买方 状态  [打开][移除]      │                             │
├────────────────────────────────────────────────────────────────┤
│ 采购订单  [关联…] [新建]                                        │
├────────────────────────────────────────────────────────────────┤
│ 购销合同 [新建] / 单据 [新建] / 发运单 [新建] / 装箱单 [新建] /   │
│ 收汇·退税（只读）                                               │
└────────────────────────────────────────────────────────────────┘
```

**区块读法映射（实现依据；「子单集」= 该 kind 的关联行 `refId` 集合）：**

| 区块（锚点 id） | 读 | 新建预填 | 行落点 |
|---|---|---|---|
| 对内销售订单（`internal-orders`） | `GET /api/order_hub/orders/links?companyOrderId=&kind=internal_sales_order`（冻结快照） | `/backend/internal-sales/orders/create?companyOrderId=` | `/backend/internal-sales/orders/<refId>/edit` |
| 对外销售订单（`external-orders`） | 同上 `kind=external_sales_order` | `/backend/external-sales/orders/create?companyOrderId=` | `/backend/external-sales/orders/<refId>/edit` |
| 采购订单（`purchasing`） | 同上 `kind=purchase_order` | `/backend/purchasing/orders/create?companyOrderId=[&orderKind=&orderId=<唯一销售子单>]` | `/backend/purchasing/orders/<refId>` |
| 购销合同（`contracts`） | 每个子单 `trade_docs/contracts/orders?orderKind=&orderId=` → 合并去重 → `trade_docs/contracts?ids=` | `/backend/trade-docs/contracts/create?orderKind=&orderId=`（目标子单解析，见下） | `/backend/trade-docs/contracts/<id>` |
| 单据（`documents`） | 每个销售子单 `trade_docs/orders/documents?orderKind=&orderId=` → 合并 → `trade_docs/documents?ids=` + `trade_docs/invoices?ids=`；`单据关联` 对话框沿用既有 `OrderDocumentsDialog` | `/backend/trade-docs/proformas/create?orderKind=&orderId=[&contractId=<唯一合同>]` | `/backend/trade-docs/{proformas,commercial-invoices,invoices}/<id>/edit` |
| 发运单（`shipments`） | 销售子单 `cross_border/shipments?salesOrderId=` + 采购子单 `cross_border/shipments?purchaseOrderId=` → 按 id 去重 | `/backend/cross_border/shipments/create?orderKind=&orderId=` | `/backend/cross_border/shipments/<id>` |
| 装箱单（`packing-lists`） | 对发运单集合 `cross_border/shipments/documents?shipmentId=&docType=packing_list` | `/backend/cross_border/packing-lists/create?contractId=<唯一合同>`（无唯一合同则不带参数） | `/backend/cross_border/packing-lists/<id>` |
| 收汇·退税（`money`） | 采购子单 `export_finance/collections?purchaseOrderId=&pageSize=1` + 发运单集合 `export_finance/refunds?shipmentId=&pageSize=1`（只读汇总，沿用现状） | 无（只读） | 收汇 → `/backend/export-finance/orders/<purchaseOrderId>`；退税 → `/backend/export-finance/containers/<shipmentId>` |

- **「目标子单解析」**：区块「新建」在子单集为空时禁用并提示（先关联/新建销售或采购订单）；恰 1 个时直连并带 `?orderKind=&orderId=`；>1 个时先弹选择器（用关联行的冻结单号/对方）再跳。带 `?orderKind=&orderId=` 的既有预填语义不变（目标模块自己的解析）。
- **「查看全部」**：恰 1 个相关子单时带该子单过滤（沿用现状）；多于 1 个时落到不带过滤的台账页（单值过滤表达不了并集）。
- **就地编辑**：下游区块（采购单/合同/单据/税务发票/发运单）沿用既有 `QuickEditDialog` 与各模块字段工厂；三个订单区块的行不就地编辑，给「打开」。
- **多区块失败隔离**：每区块独立 query + 独立 loading/error/retry（`RelatedSection`），子单数上限 20（超出只读前 20 并在区块尾部提示，防 N×M 扇出失控）。
- **Responsive / a11y / i18n / theming:** 同工作台；对话框完整键盘支持；每区块的 aria-labelledby 指向区块标题。

## Data Models

### `CompanyOrder`（`order_hub_company_orders`）

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid PK | — | no | 不可变 |
| `tenant_id` / `organization_id` | uuid NOT NULL | 复合索引 `(organization_id, tenant_id, created_at)` | no | 只来自可信上下文 |
| `number` | text NOT NULL | `UNIQUE (tenant_id, organization_id, number)` | no | 创建时 `CO-<年>-<4位>`；撞号重试 |
| `title` | text NULL | — | no | ≤200 字；可清空（显式 null） |
| `order_date` | date NOT NULL | — | no | 缺省=当天（服务器） |
| `eta_date` | date NULL | — | no | 可清空 |
| `status` | text NOT NULL default `draft` | — | no | 枚举（Domain Vocabulary）；400 on invalid |
| `notes` | text NULL | — | no | ≤2000 字；可清空 |
| `created_at` / `updated_at` | timestamptz NOT NULL | `updated_at` 作乐观锁版本 | no | 初始化器默认；update 时刷新 |
| `deleted_at` | timestamptz NULL | 软删 | no | delete 命令写；列表排除 |

### `CompanyOrderLink`（`order_hub_company_order_links`）

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid PK | — | no | 不可变 |
| `tenant_id` / `organization_id` | uuid NOT NULL | 复合索引 | no | 来自父公司订单/可信上下文 |
| `company_order_id` | uuid NOT NULL | FK（同模块 `ManyToOne`，`cascade`）+ 索引 | no | 父删则级联 |
| `kind` | text NOT NULL | `UNIQUE (company_order_id, kind, ref_id)`；反向索引 `(organization_id, tenant_id, ref_id)` | no | 枚举三值（本期）；400/422 on invalid |
| `ref_id` | uuid NOT NULL | 见上 | no | scoped 存在性校验（不存在/跨组织 → 422） |
| `ref_number` / `ref_counterparty` | text NULL | — | no（对端快照的显示名，明文来源即对端快照列） | 关联时冻结 |
| `ref_snapshot` | jsonb NULL | — | no | `{status, createdAt, currencyCode?, totalGross?}` |
| `created_at` / `updated_at` | timestamptz NOT NULL | — | no | 初始化器默认 |

**迁移：** `yarn db:generate` 生成「两张新表 + 索引/唯一键」一次迁移；只建表不写数据（补录走 CLI）。审阅后提交，不跑 `yarn db:migrate`。

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET` | `/api/order_hub/orders` | `order_hub.view` | `{page,pageSize,search,status,kind,id?}` | `{items:[{id,number,title,status,orderDate,etaDate,createdAt,updatedAt}],total,…}` | 400 非法筛选；403 | REQ-002 |
| `POST` | `/api/order_hub/orders` | `order_hub.manage` | create schema（无 number/scope） | 201 `{id,number}` + `order_hub.company_order.created` | 400/403/409 | REQ-001 |
| `PUT` | `/api/order_hub/orders` | `order_hub.manage` | `{id,…,updatedAt}` | 200 + `.updated` | 404/409（乐观锁）/400 | REQ-001 |
| `DELETE` | `/api/order_hub/orders` | `order_hub.manage` | `{id,updatedAt}` | 200 + `.deleted` | 404/409 | REQ-001 |
| `GET` | `/api/order_hub/orders/links` | `order_hub.view` | `{companyOrderId,kind?,page,pageSize}` | `{items:[{id,kind,refId,refNumber,refCounterparty,refSnapshot,updatedAt}],total}` | 400/403 | REQ-003 |
| `POST` | `/api/order_hub/orders/links` | `order_hub.manage` | `{companyOrderId,kind,refs:[{refId}],updatedAt}` → `order_hub.orders.links.replace` | 200 `{ok,count}` + `.links.updated` | 422（跨组织/未知/重复）/409/400 | REQ-003, REQ-004 |
| `POST` | `/api/order_hub/orders/link-child` | `order_hub.manage` | `{kind,refId,companyOrderId?}` → `order_hub.orders.link-child` | 200 `{companyOrderId,linked,created}` | 422（引用无效）/403 | REQ-004, REQ-006 |
| `GET` | `/api/order_hub/stages` | `order_hub.view` | `ids=<companyOrderId,…>`（1–200） | `{items:[{id,procurementCount,shipmentCount,documentCount,collected,refunded,counterparty?,childNumbers?,kinds?}]}` | 400 越界/非法 | REQ-002, REQ-009 |

- 全部走 `makeCrudRoute`（CRUD 路由含 per-method `metadata` + 独立 `openApi`，`indexer: { entityType: 'order_hub:company_order' }`）；`links`/`link-child` 是定制动作路由，先跑 mutation guard、再分发命令、读 `result`、提交后回调。
- 命令均实现 `CommandHandler`：撤销（create/update/delete）、`enforceCommandOptimisticLock`（update/delete/replace）、`withAtomicFlush({transaction:true})`、提交后事件/缓存失效（含 `order_hub.company_order.link` 这一独立缓存资源，照 lesson `crud-cache-invalidation-spans-resources`）。
- `link-child` 幂等键 = `(company_order_id, kind, ref_id)` 唯一键；`replace` 为成套替换（非撤销型，同 `trade_docs.contracts.orders.replace`）。
- **载荷重定义披露：** `GET /api/order_hub/orders` 的 `items[]` 由「三源合并行」变为「公司订单行」（`source` 及销售/采购专属字段不再返回）；`GET /api/order_hub/stages` 的 `ids` 由 sales order id 变为 company order id（字段只追加）。

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| 公司订单创建/更新/删除 | `order_hub` 命令 | 本模块缓存失效；未来订阅者可监听 | `emitCrudSideEffects`（含事件 + indexer + 缓存） | 提交后发出；undo 复放同一别名 |
| 关联成套替换 / 新增 | `order_hub.orders.links.replace` / `link-child` | 工作台与 hub 的查询失效 | `order_hub.company_order.links.updated`（`clientBroadcast`）+ 显式失效关联集合 | 幂等键=唯一键；替换带版本锁；重复调用不产生重复行 |

不进 worker/通知；不新增定时任务。

## Security, Privacy, and Compliance

- **Authorization:** 页面 `requireFeatures` 是唯一闸门（`/backend/orders*` 用 `order_hub.view`，create/edit 用 `order_hub.manage`）；API 每方法声明 feature；不使用角色名判断；按钮显隐只是 UX。
- **Tenant isolation:** 两张表的读写都以 `tenant_id` + 组织集过滤；`replace`/`link-child` 的对端解析在同一可信 scope 内（跨组织 → 422，不泄露存在性）；`stages`/并集读的每个投影都按 scope；无会话 401、无可解析组织 400 + `organization_scope_required`（沿用 `requestScope.ts`）。
- **Sensitive data:** 公司订单自身无 PII/密文列；对端显示名取自对端**快照列**（`customer_snapshot`/`supplier_snapshot` 的显示名，已是明文口径，照 `contractOrderReads.ts`）；不新增加密映射。
- **Abuse and failure modes:** 参数化/校验所有输入；`refs` 上限 200；追加重放由唯一键兜底；破坏性操作（删除公司订单）有确认并走命令审计；日志用 `createLogger('order_hub')` 且不记录密文/密钥。

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | integration | 两个组织（A/B）+ 各自公司订单 | CRUD 全量：create→list(search/status/kind)→get→update(409 用过期 updatedAt)→delete；A 的 id 在 B 的会话读不到 | 201/200/409/404 与 scope 隔离；`updatedAt` 往返 | REQ-001, REQ-002 |
| TEST-002 | integration | A 组织内 1 张公司订单 + 采购单/销售单各若干；B 组织同类数据 | `links.replace` 成套替换（去重、跨组织 ref → 422、重复 → 422、过期版本 → 409）；`link-child` 幂等（重复调用 1 行）；无 companyOrderId 的销售类 link-child 自动建根；`GET stages` 计数 | 关联行数、快照冻结值、反查解析、计数与构造一致 | REQ-003, REQ-004, REQ-009 |
| TEST-003 | integration | 渠道内销售单 + 带来源锚的采购单；无关联历史 | CLI dry-run → `--apply` → 重跑 | dry-run 无写入；apply 后 1:1 关联 + 采购单挂根；重跑 created=0；未标记单跳过 | REQ-005 |
| TEST-004 | UI（浏览器） | dev 数据/构造数据 | 工作台 → 新建公司订单 → hub → 对内区块「新建」保存（预填+自动关联）→ 工作台复看；旧 `/backend/orders/<salesOrderId>` 归位；关联对话框替换 | 行 id=公司订单；区块与阶段列更新；409 冲突条；暗色/窄屏 | REQ-002, REQ-003, REQ-006, REQ-007 |
| TEST-005 | unit | 纯函数夹具 | 编号生成、快照映射、阶段聚合、解析器 | 边界（撞号、缺渠道、硬删对端） | REQ-001, REQ-005, REQ-007 |
| TEST-006 | security | 无 `order_hub.manage` 的用户 | `POST links` / `link-child` / CRUD 写 | 403；读仍按 `order_hub.view` | REQ-008 |

## Implementation Phases

### Phase 1 — 数据与接口地基（实体/命令/路由/补录）

- **Depends on:** none
- **Outcome:** 两张表可迁移；公司订单 CRUD + 关联命令 + `stages` 改键 + 补录 CLI 可用（此时工作台仍是旧实现，互不影响——新路由未被消费）
- **Deliverables:** `data/entities.ts`/`validators.ts`、迁移、`commands/companyOrders.ts`（create/update/delete/links.replace/link-child）、`lib/orderNumber.ts`、`lib/companyOrder.ts`（快照/解析/建根共用函数）、`lib/orderStages.ts` 改键、`api/orders/route.ts`、`api/orders/links/route.ts`、`api/orders/link-child/route.ts`、`api/stages/route.ts`（改键+追加）、`cli.ts`、`events.ts`、`acl.ts`/`setup.ts` 追加 `order_hub.manage`
- **Requirements closed:** REQ-001, REQ-004（命令面）、REQ-005、REQ-008、REQ-009（API 面）
- **Tests:** TEST-001, TEST-002, TEST-003, TEST-005, TEST-006（API 部分）
- **Validation:** `yarn generate`、`yarn db:generate`（审阅 SQL/snapshot）、focused jest（`commands/__tests__`、`lib/__tests__`）、`yarn test:integration:ephemeral` 三个新 spec
- **Exit gate:** 迁移文件审阅通过且不应用；命令单测（撤销/锁/幂等）全绿；集成三个 spec 全绿；`GET stages` 对构造数据逐项一致

### Phase 2 — 工作台与公司订单页（身份切换）

- **Depends on:** Phase 1
- **Outcome:** 工作台行=公司订单、点行进公司订单页、旧 URL 归位；公司订单页给出三关联区块 + 五下游区块 + 全字段抽屉
- **Deliverables:** `components/OrderWorkbench.tsx`（重写）、`components/OrderDetail.tsx`（重写为 hub）、`components/CompanyOrderForm.tsx`、`backend/orders/create`、`backend/orders/[id]/edit`、`backend/orders/[id]`（服务端解析）、`lib/companyOrderResolve.ts`、`internal_sales`/`external_sales` 的 `[id]` 重定向页、i18n 更新、删除 `lib/mergeOrders.ts` 与其单测、删除旧 workbench 专属逻辑
- **Requirements closed:** REQ-002, REQ-003（读面）, REQ-007, REQ-008（页面门禁）
- **Tests:** TEST-002（读面）、TEST-004（浏览器）
- **Validation:** `yarn generate`、`yarn typecheck`、focused 单测、浏览器实测（工作台/hub/旧 URL/暗色/窄屏）
- **Exit gate:** 工作台每行 id 属新表；点行进 hub；旧 `/backend/orders/<salesOrderId>` 307 归位；hub 五下游区块与旧 hub 信息量对等；明暗/窄屏通过

### Phase 3 — 预填与自动关联（写入闭环）

- **Depends on:** Phase 2
- **Outcome:** 从 hub 区块新建子单（销售/采购）自动关联并跳回；区块「关联…」对话框可用；无 companyOrderId 的旧入口（报价「按此报价新建订单」）自动建根
- **Deliverables:** `internal_sales/components/InternalSalesForm.tsx`、`purchasing/components/PurchaseOrderForm.tsx`、hub 区块「新建」的目标子单解析（单子单直连/多子单选择）、关联对话框（三种类共用组件）
- **Requirements closed:** REQ-003（写面）、REQ-004（命令消费）、REQ-006
- **Tests:** TEST-002（写面）、TEST-004（浏览器全链路）
- **Validation:** `yarn generate`、`yarn typecheck`、focused 单测、浏览器实测（预填+关联+跳回；无权限降级提示）
- **Exit gate:** 从 hub 新建对内销售单与采购单，保存后公司订单页出现该行；重复保存不产生重复关联行；`link-child` 失败时子单存在且提示可见

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-002, J-003 | `CompanyOrder`、`POST/PUT/DELETE /api/order_hub/orders` | Phase 1 | TEST-001 | AC-001 |
| REQ-002 | J-001, `/backend/orders` | `GET /api/order_hub/orders`、`GET /api/order_hub/stages` | Phase 2 | TEST-001, TEST-004 | AC-002 |
| REQ-003 | J-003, `/backend/orders/<id>` | `orders/links`、`link-child`、下游并集读 | Phase 2, Phase 3 | TEST-002, TEST-004 | AC-003 |
| REQ-004 | J-002, J-003 | `order_hub.orders.links.replace` / `link-child` | Phase 1 | TEST-002 | AC-004 |
| REQ-005 | J-005 | `order_hub/cli.ts` | Phase 1 | TEST-003 | AC-005 |
| REQ-006 | J-002 | 两个表单 + `link-child` | Phase 3 | TEST-004 | AC-006 |
| REQ-007 | J-004 | `lib/companyOrderResolve.ts`、解析页 | Phase 2 | TEST-005, TEST-004 | AC-007 |
| REQ-008 | 全部 | `acl.ts`/`setup.ts` | Phase 1 | TEST-006 | AC-008 |
| REQ-009 | `/backend/orders` | 路由重定义 + 删除 `mergeOrders` | Phase 2 | TEST-001, TEST-002 | AC-009 |
| REQ-010 | 本文档 | docs/README/状态板 | Phase 1–3 | TEST-003（登记） | AC-010 |

## Extension-Surface Traceability

| Requirement | Surface | Capability ID | 效仿的 `src/modules/example/**` 文件 | Phase | 自带集成测试 | 机制分类 |
|---|---|---|---|---|---|---|
| REQ-001 | `order_hub/data/entities.ts`（两实体） | `data.entities` | `src/modules/example/data/entities.ts` | Phase 1 | TEST-001 | emitted-example |
| REQ-001 | 迁移（两表 + 索引/唯一键） | `data.migrations` | `src/modules/example/migrations/Migration20251030150038.ts` | Phase 1 | TEST-001（审阅证据 + 读回） | emitted-example |
| REQ-001, REQ-004 | `order_hub/data/validators.ts` | `data.validators` | `src/modules/example/data/validators.ts` | Phase 1 | TEST-001, TEST-002 | emitted-example |
| REQ-001, REQ-004 | `order_hub/commands/companyOrders.ts` | `commands.write` | `src/modules/example/commands/todos.ts` | Phase 1 | TEST-001, TEST-002 | emitted-example |
| REQ-002, REQ-003 | `api/orders/route.ts`（CRUD） | `api.crud-factory` | `src/modules/example/api/customer-priorities/route.ts` | Phase 1 | TEST-001 | emitted-example |
| REQ-003, REQ-004 | `api/orders/links/route.ts`、`api/orders/link-child/route.ts` | `api.custom-route` | `src/modules/example/api/organizations/route.ts` | Phase 1 | TEST-002 | emitted-example |
| REQ-002 | `api/stages/route.ts`（改键+追加字段） | `api.custom-route` | `src/modules/example/api/organizations/route.ts` | Phase 1 | TEST-002 | emitted-example |
| REQ-005 | `order_hub/cli.ts` | `module.cli` | `src/modules/example/cli.ts` | Phase 1 | TEST-003 | emitted-example |
| REQ-008 | `order_hub/acl.ts` / `setup.ts` 追加 feature | `module.acl-features` / `module.setup-role-features` | `src/modules/example/acl.ts` / `src/modules/example/setup.ts` | Phase 1 | TEST-006 | emitted-example |
| REQ-004 | `order_hub/events.ts` | `module.events` | `src/modules/example/events.ts` | Phase 1 | TEST-002 | emitted-example |
| REQ-001 | `order_hub/index.ts` 模块元数据（不变/不新增） | `module.metadata` | `src/modules/example/index.ts` | — | — | emitted-example |
| REQ-002 | `/backend/orders` 页 + `page.meta.ts`（既有路由改数据源） | `ui.page-shell` | `src/modules/example/backend/todos/page.tsx` | Phase 2 | TEST-004 | emitted-example |
| REQ-002 | 工作台 `DataTable` | `ui.datatable` | `src/modules/example/components/TodosTable.tsx` | Phase 2 | TEST-004 | emitted-example |
| REQ-001 | `/backend/orders/create`、（`/<id>/edit`）`CrudForm` | `ui.form-create` | `src/modules/example/components/TodoForm.tsx` | Phase 2 | TEST-004 | emitted-example |
| REQ-003 | hub 区块（`RelatedSection` 复用） | `ui.page-shell` | `src/modules/example/backend/page.tsx` | Phase 2 | TEST-004 | framework-only |
| REQ-003, REQ-006 | 关联对话框（app 内复用 `ContractOrdersDialog` 模式） | `umes.component-replacement`（最近行） | `src/modules/example/components/ComponentOverrideShowcase.tsx` | Phase 3 | TEST-004 | framework-only |
| REQ-002–REQ-006 | `order_hub/i18n/{zh,en}.json` | `module.i18n-catalogs` | `src/modules/example/i18n/en.json` | Phase 1–3 | 语言纯度由平台测试守 | emitted-example |
| REQ-004, REQ-005 | `lib/companyOrder.ts`（快照/建根共用纯函数 + 单测） | `runtime.tenant-scoped-cache`（最近行） | `src/modules/example/lib/todoSummaryService.ts` | Phase 1 | TEST-005 | framework-only |
| REQ-005, REQ-003 | `lib/orderStages.ts` 改键 | `runtime.tenant-scoped-cache`（最近行） | `src/modules/example/lib/todoSummaryService.ts` | Phase 1 | TEST-002 | framework-only |
| REQ-006 | 两个既有表单的预填 | `ui.form-create` | `src/modules/example/components/TodoForm.tsx` | Phase 3 | TEST-004 | emitted-example |
| REQ-007 | `lib/companyOrderResolve.ts` + 解析页 | `runtime.tenant-scoped-cache`（最近行） | `src/modules/example/lib/todoSummaryService.ts` | Phase 2 | TEST-005 | framework-only |

**未映射的行（诚实登记）：** app 级纯函数 lib（`companyOrder`/`orderStages`/`companyOrderResolve`）与 app 内共享对话框在 `surface-inventory.json` 没有一一对应能力行，用最近行承载并标 `framework-only`；不使用 `negative-fixture`。

## Rollout, Migration, and Rollback

- **迁移生成/应用边界：** 一次迁移（两新表 + 索引/唯一键），`yarn db:generate` 生成、审阅 SQL 与 snapshot 后**提交但不应用**；本机 dev 由 dev supervisor 在下次 `yarn dev` 应用；生产走既有部署流程。
- **数据补录：** 部署/升级时跑一次 `yarn mercato order_hub backfill-company-orders --apply`（dry-run 先看计数）；未跑前工作台为空（新表空）——写进 PR 与 README 的升级步骤。
- **Rollout order:** Phase 1（表/命令/路由/CLI，未被消费）→ Phase 2（工作台/hub/旧 URL）→ Phase 3（预填/关联闭环）。Phase 2 起工作台即依赖新表。
- **Feature flags:** 不使用。回滚粒度 = PR 粒度：回退代码后旧聚合工作台恢复（新表可留空，不参与旧逻辑）；`backfill-company-orders` 只写新表，回滚不需要数据清理。
- **可观测性：** `createLogger('order_hub')` 记录：命令失败、对端解析失败、`stages` 投影异常（每 scope 一行）；工作台/hub 的区块失败在 UI 行内可见。

## Migration & Backward Compatibility

（`.ai/guides/upstream/BACKWARD_COMPATIBILITY.md` 要求：任何触及契约面的 PR 必须引用一份含本节、并在其中说明不兼容影响的 spec。）

| 契约类别 | 本规格的改动 | BC 判定 | 依据 |
|---|---|---|---|
| DB schema | **新增两张表**（含索引/唯一键）；不改任何既有表 | **允许**（`MAY add new tables freely` / `MAY add new indexes freely`） | BC §8 |
| API 路由 | URL 全部保留：`/api/order_hub/orders`、`/api/order_hub/stages` 不删不改方法；新增 `/api/order_hub/orders/links`、`/api/order_hub/orders/link-child` | **允许**（`MAY add new API routes freely`；未 rename/remove） | BC §7 |
| API 响应形状 | `orders.items[]` 重定义为公司订单行（不再是三源合并行）；`stages.items[]` 字段只追加（`counterparty`/`childNumbers`/`kinds`），`ids` 语义由 sales order id 变为 company order id | **披露的破坏性重定义**：两个路由的唯一消费者是本 app 的浏览器 bundle（`grep` 证据：仓库内 `/api/order_hub/` 的调用方只有 `order_hub/components/*`），与路由同 PR 发布，无第三方模块消费 → 不设桥接版本，改为在本节披露 | BC §7 的弃用协议面向跨版本第三方消费者；app 内同发布不构成跨版本契约 |
| ACL feature | 新增 `order_hub.manage`（不动 `order_hub.view`） | **允许**（`MAY add new feature IDs freely`） | BC §10 |
| 事件 | 新增 `order_hub.company_order.*`（不改既有） | **允许**（`MAY add new event IDs freely`） | BC §5 |
| CLI | 新增 `order_hub backfill-company-orders` | **允许**（`MAY add new commands freely`） | BC §13 |
| 页面 | `/backend/orders`（同一 URL，行身份改变）、新增 create/edit（`navHidden`）；`/backend/{internal,external}-sales/orders/<id>` 保持重定向（解析口径升级） | **披露**：行身份变化见 AC-002/AC-007；通知/收藏的旧 URL 由解析保证可达 | BC §2（`PageMetadata` 未改） |
| 函数签名 / import path / DI / 生成物 | 无改动 | **无影响** | BC §3, §4, §9, §14 |

**Deprecations / removals:** 无对外移除；app 内删除 `order_hub/lib/mergeOrders.ts` 与其单测、旧三源扫描逻辑（同 PR 内无消费者）。

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 补录把销售单 1:1 建根，同一笔生意的对内+对外两单会变成两张公司订单 | 操作员需要手工合并（把一张公司订单的子单移到另一张） | 关联对话框支持成套替换（可搬移）；README 写明 | 合并是手工动作，无自动并单 |
| 公司订单号（CO-）与操作员熟悉的 ORDER- 号不同 | 短期认知成本 | 工作台列同时显示子单号；搜索支持子单号 | 用户需要适应新号段 |
| 下游区块「多子单时新建需先选目标子单」 | 操作多一步 | 单子单直连；无子单时禁用并给提示 | — |
| `link-child` 由别的表单调用，权限不足（无 `order_hub.manage`）时关联失败 | 子单存在但没关联 | 提示 + 可手工关联；README/PR 写清 `sync-role-acls` | 非管理员角色需租户自行授权 |
| 跨模块并集读的列名/软删假设错误 | 计数为 0 或查询报错 | 单点实现 `lib/orderStages.ts` + 集成断言；列名以安装源码为准 | 安装层列名变化需同步 |
| 销售单硬删导致关联悬挂 | 冻结快照仍显示，实时读为空 | 冻结快照 + 对端缺失提示；反查解析容忍缺失 | 行保留（有意） |
| 迁移未应用前新表不存在（dev 未重启） | 工作台 500 | PR/README 写明升级步骤；错误在页面可见 | 需要一次 dev 重启 |
| API 载荷重定义影响未识别的第三方消费者 | 未知调用方失效 | `grep` 证据 + 本节披露；URL 不删以便排查 | 仓库外消费者无法穷举 |

## Acceptance Criteria

- [ ] **AC-001** — `POST /api/order_hub/orders` 建单返回 `{id, number}`（`CO-<年>-<4位>`，同 scope 唯一，撞号重试）；`PUT` 用过期 `updatedAt` → 409；`DELETE` 软删后列表不含；跨租户/组织读不到对方行。
- [ ] **AC-002** — `/backend/orders` 每行 = 公司订单（id 可在新表查到）；点击进入 `/backend/orders/<companyOrderId>`；搜索子单号能命中其公司订单；类型/状态过滤与 `GET /api/order_hub/orders` 的返回一致；采购订单不再单独成行。
- [ ] **AC-003** — `/backend/orders/<companyOrderId>` 显示抬头卡与三个关联区块（列出/关联/移除/新建）+ 五个下游区块；每区独立 loading/empty/error+retry；多子单时下游「新建」先选目标子单；`#purchasing`/`#documents`/`#shipments`/`#money` 锚点可达。
- [ ] **AC-004** — `POST /api/order_hub/orders/links`（成套替换）：跨组织/未知引用 422、重复 422、过期版本 409、成功 200 且关联行数/快照与请求一致；`link-child` 幂等（重复调用仍 1 行）；对无根销售单 `link-child` 自动建根并返回 `companyOrderId`。
- [ ] **AC-005** — `yarn mercato order_hub backfill-company-orders`（dry-run）不写库并打印计数；`--apply` 后每张渠道内销售单有 1:1 公司订单与冻结快照、带来源锚的采购单挂到对应根；重跑 `created=0`；未标记销售单被跳过并计数。
- [ ] **AC-006** — 从 hub 区块新建对内/对外销售单或采购单：表单收到 `companyOrderId`（采购单另带 `orderKind/orderId` 时来源锚照写），保存后自动关联并跳回公司订单页；关联调用失败时子单仍存在且页面给出提示；无 `companyOrderId` 的旧入口（报价→订单）自动建根。
- [ ] **AC-007** — 旧 `/backend/orders/<salesOrderId>` 与 `/backend/{internal,external}-sales/orders/<id>` 解析到公司订单页；解析不到时显示「未关联」状态与两个入口（新建公司订单并关联 / 关联到已有），不出现 404 空白或错页。
- [ ] **AC-008** — 无 `order_hub.manage` 的用户：写路由 403、页面 create/edit 门禁拒绝；`order_hub.view` 用户可读工作台/hub；`yarn mercato auth sync-role-acls` 后既有租户管理员获得 `order_hub.manage`。
- [ ] **AC-009** — `GET /api/order_hub/stages?ids=` 对构造数据逐项一致、未知/跨组织 id 不出现在 `items`、超 200/非法 400；旧 `mergeOrders` 与其单测已删除，仓库内无 `mergeOrders` 引用。
- [ ] **AC-010** — 本文件、`order_hub/README.md`、`docs/plans/README.md` 状态板、`docs/plans/cross-border-erp.md` 进度表、`docs/dev/business-architecture.md` 与旧 spec 的标注在同一 PR 内更新。
- [ ] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light-mode, and dark-mode states.
- [ ] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | `AGENTS.md` 三轴路由；`om-spec-writing` + `.ai/guides/spec-delivery.md`；`om-module-scaffold`（含三个必读 references 与 blueprint）；`om-data-model-design`（schema/migration/integrity references）；`om-backend-ui-design` + `.ai/guides/backend-ui.md`；`.ai/guides/contracts.md`；`.ai/guides/upstream/BACKWARD_COMPATIBILITY.md` |
| Data models, APIs, events, UI, and tests are internally consistent | pass | 两个新实体只被 REQ-001/004 引入；每个 UI 面都有 API + TEST 映射；事件/CLI/ACL 各一行 |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001…J-005 分别落在 Phase 1–3 的退出闸门；无「整合收尾」阶段 |
| Platform-native reuse and extension points were chosen before custom code | pass | Reuse 表：`sales`/`purchasing`/`trade_docs`/`cross_border`/`export_finance` 只读并集 + `RelatedSection`/`QuickEditDialog`/对话框模式 + `requestScope` + 渠道解析复用 |
| UI contracts identify references, canonical components, and theme/state coverage | pass | 上表逐面给出最近参考、规范组件与状态；含明暗/窄屏/a11y |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | `## Implementation Phases` 三阶段各有 Depends on/Outcome/Deliverables/Requirements/Tests/Validation/Exit gate |
| Verdict | **Ready for implementation** | 两个结构决策已获 owner 批准（2026-10-09）；无阻塞开放问题 |

## Open Questions

无阻塞问题（owner 2026-10-09 已选定 容器根单 + 全量补录；其余均记入 Resolved decisions）。

## Resolved decisions

| ID | Question | Decision | Rationale / 影响 |
|---|---|---|---|
| Q-001 | 公司订单与三类订单的关系 | **容器根单**：新表存根记录，三类订单仍是各自模块单据，用关联表挂（owner 2026-10-09 选定） | 下游链路零改造；本期完整交付；关联式填入落地 |
| Q-002 | 历史订单 | **全量补录**：渠道内销售单 1:1 建根并关联；采购单按来源锚挂根（owner 2026-10-09 选定） | 工作台不空；旧 URL 可解析 |
| Q-003 | 单号规则 | `CO-<年>-<4位>`，创建时生成，按 `(tenant, org)` 唯一 | 新根单需要自己的号段；子单号在工作台并列显示以便识别 |
| Q-004 | 公司订单状态 | 模块常量 `draft/in_progress/completed/cancelled` + i18n（不引字典） | 与 `purchasing` 同方案；避免第二套状态字典系统 |
| Q-005 | 采购行是否还在工作台 | 不再单独成行；作为公司订单的关联子单（采购台账页仍在） | owner 反馈的“不要跳到采购单模块 item” |
| Q-006 | 未指定公司订单的销售单创建 | 自动建根（`link-child` 幂等） | 保证渠道内销售单必有根；旧入口与旧 URL 不悬空 |
| Q-007 | 下游区块 | 子单并集只读 + 既有预填新建；本期不做直接关联表 | 避免双份关联；链接事实已存在于各模块 |
| Q-008 | 路由载荷重定义 | URL 全保留；`orders.items[]` 重定义、`stages` 只追加字段，二者披露在本规格 | app 内同发布、无第三方消费者（grep 证据） |

## Changelog

| Date | Change |
|---|---|
| 2026-10-09 | Initial draft — owner approved 容器根单 + 全量补录; 三阶段（数据地基 / 工作台与 hub / 预填闭环） |
