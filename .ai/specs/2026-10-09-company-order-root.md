# 公司订单根单化（company order as a first-class root entity）

**Date**: 2026-10-09
**Status**: Phases 1–3 Delivered（PR `feat/company-order-root`，已合入 `dev` f26112b）；**第四轮 Delivered**（PR `feat/company-order-collaboration`，已合入 `dev` 8905b6b）；**第五轮 Delivered**（PR #153，已合入 `dev` dc119ba，含 CSP 修复）：宽门禁全绿（82 suites · 661 tests）+ 集成 `--filter order_hub` 35 passed + 浏览器实测（工作台金额列 / 全字段抽屉 / 无号草稿可选中 / 协作账号列文件与下载）。**第六轮 Delivered**（PR #152，off `dev`）：订单状态换成 7 个业务阶段（已下单→生产→工厂提货→已报关→已装运→路上→到仓库；旧值保留兼容、不回填）+ 根单「是否已收款」（已收全款/未收款），迁移 `Migration20261009064750_order_hub.ts`（加列 + `status` 默认值，无回填）。证据（第六轮，合入第五轮后的合并树）：单测 `src/modules/order_hub` 5 suites · 29 tests；ephemeral 集成 `--filter order_hub` **36 passed**；宽门禁 83 suites · 665 tests + build 全绿；浏览器实测（建单页 7 值下拉 + 是否已收款默认未收款、编辑保存后 hub「已收全款」+ DB 回读、工作台新词表与旧值徽章并存）。**第七轮 Delivered**（字段级附件槽位，PR #157，已合入 `dev` d867630）：10 个命名槽位一字段一附件位（`order_hub_company_order_documents`）+ `documents.bySlot` 汇总 + hub「单据与文件」区块与抽屉按槽位；证据：集成 `--filter order_hub` 42 passed + 浏览器实测（槽位上传/确认删除/抽屉/协作只读+字节一致）。**第八轮 Delivered**（PR #156，owner 反馈）：工作台行改显根单自身字段（编号/标题/下单日期/预计交货/状态/是否已收款/默认客户/默认供应商），与详情页抬头卡同序，`子单号`/`对方` 两列退役。证据：单测 `src/modules/order_hub` 9 suites · 53 tests；宽门禁 86 suites · 682 tests；浏览器实测（表格与抬头卡同值）。证据（前四轮）：`yarn typecheck` 全仓干净；`yarn jest src/modules/order_hub` 3 suites · 28 tests；ephemeral 集成 `company-orders` 6 / `company-order-links` 9 / `company-order-backfill` 3 = **18 passed**；浏览器实测（工作台=公司订单、点进 hub、关联对话框成套替换、旧 URL 归位、「未关联」一键建根、采购/对内销售预填+自动关联、暗色/窄屏/键盘）。迁移应用现状：`order_hub` 全部迁移已由本机 dev supervisor 应用（生产走既有部署流程）；升级步骤（迁移 + `backfill-company-orders --apply` + `auth sync-role-acls`）见模块 README。 **第九轮 Delivered**（PR #154，off `dev`；原编号「第六轮」，落地时后移）：hub 板块布局 + 对内/对外合并「销售订单」区块、行「点开」= 右侧只读预览抽屉、「编辑」独立按钮、`?returnTo=` 返回本页、无状态子单行不再渲染空徽标、hub 抬头「全字段」入口收敛到工作台行操作。证据见「第九轮」节与 run record。 **第十轮 Delivered**（`feat/company-order-round10`，off `dev` `caa5598`，PR 见 run record）：**根单持有**——`order_hub_company_orders` 加 `product_category`/`owner_user_id`/`owner_snapshot` 三列（迁移 `Migration20261010025411_order_hub.ts`，已在本地开发库应用），公司订单表单/抬头卡是唯一入口；采购单侧只读并镜像（新事件 `order_hub.company_order.order_fields_updated` + `purchasing` 订阅者），两个表单去掉这两格；hub 采购行显示 订单金额/预付款金额/尾款金额（实际口径）；工作台列改名「订单金额」且取值采购优先；采购单列表列改造 + 行操作「打开公司订单」；采购单详情撤回第三轮三区块（来源单号回到抬头摘要格）；供应商产品库新增 Excel 导入（表头探测 + 别名映射 + 复核 + 逐行复用 create 契约落库）。证据：宽门禁（`yarn generate && yarn typecheck && yarn lint && node scripts/check-lessons.mjs && yarn ds:check && yarn test && yarn build`）全绿 + 浏览器实测七个点（见 AC-036…AC-042）。 **第十轮复查 Delivered**（owner 2026-10-10 复看 5 点）：采购行改「打开详情」、子单状态按状态配色、行内新增 定金比例/备注、已落库的移除/取消类动作统一二次确认（REQ-047…REQ-050 / TEST-034–035 / AC-043…AC-046）。 **第十轮复查·二 Delivered**（owner 同日再复看 5 点）：采购单详情补齐可填字段与行「单价含税」、抬头「打开公司订单」、列表关联状态先算后显、锁定项灰态、单证入口退休并清空历史数据（REQ-051…REQ-055 / TEST-036 / AC-047…AC-051）。**第十轮复查·三 Delivered**（owner 2026-10-10 再复看 2 点）：采购单列表的公司订单动作并入行「⋯」菜单（未关联＝菜单内置灰项）、详情「单证」只读镜像根单「单据与文件」（REQ-056…REQ-057 / TEST-037–039 / AC-052…AC-053）。

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
2. 列表每行是一张公司订单，列就是**根单自己的字段**（编号/标题/下单日期/预计交货/状态/是否已收款/默认客户/默认供应商/金额/四个阶段列），与订单页抬头卡同序同义；输入 `ORDER-…` 子单号也能搜到它所在的公司订单（子单号本身在订单页的关联区块里读）；类型筛选「有采购」只留挂过采购单的根。
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
│ 编号 | 标题 | 下单日期 | 预计交货 | 状态 | 是否已收款 | 默认客户 | 默认供应商 | 金额 | 采购|发运|单证|收汇退税 | ⋯全字段 │
│ CO-2026-0001 | 秋冬季订单 | 2026-10-01 | 2026-11-30 | 进行中 | 已收全款 | ABC 贸易 | XYZ 工厂 | ¥2,000 | 2|1|3|— | 抽屉 │
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
| `status` | text NOT NULL default `placed` | — | no | 枚举（第六轮：`placed`…`warehoused`；旧值仍可存储）；400 on invalid |
| `payment_status` | text NULL | — | no | 第六轮：`paid_full`/`unpaid`；NULL=未记录（历史行） |
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
| `GET` | `/api/order_hub/orders/links` | `order_hub.view` | `{companyOrderId?,refId?,kind?,page,pageSize}`（`companyOrderId` 与 `refId` 至少一个，都缺 → 400；`refId` 是旧 URL/未关联状态的反查） | `{items:[{id,kind,refId,refNumber,refCounterparty,refSnapshot,updatedAt}],total}` | 400/403 | REQ-003, REQ-007 |
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
| TEST-007 | integration | 两组织 + parties/供应商夹具 | create 带主体与 `links`；未知/跨组织；清空 | 见「第四轮」节 | REQ-011, REQ-012 |
| TEST-008 | integration | 所有者 + 协作 + 无关组织 | collaborators.replace；三视角读；协作者写 status/title | 见「第四轮」节 | REQ-014, REQ-016 |
| TEST-009 | integration | 根单 + 小文件 | attachments 上传/列表/删除 | 见「第四轮」节 | REQ-015 |
| TEST-010 | UI（浏览器） | 上述夹具 | 建单/协作视图/文件三条链路 | 见「第四轮」节 | REQ-011…REQ-016 |

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
| REQ-011 | 建单页 / 抬头卡 | `company_orders` 4 列；`create`/`update` 校验+冻结 | Phase 4.A | TEST-007 | AC-011 |
| REQ-012 | 建单页「关联已有单据」 | `create.links[]` 同事务落关联 | Phase 4.A | TEST-007 | AC-012 |
| REQ-013 | 两个子单新建表单 | `?companyOrderId=` → 默认买方/供应商 | Phase 4.A | TEST-010 | AC-013 |
| REQ-014 | hub「协作组织」+ 命令 | `collaborators` 表；`collaborators.replace`；`update` 字段白名单 | Phase 4.B | TEST-008 | AC-014 |
| REQ-015 | hub「文件」区块 | installed `attachments`（entityType/recordId） | Phase 4.C | TEST-009 | AC-015 |
| REQ-016 | 工作台协作标记 / hub 入口收敛 | 列表 scope 并入协作集；UI 隐藏 | Phase 4.B | TEST-008 | AC-014 |
| REQ-017 | hub 全字段入口 / 工作台金额列 | `GET /orders/fields`；`stages` 追加 `amounts` | Phase 5.A | TEST-011, TEST-014 | AC-017 |
| REQ-018 | hub 文件区块（所有者为上传点） | `GET /orders/attachments`（+`[id]` 字节代理） | Phase 5.B | TEST-012, TEST-014 | AC-018 |
| REQ-019 | 建单选单 / 关联对话框采购 picker | loader 合并 + 客户端回退过滤 | Phase 5.C | TEST-013, TEST-014 | AC-019 |
| REQ-020 | 订单状态词表（生命周期 7 值） | `COMPANY_ORDER_STATUSES` + 旧值兼容 + 默认 `placed` | 第六轮 | TEST-015, TEST-016 | AC-020 |
| REQ-021 | 根单「是否已收款」字段 | `payment_status` 列 + 表单/hub + 三态语义 | 第六轮 | TEST-015, TEST-016 | AC-021 |
| REQ-022 | 槽位表（一字段一附件位） | 新表 `order_hub_company_order_documents` + 唯一键/索引 | Phase 7.A | TEST-017, TEST-019 | AC-022 |
| REQ-023 | 槽位 API（登记/列表/删除） | `GET\|POST\|DELETE /api/order_hub/orders/documents`；上传走 installed | Phase 7.A | TEST-017, TEST-019 | AC-022, AC-023 |
| REQ-024 | 字节代理支持槽位附件 | `GET /orders/attachments/<id>` 扩展 `order_hub:company_order_document` | Phase 7.A | TEST-017 | AC-023 |
| REQ-025 | 汇总 `documents.bySlot` + 抽屉按槽位 | `loadCompanyOrderFields` 扩展（向后兼容） | Phase 7.B | TEST-018 | AC-022, AC-024 |
| REQ-026 | hub「单据与附件」区块 | 新组件 `OrderDocumentsSection.tsx`；通用区保留 | Phase 7.B | TEST-018 | AC-020…AC-022 |
| REQ-027 | 槽位写入权限（仅所有者） | 命令所有权校验 + 事件 | Phase 7.A | TEST-017 | AC-023 |
| REQ-028 | 工作台行 = 根单自身字段（去 `子单号`/`对方`） | `components/companyOrderDisplay.ts`（纯解析） | 第八轮 | TEST-021, TEST-022 | AC-025 |
| REQ-029 | hub 出口销售合并区块 | `orders/links` 读法不变；对话框种类选择 | 第九轮 | TEST-025 | AC-026 |
| REQ-030 | 采购单「订单描述」字典切换 | `PRODUCT_CATEGORY_DICTIONARY_KEY` → `product_category` | 第九轮 | TEST-025 | AC-027 |
| REQ-031 | 公司订单表单去「标题」 | `useCompanyOrderFields` 去字段；载荷不含 `title` | 第九轮 | TEST-025 | AC-028 |
| REQ-032 | 抬头「客户/供应商」改名 | i18n `header.customer/supplier` | 第九轮 | TEST-025 | AC-029 |
| REQ-033 | hub 板块布局 | `SectionHeader` + 既有锚点；新增 `#sales` | 第九轮 | TEST-025 | AC-030 |
| REQ-034 | 关联记录预览抽屉 | `LinkedRecordPreviewDrawer` + `linkedRecordPreviewSources` | 第九轮 | TEST-024, TEST-025 | AC-031 |
| REQ-035 | `?returnTo=` 返回 | `src/lib/navigation/returnTo.ts` + 各模块消费 | 第九轮 | TEST-023, TEST-025 | AC-032 |
| REQ-036 | 全字段抽屉分组空态 | 第五轮 `GET /orders/fields` 投影；无关联分组「未关联」 | 第九轮 | TEST-025 | AC-033 |
| REQ-037 | 子单行无状态不渲染徽标 | `components/companyOrderChildStatus.ts`（纯函数） | 第九轮 | TEST-026, TEST-025 | AC-034 |
| REQ-038 | hub「全字段」入口收敛到工作台 | `OrderDetail.tsx` 移除入口；`OrderWorkbench.tsx` 保留 | 第九轮 | TEST-025 | AC-035 |

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

## 第四轮 — 起手信息、母子协作与附件（2026-10-09，owner 已定口径）

**背景**：owner 给出原飞书多维表格的 35 列字段清单，并明确三条口径（2026-10-09 答复）：

1. **建单抓起手信息**：可选客户/供应商（主体，用作子单预填默认）+ **建单时直接关联已有销售/采购单**（一步建根+挂单）。
2. **协作组织白名单 + 状态可写**：根单加「协作组织」，被授权子公司可见并可改「订单状态 + 备注」（其它只读）。
3. **先加公司订单「文件」区块**：未拆细的文件（水单/证明/盖章件…）先挂根单，后续再逐个拆到模块。

### 字段归属（35 列 → 承载方）

| 飞书列 | 承载方（现状） | 本轮动作 |
|---|---|---|
| 订单号 / 下单日期 / 预计交货 / 备注 | 公司订单 `number` / `orderDate` / `etaDate` / `notes` | 不动 |
| 订单状态 | 公司订单 `status` | **协作组织可写**（REQ-014/016） |
| 客户名称 / 供应商名称 / 采购负责人 | 销售单 `customer_snapshot`、采购单 `supplier_snapshot`/`owner_snapshot`（已冻结进关联行） | 根单增**默认客户/供应商**（REQ-011/013），显示仍以子单冻结值为准 |
| 订单金额 / 预付款·尾款 / 运输日期 | 子单金额、采购付款行、发运里程碑（只读聚合） | 留后续（建议下一轮做「35 字段汇总」；本轮不做） |
| INV.NO / Invoice / 箱单 / 电放提单 / 中国报关单 / 订舱运杂费水单及发票 / 国内段运费水单及发票 / 采购水单及发票 / 涉外收入证明 / KC INVOICE 盖章 | `trade_docs` 单据与合同、`cross_border` 出口单证（`EXPORT_DOC_TYPES` 已覆盖）、`export_finance` 收汇/退税 + 各模块附件 | 留后续（汇总读） |
| 购销合同 / KC 订单价格 / USD | 合同区块、合同 `finance_total`、币种 | 不动 |
| 是否已收款 / 退税状态 / 退税金额 | `export_finance`（按采购单/柜） | 不动 |
| 未拆细的文件 | 现无根单层落点 | **文件区块**（REQ-015） |

### REQ（本轮）

- **REQ-011** — 根单增可选 **默认客户**（`customer_party_id` + `customer_snapshot`，来源 `parties` 的 buyer 选项源）与 **默认供应商**（`supplier_id` + `supplier_snapshot`，来源 `purchasing/suppliers`）；create/update 命令做 scoped 存在性校验（不存在/跨组织 → 422）并冻结快照；可显式清空（含部分更新不得把「字段缺席」当清空）。
- **REQ-012** — **建单即关联**：`order_hub.orders.create` 接受可选 `links: [{ kind, refId }]`（≤20），与建根在**同一事务**内解析、冻结快照并落关联（重复/未知/跨组织 → 422）；建单表单给出「关联已有单据」两个搜索多选（对内/对外销售单按贸易类型通道、采购单）。
- **REQ-013** — **子单预填默认**：经 `?companyOrderId=` 进入 `internal_sales`（对内/对外）与 `purchasing` 新建表单时，读取根单默认客户/供应商作为**未填时**的买方/供应商默认；读取失败静默降级、不阻断（操作员手填优先）。
- **REQ-014** — **协作组织**：新表 `order_hub_company_order_collaborators`（唯一 `(company_order_id, organization_id)`）；所有者可在 hub 管理（组织选择器来自 directory 可见树、排除自身组织）；被授权组织**可见**该根单，除 `status`+`notes` 外只读；命令 `order_hub.orders.collaborators.replace`（成套替换、乐观锁、仅所有者）。
- **REQ-015** — **文件区块**：根单详情页「文件」区块复用 installed `attachments`（表单域 `entityId='order_hub:company_order'`、`recordId=根单 id`；列表/删除/预览同模块既有路由）：上传/列出/删除/预览；权限沿用 attachments 自身门禁；区块级失败隔离。
- **REQ-016** — **协作可见性落地**：工作台对协作行显示「协作」标记；协作组织使用者的 hub 只提供 状态/备注 编辑入口；**授权仍由服务端命令白名单强制**（UI 隐藏不代替授权）。

### 数据模型（增量）

| 位置 | 增量 |
|---|---|
| `order_hub_company_orders` | `customer_party_id uuid null`、`customer_snapshot jsonb null`、`supplier_id uuid null`、`supplier_snapshot jsonb null`（均可清空） |
| 新表 `order_hub_company_order_collaborators` | `id`/`tenant_id`/`organization_id`（协作方组织）/`company_order_id`（FK cascade）/`created_at`/`updated_at`；唯一 `(company_order_id, organization_id)`；索引 `(organization_id, tenant_id)`（反查「我能看到哪些协作根单」） |

迁移由 `yarn db:generate` 生成、审阅后提交（含既有 4 列的追加与 1 张新表），不应用。

### 读路径与写路径（协作可见性）

- **列表读**（`GET /api/order_hub/orders`）：`orm.orgField: null` 关闭 factory 的单一组织过滤，scope 由 `buildFilters` 统一施加为**显式可见 id 集**：先读「`organization_id ∈ 我的可见组织集` **或** 我是其协作组织的根单 id」，列表/筛选/`?id=`/`?ids=` 都在这一个集合上做交（空集 → 哨兵 id → 合法空页）。**实现期更正**：最初用 `$or` 主形式，实测引擎在「顶层 `id` 过滤 + `$or` 子树」并存时 OR 组不再匹配（协作组织的 search/`?ids=` 读全空），因此落地为 id 集形式（原记的「contingency」即此）；`links` 读同法。协作可见性由集成测试三视角证明。
- **读投影**（`stages`/`links`）：scope 同样并上「我是协作组织」的根单集合。
- **写**（`update`）：命令内判定「所有者组织 vs 协作组织」——协作者只接受 `status`/`notes`（含显式 `null`），payload 出现其它键 → 422；`delete`、`collaborators.replace`、`links.replace`、`link-child`（对已存在的根单）仅所有者。
- **一个子单只属于一张公司订单**（2026-10-09 实现期口径）：`create.links[]` 与 `links.replace` 在落关联前先把这些 `(kind, refId)` 在调用方可见 scope 内的**其它**根单关联行删掉（同一事务内“移动”），因此「在另一个根上重挂同一张子单」= 搬移而不是 422；`link-child` 带显式目标时沿用幂等语义（已挂时返回现有根、不搬）。搬移会向被移出的根发 `links.updated` 并失效其缓存。
- **权限**：协作组织使用者写状态仍需 `order_hub.manage`（租户角色配置），README 写明。

### UI

- 建单页 `/backend/orders/create`：+ 默认客户（buyer 选项源）、默认供应商（供应商选项源）、「关联已有单据」（销售/采购两个搜索多选）；保存一次完成「建根 + 挂单」。
- 抬头卡：默认客户/供应商（可清空、显示为名称快照）+ 「协作组织」对话框（组织多选、保存成套替换、带 `updatedAt`）；协作者视图隐藏 编辑/删除/关联 等入口，只留 状态/备注。
- 工作台：协作行加「协作」标记（不改变其它列与筛选）。
- 「文件」区块：`RelatedSection` 壳 + 上传/列表，预览复用 `@/lib/attachments/AttachmentPreview`；新增 app 级共享件 `src/lib/attachments/AttachmentsSection.tsx`（本期只被本区块使用，便于后续替换其它模块的副本）。

### Implementation Phases（第四轮）

- **Phase 4.A（REQ-011/012/013）** — 4 列 schema + create/update 校验与冻结 + create 的 `links` 同事务落关联 + 建单页三个控件 + 两个子单表单的默认预填。Tests：TEST-007、TEST-010（A 段）。Exit：建单一次带上主体与 1 张销售单 + 1 张采购单，工作台立即可见；未知/跨组织引用 422。
- **Phase 4.B（REQ-014/016）** — collaborators 表 + 读路径改造 + 命令白名单 + hub/工作台 UI。Tests：TEST-008、TEST-010（B 段）。Exit：所有者把 A 组织加入协作 → A 组织账号的工作台可见该行、hub 只能改状态/备注；无关组织不可见；越权改其它字段 422。
- **Phase 4.C（REQ-015）** — 文件区块 + 共享件。Tests：TEST-009、TEST-010（C 段）。Exit：上传/列出/预览/删除在根单工作。

### Integration Coverage（第四轮）

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-007 | integration | 两组织 + parties/供应商夹具 | create 带 `customerPartyId`/`supplierId`/`links`（销售+采购）；再试未知/跨组织引用；清空主体 | 201 且快照冻结、关联行同事务可见；422；显式清空读回 null | REQ-011, REQ-012 |
| TEST-008 | integration | 所有者组织 + 协作组织 + 无关组织 | `collaborators.replace`；协作组织读列表/hub；协作组织 PUT status/notes；协作者 PUT title；无关组织读 | 200/可见；status 200；title 422；无关不可见 | REQ-014, REQ-016 |
| TEST-009 | integration | 根单 + 小文件 | `POST /api/attachments`(entityType/recordId) → 列表 → 删除 | 列表回该件、删除后不回；跨组织不可见 | REQ-015 |
| TEST-010 | UI（浏览器） | 上述夹具 | 建单页主体+关联、协作者视图、文件区块 | 三条链路各自可见结果；暗色/窄屏/键盘 | REQ-011…REQ-016 |

### Acceptance Criteria（第四轮）

- [x] **AC-011** — 建单页可选客户/供应商并在保存后读回（名称快照）；显式清空读回 `null`；未知/跨组织主体 422。*证据：integration `company-order-create-fields`（4 passed）+ 浏览器建单读回「Default customer/supplier」。*
- [x] **AC-012** — 建单页勾选 1 张销售单 + 1 张采购单 → 一次保存后工作台与 hub 立即出现两行（冻结单号/对方），无手动关联步骤。*证据：浏览器实测（`ORDER-20261009-00001` + 采购单同现）+ integration create-fields。*
- [x] **AC-013** — 带 `?companyOrderId=` 打开对内/对外销售单或采购单新建页时，买方/供应商按根单默认预填；手填值不被覆盖；根单无默认时行为与今天一致。*证据：Phase 3 浏览器实测 + 本轮实现（字段为空才填）。*
- [x] **AC-014** — 协作组织账号：工作台可见带「协作」标记的根单；hub 只能改状态/备注（其它字段 422 且入口不显示）；无关组织不可见；所有者可管理协作组织列表（成套替换 + 409）。*证据：integration `company-order-collaborators`（4 passed）+ 浏览器实测（分公司账号 hub 只显示「Update status and notes」；写状态后 API 读回 `in_progress`；hub 对话框成套保存）。*
- [x] **AC-015** — 根单「文件」区块上传/列出/预览/删除可用；读失败只影响该区块。*证据：integration `company-order-files`（1 passed）+ 浏览器实测（上传 → 行显示名称/大小/日期 + Preview/Download）。*
- [x] **AC-016** — 迁移为「4 列追加 + 1 张新表 + 索引」，审阅后未应用；README/spec/状态板同步更新。*证据：`Migration20261009044102_order_hub.ts` + `Migration20261009051049_order_hub.ts`（均未应用；`yarn db:generate` 复跑 no changes）。*

### Migration & Backward Compatibility（第四轮）

| 契约类别 | 改动 | 判定 |
|---|---|---|
| DB schema | `order_hub_company_orders` 追加 4 个可空列；新增 `order_hub_company_order_collaborators` 表 + 索引 | 允许（MAY add new columns with defaults / MAY add new tables freely） |
| API 请求 | `POST /api/order_hub/orders` 追加可选 `customerPartyId`/`supplierId`/`links`；`PUT` 追加可选同名主体字段 | 允许（MAY add new optional fields） |
| 命令 | 新增 `order_hub.orders.collaborators.replace`；`create` 输入扩展 | 允许（MAY add freely） |
| 读路径 | 列表/汇总的 scope 并入「协作组织」——**授权行为变化**：被显式加入协作的组织由「不可见」变为「可见」，属 owner 要求的行为，README 披露 | 披露 |
| 附件 | 复用 installed `attachments`，不改其契约 | 无影响 |

### Risks（第四轮）

| 风险 | 缓解 |
|---|---|
| 列表 scope 脱离 factory 单一组织过滤后漏加条件 | 集成测试显式覆盖「所有者/协作/无关」三视角；`orgField: null` 的注释写明这是唯一 scope 施加点 |
| 协作者越权写其它字段 | 命令层字段白名单（服务端），UI 隐藏只是 UX |
| 子单预填覆盖操作员手填 | 只在字段为空时填；读取失败静默降级 |
| 建单 `links` 与既有 link-child 口径漂移 | 复用 `loadCompanyOrderRefs`/`persistCompanyOrderLink` 同一实现 |

---

## 第五轮 — 35 列汇总、附件协作可见与草稿单据可选（2026-10-09）

**背景**：owner 2026-10-09 确认实作三件（第 4 项「订单描述长文本」不做）：① 35 列字段汇总到公司订单视角；② 协作组织能看到所有者名下的文件（当前被 attachments 的组织作用域挡住）；③ 建单/关联选择器里**草稿采购单**（无单号）必须能被选到。

### REQ（本轮）

- **REQ-017 — 公司订单「全字段」汇总（只读）**：新增 scoped 只读投影（`lib/companyOrderFields.ts`，照 `orderStages.ts` 的跨模块投影法），按根单汇总并分组返回：
  - **金额（按币种分组，跨币种一律不加总）**：`sales` = Σ 销售子单 `grand_total_gross_amount`；`purchase` = Σ 采购子单 `total`；`deposit` = Σ 采购子单 `deposit_amount`；`paid`/`outstanding` = Σ 采购付款行推导（与采购模块「应付 = 总额 − 已付」同口径）。
  - **日期**：`orderedAt`（根单 `order_date`）；`expectedDeliveryAt`（根单 `eta_date`）；`shippedAt` = 关联发运单最早的 `departed_at`（缺失时取里程碑最新一条的 `occurred_at`）。
  - **单据（INV.NO 等）**：关联子单的 `trade_docs_order_documents` 行 + 其合同的 PI/CI/税务发票 → 按 kind 汇总单号列表（INV.NO = `commercial` 的单号）。
  - **发运层级单证**：关联发运单的 `cross_border_export_documents` 按 `doc_type` 汇总（`customs_declaration` 报关单 / `telex_release` 电放提单 / `domestic_freight_receipt` 国内段运费水单 / `booking_charges_receipt` 订舱运杂费水单 / `bill_of_lading` 提单 / `packing_list` 箱单）：每类给 `count` + 最近一行的 `number`/`attachmentId` 是否存在。
  - **采购水单及发票**：关联采购子单及其付款行的附件条数（installed `attachments` 按 `entityId`/`recordId` 计数，只读）。
  - **财务**：`collections` = 关联采购子单的收汇档案（状态 + 涉外收入证明 `doc_type` 是否存在）；`refunds` = 关联发运单的退税档案（状态 + 金额，按币种）；KC 盖章 = 关联合同的 `attachment_id` 是否存在。
  - **接口**：`GET /api/order_hub/orders/fields?companyOrderId=`（`order_hub.view`；scope 与列表一致：所有者组织或协作组织，否则空对象）。**UI**：hub 的「全字段」入口改为渲染本投影（分组：订单 / 金额与日期 / 单证与文件 / 财务，只读，缺失项显示「—」）；工作台行新增**金额列**（`summaries` 追加 `amounts`，按币种展示销售金额，无销售子单时显示采购金额）。
- **REQ-018 — 附件协作可见**：新增 order_hub 侧的两条只读路由，以**根单可见性**（所有者或协作组织）授权，代理 installed `attachments` 的字节：
  - `GET /api/order_hub/orders/attachments?companyOrderId=` → 列出该根单（`entityId='order_hub:company_order'`、`recordId=根单 id`）的附件（id/文件名/大小/时间）。
  - `GET /api/order_hub/orders/attachments/[id]?download=1` → 代理字节（同 installed 路由的头：content-type/文件名/inline 或 attachment）。
  - 授权：先按 `companyOrderId` 可见性校验（列表路由），单文件路由按其所属记录反查根单再校验；**上传/删除仍走 installed 路由**（`attachments.manage` + 所有者组织），协作组织在 UI 上只看到列表/预览/下载。文件区块改用本模块的列表/字节路由（上传入口保持 installed）。
- **REQ-019 — 草稿单据可选**：建单表单的采购单多选（`companyOrderOptions.ts` 的 `loadPurchaseOrderLinkOptions`）与 hub 关联对话框的采购 picker 在按单号搜不到时**回退**：并行取「无 search 的第 1 页 + 带 search 的第 1 页」，合并去重后按 `number` / 供应商名 / 标签（含无号草稿的 id 前缀）做客户端过滤；无号草稿因此可以被选到。

### Integration Coverage（第五轮）

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-011 | integration | 根单 + 销售子单（1 行）+ 采购单（定金 + 付款）+ 合同/PI + 发运单（含报关单/电放提单附件）+ 收汇/退税档案 | `GET /orders/fields?companyOrderId=` | 各分组字段与构造一致（金额按币种、定金/已付/应付、运输出运日、INV.NO 列表、按 doc_type 的计数、收汇/退税状态与金额、KC 盖章）；无关组织得到空对象 | REQ-017 |
| TEST-012 | integration | 根单 + 1 个附件；所有者组织 + 协作组织 + 无关组织 | order_hub 附件列表/字节路由 | 所有者与协作组织都能列出并下载（字节一致）；无关组织列表空、字节 404/403；上传仍走 installed 路由（协作组织 403） | REQ-018 |
| TEST-013 | unit | 纯函数夹具（选项合并/过滤） | loader 合并 + 过滤 | 无号草稿（供应商名/id 前缀命中）出现在候选；重复 id 去重；空输入不报错 | REQ-019 |
| TEST-014 | UI（浏览器） | 上述夹具 | hub 全字段入口 / 协作组织看文件 / 建单选无号草稿采购单 | 三条链路各自可见结果 | REQ-017…REQ-019 |

### Acceptance Criteria（第五轮）

- [x] **AC-017** — hub「全字段」显示 金额(按币种)/日期/单据号(含 INV.NO)/按类型的发运单证计数/采购水单与发票条数/收汇与退税/ KC 盖章；工作台金额列与投影一致；无关组织读不到。证据：TEST-011（集成 3 passed）+ 浏览器实测（金额 `CN¥36.00 · $999.98`、四组抽屉、发运单证 `报关单·1·CD-MV0M1RC9`、`收汇 Received·证明 yes`、`退税 Applied CN¥130.00`）；不可见根返回 `{}`。
- [x] **AC-018** — 协作组织账号能在文件区块**列出并下载**所有者的文件（字节与所有者下载一致）；上传/删除入口对协作组织不可见且服务端拒绝；无关组织读不到。证据：TEST-012（集成 4 passed）+ 浏览器实测（协作账号 Files 区块列出文件、无上传按钮）；字节 sha 一致（admin installed / admin 代理 / 协作 `?download=1`）；无关组织数据由集成断言覆盖；实测修复了 `next.config.ts` 缺 CSP 豁免的问题。
- [x] **AC-019** — 建单表单与关联对话框的采购选择器能搜到**无单号草稿**（按供应商名或 id 前缀），且原有按单号搜索不受影响。证据：TEST-013（单测 7 passed，含合并去重与无号草稿命中）+ 浏览器实测（输入供应商名后选项含无号草稿标签 `c878e786-…`，点选成为 chip）。

### Migration & Backward Compatibility（第五轮）

| 契约类别 | 改动 | 判定 |
|---|---|---|
| API | 新增 `/api/order_hub/orders/fields`、`/api/order_hub/orders/attachments`（+`[id]`）；`stages` 响应**追加** `amounts` | 允许（新路由自由添加 / 响应只追加） |
| DB | 无 schema 变更 | 无影响 |
| 行为 | 文件区块改走本模块代理路由（对所有者等价）；采购 picker 回退搜索（更宽松） | **披露**（更宽松，不破坏既有选择） |

### Risks（第五轮）

| 风险 | 缓解 |
|---|---|
| 代理字节路由绕开 installed 的组织作用域 | 授权只放给「根单可见」的调用方（owner/协作），先查根单再取字节；不返回非本根单记录 id 的文件；字节与文件名沿用 installed 头 |
| 代理响应的沙箱 CSP 被 `next.config.ts` 的全站 CSP 覆盖 | 已按 installed 文件路由同法在 `next.config.ts` 为 `'/api/order_hub/orders/attachments/:id'` 单独豁免（实测：修复后响应头为 `default-src 'none'; sandbox`） |
| 跨币种加总 | 投影一律按币种分组返回，UI 不做换算（全站 CNY 换算由既有组件负责，本投影不参与） |
| 汇总读放大 | 每段一次 scoped 批量查询（与 `orderStages` 同法），单根单上限由关联子单数（≤20）与既有查询约束控制 |

---

## 第六轮 — 订单状态词表与「是否已收款」（2026-10-09，owner 口径）

**背景**：owner 2026-10-09 在 `/backend/orders/create` 反馈两件：① 订单状态改用业务词表（已确认**替换**现有 草稿/进行中/已完成/已取消，并**按业务流转排序**）：已下单 → 生产 → 工厂提货 → 已报关 → 已装运 → 路上 → 到仓库；② 新增「是否已收款」字段（选项 已收全款 / 未收款，新单默认 未收款）。35 列清单里的 `是否已收款` 本期落成**根单自己的手工标记**（owner 的表格习惯：订单行上一格两态）；`export_finance` 的按采购单收汇档案（含金额/日期/涉外收入证明）**不动**，两者语义不同、各自服务自己的读方。

### REQ（本轮）

- **REQ-020 — 订单状态词表替换（≥1 版本兼容）**：`COMPANY_ORDER_STATUSES` = `placed`/`in_production`/`factory_pickup`/`customs_declared`/`shipped`/`in_transit`/`warehoused`（生命周期序）；新建默认 `placed`，DB 列默认同步改 `placed`。旧值 `draft`/`in_progress`/`completed`/`cancelled` 保留为**可存储值**（`COMPANY_ORDER_STORED_STATUSES`）：校验与列表筛选继续接受、i18n 标签与徽章配色保留；编辑表单与「修改状态」对话框用 `companyOrderStatusOptions(当前值)`（当前词表 + 该行自己的旧值），使无关保存不会静默改写状态。新建路径不再产生旧值；补录 CLI 例外——历史销售单为 `draft`/`cancelled` 时保留其原义（由人再次编辑可迁入新词表）。
- **REQ-021 — 根单「是否已收款」**：新增 `payment_status`（`paid_full`/`unpaid`），**可空**：迁移前已存在的行渲染为「—」而不是替它回答「未收款」。建单表单默认 `unpaid`（owner 口径）；命令在字段**缺席**时默认 `unpaid`、显式 `null` 存 null（三态：值/清空/不变，照 `partial-update` 两课的口径）；hub 抬头卡显示该标记；协作组织白名单仍只有 `status`/`notes`（该字段 422）。

### Integration Coverage（第六轮）

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-015 | unit | 纯 schema/词表 | `companyOrderStatusOptions`；create/update `parse` | 选项=当前 7 值（+该行旧值）；旧值可解析、未知值 400；paymentStatus 三态（值/显式 null/缺席） | REQ-020, REQ-021 |
| TEST-016 | integration | 默认建单；显式 `in_progress` + `paid_full` 的历史行；版本锁更新 | `POST`/`GET`/`PUT` + `?status=` 筛选 | 新单 `placed`/`unpaid`；显式值回读一致；旧状态值可写可读可筛；`shipped`+`paid_full` 更新落地 | REQ-020, REQ-021 |

### Acceptance Criteria（第六轮）

- [x] **AC-020** — `/backend/orders/create` 状态下拉只有这 7 个业务值（生命周期序）、新单默认「已下单」；旧值行仍按原标签显示且可原样保存（不 400）；工作台状态筛选与徽章同词表。*证据：浏览器实测（下拉 7 值 + 默认已下单；工作台 `已报关` 与旧值 `进行中` 并存）；集成 TEST-016 旧值可写可读可筛；单测 TEST-015。*
- [x] **AC-021** — 建单/编辑表单提供「是否已收款」（已收全款/未收款），新单默认「未收款」；hub 抬头卡显示；历史行显示「—」；协作组织写该字段 422。*证据：浏览器实测（建单默认未收款；编辑保存后 hub `是否已收款 已收全款`，DB 回读 `payment_status='paid_full'`，历史行 `NULL`→「—」）；命令单测白名单 422；集成 TEST-016 显式值往返。*

### Migration & Backward Compatibility（第六轮）

| 契约类别 | 改动 | 判定 |
|---|---|---|
| DB schema | 加列 `payment_status text NULL`；`status` 列默认 `draft`→`placed`（不改类型、**不回填**既有行） | 允许（`MAY add new columns`；默认值不触碰既有数据） |
| API 请求 | create/update schema **拓宽**：接受新词表 + 追加 `paymentStatus`；旧状态值继续接受 | 允许（`data/validators.ts` MUST NOT narrow） |
| API 响应 | `items[].status` 值域变化（新行=新词表，旧行=旧值）；追加 `paymentStatus` | **披露**：唯一消费者是本 app bundle，同 PR 发布；旧行行为不变 |
| 页面/UX | 状态下拉词表变化；「是否已收款」为新控件 | 披露（owner 指定） |

**Deprecations / removals:** 无对外移除；旧词表仅从**选择器**移除，存储/校验/标签保留。

### Risks（第六轮）

| 风险 | 缓解 |
|---|---|
| 工作台同时出现两套状态标签 | 有意（旧行如实保留）；编辑一次即迁入新词表；README 写明 |
| 「是否已收款」与 `export_finance` 收汇档案并存可能漂移 | 语义不同（根单手工标记 vs 按采购单收汇事实），README 写明；若 owner 要求合并口径另立规格 |
| 新列/默认值改动未应用或 dev runtime 未重启时写入被静默丢弃 | 迁移随 PR 提交、本机 dev 由 supervisor 应用；entity 属性变更后重启 dev runtime（lesson `entity-property-needs-dev-runtime-restart`） |
## 第七轮 — 字段级附件槽位（一字段一附件位）（2026-10-09，owner 反馈）

> 第六轮（#152）已合入 dev 并先占了 REQ-020/021、TEST-015/016、AC-020/021；本单元顺延为第七轮并使用 REQ-022…REQ-027、TEST-017…TEST-020、AC-022…AC-024。

**背景**：owner 2026-10-09 反馈——第五轮的「文件」区块是一个**笼统的上传区**，与 35 列的每个单据字段没有一一对应（例：KC 盖章是一个具体附件，却只能在根单上作为通用文件上传）。要求按本模块既定的「新表 + 关联」方式，**给每个单据字段一个槽位**，一个槽位的文件可被该字段追溯到（名称/时间/来源）。

### REQ（本轮）

- **REQ-022 — 槽位表**：新表 `order_hub_company_order_documents`（一行 = 根单某槽位下的一个文件）：`id uuid pk`（**由前端生成**，同时作为 installed `attachments.record_id`）、`company_order_id uuid`（FK cascade）、`slot text`、`attachment_id uuid`、`file_name text`（登记时冻结）、`tenant_id uuid`、`organization_id uuid`（根单所有者组织）、`created_at`/`updated_at`；唯一 `(company_order_id, slot, attachment_id)`；索引 `(company_order_id, slot)`。槽位枚举（与既有单证类型对齐）：`commercial_invoice`（INV.NO / Invoice）、`packing_list`（箱单）、`bill_of_lading`（提单）、`telex_release`（电放提单）、`customs_declaration`（中国报关单）、`domestic_freight_receipt`（国内段运费水单及发票）、`booking_charges_receipt`（订舱运杂费水单及发票）、`purchase_slip_invoice`（采购水单及发票）、`foreign_income_certificate`（涉外收入证明）、`kc_invoice_stamp`（KC INVOICE 盖章）。第 11 类「其他」沿用根单通用文件区（installed `entityId='order_hub:company_order'`，不新开槽位）。
- **REQ-023 — 槽位 API**：`GET /api/order_hub/orders/documents?companyOrderId=`（槽位行 + 附件元数据；scope = **根单可见性**；附件已不在的行返回 `missing: true`）；`POST /api/order_hub/orders/documents`（登记 `{id, companyOrderId, slot, attachmentId}`——仅所有者；校验附件属本租户且 `entityId='order_hub:company_order_document'`、`recordId=id`；重复 → 409）；`DELETE /api/order_hub/orders/documents?id=`（仅所有者）。**上传本体仍走 installed `POST /api/attachments`**（`entityId='order_hub:company_order_document'`、`recordId=槽位行 id`；分区/配额/危险扩展名/OCR 规则不变）；删除顺序 = 先删槽位行，再由前端走 installed `DELETE` 删文件（文件删除失败只留无 UI 引用的孤儿文件，记 README）。
- **REQ-024 — 字节代理扩展**：round-5 的 `GET /api/order_hub/orders/attachments/<id>` 增加对 `entityId='order_hub:company_order_document'` 的支持（附件 → 槽位行 → 根单 → 可见性判定）；头/沙箱 CSP 与既有实现一致。
- **REQ-025 — 汇总按槽位**：`loadCompanyOrderFields` 的 `documents` 增加 `bySlot`：每个槽位 `{ slot, files: [{attachmentId, fileName, createdAt}]（本单上传）, childSources: [{source: 'contract'|'shipment'|'collection'|'purchasing', label, url?}]（子单既有来源信号）}`；`kcStamp` 等既有布尔字段保留（向后兼容）。抽屉的「单证与文件」组按槽位渲染：文件（名/时间/下载）+ 来源徽标（本单/合同/发运单/收汇档案/采购）+「去子单上传」深链。
- **REQ-026 — hub 单据区块**：新组件 `OrderDocumentsSection.tsx`（hub 文件区块位置）：每个槽位一行——槽位标签 + 该槽位文件 chips（预览/下载/删除）+「上传」；子单来源行只读 + 深链；「其他文件」保留原通用区（`AttachmentsSection`）。协作者只读（无上传/删除）。整块失败隔离与既有区块一致。
- **REQ-027 — 权限与审计**：登记/删除仅**所有者**（`order_hub.manage` + 根单所有权；协作者 403 `company_order_owner_required`）；读 = 根单可见性；命令发 `order_hub.company_order.documents.updated`（clientBroadcast，失效列表/汇总缓存）。

### 数据模型（增量）

| 位置 | 增量 |
|---|---|
| 新表 `order_hub_company_order_documents` | 见 REQ-022（一次迁移：1 新表 + 1 唯一键 + 1 索引）；`yarn db:generate` 生成、审阅后提交、不应用 |

### Integration Coverage（第七轮）

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-017 | integration | 根单 + 小文件（多槽位） | installed 上传（recordId=槽位行 id）→ `POST /documents` 登记两槽位 → `GET /documents` → 代理下载 → 重复登记 → `DELETE`；协作者视角读/写；无关组织 | 列表含名称/时间；重复 409；删除后行消失；协作者可读、写 403；无关组织空 + 字节 404 | REQ-022…REQ-024, REQ-027 |
| TEST-018 | integration | 根单 + 槽位文件 + 子单来源（合同盖章/发运单证/收汇证明） | `GET /orders/fields` | `bySlot` 同时含本单文件与子单来源；既有布尔字段不变 | REQ-025 |
| TEST-019 | unit | 槽位枚举/登记输入 | 校验函数 | 非法槽位/缺参拒绝；合法通过 | REQ-022, REQ-023 |
| TEST-020 | UI（浏览器） | 上述夹具 | hub 每槽位上传→预览→下载→删除；抽屉按槽位；协作者只读 | 各链路可见结果 | REQ-025, REQ-026 |

### Acceptance Criteria（第七轮）

- [x] **AC-022** — hub 上每个单据字段（槽位）可单独上传/预览/下载/删除；汇总里每个槽位能追溯到具体文件（名称/时间）。证据：集成 TEST-017（6 passed）+ 浏览器实测（10 个槽位行；把 `co7-packing.txt` 上传到 `packing_list` 槽位后该行显示名/大小/时间，确认删除后回到「未上传」；抽屉按槽位显示 `customs-declaration.txt`/`kc-stamp.txt`）。
- [x] **AC-023** — 槽位文件对协作组织可下载（字节与所有者一致）但不可写；无关组织不可见。证据：集成 TEST-017（协作列表+字节、登记/删除 403；无关组织空+404）+ 浏览器实测（协作账号 0 个 Upload 按钮、下载链接指向代理）+ 字节 sha 一致（`0a5a31e4…`）。
- [x] **AC-024** — KC 盖章：本单上传后汇总显示本单文件；合同仍挂附件时并列显示「合同」来源徽标与深链。证据：集成 TEST-018（本单文件 + 子单来源共存；实现期修复「无号草稿合同有盖章但无单号」被漏计的一处）+ 浏览器实测（KC invoice stamp 行显示本单文件）。

### Risks（第七轮）

| 风险 | 缓解 |
|---|---|
| 与在飞的 order_hub 单元（#152/#154）在 spec/i18n/hub 组件上冲突 | UI 收敛进新组件 `OrderDocumentsSection.tsx`；spec 只追加一节；PR 披露 |
| 孤儿附件（先删行后删文件失败） | 无 UI 引用；README 记录；既有 `storage_ops audit` 可发现 |
| 槽位与子单来源重复展示 | 投影同时返回，UI 以来源徽标区分，**不做合并/迁移**（子单事实仍归子单） |

---

## 第八轮 — 工作台行改显根单自身字段（2026-10-09，owner 反馈）

**背景**：owner 2026-10-09 看 `/backend/orders` 的表格后反馈：`对方` 这一列看不出是什么，且整行「还是有采购单的影子数据」——`子单号` 是关联子单（含 `PO-…`）的冻结单号并集、`对方` 是「优先销售子单的买方，否则采购子单的供应商」，两列都是**子单的事实**，不是公司订单自己的字段；按 owner 的口径，工作台的列应当与订单详情页（抬头卡）显示的字段一致，「对的上才正确」。

### REQ（本轮）

- **REQ-028 — 工作台行的列 = 根单自身字段，与详情页抬头卡同序**：行读 `GET /api/order_hub/orders` 自己的列（编号/标题/下单日期/预计交货/状态/**是否已收款**/默认客户/默认供应商），后接既有的**金额**列与四个阶段列；**移除** `子单号` 与 `对方` 两列（子单事实改由详情页的关联区块承载，工作台的搜索仍可按子单号命中根单）。`对方` 这个词随之退出界面（根单的两个默认往来方各有其名：默认客户/默认供应商）。`是否已收款` 一列随第六轮字段落地（第六轮刻意未动工作台列集合）：`paid_full`/`unpaid` 按第六轮标签渲染，`null`（迁移前的历史行）渲染 `—`，不替它回答「未收款」。
- 读法单一：`components/companyOrderDisplay.ts` 的 `toOrderWorkbenchRow` + `snapshotDisplayName`（后者同时供 hub 抬头卡使用），非空字符串以外的值一律 `null`（渲染为 `—`），绝不让 `undefined` 落进单元格。

### Integration Coverage（第八轮）

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-021 | unit | 列表项夹具（含子单事实键、加密快照形状的 `{name, code}`、缺失/非字符串字段、`paymentStatus` 缺席/非字符串） | `toOrderWorkbenchRow` / `snapshotDisplayName` | 只取根单字段；缺席/空白/非字符串 → `null`；`viewerIsCollaborator` 仅严格 `true`；子单键不进入行 | REQ-028 |
| TEST-022 | UI（浏览器） | 根单（标题/预计交货/默认客户/默认供应商 + 一张采购子单） | `/backend/orders` 与 `/backend/orders/<id>` | 表格列与抬头卡字段同序同值；表内不出现 `PO-…`/供应商式的「子单影子」列；阶段列计数不受影响 | REQ-028 |

### Acceptance Criteria（第八轮）

- [x] **AC-025** — 工作台每行的字段与订单详情页抬头卡一一对应（编号/标题/下单日期/预计交货/状态/是否已收款/默认客户/默认供应商），不再出现 `子单号`/`对方` 两列。证据：TEST-021（单测 6 例，含 `paymentStatus` 的缺席/非字符串 → `null`）+ TEST-022（浏览器实测：`CO-2026-0003` 行 `标题/预计交货=2026-11-30/默认客户=俄罗斯 AB 有限公司/默认供应商=PetKit`，与 `/backend/orders/CO-2026-0003` 抬头卡同值；`CO-2026-0002` 行「是否已收款=已收全款」与抬头卡同值；同行的采购子单 `PO-2026-0010` 只在阶段列计数为 1）。

### Migration & Backward Compatibility（第八轮）

| 契约类别 | 改动 | 判定 |
|---|---|---|
| API | 无（`stages` 的 `counterparty`/`childNumbers` 仍在响应里，只是本页不再渲染） | 允许（无契约变更） |
| 页面/UX | 工作台列集合变化（去 2 列、加 5 列） | **披露**（owner 指定；唯一消费者是本 app bundle） |
| i18n | 删 `order_hub.workbench.columns.{childNumbers,counterparty}`，加 `{title,etaDate,paymentStatus,customer,supplier}` | 无影响（模块字典，随本 PR 发布） |

### Risks（第八轮）

| 风险 | 缓解 |
|---|---|
| 去掉子单号列后「按单号找根单」变难 | 搜索本就按 `search` 覆盖子单号（服务端），只少了展示；详情页关联区块仍并列显示冻结单号 |
| `对方` 一列消失后有人认为少了信息 | 有意的取舍：该列的值域取决于「有没有销售子单」，名不副实；根单自带的默认客户/默认供应商才是本公司订单的字段 |

---

## 第九轮 — 板块布局、关联预览与「回到订单」返回（2026-10-09，owner 反馈）

> **编号说明**：本轮在本地分支上原按「第六轮」开发；落到 `dev` 时该号已由 #152（订单状态词表/是否已收款）占用，
> 第七轮为 #157（字段级附件槽位）、第八轮为 #156（工作台行改显根单字段），故按落地顺序记为**第九轮**
> （REQ-029…REQ-038 / TEST-023…TEST-026 / AC-026…AC-035）。

> **编号说明**：本轮在本地分支上原按「第六轮」开发（run record `.ai/runs/2026-10-09-order-hub-layout-preview.md`
> 正文沿用了当时的编号）；rebase 到 `dev` 时「第六轮（订单状态词表/是否已收款）」与「第七轮（工作台行=根单字段）」
> 已落地，为避免同号两义，本节与 REQ/TEST/AC 编号整体后移为 **第八轮 / REQ-029…REQ-038 / TEST-023…TEST-026 /
> AC-026…AC-035**。

**背景**：owner 2026-10-09 对 `/backend/orders/<id>` 与工作台「全字段」的十点反馈——前八点为本轮主体，后两点为
落地后复查补充：

1. 对内/对外销售订单不再各占一个区块——合并为「出口销售」区块，行级徽标区分（单据与通道标记不变）。
2. 采购单「订单描述」属于**字典库的「Product categories」**（key `product_category`），不用模块私有的 `order_product_category`。
3. 公司订单表单**不再填写「标题」**。
4. 抬头「默认客户 / 默认供应商」改称「客户 / 供应商」。
5. hub 区块按**采购 / 出口销售 / 合同与单据 / 发运与装箱**四板块分区（与导航树同构），其后是 收汇·退税 / 文件。
6. 已关联记录的「点开」= **右侧预览抽屉**（只读），编辑另有独立按钮。
7. 从 hub 跳进模块页面后的「返回」必须回到**刚才那张公司订单**，而不是模块台账。
8. 工作台「全字段」要**展示数据而不是计数**，没有关联的分组也要显式呈现。
9. 关联子单行在**没有状态**时不应渲染只写「—」的状态徽标（复查：内对行出现空徽标）。
10. hub 抬头动作区的「全字段」入口位置怪异（复查）。

### REQ（本轮）

- **REQ-029 — 出口销售合并区块**：hub 不再分别渲染 `internal_sales_order` / `external_sales_order` 两个可写区块，改为一个「出口销售」区块（一个 `RelatedSection`），行内以徽标标注 对内/对外；「关联…」对话框提供种类选择（默认对内），「新建」弹出 对内/对外 两个入口。服务端 `kind` 与通道标记不变——单据仍是两种、仍是各自入口创建。
- **REQ-030 — 订单描述改读 Product categories 字典**：`purchasing` 的 `PRODUCT_CATEGORY_DICTIONARY_KEY` 由 `order_product_category` 改为 `product_category`（`product_codes` 播种的「Product categories」）；详情/表单/快速编辑/汇总抽屉的显示一律解析为该字典标签；`purchasing` 不再播种 `order_product_category`（已存在的字典行保留，运营可在字典库自行删除）。
- **REQ-031 — 公司订单表单去掉标题输入**：`useCompanyOrderFields` 删除 `title` 字段；create/update 载荷不再包含 `title`（编辑保存不清空既有值）；抬头副标题、工作台搜索、抽屉读值保留（历史数据仍可见）。
- **REQ-032 — 抬头标签改名**：`order_hub.companyOrders.header.customer/supplier` 中文改为「客户 / 供应商」（en 同步 Customer / Supplier）；字段语义（子单预填默认，REQ-011/013）不变。
- **REQ-033 — hub 板块布局**：按 采购 → 出口销售 → 合同与单据 → 发运与装箱 → 收汇·退税 → 文件 分区；每区一个板块标题（`SectionHeader`），区内保留既有区块（`RelatedSection`，各自 loading/error/重试/空态）。锚点 `#purchasing`/`#contracts`/`#documents`/`#shipments`/`#packing-lists`/`#money`/`#files` 保留，新增 `#sales`；旧 `#internal-orders`/`#external-orders` 退役（见兼容表）。
- **REQ-034 — 关联记录预览抽屉**：hub 各区块的行「点开」= 右侧抽屉（复用 app 级 `SourcePreviewDrawer`），按记录 id 现场读取并按种类渲染只读字段；写操作与它分离：行内另有「编辑」（销售/采购子单 → 模块编辑页；下游行 → 既有快速编辑），全部带 `returnTo`。
- **REQ-035 — `?returnTo=` 返回**：hub 生成的所有跳转链接携带 `returnTo=<当前公司订单页>`；目标模块页面（采购详情/编辑、对内/对外销售编辑、合同详情、单据/发票编辑、发运单详情、装箱单、export_finance 收汇/退税档案）用它作为「返回」链接；仅接受 `/backend/` 开头的同站路径，否则回退各自默认台账。共享件 `src/lib/navigation/returnTo.ts`。
- **REQ-036 — 全字段抽屉的分组空态**：抽屉按 采购 / 出口销售 / 合同与单据 / 发运与装箱 / 收汇·退税 / 文件 分组呈现（第五轮的 `GET /orders/fields` 35 列投影）；没有关联的分组显式显示「未关联」+ 预填入口，不以计数代替数据。
- **REQ-037 — 子单行无状态时不渲染徽标**：hub 子单行只在**有状态**时渲染 `StatusBadge`；无状态（`ref_snapshot.status` 为空——本开发库 9 张销售单里 8 张如此）时该行不渲染徽标，而不是渲染只写「—」的徽章。词表映射不变（销售走销售字典、采购走采购词表、未知码回原值），抽到 `components/companyOrderChildStatus.ts`（纯函数 `childStatusLabel` 返回 `string | null`）。
- **REQ-038 — hub「全字段」入口收敛**：`/backend/orders/<id>` 抬头动作区不再提供「全字段」按钮（只留 编辑 / 协作组织，协作者为 修改状态与备注）；35 列汇总抽屉保留为**工作台行操作**（`OrderWorkbench`）——详情页本身即填写面，不重复入口。

### Integration Coverage（第八轮）

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-023 | unit | 纯函数夹具 | `readReturnTo` 各种输入 | 同站 `/backend/...` 通过；`https://`、`//evil`、`javascript:`、非 backend 路径、空值 → null | REQ-035 |
| TEST-024 | unit | 预览来源字段映射（夹具记录） | 每个 kind 的字段映射 | 关键字段与标签正确、缺失显示「—」 | REQ-034 |
| TEST-025 | UI（浏览器） | 本地环境 | hub 分区与合并销售区块；点行开预览抽屉；编辑按钮带 `returnTo` 且返回落到订单页；无状态子单行不出现空徽标；hub 抬头无「全字段」 | 目视 + URL/标题断言 | REQ-029, REQ-033…REQ-038 |
| TEST-026 | unit | 纯函数夹具 | `childStatusLabel`（无状态 / 销售字典 / 采购词表 / 原值） | 无状态一律 `null`；有状态按各自词表；未知码回原值 | REQ-037 |

> TEST-023 / TEST-024 / TEST-026 有永久单测（`src/lib/navigation/__tests__/returnTo.test.ts`、
> `src/modules/order_hub/components/__tests__/linkedRecordPreviewSources.test.ts`、
> `.../companyOrderChildStatus.test.ts`）；TEST-025 为 **smoke-only**（无永久产物），证据见本节 Acceptance Criteria
> 与 Changelog 行。

### Acceptance Criteria（第八轮）

- [x] **AC-026** — hub 只有**一个**出口销售区块；对内/对外行都在其中并以徽标区分；「关联…」与「新建」都能选到两种。*证据：浏览器实测（区块 `#sales` 内行带「对内」徽标；关联对话框「类型」= 关联对内/对外销售订单；新建对话框列出两类——原验证 + 第八轮复验单区块/单行）。*
- [x] **AC-027** — 采购单表单/详情/快速编辑/抽屉的「订单描述」候选与显示都来自 `product_category`。*证据：浏览器实测（`/backend/purchasing/orders/create` 订单描述候选 = `TP — 尿片 / CL — 猫砂 / LB — 猫砂盆 / LS — 猫砂铲 / CB — 餐具`）；`grep -rn order_product_category src/` 只命中 README 的叙述（无代码引用）。*
- [x] **AC-028** — 公司订单建单/编辑页没有「标题」输入；保存后既有标题不被清空；抬头副标题仍显示历史标题。*证据：浏览器实测（建单页字段 = 下单日期/预计交货/状态/是否已收款/客户/供应商/关联已有销售单/关联已有采购单/备注）；载荷不再发送 `title`（命令对缺席字段不改写）。*
- [x] **AC-029** — 抬头卡写「客户」「供应商」。*证据：浏览器实测（hub 抬头 = 客户 / 供应商 / 是否已收款，无「默认客户」字样）。*
- [x] **AC-030** — 六个板块标题齐备（采购/出口销售/合同与单据/发运与装箱/收汇·退税/文件），各自区块与空态正常；`#purchasing`/`#shipments`/`#documents`/`#money` 深链仍滚动到对应区块。*证据：浏览器实测（板块标题 采购/出口销售/合同与单据/发运与装箱/收汇 · 退税/文件 + 区块锚点 `purchasing`/`sales`/`contracts`/`documents`/`shipments`/`packing-lists`/`money`/`files` 齐备）。*
- [x] **AC-031** — 任一行「点开」打开右侧只读预览（不离开页面）；行内「编辑」才跳模块页。*证据：浏览器实测（销售行号 = `<button>`，点开抽屉 = 「对内销售订单 · 俄罗斯 AB 有限公司」只读字段；行内「编辑」= `/backend/internal-sales/orders/<id>/edit?returnTo=…`）。*
- [x] **AC-032** — 从 hub 跳到采购详情/销售编辑/合同详情/单据编辑/发运详情/装箱单/收汇档案后，页面「返回」回到该订单页；参数被伪造（外部 URL）时回退默认台账。*证据：浏览器实测（内对销售编辑页「← 返回」= `/backend/orders/<id>`；`?returnTo=https://evil.example/x` 与缺参均回退 `/backend/internal-sales/orders`）。*
- [x] **AC-033** — 工作台「全字段」显示数据分组（无关联分组显示「未关联」而非计数）。*证据：浏览器实测（工作台行菜单「全字段」抽屉 = 订单 / 金额与日期 / 单证与文件 / 财务 四组数据，缺失项「—」）。*
- [x] **AC-034** — 有状态的子单行照常显示状态徽标；无状态的行不渲染徽标（不出现只写「—」的徽章）。*证据：浏览器实测（hub `#sales` 行 = `对内 ORDER-20260929-00007 俄罗斯 AB 有限公司 编辑 移除`，无徽标；`#purchasing` 行含「已下单」徽标）；单测 TEST-026 4 passed（无状态 → null、销售字典、采购词表、原值回退）。*
- [x] **AC-035** — hub 抬头动作区没有「全字段」按钮；工作台行的「全字段」仍打开四组抽屉。*证据：浏览器实测（hub 抬头按钮 = 编辑 / 协作组织；工作台行菜单 = 打开 / 全字段，抽屉四组数据照常）。*

### Migration & Backward Compatibility（第八轮）

| 契约类别 | 改动 | 判定 |
|---|---|---|
| API | 无新增/修改服务端契约 | 无影响 |
| URL 参数 | 新增 `?returnTo=`（仅 UI 读取，白名单校验）；hub 锚点新增 `#sales`、退役 `#internal-orders`/`#external-orders` | 允许（新增参数/锚点；退役锚点仅影响页内滚动定位） |
| 字典 | `order_product_category` 不再播种；订单描述改读 `product_category`（存量值解析不到时显示原值） | **披露**（数据源切换，无 schema 变更） |
| 表单 | 公司订单表单去掉「标题」输入；create/update 载荷不再发送 `title` | **披露**（字段不再可编辑；既有值保留、仍显示） |
| UI 文案/入口 | 默认客户/供应商 → 客户/供应商；对内/对外从区块级降为行级标注；hub 抬头的「全字段」入口收敛到工作台行操作；无状态子单行不再渲染空徽标 | 无影响（入口仍在工作台；徽标只去掉空值） |

### Risks（第八轮）

| 风险 | 缓解 |
|---|---|
| `returnTo` 被用来做开放跳转 | 白名单：必须 `/backend/` 开头、单斜杠、无 scheme/空白；非法值回退默认台账（TEST-023 + 浏览器实测） |
| 合并销售区块削弱「入口即类型」的清晰度 | 行徽标 + 关联对话框种类选择 + 新建必须显式选类型，并保留两套入口页 |
| 字典切换后存量 `order_product_category` 代码不可解析 | 显示回退为存储值（不报错）；本库采购单该字段为空，无数据迁移 |
| 预览抽屉的按需读取放大 | 只在打开时读一条（`id=` 单条查询），失败在抽屉内展示 + 重试 |
| hub 去掉「全字段」后汇总入口只剩工作台 | 有意为之（详情页即填写面）；工作台行操作保留并已实测；owner 若要放回 hub 是一行改动 |

---

## 第十轮 — 根单持有字段、采购单明细回退与供应商产品库 Excel 导入（2026-10-10，owner 反馈）

**背景**：owner 2026-10-10 对 `/backend/orders/<id>`、`/backend/orders`、`/backend/purchasing/orders`、
`/backend/purchasing/orders/<id>`、`/backend/purchasing/supplier-products` 五个页面提出 12 点设计反馈。
**当日问答定下七条口径**（本节的要求以它们为准）：

1. **根单持有（通用规则）**：「订单描述」「采购负责人」统一由公司订单根单持有；凡涉及关联的显示一律**只读根单**，
   修改一律**跳回公司订单**修改。此规则今后同样适用于其它「根单字段被关联模块重复开口」的场景——本轮已顺带审计
   订单树内的同类面（审计结论见 REQ-041）。
2. 订单描述字典**复用 `product_category`**（「Product categories」，`product_codes` 播种），不恢复模块私有 `order_product_category`。
3. 预付款/尾款采用**实际口径**（已登记付款的 deposit / balance 阶段合计），而不是 2026-09-22 的「计划」口径。
4. hub 抬头「供应商」：根单优先，为空时回退所关联采购单的供应商。
5. 采购单详情**只撤三个关联区块**；`cross_border` 的 `?purchaseOrderId=` 过滤与集成 spec 保留。
6. 供应商产品库**现在做 Excel 上传 + 解析骨架**（AI 列映射与 PDF 识别后续接入）。
7. 迁移生成并**在本地开发库应用**（`yarn dev` 由 dev supervisor 应用）。

### REQ（本轮）

- **REQ-040 — 根单新增「订单描述」与「采购负责人」**：`order_hub_company_orders` 加三列——`product_category`（text null）、
  `owner_user_id`（uuid null）、`owner_snapshot`（jsonb null）。订单描述 = 字典 `product_category` 单选（选项与标签
  解析走既有 code-list 读法，显示成 `CL — 猫砂` 形状）；采购负责人 = 人员账号（当前组织用户列表，随选择冻结
  `{name,email}` 快照）。创建/编辑表单可填；hub 抬头卡**只读**显示这两格（抬头卡本身没有行内编辑，编辑走「编辑」表单）。
- **REQ-041 — 根单持有、子单只读（通用规则落地）**：采购单的「订单描述 / 采购负责人」不再有采购单侧的编辑入口——
  创建/编辑表单移除这两个字段；死代码 `lib/purchaseOrderQuickEdit.ts` 移除；详情页两格**只读**显示，已关联根单时附
  「去公司订单修改」链接（`/backend/orders/<rootId>`），未关联（独立采购单）显示自身存量值。根单这两个字段在
  **关联建立时**与**根单更新时**向后镜像到已关联采购单（`order_hub` 发事件、`purchasing` 订阅落库），使采购台账、
  订单档案（`export_finance` 的 owner/productCategory 读面）等采购侧显示与根单一致。
  **同类面审计结论**：订单树内其余子单页面显示的都是子单自身事实（销售单的客户、采购单的供应商与金额、合同/单据/发运的
  单号与状态），不是根单字段的重复开口——本轮无需改动；本条规则写入本规格，作为后续新字段的默认口径。
- **REQ-042 — 工作台「金额」列改名「订单金额」**：取值改为按币种**采购金额优先**（Σ 关联采购单 `total`），无采购子单时
  回退销售金额；展示形状（多币种 `·` 连接、2 位小数、`—` 空态）不变。
- **REQ-043 — hub 采购单行显示三个金额**：订单金额（`total`）、预付款金额（已登记 `deposit` 阶段合计）、尾款金额
  （已登记 `balance` 阶段合计）；合计在采购单列表投影的 `afterList` 里算（与 `paidTotal/outstanding/paymentStatus` 同一处），
  hub 用 `?ids=` **批量**读取，绝不逐行请求。
- **REQ-044 — 采购单列表列改造与互跳**：`总额` → `订单金额`；新增 `预付款金额`、`尾款金额`（实际口径）；`预计发货` →
  `预计交货日期`；行操作新增「打开公司订单」——点击时按 `refId` 反查 `order_hub_company_order_links`，未关联时该项
  置灰并提示原因（不静默跳空页）。
- **REQ-045 — 采购单详情撤回第三轮三区块**：`#source-order`（关联订单）/ `#contracts`（关联合同）/ `#shipments`（关联发运单）
  三区块与其 i18n 词条移除，来源单号回到抬头摘要格；`cross_border` 的 `?purchaseOrderId=` 过滤、列表横幅与集成 spec
  **保留**（owner 口径：只撤 UI 区块）。
- **REQ-046 — 供应商产品库 Excel 导入（骨架）**：`/backend/purchasing/supplier-products` 抬头在「新建产品」旁新增
  「Excel 导入」入口；向导三步 = 选供应商 + 上传（`.xlsx`/`.xls`/`.csv`，附件绑到该供应商记录）→ 服务端解析
  （工作簿读取 + 表头探测 + 别名映射到库字段）→ 复核并导入；导入**逐行复用 create 口径**校验，返回成功/失败计数与失败原因，
  失败行不写库。AI 列映射与 PDF 识别留后续（本轮不接）。

### Integration Coverage（第十轮）

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-027 | unit | 根单行/表单夹具 | 根单映射（`toHead`、显示解析、表单载荷） | 订单描述/采购负责人缺席、null、有值三态不变形；标签回退原值；快照随选择冻结 | REQ-040 |
| TEST-028 | unit | 付款行夹具（deposit / balance / other / 空） | 阶段合计 | 只累计对应阶段；空集 `0.00`；既有 `paidTotal/outstanding` 不变 | REQ-043, REQ-044 |
| TEST-029 | unit | 别名表 + 表头夹具 | 导入列映射 | 中/英表头命中目标字段；未知列标忽略；同目标多列有确定优先级 | REQ-046 |
| TEST-030 | unit | CSV 工作簿夹具 | 解析 → 行构建 | 表头定位、空行跳过、数值/单位规范化、超限报错 | REQ-046 |
| TEST-031 | unit | 显示夹具（根单/采购行/阶段金额） | 抬头供应商回退 + 工作台金额优先级 | 根单有值优先、空则取采购行供应商（去重）；金额采购优先、无采购回退销售 | REQ-040, REQ-042 |
| TEST-032 | smoke（浏览器 + DB 回读） | 本地环境（根单 + 采购单 `PO-2026-0008`） | 改根单两字段；从根单新建采购单 | 采购单两字段与根单一致（`CL` / `employee@acme.com`）；幂等（同值不重发） | REQ-041 |
| TEST-033 | UI（浏览器） | 本地环境 | 五页面逐点复验 | 见 AC-036…AC-042 | REQ-040…REQ-046 |

> TEST-027 / TEST-031 有永久单测（`src/modules/order_hub/components/__tests__/companyOrderDisplay.test.ts`）；
> TEST-028 在 `src/modules/purchasing/lib/__tests__/orderTotals.test.ts`；
> TEST-029 / TEST-030 在 `src/modules/purchasing/lib/supplierProductExcelImport/__tests__/{aliases,columns,rows}.test.ts`；
> TEST-032（镜像）与 TEST-033 为 **smoke-only**（无永久产物；本轮未写 ephemeral 集成规格，证据是本节的浏览器 + DB 回读）。

### Acceptance Criteria（第十轮）

- [x] **AC-036** — 公司订单建单/编辑页有「订单描述」（字典 `product_category` 候选）与「采购负责人」（人员账号候选）；
  保存后 hub 抬头卡显示两格（描述为 `CL — 猫砂` 形状标签），值可回读。*证据：浏览器实测（编辑页字段 = 下单日期/预计交货/状态/是否已收款/订单描述/采购负责人/客户/供应商/备注；订单描述候选 = `TP — 尿片 / CL — 猫砂 / LB — 猫砂盆 / LS — 猫砂铲 / CB — 餐具`；采购负责人候选含 `employee@acme.com`；保存后抬头卡 = 「订单描述 CL — 猫砂」「采购负责人 employee@acme.com」）。*
- [x] **AC-037** — 采购单详情的「订单描述 / 采购负责人」只读，附「去公司订单修改」落到该根单页；采购单建单/编辑页
  没有这两个输入。*证据：浏览器实测（`PO-2026-0008` 详情 = 「订单描述 CL — 猫砂 + 去公司订单修改 → `/backend/orders/e9ad342f…`」「采购负责人 employee@acme.com」，无输入控件；采购单编辑页字段 = 业务订单号/供应商/客户名称/币种/预计交货日期/定金比例/定金金额/备注——无两格；建单页同）。*
- [x] **AC-038** — hub 抬头「供应商」：根单为空时显示所关联采购单的供应商；根单有值时优先显示根单值。*证据：浏览器实测（`CO-2026-0004` 根单 supplier 空 → 抬头「供应商 = CI E2E supplier mumhx0rr」；从根单新建一张 PetKit 采购单后 = 「CI E2E supplier mumhx0rr / PetKit」（去重并列），移除该单后回到单值）。*
- [x] **AC-039** — 工作台列名「订单金额」且取值采购优先；hub 采购单行显示 订单金额 / 预付款金额 / 尾款金额；
  采购单列表三列同口径（已登记 deposit / balance 合计），列名与列集合为 单号/供应商/状态/订单金额/预付款金额/尾款金额/预计交货日期/操作。
  *证据：浏览器实测（工作台表头含「订单金额」，`CO-2026-0004` 行 = `¥2,000.00`（采购金额优先，销售子单金额不再占位）；hub 采购行 = 「订单金额 ¥2,000.00 / 预付款金额 ¥0.00 / 尾款金额 ¥0.00」；采购单列表表头 = 单号/供应商/状态/订单金额/预付款金额/尾款金额/预计交货日期/操作，行金额与 hub 一致；接口 `?ids=` 回读 `paidDeposit/paidBalance` = `0.00`）。*
- [x] **AC-040** — 采购单列表行操作「打开公司订单」落到对应根单页；未关联的采购单该项不可用且有提示。*证据：浏览器实测（`PO-2026-0008` → `/backend/orders/e9ad342f…`；`PO-2026-0010` → `/backend/orders/40f34dd2…`；`PO-2026-0009` 未关联 → 行内出现置灰按钮「未关联公司订单」（title 同文案），页面不跳转）。*
- [x] **AC-041** — 采购单详情不再出现三个关联区块，来源单号回到抬头摘要格；发运单列表 `?purchaseOrderId=` 过滤仍可用。
  *证据：浏览器实测（`PO-2026-0008` 详情无「关联订单/关联合同/关联发运单」文本与区块元素；从根单新建的采购单详情 = 「来源销售订单 ORDER-20260929-00007」链接 → `/backend/internal-sales/orders/d245512a…`；`cross_border` 侧本轮零改动，过滤与集成 spec 保留）。*
- [x] **AC-042** — 供应商产品库「Excel 导入」可用：上传→解析→复核→导入后列表出现新行；故意失败的行有原因且不写库。
  *证据：浏览器实测（选供应商 → 上传 9 列表（商品 SKU/供应商货号/品名/中文品名/英文品名/单位/每箱数量/最小订量/折扣）→ 「工作表「Sheet1」，表头在第 1 行：已映射 9/9 列」（精确 + 别名置信）→ 预览 2 行 → 「成功导入 2 行」；库里两行 = `SMOKE-IMP-SKU-1/2` + 货号/中英品名/单位 PCS/装箱 24·12/MOQ 120·60/折扣 5·空；缺「商品 SKU/品名」的表在映射步被拦——提交禁用 + 「还需要映射：商品 SKU / 商品名称（供应商原始名）」，接口层同样拒绝（`supplierSku/name` 缺失行到 `failed[]`、不写库））。*

### Migration & Backward Compatibility（第十轮）

| 契约类别 | 改动 | 判定 |
|---|---|---|
| Schema/迁移 | `order_hub_company_orders` 加三列（全部可空，无回填） | 允许（加列，向后兼容） |
| API 响应 | 根单列表/详情新增三字段；采购单列表投影新增 `paidDeposit`/`paidBalance` | 允许（追加式） |
| API 请求 | 采购单 create/update 契约不变（字段仍在命令 schema 内，UI 不再发送）；新增导入 parse/import 两个路由 | 允许（新增路由；既有字段只停用入口） |
| UI 入口 | 采购单表单去两字段；采购单详情撤三区块；工作台与采购单列表列名/列集合变化；供应商产品库新增导入入口 | **披露**（owner 指定） |
| 事件 | 新增根单字段镜像事件（`order_hub` → `purchasing` 订阅） | 允许（模块间只走 ID/快照/事件） |

### Risks（第十轮）

| 风险 | 缓解 |
|---|---|
| 镜像同步失败 → 采购侧与根单不一致 | 同步是幂等覆盖写（按 `refId`），失败留日志；采购详情如实显示自身值并保留跳回根单入口 |
| 独立采购单（无根单）没有这两个字段 | 有意为之：入口统一在根单；独立单据显示自身存量值，关联后再镜像 |
| 导入行校验与手填口径不一 | 逐行复用 create 命令的 schema；失败行带原因、不写库 |
| 撤三区块后 `#source-order` 等锚点消失 | 锚点只被本页内部使用（无外部深链）；README/计划同步更新 |
| 工作台金额改采购优先后销售金额不再显眼 | 销售金额仍在「全字段」抽屉与 hub 板块；本列按 owner 口径指向采购单金额 |

---

---

### 第十轮复查（owner 2026-10-10 复看 5 点）

**背景**：owner 复看第十轮交付的 `/backend/orders/<id>` 采购区块后提了 5 点：① 行内「编辑」应改为「打开详情」（采购单详情页才是填写单证与付款记录的地方）；② 所有「移除 / 取消」类动作都要二次确认；③ 子单状态徽章要按状态区分颜色；④ 行内新增「定金比例」；⑤ 行内新增「备注」。

#### REQ（复查）

- **REQ-047 — 采购行的动作改「打开详情」**：hub 的 采购 行不再提供「编辑」入口，固定链到 `/backend/purchasing/orders/<id>` 并带 `returnTo`（采购单详情页内自有「编辑采购单」与 单证/付款 入口）。协作者与所有者看到同一个动作。
- **REQ-048 — 子单状态徽章按状态配色**：采购单状态复用 `PURCHASE_ORDER_STATUS_TONES`（与 `PurchaseOrderStatusBadge` 同一份映射，已导出）；销售单状态用它自己的字典色（与销售列表同一个色点）；未知码保持中性色 + 原值。纯函数 `childStatusAppearance` 返回 `{ label, tone, color }`。
- **REQ-049 — 采购行新增「定金比例」与「备注」**：两者都取自该区块**已有的**一次批量读（`depositPercent` / `notes`），不新增请求；比例渲染成 `50%` 形状（`numeric(6,3)` 去尾零），备注单行截断、hover 显示全文；没有值时显示「—」。
- **REQ-050 — 已落库的移除/取消类动作统一二次确认**：hub 子单「移除」（对话框写出被移除的单号）、合同盖章件「移除」、单据替换件「移除」、报价「归档」、报价导入「重建行」（仅当会覆盖已生成的行时）——一律走 `useConfirmDialog`；**表单内尚未保存的行删除不弹窗**（保存前不落库，弹窗只会打扰逐行编辑）。

#### Integration Coverage（复查）

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-034 | unit | 状态夹具（采购词表 / 销售字典带色 / 未知码 / 空） | `childStatusAppearance` | 采购 tone 与 `PurchaseOrderStatusBadge` 一致；销售取字典色；未知码中性 + 原值；空 → null | REQ-048 |
| TEST-035 | UI（浏览器） | 本地环境（`CO-2026-0004` + `PO-2026-0008`） | 行内动作 / 配色 / 新字段 / 移除 | 见 AC-043…AC-046 | REQ-047…REQ-050 |

#### Acceptance Criteria（复查）

- [x] **AC-043** — 采购行的动作是「打开详情」并落到采购单详情页（带 `returnTo`），行内没有「编辑」。*证据：浏览器实测（行内动作 = 「打开详情」→ `/backend/purchasing/orders/ac8753f3…?returnTo=%2Fbackend%2Forders%2Fe9ad342f…`，落点标题 = 「采购单 PO-2026-0008 已下单 … 编辑采购单 标记已发运 取消订单」）。*
- [x] **AC-044** — 子单状态徽章按状态配色：采购「已下单」= `info`（不再是中性）；销售状态用字典色点（单测覆盖）；未知码中性 + 原值。*证据：浏览器实测（`#purchasing` 行徽章 `data-variant="info"`，文字「已下单」）；单测 TEST-034。*
- [x] **AC-045** — 采购行显示「定金比例」与「备注」两格，取值来自同一批量读；无值显示「—」。*证据：浏览器实测（行内 = 「定金比例 —」「备注 —」——本库所有采购单都没有这两项数据；字段来自 `purchasing/purchase-orders?ids=` 的 `depositPercent`/`notes`）。*
- [x] **AC-046** — hub 移除弹二次确认（写出单号）；取消后行仍在。另外三处已落库移除/取消与一处重建也补了确认。*证据：浏览器实测（点「移除」→ 对话框 = 「移除 / 确定移除关联 PO-2026-0008 吗？/ 取消 确认」；「取消」后行仍在）；代码审计清单见 run record 复查节（30 个文件 ~34 处原本已有确认；本轮补 5 处；18 处表单内未保存行按口径不弹窗）。*

### 第十轮复查·二（owner 同日再复看 5 点：采购单详情与列表）

**背景**：owner 再复看采购单详情/列表/编辑页后提了 5 点：① 详情摘要格缺少可填字段（备注等）；② 被公司订单关联时要有跳转根单的按钮；③ 列表的「未关联公司订单」不该先点一下才出现（「这样操作很傻很差」）；④ 不能编辑的填写项要变灰，可填内容要在详情页完整显示（此逻辑其他模块同样适用）；⑤ 单证已托到根订单统一录入，采购单不再提供录入入口、只做映射（并清空历史数据）。

#### REQ（复查·二）

- **REQ-051 — 详情摘要格与编辑表单一一对应**：抬头摘要补上编辑表单仍可填的字段——定金比例、定金金额、备注——并给采购明细行补「单价含税」列（编辑器可勾选，此前详情页无处显示）；新增共享件 `@/lib/orders/depositPercent.formatDepositPercent`（比例按 `numeric(6,3)` 去尾零渲染成 `50%`）。
- **REQ-052 — 抬头的根单入口**：采购单被公司订单关联时，详情抬头在「编辑采购单」旁给出「打开公司订单」按钮（链接到那张根单的详情页）；未关联（独立采购单）不显示。
- **REQ-053 — 列表的关联状态先算后显**：`order_hub/orders/links` 新增 `refIds=`（逗号分隔、去重、uuid 过滤、上限 200）批量反查；采购单列表在页面加载时一次读回本页所有行的根单归属——已关联＝「打开公司订单」按钮直达，未关联＝置灰不可点的「未关联公司订单」，读不到（403/传输失败）＝不显示该位（不给错误状态）。原先「先点再发现」的流程废弃。
- **REQ-054 — 锁定项一律灰态**：不可编辑的填写项改用 `disabled` 而非 `readOnly`（`readOnly` 在 CrudForm 里对多数类型近似无效，`number` 类型更是完全不转发）——采购单编辑表单的供应商/币种/定金两格（`number` 走自定义只读值渲染，因为内置 number 分支不转发 disabled）、供应商编码、产品库的供应商名。审计结论：其余模块的锁定项本就用 `disabled`（`our_parties` 等），本轮的这条即覆盖全 app 的规则。
- **REQ-055 — 采购单单证入口退休**：详情页不再有 新增单证/编辑/删除 与单证表读取，改为指向根订单的入口（已关联时给「去公司订单录入单证」按钮）；`purchasing_purchase_order_documents` 的 4 行历史数据按 owner 要求清空（其他环境执行 `delete from purchasing_purchase_order_documents;`）。路由/命令/实体/表保留（不做破坏性删表），README 标注「无 UI 入口」。**披露**：`export_finance` 订单档案「单据齐套」中由该表供数的三项（供应商发票 / 装箱单 / 采购水单）在清空后回到「未上传」；是否改读根单槽位需要业务口径。

#### Integration Coverage（复查·二）

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-036 | UI（浏览器） | 本地环境（`PO-2026-0008` 已关联 / 未关联单） | 详情摘要、抬头入口、列表状态、编辑页灰态 | 见 AC-047…AC-051 | REQ-051…REQ-055 |

#### Acceptance Criteria（复查·二）

- [x] **AC-047** — 详情摘要格含 定金比例 / 定金金额 / 备注，采购明细含「单价含税」。*证据：浏览器实测（摘要 = 「… 预计交货日期 — 定金比例 — 定金金额 — 备注 额温枪」；明细表头 = 商品/数量/单价/税率 %/**单价含税**/金额/备注，行值「是」）。*
- [x] **AC-048** — 已关联的采购单抬头有「打开公司订单」并落到该根单。*证据：浏览器实测（`PO-2026-0008` 抬头按钮 href = `/backend/orders/e9ad342f…`）。*
- [x] **AC-049** — 列表加载后即显示关联状态：已关联可点、未关联置灰不可点、读不到不显示。*证据：浏览器实测（8 行首屏：`PO-2026-0008` → 「打开公司订单」（可点）；其余 → 「未关联公司订单」`disabled=true`；无需任何点击）。*
- [x] **AC-050** — 锁定项灰态：采购单编辑页的供应商/币种/定金两格 `disabled`；业务订单号/备注仍可编辑。*证据：浏览器实测（`depositPercent`/`depositAmount`/`supplierId` 控件 `disabled=true`，`businessNumber` `disabled=false`）。*
- [x] **AC-051** — 详情「单证」区块只有指向根订单的入口，没有 新增单证/编辑/删除；表内 4 行历史数据已清空。*证据：浏览器实测（区块 = 「单证改在公司订单（根订单）统一录入…」+「去公司订单录入单证」；`新增单证` 按钮不存在；DB `select count(*) from purchasing_purchase_order_documents` = 0）。*

### 第十轮复查·三（owner 2026-10-10 复查 2 点：采购单列表的行菜单 / 详情单证镜像）

**背景**：owner 2026-10-10 再复看采购单列表与详情，两点：① 列表里公司订单的归属被做成「⋯ 旁边的第二个按钮」（已关联可点、未关联置灰），「我希望你这个按钮操作可以放置「。。。」里面，这样放置外面很丑」；② 详情「单证」区块只剩提示与入口，要求「这里显示会关联什么单证数据，会联动显示在这里」。

#### REQ（复查·三）

- **REQ-056 — 采购单详情的「单证」区块只读镜像根单的「单据与文件」**：录入仍只在根单（REQ-055）。本页读 `GET /api/order_hub/orders/fields?companyOrderId=`（hub 自己的汇总路由；`documents.bySlot` 与 hub 的「单据与文件」区块、全字段抽屉**同一投影**，不读它的表），只列出**有内容**的槽位：槽位名下是本单文件 chips（名称/日期/预览/下载；字节走根单的代理 `/api/order_hub/orders/attachments/<id>`）与子单来源 chips（`order_hub.documents.sources.*` + 份数，深链到根单页 `#contracts`/`#shipments`/`#money`/`#purchasing`）。解析是纯函数 `purchasing/components/rootDocuments.ts`（跨模块 HTTP 载荷的边界：空槽位丢弃、坏行丢弃、非数组答空列表）。三条不可用答——未关联 / 无 `order_hub.view` 的 403 / 读失败——一律只留提示与入口按钮，页面自身读取（订单、行、付款、关联反查）不受影响；已关联但根单没有文件时给 `purchasing.orders.documents.rootEmpty`。
- **REQ-057 — 公司订单归属是行「⋯」菜单里的一项，不再是行内第二个按钮**：列表每行只有一个菜单（`@open-mercato/ui/backend/forms` 的 `ActionsDropdown`，`triggerMode='icon'` + `triggerClassName` 保持与裸行动作图标同形），项由纯函数 `purchasing/components/purchaseOrderRowActions.ts` 构建——「打开」常驻；批量反查（REQ-053 的 `refIds=`）答出「已关联」＝「打开公司订单」项直达根单，「未关联」＝「未关联公司订单」项 `disabled: true`（`pointer-events: none`），未答/失败＝连该项都不出现。行点击（`onRowClick`）与单元格内 `stopPropagation` 的语义不变。

#### Integration Coverage（复查·三）

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-037 | unit | 三态夹具（`undefined`/`null`、已关联 Map、未关联 Map） | `buildPurchaseOrderRowActions` | 未答/失败 → 只有「打开」；已关联 → 「打开公司订单」项带根单 id；未关联 → `disabled: true` 且点不动 | REQ-057 |
| TEST-038 | unit | 载荷夹具（空槽位、坏行、多文件、来源计数、非数组） | `toRootDocumentSlots` | 空槽位丢弃且保持载荷顺序；文件名缺省回退附件 id；来源 kind/label/count 逐项；非数组答空列表不抛错 | REQ-056 |
| TEST-039 | UI（浏览器） | 本地环境（`PO-2026-0008` 已关联 / 未关联单；根单 `CO-2026-0004`） | 行菜单两态；详情单证镜像；根单上传/删除的联动 | 见 AC-052…AC-053 | REQ-056, REQ-057 |

#### Acceptance Criteria（复查·三）

- [x] **AC-052** — 列表每行只有一个「⋯」菜单：已关联行 = 打开 / 打开公司订单（可点，落 `/backend/orders/<id>`）；未关联行 = 打开 / 未关联公司订单（`disabled`、`pointer-events: none`）；读不到（403/失败）＝只有「打开」。*证据：浏览器实测（`PO-2026-0008` 菜单 = 「打开 / 打开公司订单」；`PO-2026-0007` 菜单 = 「打开 / 未关联公司订单」`disabled=true` 且计算样式 `pointer-events: none`；行内已无第二个按钮；截图见 PR 评论）+ 单测 TEST-037。*
- [x] **AC-053** — 详情「单证」区块只读联动根单的「单据与文件」：槽位文件按 名称/日期 显示且可预览/下载（`/api/order_hub/orders/attachments/<id>`），子单来源以 chip + 份数显示并深链根单页对应区块；根单上传一张单 → 采购单页出现该槽位；根单删除 → 采购单页随之消失；未关联/403/失败时只剩提示与入口，页面其余部分正常。*证据：浏览器实测（区块 = 「商业发票（INV.NO） 本单 20260923164549_67_40.jpg 2026-10-10 预览 下载」+「采购水单及发票 采购 1 份 → `#purchasing`」；把 `r10-doc-smoke.txt` 上传到根单「装箱单（PL）」→ 采购单页随之出现该槽位、其下载 200 且字节一致；在根单删除该文件 → 采购单页随之消失；别的 dev 树上传的旧槽位文件在本树答 404「File not available」——根单页自己的下载链在该服务器上同样如此，属本地存储按工作树分开）。实测用的两枚临时文件已清理（根单槽位文件走 hub 删除；付款凭证走 installed `DELETE /api/attachments?id=` 并把付款行的 `attachment_id` 复位）+ 单测 TEST-038。*

## Rollout, Migration, and Rollback

- **迁移生成/应用边界：** 一次迁移（两新表 + 索引/唯一键），`yarn db:generate` 生成、审阅 SQL 与 snapshot 后**提交但不应用**；本机 dev 由 dev supervisor 在下次 `yarn dev` 应用；生产走既有部署流程。第七轮追加一次迁移（`order_hub_company_order_documents` 槽位表，`Migration20261009073318_order_hub.ts`），同样审阅后提交、不应用。
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
| 公司订单号（CO-）与操作员熟悉的 ORDER- 号不同 | 短期认知成本 | 搜索支持子单号，订单页的关联区块并列显示冻结单号 | 用户需要适应新号段 |
| 下游区块「多子单时新建需先选目标子单」 | 操作多一步 | 单子单直连；无子单时禁用并给提示 | — |
| `link-child` 由别的表单调用，权限不足（无 `order_hub.manage`）时关联失败 | 子单存在但没关联 | 提示 + 可手工关联；README/PR 写清 `sync-role-acls` | 非管理员角色需租户自行授权 |
| 跨模块并集读的列名/软删假设错误 | 计数为 0 或查询报错 | 单点实现 `lib/orderStages.ts` + 集成断言；列名以安装源码为准 | 安装层列名变化需同步 |
| 销售单硬删导致关联悬挂 | 冻结快照仍显示，实时读为空 | 冻结快照 + 对端缺失提示；反查解析容忍缺失 | 行保留（有意） |
| 迁移未应用前新表不存在（dev 未重启） | 工作台 500 | PR/README 写明升级步骤；错误在页面可见 | 需要一次 dev 重启 |
| API 载荷重定义影响未识别的第三方消费者 | 未知调用方失效 | `grep` 证据 + 本节披露；URL 不删以便排查 | 仓库外消费者无法穷举 |

## Acceptance Criteria

- [x] **AC-001** — `POST /api/order_hub/orders` 建单返回 `{id, number}`（`CO-<年>-<4位>`，同 scope 唯一，撞号重试）；`PUT` 用过期 `updatedAt` → 409；`DELETE` 软删后列表不含；跨租户/组织读不到对方行。*证据：integration `company-orders` TEST-001（6 passed）+ 浏览器建单 `CO-2026-0001/0002`。*
- [x] **AC-002** — `/backend/orders` 每行 = 公司订单（id 可在新表查到）；点击进入 `/backend/orders/<companyOrderId>`；搜索子单号能命中其公司订单；类型/状态过滤与 `GET /api/order_hub/orders` 的返回一致；采购订单不再单独成行。*证据：浏览器实测（行 `CO-2026-0001` 子单号 `ORDER-20261009-00001`、`?type=internal` 过滤生效）+ integration TEST-001。*
- [x] **AC-003** — `/backend/orders/<companyOrderId>` 显示抬头卡与三个关联区块（列出/关联/移除/新建）+ 五个下游区块；每区独立 loading/empty/error+retry；多子单时下游「新建」先选目标子单；`#purchasing`/`#documents`/`#shipments`/`#money` 锚点可达。*证据：浏览器实测八个区块渲染 + 锚点落点（采购预填落 `#purchasing`）；实现见 `components/OrderDetail.tsx`。*
- [x] **AC-004** — `POST /api/order_hub/orders/links`（成套替换）：跨组织/未知引用 422、重复 422、过期版本 409、成功 200 且关联行数/快照与请求一致；`link-child` 幂等（重复调用仍 1 行）；对无根销售单 `link-child` 自动建根并返回 `companyOrderId`。*证据：integration `company-order-links` TEST-002（9 passed，含汇总口径回归）。*
- [x] **AC-005** — `yarn mercato order_hub backfill-company-orders`（dry-run）不写库并打印计数；`--apply` 后每张渠道内销售单有 1:1 公司订单与冻结快照、带来源锚的采购单挂到对应根；重跑 `created=0`；未标记销售单被跳过并计数。*证据：integration `company-order-backfill` TEST-003（3 passed）。*
- [x] **AC-006** — 从 hub 区块新建对内/对外销售单或采购单：表单收到 `companyOrderId`（采购单另带 `orderKind/orderId` 时来源锚照写），保存后自动关联并跳回公司订单页；关联调用失败时子单仍存在且页面给出提示；无 `companyOrderId` 的旧入口（报价→订单）自动建根。*证据：浏览器实测两条链路（采购 `PO total=12.00` + `#purchasing`；对内销售 `ORDER-20261009-00001`/`Smoke Branch`）。*
- [x] **AC-007** — 旧 `/backend/orders/<salesOrderId>` 与 `/backend/{internal,external}-sales/orders/<id>` 解析到公司订单页；解析不到时显示「未关联」状态与两个入口（新建公司订单并关联 / 关联到已有），不出现 404 空白或错页。*证据：浏览器实测（`1c133564…` → `9a3e19d6…`；「该单据尚未关联公司订单」页提供两个入口且 `新建…并关联` 生成 `CO-2026-0002`）。*
- [x] **AC-008** — 无 `order_hub.manage` 的用户：写路由 403、页面 create/edit 门禁拒绝；`order_hub.view` 用户可读工作台/hub；`yarn mercato auth sync-role-acls` 后既有租户管理员获得 `order_hub.manage`。*证据：integration TEST-006（ACL 断言）+ `acl.ts`/`setup.ts` 变更；README 写明 sync 步骤。*
- [x] **AC-009** — `GET /api/order_hub/stages?ids=` 对构造数据逐项一致、未知/跨组织 id 不出现在 `items`、超 200/非法 400；旧 `mergeOrders` 与其单测已删除，仓库内无 `mergeOrders` 引用。*证据：integration `company-order-links` 两条汇总用例（含 `ids` 越界 400）+ `git grep mergeOrders` 为空。*
- [x] **AC-010** — 本文件、`order_hub/README.md`、`docs/plans/README.md` 状态板、`docs/plans/cross-border-erp.md` 进度表、`docs/dev/business-architecture.md` 与旧 spec 的标注在同一 PR 内更新。*证据：本 PR 的文档改动。*
- [x] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light-mode, and dark-mode states. *证据：browser smoke（暗色/窄屏/键盘/冲突条实现）+ `yarn ds:check`。*
- [x] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes. *证据：三个集成 spec + 宽门禁（见 PR 的 Tests 段）。*

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
| Q-003 | 单号规则 | `CO-<年>-<4位>`，创建时生成，按 `(tenant, org)` 唯一 | 新根单需要自己的号段；子单号在订单页的关联区块并列显示、列表可按子单号搜到根 |
| Q-004 | 公司订单状态 | 模块常量 `draft/in_progress/completed/cancelled` + i18n（不引字典） | 与 `purchasing` 同方案；避免第二套状态字典系统 |
| Q-005 | 采购行是否还在工作台 | 不再单独成行；作为公司订单的关联子单（采购台账页仍在） | owner 反馈的“不要跳到采购单模块 item” |
| Q-006 | 未指定公司订单的销售单创建 | 自动建根（`link-child` 幂等） | 保证渠道内销售单必有根；旧入口与旧 URL 不悬空 |
| Q-007 | 下游区块 | 子单并集只读 + 既有预填新建；本期不做直接关联表 | 避免双份关联；链接事实已存在于各模块 |
| Q-008 | 路由载荷重定义 | URL 全保留；`orders.items[]` 重定义、`stages` 只追加字段，二者披露在本规格 | app 内同发布、无第三方消费者（grep 证据） |

## Changelog

| Date | Change |
|---|---|
| 2026-10-10 | **第十轮复查·三（owner 复查 2 点：列表行菜单 / 详情单证镜像）**：采购单列表的公司订单归属从「⋯ 旁边的第二个按钮」改为**行菜单里的一项**（`ActionsDropdown`：已关联＝打开公司订单、未关联＝置灰项、读不到＝不出现；纯函数 `buildPurchaseOrderRowActions`，TEST-037）（REQ-057）；采购单详情「单证」区块改为**根单「单据与文件」的只读镜像**（`order_hub/orders/fields` 的 `documents.bySlot`：文件预览/下载走根单字节代理、子单来源 chip 深链根单区块；未关联/403/失败只留入口；解析 `components/rootDocuments.ts`，TEST-038）（REQ-056）。证据：浏览器实测（AC-052/AC-053）+ 宽门禁。 |
| 2026-10-10 | **第十轮复查·二（owner 同日再复看 5 点）**：采购单详情摘要格补齐编辑表单仍可填的字段（定金比例/定金金额/备注 + 明细「单价含税」列，REQ-051）；抬头在已关联时给出「打开公司订单」（REQ-052）；列表的根单归属**先算后显**——`order_hub/orders/links` 新增 `refIds=` 批量反查，已关联可点、未关联置灰不可点、读不到不显示（REQ-053）；锁定项一律 `disabled` 灰态（含 CrudForm `number` 分支不转发 disabled 的两格，REQ-054）；采购单「单证」入口退休为指向根订单的入口，`purchasing_purchase_order_documents` 4 行历史数据按 owner 要求清空（路由/命令/表保留，REQ-055）。证据：单测（`depositPercent` / 现有套件）+ 浏览器实测（AC-047…AC-051）。 |
| 2026-10-10 | **第十轮复查（owner 复看 5 点）**：hub 采购行的动作由「编辑」改为「打开详情」（采购单详情页是填写单证/付款记录的地方，REQ-047）；子单状态徽章按状态配色——采购状态复用 `PURCHASE_ORDER_STATUS_TONES`、销售状态用字典色、未知码中性 + 原值（`childStatusAppearance`，REQ-048）；行内新增「定金比例」「备注」两格，取自同一批量读（REQ-049）；已落库的移除/取消类动作统一补二次确认——hub 子单移除、合同盖章件移除、单据替换件移除、报价归档、导入重建行（仅覆盖已有行时），表单内未保存的行删除按口径不弹窗（REQ-050）。证据：单测 TEST-034 + 浏览器实测（AC-043…AC-046）；代码审计 30 文件 ~34 处原本已有确认、本轮补 5 处。 |
| 2026-10-10 | **第十轮实现并验证**（`feat/company-order-round10`，off `dev`；owner 2026-10-10 对五个页面的 12 点反馈）：① **根单持有** —— 根单加 `product_category`（字典 `product_category`）/`owner_user_id`/`owner_snapshot`（迁移 `Migration20261010025411_order_hub.ts`，本地开发库已应用），公司订单表单与抬头卡是唯一入口；采购单侧只读并**镜像**（新事件 `order_hub.company_order.order_fields_updated`，`purchasing` 订阅者落库；采购单两个表单去掉这两格、详情附「去公司订单修改」）——「根单持有、子单只读、修改跳回根单」定为本规格的通用规则（REQ-040/041）；② 预付款/尾款 = **实际口径**（已登记 deposit/balance 合计，`paidDeposit`/`paidBalance`，REQ-043/044）；③ hub 采购行三金额 + 抬头「供应商」根单优先回退采购单（REQ-040/043）；④ 工作台列「订单金额」采购优先（REQ-042）；⑤ 采购单列表列改造 + 行操作「打开公司订单」（REQ-044）；⑥ 采购单详情撤回第三轮三区块、来源单号回到抬头摘要格（REQ-045）；⑦ 供应商产品库 Excel 导入（表头探测 + 别名映射 + 复核 + 逐行复用 create 契约；必填列在映射步拦截，REQ-046）。实现期自修：hub 批量读金额的 `pageSize` 超过路由上限（400 被吞 → 金额显示「—」），改为 100 分页并记入 lesson。证据：宽门禁全绿（92 suites · 822 tests + `ds:check` 1106 files + build）；浏览器实测七点（本文件 AC-036…AC-042 与 run record `.ai/runs/2026-10-10-company-order-round10.md`）。 |
| 2026-10-09 | **第九轮实现并验证**（PR #154，off `dev`；本地分支上原编号「第六轮」，落地时后移）：hub 板块布局（采购/出口销售/合同与单据/发运与装箱 + 收汇·退税/文件）+ 对内/对外合并「销售订单」区块；行「点开」= 右侧只读预览抽屉（`LinkedRecordPreviewDrawer`）、「编辑」独立按钮；`?returnTo=` 返回本页（共享件 + 六个模块消费）；公司订单表单去「标题」、抬头改称 客户/供应商、采购单「订单描述」改读 `product_category`；复查两点——无状态子单行不再渲染空徽标（REQ-037）、hub 抬头「全字段」入口收敛到工作台行操作（REQ-038）。REQ-029…REQ-038 / TEST-023…TEST-026 / AC-026…AC-035 建立。证据：单测 `src/modules/order_hub` + `src/lib/navigation` 11 suites · 71 tests；宽门禁 88 suites · 700 tests + `ds:check` 1097 files；浏览器实测（板块/预览抽屉/编辑+返回/无空徽标/工作台抽屉/建单页无标题/订单描述候选）。 |
| 2026-10-09 | **第八轮口径定案并交付（owner 反馈）**：工作台行改显**根单自身字段**（编号/标题/下单日期/预计交货/状态/是否已收款/默认客户/默认供应商 + 金额 + 四阶段列），与订单详情页抬头卡同序；`子单号`/`对方` 两列退役（子单事实归详情页关联区块；搜索仍可按子单号命中根单）；「是否已收款」列随第六轮字段补上（第六轮未动列集合）。REQ-028 / TEST-021–022 / AC-025 建立；解析抽到 `components/companyOrderDisplay.ts`（hub 抬头卡共用 `snapshotDisplayName`）。 |
| 2026-10-09 | **第七轮交付并验证**（PR #157，已合入 `dev` d867630）：新表 `order_hub_company_order_documents`（一行=一个槽位文件，行 id 即附件 `recordId`）+ `GET\|POST\|DELETE /orders/documents` + 字节代理扩展；`documents.bySlot` + hub「单据与文件」逐槽位区块 + 抽屉按槽位。实现期修复一处：**无号草稿合同**已盖章但无单号时被漏计来源（改按盖章计数、单号仅作标签）。证据：集成 `--filter order_hub` **42 passed**（含 TEST-017 6 项 / TEST-018）；浏览器实测（槽位上传→行内可见、确认删除→回到未上传、抽屉按槽位、协作账号 0 上传按钮、字节 sha 一致）。 |
| 2026-10-09 | **第七轮口径定案（owner 反馈）**：文件区太笼统——要求**每个单据字段一个附件槽位**（一字段一附件位），按「新表 + 关联」实现；KC 盖章等字段要有自己的上传位，汇总可追溯到具体文件。REQ-022…REQ-027 / TEST-017…TEST-020 / AC-022…AC-024 建立。 |
| 2026-10-09 | **第五轮交付并验证**（PR #153）：35 列汇总（`GET /orders/fields` + `stages.amounts` + 工作台金额列 + hub「全字段」四组）、附件协作可见（order_hub 列表 + 字节代理按根单可见性授权；`AttachmentsSection` 支持自有路由；installed 上传仍 owner-only）、无号草稿可选（两页合并 + 客户端回退过滤）。宽门禁 82 suites · 661 tests；集成 `--filter order_hub` 35 passed；浏览器实测四条链路。实测发现并修复：`next.config.ts` 全站 CSP 覆盖了代理路由的沙箱 CSP，补 `source: '/api/order_hub/orders/attachments/:id'` 豁免（与 installed 文件路由同法）。 |
| 2026-10-09 | **第五轮口径定案（owner）**：① 35 列汇总到公司订单视角（金额按币种/日期/单据号/发运单证/水单发票/收汇退税/KC 盖章）；② 协作组织可看/下载所有者文件；③ 选择器要能选到**无号草稿**采购单。「订单描述长文本」明确不做。REQ-017…REQ-019 / TEST-011…TEST-014 / AC-017…AC-019 建立。 |
| 2026-10-09 | **第六轮口径定案并交付（owner）**：订单状态替换为 7 个业务阶段（已下单→生产→工厂提货→已报关→已装运→路上→到仓库；旧值保留兼容、不回填）；根单新增「是否已收款」（`paid_full`/`unpaid`，新单默认未收款、历史行「—」）。REQ-020/021、TEST-015/016、AC-020/021 建立；迁移 `Migration20261009064750_order_hub.ts`（加列 + `status` 默认值）。 |
| 2026-10-09 | **第四轮交付并验证**（PR #151，已合入 `dev` 8905b6b）：Phase 4.A（4 列默认客户/供应商 + `create.links[]` 同事务 + 建单表单选择器/多选 + 子单预填）、4.B（协作组织表/命令/显式可见 id 集读路径/字段白名单/UI）、4.C（`AttachmentsSection` + 文件区块）；一致性修正「一个子单一张根」（移动语义）。实现期修复 4 处：stages 的先行引用 500、`$or`+顶层 id 的读路径失效、跨组织 CRUD 列表缓存失效、31 个缺失 i18n 键。证据：宽门禁全绿（81 suites · 654 tests）；集成 6 套 **28 passed**；浏览器实测建单/文件/协作视图/协作写状态。 |
| 2026-10-09 | **第四轮口径定案（owner）**：建单抓起手信息（可选默认客户/供应商 + 建单即关联已有单据）、订单状态支持「协作组织白名单 + 状态/备注可写」、先加公司订单「文件」区块。REQ-011…REQ-016 / TEST-007…TEST-010 / AC-011…AC-016 建立；35 列字段归属表与「金额/单证汇总」的后续项一并记录。 |
| 2026-10-09 | **Phases 1–3 实现并验证**：实体/迁移/命令/路由/补录 CLI（Phase 1，含 5 处实现期自修）、工作台与 hub 重写 + create/edit + 旧 URL 归位 + 删除旧聚合（Phase 2）、`?companyOrderId=` 预填与自动关联（Phase 3）。实现期发现并修复「对方」列优先级与规格不符（`lib/orderStages.ts` 两段合并 + 回归断言）。证据见 Status 行。|
| 2026-10-09 | Initial draft — owner approved 容器根单 + 全量补录; 三阶段（数据地基 / 工作台与 hub / 预填闭环） |
