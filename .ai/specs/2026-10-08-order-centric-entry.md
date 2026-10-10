# 公司订单为中心的入口改造（订单工作台 + 填入式补充 + 自绘多级导航树）

**Date**: 2026-10-08
**Status**: Delivered — Phases 1–5 implemented and verified (2026-10-08)；**2026-10-09 部分被取代**：工作台/hub 的「三源聚合 + 无实体」口径由 [`2026-10-09-company-order-root.md`](./2026-10-09-company-order-root.md) 取代（公司订单根单化：`order_hub_company_orders` + `order_hub_company_order_links` + 全量补录；工作台行=公司订单、点进公司订单页）。本文件的 REQ-001/009/010、Non-goals 第一条与「阶段计数在客户端合并」的决策随之失效；导航树、采购单 hub、预填与录入减负仍有效。 **2026-10-10 第三轮的 UI 部分撤回**（owner 口径）：采购单详情页的三个关联区块与其 i18n 词条移除、来源单号回到抬头摘要格；发运单列表的 `?purchaseOrderId=` 过滤与集成 spec 保留（见 Changelog 与 company-order-root 第十轮 REQ-045）。 Entry rework delivered (2026-10-08): the tree collapses the order entries onto one domain plus four read-only ledgers, the workbench pages server-side through `GET /api/order_hub/orders`, and the order hub moved to `/backend/orders/<id>` (the old list/detail URLs redirect there)。**第二轮（2026-10-08，PR #147）**：报价单合并成一条工作台（`/backend/quotes`）、订单获得自己的单据维度（`trade_docs_order_documents`）、hub 变六区块且区块内可就地编辑、公司订单域第二层平铺（订单工作台与四个业务组平级）、工作台取消「只看待补」。**第三轮（2026-10-09）**：采购单详情页读作 hub——「关联订单 / 关联合同 / 关联发运单」三区块（共享 `RelatedSection`，读侧只读）、发运单列表新增 `?purchaseOrderId=` 过滤（REQ-013 / TEST-307）

## TLDR

把后台的入口从「按外贸/跨境流程分模块平铺」改成**以公司订单为根**：新增「订单工作台」一屏列出对内销售订单 / 对外销售订单 / 采购订单三类订单及其填充进度（采购 / 发运 / 单证 / 收汇·退税），订单详情变成 hub——每个后续模块是根上的一个分区，带预填的新建入口与「从订单复制行」；侧边栏换成 app 自绘的可折叠多级导航树（域 → 模块 → 页面，任意层级）；同时补齐一处真实的链路缺口（订单 → 采购单的来源锚）并把录入摩擦降到最低（内联快速新建、智能默认、必填收敛）。

功能模块、数据归属、权限语义全部不变——这是入口/UI 组织层改造，加一处链路补齐。落地页保持现有仪表盘。

## Problem Statement

**现状**：后台侧边栏是 15 个分组平铺（`src/modules.ts` 的 `nav.groupOrder` + 各页面 `page.meta.ts` 的 `pageGroup`），分组不能套分组（`AppShell.tsx:1194-1312` 只支持「分组（可折叠）→ 条目 → 一层 URL 派生子项」）；一张订单的后续填写分散在采购 / 出口业务 / WMS / 财务 / 平台运营五个大域里，操作员要自己记住「这张订单的采购单去哪个页面加、发运单去哪个页面配」。

**具体痛点**（逐条对应到本规格的 REQ）：

1. 销售订单**没有详情页**，只有编辑页——`src/modules/internal_sales/backend/internal-sales/orders/[id]/edit/page.tsx` 是唯一的 `[id]` 路由，列表行点进去只能改单，看不到这张单已经走到了哪一步。
2. 下游单据**每次都要重新选单**：全站只有两个预填参数（`?contractId=` 与 `?fromQuote=`），采购单 / 发运单 / 合同 / PI 新建时都要手动重新挑一遍订单、重敲一遍行。
3. **订单 → 采购单没有来源锚**：`PurchasingPurchaseOrder` 没有 `source_sales_order_id`，因此「这张订单的采购单是哪些」无法查询，工作台的「采购」阶段列也就无从计算。这是本规格唯一需要加列的地方。
4. 录入摩擦：买方/供应商要先去别的页面建档再回来选；币种每次重选；行内数量/单价的错误只在提交时才出现。

**为什么要改**：这套后台服务的业务口径是「一张订单为主线，采购—发运—单证—收汇退税逐段补齐」（见 `docs/dev/business-architecture.md` 与 `.ai/specs/2026-09-22-order-file-and-export-finance.md`），而界面却按流程分段组织，界面结构与业务主线相反。

## Overview and Success Measures

- **Primary outcome:** 操作员从落地页进入「订单工作台」，一屏看到三类订单与各自缺口；对一张订单的全部后续填写都能从订单详情 hub 的分区进入，且新建时不再手敲订单号与商品行。
- **Leading indicators:** 订单 hub 建单入口的使用次数（分区内的「新增」按钮点击）；预填参数（`?orderKind=&orderId=`）到达表单的比率。
- **Baseline:** `unknown — measurement plan`：现有埋点为 0，本规格不新增埋点，用集成/浏览器证据代替（P0 的结论见 Risks）。
- **Market / product reference:** Odoo 的「销售订单 → 智能按钮（Smart Buttons）」与 NetSuite 的 `Related Records` 区块是同类产品里被验证的组织方式：**单据为根，每个后续模块是根上的一个计数按钮**，点击直达「已关联列表」或「带上下文的创建」。本规格采纳其「订单 hub + 分区计数 + 上下文创建」，**拒绝**其「单一巨型表单」（NetSuite 的 order 表单把 30+ 字段塞在一页）——那与 DataTable 的列栅格和窄屏行为冲突，本规格改为只读列表 + 右侧「全字段」抽屉。

## Goals

- **REQ-001** — 新增「订单工作台」`/backend/orders`：一屏合并列出对内销售订单 / 对外销售订单 / 采购订单，带类型/状态/关键词筛选与四个填充阶段列。
- **REQ-002** — 销售订单详情 hub `/backend/orders/<id>`（对内外同一实现）：抬头 + 明细行 + 六个分区（采购单 / 购销合同 / 单据 / 发运单 / 装箱单 / 收汇·退税），每区独立读取、独立失败、带分区内新建入口，**关联行可区块内就地编辑**（弹窗改头部字段，走各模块既有 PUT + 乐观锁）。
- **REQ-003** — 侧边栏换成 app 自绘的可折叠多级导航树（域 → 模块 → 页面，配置支持任意层级），桌面挂在注入位 `backend:sidebar:nav`，移动抽屉挂在 `AppShell` 的 `mobileSidebarSlot`；内置平铺列表不再渲染。
- **REQ-004** — 导航树接入平台既有的侧边栏偏好契约：角色偏好 → 用户偏好，隐藏/改名/排序、变体、乐观锁、`auth.sidebar.manage` 门禁全部照旧可用；`/backend/sidebar-customization` 编辑对象换成新树。
- **REQ-005** — 导航树是**显示层**：树的服务端过滤按「有效功能位」，客户端再按 `grantedFeatures` 过滤；页面 `requireFeatures` 仍是唯一授权闸门；隐藏条目不授予、也不剥夺任何页面访问权。
- **REQ-006** — 采购单具备可检索的来源锚：`source_sales_order_id / _kind / _number` 三列 + 索引；建单时校验来源订单存在且同组织；列表可按 `sourceSalesOrderId` 过滤；表单支持 `?orderKind=&orderId=` 一次性预填（含逐行复制，不复制销售单价）。
- **REQ-007** — 发运单列表可按销售订单过滤（`salesOrderId`），供订单 hub 的「发运单」分区使用。
- **REQ-008** — 下游新建表单的预填：发运单预填销售分摊（缺官方目录链接的行跳过并提示）与来源采购单的采购分摊；合同预填方向/币种/商品行；PI/CI 预填方向/币种并自动执行既有「从订单复制行」。
- **REQ-009** — 阶段投影 API `GET /api/order_hub/stages?ids=<uuid,…>`：按订单 id 批量返回采购数 / 发运数 / 单证件数 / 是否收汇 / 是否退税；全部 scoped（tenant + 组织及后代 + 软删过滤）；未知 id 不出现在结果里。
- **REQ-010** — 工作台每行的「全字段」抽屉：采购订单行复用既有 `export_finance` 投影（订单 / 单证与文件 / 财务三组），销售订单行为抬头 + 四分支计数；分组无权限时组内提示而不影响其余组。
- **REQ-011** — 录入减负：买方内联快速新建客户（复用 `parties` 写路径）、订单与采购单的币种智能默认、行内数量/单价 `inputMode="decimal"` + blur 内联错误、（条件项）零行草案。
- **REQ-012** — 本规格与状态板同步：`.ai/specs/` 落档本文件、`docs/plans/README.md` 状态板加一行；实现落地时同 PR 更新对应 `docs/dev/*`、模块 README 与本文件的 Phase 状态。
- **REQ-013** — 采购单详情页（`/backend/purchasing/orders/<id>`，工作台采购行的「打开详情」落点）读作 hub：明细行后给出三个关联区块——关联订单（来源销售订单）/ 关联合同（覆盖本单的购销合同）/ 关联发运单（携带本单货物的发运单），壳一律复用共享 `RelatedSection`；读侧保持只读（挂单关系写在合同页自己的「管理订单关联」里），发运单列表新增 `?purchaseOrderId=` 过滤（scoped 投影 + 可清除横幅），发运单区块的「查看全部」指向它。

## Non-goals

- **不改**任何数据归属、模块边界或页面授权：不新增业务实体，不迁移数据，不重命名任何 ACL feature id、API URL、事件 id、DI 名。
- **不改**落地页：`/backend` 仍是现有仪表盘（工作台是侧边栏一级入口，不抢占首页）。
- **不做**跨模块 ORM 关系：订单 ↔ 采购单只存 id + 快照列；订单 hub 的关联全部经既有 API 读取（`export_finance` 的投影口径）。
- **不引入**新的聚合/物化表、队列、定时任务或缓存层；阶段投影是请求内只读 SQL。
- **不改**发运单分摊的业务校验（`allocations.min(1)`）、`trade_docs` 的单写者命令、`export_finance` 的投影口径。
- **不删** `src/modules.ts` 的 `nav.groupOrder`，也不动任何页面 `page.meta.ts` 的 `pageGroup`（只把 chrome payload 的 `groups` 置空；两者继续服务面包屑/标题/ACL，且是回滚路径）。
- **不做**导航树的历史组级偏好迁移（见 Risks 的「一次性错位」）。

## Proposed Solution

新增两个 app 自绘只读模块（`nav_shell`、`order_hub`），在 `purchasing` 上补一处来源锚，在 `internal_sales` / `cross_border` / `trade_docs` 上补预填参数与详情 hub。全部改动都是**既有页面的门禁与权限语义不变**的入口层重排：

1. **入口层（REQ-001/002/003/010）**：`nav_shell` 提供导航树组件并由 chrome 包装路由清空内置列表；`order_hub` 提供工作台页与阶段投影；销售订单详情 hub 复用 `trade_docs/components/ContractDetail.tsx` 的 `RelatedSection` 模式（每块独立读、独立失败、独立「新增」）。
2. **链路层（REQ-006/007/008）**：采购单加来源三列（唯一 schema 变更，纯追加 + 索引）；发运单列表加 `salesOrderId` 过滤；三张新建表单接受统一的 `?orderKind=&orderId=` 预填。
3. **录入层（REQ-011）**：把已经存在的 `trade_docs` 内部件提升为 app 共享件复用、给币种加「上次使用」默认、把行内校验提前到 blur。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| 三类订单合并到一个工作台 | 操作员的心智是「公司订单」，不是「模块」；缺口列只有在同一张表上才能横向比较 | 三个列表各自加缺口列 | 三处实现同一套阶段逻辑，口径必然漂移；且「今天有什么要补」要跳三页 |
| 菜单多层级用 app 自绘树 | 框架侧栏只支持「分组 → 条目 → 一层 URL 子项」，且没有壳/侧栏的组件替换句柄（`component-registry.ts` 只有 `page:/data-table:/crud-form:/section:` 四类） | ① 用 `nav.groupOrder` + 页面 `pageGroup` 重排 ② 提 PR 改框架侧栏 ③ 每个域复制一条 `pageGroup` 前缀 | ① 不能套两层 ② 跨仓改动超出本单元 ③ 标题会变成「采购 / 采购」这类假层级 |
| 树挂在注入位 + layout 的 `mobileSidebarSlot` | 桌面侧栏有注入位 `backend:sidebar:nav`；移动抽屉明确不渲染注入位（`shouldRenderSidebarInjectionSpots = !isMobileVariant`） | 只做桌面，移动端保留内置平铺 | 移动端会出现「桌面 9 个域 / 移动 15 个分组」两套信息架构，操作员在手机上找不到同一件事 |
| 清空 `chromePayload.groups` 而不是删页面元数据 | `groups: []` 是渲染为空的最小切口；`page.meta.ts` 继续服务面包屑、标题、`requireFeatures`；回滚 = 恢复包装路由 | 改造每页 `page.meta.ts` / 删 `nav.groupOrder` | 改动面从 1 个路由变成 40+ 页面元数据，回滚困难，且面包屑会一起坏掉 |
| 偏好用平台同一套数据与编辑器 | 角色默认布局、用户覆盖、隐藏/改名/排序、变体、乐观锁、`auth.sidebar.manage` 门禁全部现成 | 自建一套树偏好表 | 与平台侧栏偏好两套语义并存，用户会看到两个「侧边栏自定义」且互不同步 |
| 采购单加来源三列（id + kind + number 快照） | 工作台的「采购」阶段列与 hub 的分区都需要一次 scoped 查询；快照让历史单在不加载销售订单时也能显示来源号 | ① 名称/号段模糊匹配 ② 只存 id，号实时读 ③ 建关联表 | ① 不可靠 ② 列表要多一次跨模块读、且销售单删除后无法显示 ③ 一个 order↔PO 已是一对多，关联表无额外基数 |
| 阶段计数在 `order_hub` 的只读 SQL 投影里算，只在客户端合并 | 买方名只有官方 API 能解密（`internal_sales` 的客户快照加密），服务端合并会拿到密文 | 服务端合并成一个列表接口 | 会强制在服务端解密再序列化，越过「解密只发生在授权读路径」的约定 |
| 「全字段」用右侧抽屉，不做表内嵌展开 | `DataTable` 的展开契约是 tanstack `getSubRows` 的同列嵌套行，35 个分组字段塞不进列栅格，窄屏还会随横向滚动跑位 | ① 表内嵌展开 ② 每个订单一个全字段详情页 | ① 见左 ② 已在 P4 用抽屉 + 既有 `export_finance` 投影覆盖，不新增聚合 API |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| 公司订单 | 三类业务锚的统称：对内销售订单（`sales_orders.channel_id = INTERNAL_SALES`）、对外销售订单（`= EXTERNAL_SALES`）、采购订单（`purchasing_purchase_orders`） | `sales` / `purchasing` | 未标记贸易类型的历史销售单不出现在工作台；用 `yarn mercato internal_sales backfill-trade-type --apply` 归类 |
| 阶段（填充进度） | 四个可观测的补齐动作：采购（有来源采购单）/ 发运（经分摊关联的发运单）/ 单证（经关联合同的 PI/CI + 经关联发运单的出口单证）/ 收汇·退税（收汇已收 / 存在退税档案） | `order_hub/lib/orderStages.ts` | 任一关联读失败 → 该源行内错误 + 重试；工作台其余源照常渲染 |
| 来源销售订单 | 采购单上的不可编辑三元组：`source_sales_order_id`（可空）、`_kind`（`internal_sales_order` \| `external_sales_order`）、`_number`（建单时冻结的快照） | `purchasing` | 解析不到 / 跨组织 → 422 `source_sales_order_not_found`；`kind`/`number` 不接受客户端直写 |
| 填充式补充 | 从订单 hub 或工作台发起下游新建时，用查询参数把已知事实（订单、方向、币种、商品行）一次性带过去 | 各表单的预填读取 | 参数非法 → 行内提示并忽略该参数（不阻断），空表单仍可正常新建 |
| 贸易类型 | `internal_sales_order` / `external_sales_order` 两个取值，由销售渠道推导 | `internal_sales/lib/tradeTypeChannels` | 其它取值 → 行内拒绝 `purchasing.orders.create.sourceOrder.invalid` |
| 导航树节点 | 域（L1）→ 分支节点（L2+）→ 页面（L3+），配置可继续嵌套；节点 id 形如 `tree:orders` / `tree:module:purchasing`。分支行的标题是链接：组节点链到它的第一个子页（采购 → 采购单）；右侧箭头按钮只做展开/收起。当前页标识只画一次：页面那一行带竖条 + 底色，其上的域标题与分支行只加粗（判定 `nav_shell/lib/navActive.ts`：`active` / `on-path` / `idle`）——分组行没有自己的页面时 href 取第一个子页（采购 → `/backend/purchasing/orders`），只看「本行或子行命中」会让分组行与页面行同时点亮 | `nav_shell/lib/navTree.ts` + `nav_shell/lib/navActive.ts` | 子项全被功能位过滤 → 该节点一起消失 |
| 显示层隐藏 | `hiddenItems` 是显示开关，与页面 `requireFeatures` 无关 | `sidebarPreferencesService` | 隐藏条目不改变任何授权结果 |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 订单操作员（销售/单证） | 看工作台、看订单 hub、点进各分区、按预填新建下游单据 | 选中组织及其后代（`resolveOrganizationScopeForRequest().filterIds`） | `order_hub.view` + 各目标页面自身的 feature（如 `sales.order.view`、`cross_border.shipments.view`） |
| 采购员 | 同上；采购单可写来源锚、可用预填建单 | 同上 | `order_hub.view` + `purchasing.orders.view` / `purchasing.orders.manage` |
| 财务 | 工作台的收汇·退税列；「全字段」抽屉的财务组 | 同上 | `order_hub.view` + `export_finance.orders.view` / `finance.ledger.view` |
| 老板（超管/管理员） | 全部 | 同上；`order_hub.view` 由 `setup.ts` 授予 `superadmin`/`admin` | 全部 |
| 任意已登录用户 | 侧边栏树只显示其有效功能位覆盖的条目 | 同上 | 树按有效功能位过滤（服务端）+ `grantedFeatures`（客户端） |

- **Trusted scope:** 服务端从会话与目录解析 `tenantId` + `organizationIds`，**绝不**从查询参数或请求体读取；`order_hub/lib/requestScope.ts` 照 `export_finance/lib/requestScope.ts` 逐行实现（无会话 401；无可解析组织 400 + `organization_scope_required`）；不可解析组织时 fail closed。
- **合法 system 作用域：** 无。本规格两个新模块都不做 system scope 读（`organizationId: null` 的安装契约只属于已安装模块）。
- **`nav_shell` 无 ACL feature：** 它是显示层（树只列用户已有权访问的页面）；因此它不新增 feature id，也不授予任何页面访问权。`order_hub` 新增唯一 feature `order_hub.view`（需要 `yarn mercato auth sync-role-acls` 为既有租户补授）。
- **显隐而非门禁：** 工作台的新建按钮按 `sales.orders.manage` / `purchasing.orders.manage` 显隐（chrome payload 未就绪时不隐藏，就绪后无权限才隐藏）；页面的 `requireFeatures` 是唯一闸门。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 侧边栏渲染与折叠状态 | reuse | 安装层 `@open-mercato/ui` | 注入位 `backend:sidebar:nav` + `useSidebarCollapse()` + layout `mobileSidebarSlot` | 壳不替换，只填内容 |
| chrome payload（brand/roles/grantedFeatures/settings 段） | reuse | 安装层 `auth` | app 路由转发安装层 `GET /admin/nav`，只把 `groups` 置空 | 复用 30min 缓存与组织的 payload 语义 |
| 侧边栏偏好（角色 + 用户、隐藏/改名/排序、变体、乐观锁） | reuse | 安装层 `auth` | `applySidebarPreference`（纯函数）+ 既有偏好 API + 既有编辑器组件 | 偏好语义只应有一处 |
| 订单/采购单数据与写路径 | reuse | `sales`（安装）/ `purchasing`（app） | 既有列表 API；采购单加一列来源锚 | 不复制写路径 |
| 阶段投影 | app-own | 新 `order_hub` | scoped 只读 SQL（照 `export_finance/lib/orderFileProjection.ts`） | 跨模块只读聚合不属于任何单模块 |
| 订单 hub 分区 | app-own（复用模式） | `internal_sales`（+ 对外复用） | 既有 API + `?orderKind=&orderId=` 预填 | 复用 `trade_docs` 已验证的 `RelatedSection` 结构 |
| 35 字段全字段视图 | reuse | `export_finance` 投影 | 既有 `GET /api/export_finance/order-files` | 同一口径只留一处，不新增聚合 API |
| 买方快速建档 | reuse | app `parties` | 既有 `POST /api/parties` + 选项源 | 不新建客户主数据 |
| 导航树配置 | app-own | 新 `nav_shell` | 单点真源 `lib/navTree.ts` | 树是 app 的信息架构，不应固化进框架 |

## Architecture and Data Flow

```text
落地页/侧边栏树(nav_shell 客户端)
  -> GET /api/nav_shell/tree        (requireAuth + 有效功能位过滤 + 偏好分层)
  -> GET /api/nav_shell/chrome      (转发安装层 chrome，groups: [])
  -> 点击 -> 页面自身门禁 requireFeatures（唯一授权闸门）

订单工作台(/backend/orders, order_hub)
  -> GET /api/sales/orders?channelIds=<internal|external>
  -> GET /api/purchasing/purchase-orders
  -> GET /api/order_hub/stages?ids=...   (scoped 只读投影)
  -> 客户端 k 路合并 -> DataTable；行操作 -> 抽屉(/api/export_finance/order-files) 或 hub

订单详情 hub(/backend/internal-sales/orders/[id])
  -> /api/sales/order-lines?orderId=
  -> /api/purchasing/purchase-orders?sourceSalesOrderId=
  -> /api/cross_border/shipments?salesOrderId=
  -> /api/trade_docs/contracts/orders?orderKind=&orderId= -> /api/trade_docs/contracts?ids=
  -> /api/trade_docs/documents?contractId= (+ 发票)
  -> /api/export_finance/collections?purchaseOrderId= / refunds?shipmentId=
  -> 分区内新建: create 页?orderKind=<kind>&orderId=<id>  -> 表单预填（一次性）

采购单建单(purchasing)
  -> POST /api/purchasing/purchase-orders {sourceSalesOrderId} (或命令 purchasing.purchase-orders.create)
  -> 命令内 scoped 解析 sales_orders -> 冻结 source_sales_order_number/_kind -> 落库
  -> 列表 GET /api/purchasing/purchase-orders?sourceSalesOrderId= 回给 hub/工作台
```

- **Module boundaries:** `nav_shell` 只拥有「树配置 + 树渲染 + 偏好/功能位过滤」；`order_hub` 只拥有「阶段投影 + 工作台页」；来源锚属于 `purchasing`（它是采购单的属性）。三者无事务耦合。
- **Extension points:** 注入位 `backend:sidebar:nav`、`mobileSidebarSlot` prop、安装层 chrome 路由、既有偏好 API/编辑器、既有模块 API。**不改**任何安装层源码，不新增安装层导出。
- **Alternatives considered:** 让框架侧栏原生支持多级（跨仓改动，出本单元）；服务端合并工作台列表（需要越过解密边界，见 Design Decisions）。
- **Compatibility:** 所有安装层契约不变（见 `## Migration & Backward Compatibility`）。

## User Journeys

### Journey J-001 — 早上打开工作台，找出今天要补的订单

1. 操作员登录 → 侧边栏「公司订单 → 订单工作台」→ `/backend/orders`。
2. 阶段列为 `0` 的行就是今天要补的单——列表本身按 `createdAt desc` 排；「外发运单」列显示 `0`。
3. 点「发运」单元格 → 该订单的发运单列表为空 → 点击直达「新建发运单（已预填该订单）」。
4. 保存后返回工作台刷新 → 「发运」列变 `1`；失败（如缺官方目录链接）→ 表内行内提示，已预填部分保留。

### Journey J-002 — 从订单详情补齐采购与单证

1. 操作员在公司订单列表点开一张对内销售订单 → `/backend/internal-sales/orders/<id>`。
2. 抬头显示单号/买方/币种/金额/状态；明细行表格；「采购订单」分区为空态 + 「新增采购订单」。
3. 点新增 → `/backend/purchasing/orders/create?orderKind=internal_sales_order&orderId=<id>`：供应商未选、行已按订单商品行复制（**单价为空**）、来源显示该订单号。
4. 选供应商 → 单价自动带出该供应商供货价（未被手改的行）→ 保存 → 返回 hub，采购分区出现该单（只读来源列链回 hub）。
5. 同法从「单据」分区新建 PI：行已复制、方向/币种已填；订单只有一张关联合同时合同已选。

### Journey J-003 — 非管理员用户的导航树

1. 只被授予 `cross_border.shipments.view` 的用户登录。
2. 树只出现「业务办理 → 发运与装箱」等命中条目；被授权为空的域整段消失。
3. 该用户手动访问 `/backend/finance/payables` → 页面门禁拒绝（403/重定向），树从未授予过访问权。

### Journey J-004 — 自定义侧边栏（角色 + 个人）

1. 管理员进入 `/backend/sidebar-customization`（编辑对象 = 新树）：隐藏「供应商产品库」、把「合同与单据」内部调序、改一个显示名。
2. 保存（应用到角色）→ 该角色的用户刷新后看到角色布局；自己也进过自定义页并保存过的用户保留自己的覆盖。
3. 历史条目级偏好（隐藏某 href）升级后仍然生效；旧的组级偏好（`*.nav.group`）失效一次（见 Risks）。

### Journey J-005 — 采购员用预填建单

1. 采购员从 hub 或工作台的「采购」列进入预填建单。
2. 参数非法（如 `orderKind=vendor`）→ 行内提示 `purchasing.orders.create.sourceOrder.invalid`，表单仍可手工新建。
3. 表单已有输入时再点预填 → 先弹覆盖确认。

### Journey J-006 — 录入减负

1. 订单新建页买方选择器旁「新建客户」→ 建档成功 → 自动选中为新买方。
2. 连续新建两张订单：第二张币种 = 上一张选过的币种（同一组织、同一入口）。
3. 采购单选中供应商 → 币种 = 供应商默认币种（用户改过则不覆盖）。
4. 行内数量输 5 位小数 → blur 即行内报错；提交被拦。

## UI and Interaction Contracts

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| 全部角色（树按有效功能位裁剪） | 公司订单（订单工作台 + 采购 / 出口销售 / 合同与单据 / 发运与装箱 四个二级组）→ 财务 → 经营概览 → 仓储与库存 → 平台运营 → 数据同步 → 基础数据 → 系统（8 域；「业务办理」域已撤销——它的页面作为「公司订单」下的四个业务组继续在树里） | 落地页保持现有仪表盘（含 `boss_cockpit` 四个 widget）；树本身是注入件 | 登录 → 落地页 → 侧栏「订单工作台」（1 次点击）→ 阶段列为 0 的行（聚焦）→ 目标订单 hub（2 次点击） |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| 导航树 | 某域无可见条目 → 整域不渲染；全部为空 → 空态文案 | ≤420px 时在移动抽屉内渲染同一棵树（`mobileSidebarSlot`）；折叠态只画图标 | 每个域按钮 `aria-expanded`；`Enter/Space` 折叠展开；Tab 顺序 = 视觉顺序；过滤框输入后焦点留在框内 |
| 订单工作台 | 无订单 → 空态 + 单个「新建订单」（打开选择贸易类型的弹窗；采购单从台账页或订单采购分区建） | 窄屏横向滚动，阶段列固定在最右（`DataTable` 既有行为）；抽屉全屏 | 行操作按钮可 Tab 到达；抽屉 `Esc` 关闭并把焦点还给触发行 |
| 订单 hub | 分区为空 → 该区空态「还没有…，点这里补一张」；读失败 → 该区错误 + 重试，其余区照常 | 窄屏分区纵向堆叠 | 分区内的表格沿用 `DataTable` 键盘行为 |
| 「全字段」抽屉 | 组无权限 → 组内无权限文案；读失败 → 抽屉内错误 + 重试 | 窄屏全屏抽屉 | 与 `SourcePreviewDrawer` 同款 |

### `/backend/orders` — 订单工作台

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 订单工作台                                              [新建订单]（选贸易类型）│
│ [类型▾] [状态▾] [关键词____]                                                │
├──────────────────────────────────────────────────────────────────────────────┤
│ 类型 | 单号      | 对方   | 币种 | 金额 | 状态 | 采购 | 发运 | 单证 | 收汇·退税 | 下单日期 │
│ 对内 | ORD-…-08 ↘| 甲方   | USD  | 1.2万| 已确认| 2   | 1   | 3   | ✓        | 09-30  │
│ 采购 | PO-…-31  ↘| 供甲   | CNY  | 8千  | 待收  | —   | 0 → | 1   | ✓/待退税  | 10-01  │
├──────────────────────────────────────────────────────────────────────────────┤
│ 显示第 1 至 20 条，共 47 条结果            [‹] 1 2 3 [›]        20 每页       │
└──────────────────────────────────────────────────────────────────────────────┘
行操作：全字段（抽屉） | 打开详情
```

- **Behavior:** 一屏一次 `GET /api/order_hub/orders`（手写守卫，`order_hub.view`）在服务端合并三类订单并按 `createdAt desc` 分页：路由把调用者的凭据转给各模块自己的列表路由（每个贸易类型渠道一次 `/api/sales/orders` + 一次 `/api/purchasing/purchase-orders`），因此每个源的作用域、功能位与解密仍归其所有者（买方名不在 `order_hub` 解密）。每源按 100/页向下扫，直到「够填当前页 / 该源取尽 / 500 行扫描上限」；`type`/`status`/`search`/`pending` 全部是请求参数（`status` 与 `pending` 在扫描窗口内过滤，因为安装层销售列表没有 `status` 过滤）。`total` 口径：无筛选 = 各源 `total` 之和（精确）；带筛选 = 窗口内命中数（下限，同时置 `totalIsCapped`），工作台据此提示收窄。工具栏只有一个「新建订单」（弹窗选对内/对外贸易类型）；采购单在采购台账页与订单的采购分区建（无来源订单的采购单合法）。阶段单元格点击 → 计数 > 0 时进对应分区/详情（销售行进 `/backend/orders/<id>` 并带 `#purchasing|#shipments|#documents|#money` 锚点），= 0 且有写权限时直达预填新建。
- **Responsive and accessibility:** 见上表；阶段列的 `0` 用 `—` 之外的显式 `0` 表示缺口并带 `aria-label`（「发运单 0 张，点击新建」）。
- **Localization:** 全部经 `t()`，命名空间 `order_hub.*`；状态标签复用 `sales.order_status` 字典与采购状态映射（工作台的状态选项取字典与采购状态枚举的并集，不再由当前页行派生）。
- **Design-system and theming:** `Page`/`PageBody`/`DataTable`/`MoneyAmount`/共享徽章 + 语义 token；明暗两态与窄屏实测。

### `/backend/orders/[id]` — 订单详情 hub

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← 返回订单工作台              单号 ORD-20261001-00008   [已确认]  [编辑][作废] │
│ 买方 甲方 · 币种 USD · 金额 12,340.00 · 下单 2026-10-01 · 明细 6 行            │
├──────────────────────────────────────────────────────────────────────────────┤
│ 明细行（DataTable）                                                           │
├──────────────────────────────────────────────────────────────────────────────┤
│ 采购订单 (2)          [去填写采购] [查看全部]                                  │
│   PO-20261002-00031 · 供甲 · CNY 8,000.00 · 已收汇 → 采购单详情                │
├──────────────────────────────────────────────────────────────────────────────┤
│ 发运单 (1)            [去填写发运] [查看全部]                                  │
│ 单据（PI/CI/税务发票）(3)  [去填写单据] [查看全部]                              │
│ 购销合同 (1)          [去填写合同] [查看全部]                                  │
│ 收汇·退税         收款 1 笔（已收） · 退税 1 档（办理中）→ 订单档案 / 柜档案      │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Behavior:** 贸易类型由**数据**判定，不再由路径判定：抬头（`GET /api/sales/orders?id=`）的 `channelId` 对两个贸易类型渠道 id 反查得出类型，缺失或未标记时按 `internal` 渲染、块内合同 kind 用 `internal_sales_order`（与工作台同口径），因此同一个 URL 服务两类订单。每区独立 `react-query` 读、独立 loading/empty/error + 重试，每区带 `id` 锚点（`purchasing`/`shipments`/`contracts`/`documents`/`money`，工作台的阶段单元格深链到这里）与「去填写 X」+「查看全部」（后者进对应台账列表）；抬头动作复用列表同款写路径（`lib/salesStatus.ts` 的 `salesStatusActions`）；返回链接 = 订单工作台（**绝不指向自身**）。旧 URL `/backend/{internal,external}-sales/orders/[id]` 由服务端 `redirect()` 301/307 到此。
- **Localization:** 复用 `sales.*` / `purchasing.*` / `cross_border.*` 既有 key；hub 自己的 key 已随组件迁到 `order_hub.detail.*`（`internal_sales` 只留 `internal_sales.hub.title` 给两个仍可解析的旧 `page.meta.ts`）。
- **Design-system:** 复用 `trade_docs` 的 `RelatedSection` 结构与 `FormHeader`，语义 token。

### `/backend/sidebar-customization`（遮蔽安装层页面）

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 侧边栏自定义            [应用到角色▾] [保存] [重置]                            │
├──────────────────────────────────────────────────────────────────────────────┤
│ 树（可折叠）：公司与订单 / 业务办理 / 财务 / …   每项：[眼睛]隐藏 [改名] [↑↓]   │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Behavior:** 页面体渲染安装层 `SidebarCustomizationEditor`，只把 `groups` prop 换成新树（偏好键仍是组 id / href）；门禁、角色目标、变体、乐观锁、`auth.sidebar.manage` 全部不变。
- **明暗/窄屏/a11y:** 直接继承安装层编辑器的既有行为，本规格不重做。

### Surface inventory

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| 侧边栏树（注入 `backend:sidebar:nav` + `mobileSidebarSlot`） | 多级导航、折叠、活跃高亮、过滤 | `GET /api/nav_shell/tree` | 安装层 `AppShell` 侧栏分组 + `src/modules/example/widgets/injection/customer-priority-detail/widget.ts`（注入件） | 注入件 + 语义 token + `aria-expanded` | loading、empty、error(+重试)、hidden 跳过、紧凑态只画图标、窄屏抽屉 | REQ-003, REQ-005 |
| `/backend/sidebar-customization`（app 遮蔽） | 角色/个人布局编辑 | 既有偏好 API | 安装层同路径页面 | `SidebarCustomizationEditor`（`groups` prop） | 继承安装层 | REQ-004 |
| `/backend/orders` | 三类订单合并列表 + 阶段列 + 全字段抽屉 | `GET /api/sales/orders`、`GET /api/purchasing/purchase-orders`、`GET /api/order_hub/stages`、`GET /api/export_finance/order-files` | `src/modules/boss_cockpit/components/CockpitView.tsx`（app 级只读组合页） + `src/modules/example/components/TodosTable.tsx`（DataTable） | `Page`、`PageBody`、`DataTable`、`MoneyAmount`、`SourcePreviewDrawer` 外壳 | loading、empty、error(逐源)、permission denied(组)、conflict 不适用、narrow/dark | REQ-001, REQ-009, REQ-010 |
| `/backend/orders/<id>` | 订单详情 hub + 六分区新建入口 + 区块内就地编辑 | 见 Architecture 的 API 列表 | `src/modules/trade_docs/components/ContractDetail.tsx` 的 `RelatedSection`（现为共享件 `src/lib/related/RelatedSection.tsx`） | `Page`、`PageBody`、`FormHeader`、`DataTable`、`QuickEditDialog` | 每区 loading/empty/error(+重试)、403、就地编辑冲突 409 | REQ-002, REQ-007, REQ-008 |
| `/backend/purchasing/orders/create?orderKind=&orderId=` | 预填建采购单（行复制、来源锚） | `GET /api/sales/order-lines`、`POST /api/purchasing/purchase-orders` | `src/modules/example/backend/todos/create/page.tsx` + `src/modules/example/components/TodoForm.tsx` | `CrudForm` | 参数非法行内提示、覆盖确认、脏表单冲突、必填收敛 | REQ-006 |
| 发运单/合同/PI-CI 新建（新增预填参数） | 从订单带入事实 | 既有 create 页 | `src/modules/example/components/TodoForm.tsx` | 既有表单 | 同上 + 缺目录链接提示 | REQ-008 |
| 采购单列表（`?sourceSalesOrderId=` 横幅） | 单张订单的采购单 | `GET /api/purchasing/purchase-orders` | `src/modules/example/components/TodosTable.tsx`（列/筛选） | `DataTable` + 可清除横幅 | loading、empty、error、清除横幅 | REQ-006 |
| 发运单列表（`?salesOrderId=` 横幅） | 单张订单的发运单 | `GET /api/cross_border/shipments` | 同上 | 同上 | 同上 | REQ-007 |
| `/backend/purchasing/orders/<id>` | 采购单详情 hub：抬头 + 明细 + 关联订单/关联合同/关联发运单三区块 + 单证 + 阶段付款 | `GET /api/purchasing/purchase-orders\|lines\|payments\|documents`、`GET /api/trade_docs/contracts/orders` → `contracts`、`GET /api/cross_border/shipments?purchaseOrderId=` | `src/modules/order_hub/components/OrderDetail.tsx`（hub 六区块）+ `src/modules/trade_docs/components/ContractDetail.tsx` | `Page`、`PageBody`、`FormHeader`、`DataTable`、`RelatedSection` | 每区 loading、empty、error(+重试)；读侧只读、无冲突态 | REQ-013 |

**Custom-component exceptions and their rationale:** ① 导航树是注入件而非某项 `DataTable`/`CrudForm`——框架壳没有多级导航的原语，且注入位是官方给定的扩展点；② 工作台页面是自绘组合页（`boss_cockpit` 同类先例），因为它在客户端合并四个来源、并需要逐源失败隔离，`DataTable` 仍承担表格渲染；③ 「全字段」抽屉复用 `SourcePreviewDrawer` 外壳而不是 `DataTable` 展开行（见 Design Decisions）。三者之外不引入任何自定义表格/表单原语。

## Data Models

### `PurchasingPurchaseOrder`（app 模块 `purchasing`，唯一 schema 变更）

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `source_sales_order_id` | uuid, nullable（新增） | `purchasing_purchase_orders_source_sales_order_idx` = `[organizationId, tenantId, sourceSalesOrderId]`（新增） | no | 建单时服务端解析并冻结；更新可显式清空（`null`）；不写即不改 |
| `source_sales_order_kind` | text, nullable（新增） | 同索引前缀 | no | 服务端由销售渠道推导（`internal_sales_order` / `external_sales_order`），客户端直写忽略 |
| `source_sales_order_number` | text, nullable（新增） | — | no | 建单时冻结为销售订单号快照；不随对方改动更新 |
| `updated_at` | timestamp, required（既有） | 乐观锁 | no | 既有行为 |

- **无新表、无回填、无数据迁移**：迁移只 `add column` ×3 + `create index` ×1，全部可空/可加；`deleted_at`、`is_active`、`organization_id`、`tenant_id` 等标准列一个不动。
- **跨模块只读使用（不建 ORM 关系）：** `order_hub/lib/orderStages.ts` 与 `purchasing` 的命令都用 scoped 读（`tenant_id` + `organization_id in (选中组织及后代)` + 软删过滤）访问对方表，实体定义以安装源码为准；不引入跨模块实体关系或 `any`。
- **`nav_shell` / `order_hub` 无实体**：两个新模块是纯读侧（`order_hub` 的 stage 投影是请求内 SQL），不持有任何表。

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET` | `/api/nav_shell/chrome` | `requireAuth: true` | — | 安装层 chrome payload 原样，`groups: []` | 401 透传安装层 | REQ-003 |
| `GET` | `/api/nav_shell/tree` | `requireAuth: true` | — | `{ groups: BackendChromeNavGroup[] }`（偏好 + 有效功能位过滤后） | 401 | REQ-003, REQ-004, REQ-005 |
| `GET` | `/api/order_hub/stages` | auth + `order_hub.view` | `ids` 1–200 个 uuid | `200 { items: StageItem[] }` | 400（参数/超限）、401、403 | REQ-009 |
| `GET` | `/api/order_hub/orders` | auth + `order_hub.view` | `page`≥1、`pageSize` 1–100、`type ∈ {all,internal,external,purchase}`、可选 `status`/`search`/`pending` | `200 { items: OrderRow[], total, page, pageSize, totalIsCapped?, unavailableSources? }` | 400（非法参数）、401、403；某源读不了 → 该源不出行并列入 `unavailableSources`（对端 401 原样透传） | REQ-001, REQ-009 |
| `GET` | `/api/purchasing/purchase-orders`（既有，扩展） | auth + `purchasing.orders.view` | 新增可选 `sourceSalesOrderId` | 既有列表 + 新增三列 | 既有行为不变 | REQ-006 |
| `POST`/`PUT` | `/api/purchasing/purchase-orders`（既有，扩展） | auth + `purchasing.orders.manage` | 新增可选 `sourceSalesOrderId`（update 语义：缺省不改、`null` 清空） | 既有 201/200 + 冻结的来源三列 | 422 `source_sales_order_not_found`；既有 409 乐观锁不变 | REQ-006 |
| `GET` | `/api/cross_border/shipments`（既有，扩展） | auth + `cross_border.shipments.view` | 新增可选 `salesOrderId`、`purchaseOrderId` | 既有列表（空集 → 空列表） | 既有行为不变 | REQ-007, REQ-013 |
| 预填参数 | create 页查询串 `?orderKind=&orderId=` | 目标页面自身 feature | `orderKind ∈ {internal_sales_order, external_sales_order}` | 表单预填（一次性） | 非法值 → 行内 `purchasing.orders.create.sourceOrder.invalid`；解析不到订单 → 不预填、表单照常 | REQ-006, REQ-008 |
| `StageItem` | 形状 | — | — | `{ id, source: 'sales_order'\|'purchase_order', procurementCount, shipmentCount, documentCount, collected, refunded }` | 未知/跨组织 id 不出现在 `items` | REQ-009 |

- `/api/order_hub/stages` 是**手写守卫路由**（照 `src/modules/example/api/organizations/route.ts` 与 `boss_cockpit/api/summary/route.ts`）：`export const metadata = { GET: { requireAuth: true, requireFeatures: ['order_hub.view'] } }` + `export const openApi`。分页/搜索不适用；无缓存（阶段会立刻变化）。
- `/api/order_hub/orders` 同样是手写守卫路由，且**不读任何对端表**：它把调用者的请求头转给 `/api/sales/orders`（每个贸易类型渠道一次）与 `/api/purchasing/purchase-orders`，因此每个源的作用域、功能位与解密仍由各模块裁决（`order_hub` 不解密买方名，也不复制过滤逻辑）。`total`/`totalIsCapped` 的口径写在 `openApi` 描述与 `order_hub/README.md`：无 `status`/`pending` 时为三源 `total` 之和（精确），带筛选时为扫描窗口内命中数（下限，窗口被截断即置 `totalIsCapped`）。
- `/api/nav_shell/tree` 同样手写守卫 + `openApi`，不透出任何跨组织数据（只回结构，不回记录）。
- `purchasing` 的既有 CRUD 路由继续用 `makeCrudRoute`；新增的都是**可选入参**与**追加出参字段**（BC 允许）。
- 无新增命令 id、无新增事件、无幂等键变更；采购单来源解析在既有 create/update 命令的事务作用域内完成。

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| N/A — 本规格不新增事件、订阅者、worker、定时任务或通知类型 | — | — | — | — |

- **缓存：** `/api/nav_shell/chrome` 继承安装层 30 分钟缓存；`/api/nav_shell/tree` **不缓存**（偏好保存后必须立刻生效，见 Journey J-004）。偏好写入后由客户端 `invalidateQueries` 刷新树。
- **失败恢复：** 工作台与 hub 的四个/五个来源互相隔离；单源失败只影响该源（行内错误 + 重试），不影响其余渲染。

## Security, Privacy, and Compliance

- **Authorization:** 页面 `requireFeatures` 是唯一闸门；两个新 API 用 `metadata.requireFeatures`；不使用角色名判断；工作台的按钮显隐只是 UX，不放行任何写路径。
- **Tenant isolation:** `order_hub` 的所有读都以 `tenant_id` + 组织及后代 + 软删过滤；`orderStages` 对未知/跨组织 id 直接不返回（fail closed）；`requestScope` 无会话 401、无可解析组织 400。**共享测试要证明**：第二个租户的同名订单 id 不出现在 `items` 里。
- **Sensitive data:** 本规格不解密也不传输任何加密字段——买方名经官方 API（`/api/sales/orders`）渲染，`orderStages` 只回计数与布尔；不新增 PII 字段、不新增日志中的个人数据。
- **Abuse and failure modes:** ① `ids` 参数上限 200（超限 400）防大范围扫描；② 树接口只回结构，不构成枚举面；③ 预填参数非法值不写入任何数据；④ 来源解析失败 → 422 且事务回滚，不产生半写；⑤ 抽屉/分区读失败不泄露跨组织数据（scoped 读）。

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-101 | unit | 纯函数：`NAV_TREE` 配置 | `buildNavTree` 映射 + 偏好分层（角色 → 用户）+ 隐藏/改名/排序 + 递归 children + 功能位过滤 + 空节点剪枝 | 组 id = 节点 id、条目 id = href、`defaultTitle`/`defaultName` 就位、被过滤节点整体消失 | REQ-003, REQ-004, REQ-005 |
| TEST-102 | unit | `@/.mercato/generated/backend-route-metadata.generated` | 遍历非 settings/profile、`navHidden !== true`、非动态段的页面 | 每个页面出现在 `NAV_TREE` 或 `TREE_EXCLUDED`；故意删一条 → 测试必须红 | REQ-003, REQ-012 |
| TEST-103 | integration | 租户 A/B + 角色（只授 `cross_border.shipments.view`）+ 用户偏好 | `curl /api/nav_shell/chrome`、`/api/nav_shell/tree`（多角色/多偏好） | chrome：`groups: []` 且 `grantedFeatures`/`brand`/settings 段与安装层一致；tree：只含有效功能位覆盖的条目；无权限条目**不返回**（不是返回后隐藏） | REQ-003, REQ-005 |
| TEST-104 | UI | 浏览器（管理员 + 受限用户 + 移动宽度 + 暗色） | 折叠/展开/过滤/紧凑态/移动抽屉/活跃高亮；`/backend/sidebar-customization` 隐藏+调序+改名 → 刷新生效；应用到角色 → 角色用户生效、个人覆盖优先；历史 href 级偏好仍生效；受限用户访问 `/backend/finance/payables` 被拒 | 9 个域、无内置平铺重复、窄屏与暗色正常、授权不被树改变 | REQ-003, REQ-004, REQ-005 |
| TEST-201 | unit | 纯函数：来源字段部分化 + kind 映射 | `kind` 由渠道推导、`number` 只服务端写、update 缺省/`null` 语义 | 客户端直写 `kind/number` 被忽略；缺省不改、`null` 清空 | REQ-006 |
| TEST-202 | integration | 租户 A（对内/对外订单各一张）+ 租户 B 同形订单 | `POST /api/purchasing/purchase-orders {sourceSalesOrderId}`；跨组织 id；`?sourceSalesOrderId=` 过滤；清空后再读 | 201 且三列冻结（单号 = 订单号）；跨组织/不存在 → 422 `source_sales_order_not_found`；过滤只回该单；清空读回 null | REQ-006 |
| TEST-203 | unit | 纯函数：预填参数解析 + 行映射 | `orderKind/orderId` 解析、非法值拒绝、行复制字段集合 | 只复制 `productId`/`productSnapshot`/`quantity`（**不复制销售单价**）；非法 `orderKind` 拒绝 | REQ-006, REQ-008 |
| TEST-204 | integration | 发运单 + 两组织 | `GET /api/cross_border/shipments?salesOrderId=` 命中/空集/跨组织 | 命中只回该订单的发运单；未知 id → 空列表；跨组织不泄露 | REQ-007 |
| TEST-205 | UI | 浏览器：一张对内订单 + 一张已有来源采购单 | hub 六分区渲染；四个预填新建（发运/合同/PI/税务发票）+ 装箱单入口；收汇/退税行可达；任一区块行「编辑」→ 弹窗预填 → 保存后行内刷新，旧版本重放 → 409 | 分摊已预填、缺目录链接被跳过并提示、行已复制、合同单选时已预选、链接可达、冲突不丢输入 | REQ-002, REQ-007, REQ-008 |
| TEST-301 | unit | 纯函数：`orderStages` 口径 | 计数映射（三类订单） | 各计数与构造一致；采购行 `procurementCount` 恒 0 | REQ-009, REQ-001 |
| TEST-302 | integration | 一张销售单 + 来源采购单 + 发运分摊 + 合同 + PI/CI + 收汇 + 退税 + 第二租户同 id | `GET /api/order_hub/stages?ids=` | 各计数与勾选符合构造；未知 id 不出现；跨组织 id 不出现 | REQ-009 |
| TEST-303 | UI | 浏览器：三类订单各若干 + 非超管角色（无 `export_finance.orders.view`） | 工作台四源渲染、类型/状态筛选、阶段 0 直达预填、抽屉三组、权限组文案、`/backend` 落地页 | 一致计数、抽屉与 `/backend/export-finance/orders/<id>` 同值、无权限组文案且其余组照常、落地页仍是仪表盘 | REQ-001, REQ-010 |
| TEST-304 | unit | 纯函数：币种默认解析 + `localStorage` 键构造；行内小数校验 | 报价币种 > 上次币种 > 现状；用户改过不覆盖；供应商默认币种 | 优先级正确；键 = `om:internalSales:currency:<orgId>:<tradeType>`；5 位小数行内报错且提交被拦 | REQ-011 |
| TEST-305 | UI | 浏览器：订单新建页 + 采购单新建页 | 内联建档→自动选中；连续两次建单币种记忆；采购单选供应商带币种；数量 5 位小数 blur | 建档后自动选中；币种记忆；供应商币种；行内错误 | REQ-011 |
| TEST-306 | integration | `sales.orders.create` 是否接受零行集合 | 直接调命令传空行集 | 接受 → 放开「至少一行」；不接受 → 保持至少一行并记录在 Resolved decisions | REQ-011 |
| TEST-307 | integration | 发运单 ×2 + 两张已下单采购单（各一张柜）+ 第二组织 | `GET /api/cross_border/shipments?purchaseOrderId=` 命中/空集/跨组织 | 命中只回携带该采购单货物的发运单（不含另一张采购单的柜）；未知 id → 空列表；跨组织不泄露 | REQ-013 |

## Implementation Phases

### Phase 1 — 自绘多级导航树 + 偏好/RBAC 贯通（REQ-003/004/005）

- **Depends on:** none
- **Outcome:** 侧边栏换成本规格的目标树（9 个域、可逐级折叠、活跃高亮、过滤、紧凑态、移动抽屉），角色/个人自定义与授权语义完全照旧。
- **Why this order / value delivered:** 它是所有后续页面的入口——没有树，工作台与 hub 只能靠直接输入 URL 到达；同时它独立于任何数据改动，风险最低。
- **Deliverables:** 新 app 模块 `src/modules/nav_shell/`：`index.ts`、`lib/navTree.ts`（单点真源 + `TREE_EXCLUDED`）、`lib/buildNavTree.ts`（配置 → chrome 组形状 + 偏好分层 + 有效功能位过滤）、`api/chrome/route.ts`（转发安装层 payload，`groups: []`）、`api/tree/route.ts`、`components/SidebarNavTree.tsx`、`widgets/injection/sidebar-tree/{widget.tsx,widget.client.tsx}`、`widgets/injection-table.ts`、`i18n/{zh,en}.json`、`lib/__tests__/*`、`README.md`；`src/modules/auth/backend/sidebar-customization/{page.tsx,page.meta.ts}`（遮蔽安装层页面，编辑对象换成新树）；`src/app/(backend)/backend/layout.tsx`（`adminNavApi` + `mobileSidebarSlot`）；`docs/plans/README.md` 状态板。
- **Independent slices / estimated commits:** ① 模块骨架 + 树配置 + 覆盖测试；② `buildNavTree` + 偏好/功能位 + 单测；③ 两个 API 路由；④ 客户端树 + 注入件 + 移动槽 + 布局；⑤ 遮蔽自定义页；⑥ i18n/README/状态板。
- **Requirements closed:** REQ-003, REQ-004, REQ-005
- **Tests:** TEST-101, TEST-102, TEST-103, TEST-104
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build`；`yarn jest --config jest.config.cjs src/modules/nav_shell`；浏览器（明/暗、窄屏、紧凑态、移动抽屉）
- **Exit gate:** `curl /api/nav_shell/chrome` → `groups: []` 且其余字段与安装层一致；`curl /api/nav_shell/tree` → 与目标树一致；浏览器 7 项（域数、折叠、紧凑态、移动抽屉、过滤、RBAC、自定义含角色/个人优先级与历史 href 偏好）全部通过。

### Phase 2 — 订单 → 采购单来源锚与预填（REQ-006）

- **Depends on:** none（与 Phase 1 无文件重叠）
- **Outcome:** 采购单可记录/检索来源销售订单；从 `?orderKind=&orderId=` 进入建单时来源已填、行已复制（单价空）；列表可按来源过滤。
- **Why this order / value delivered:** 工作台的「采购」阶段列与 hub 的采购分区都依赖这一列；先落它，后面两阶段才有数据可读。
- **Deliverables:** `purchasing/data/entities.ts`（3 列 + 1 索引）、`migrations/*`（`yarn db:generate` 产出 + 快照）、`data/validators.ts`、`commands/purchase-orders.ts`（来源解析 + 冻结 + 422）、`api/purchase-orders/route.ts`（过滤 + 出参）、`components/PurchaseOrderForm.tsx`（预填 + 行复制 + 供应商供货价预填）、`components/PurchaseOrderDetail.tsx`（只读来源块）、`components/PurchaseOrdersTable.tsx` + 列表页（`?sourceSalesOrderId=` 可清除横幅）、`__integration__/order-source-link.spec.ts`、README。
- **Independent slices:** ① 实体 + 迁移 + 审阅；② validators + 命令；③ API 过滤/出参；④ 表单预填 + 行复制；⑤ 详情来源块 + 列表横幅；⑥ 集成测试 + README。
- **Requirements closed:** REQ-006
- **Tests:** TEST-201, TEST-202, TEST-203
- **Validation:** 门禁全套 + `yarn jest --config jest.config.cjs src/modules/purchasing` + `yarn mercato test:integration order-source-link`
- **Exit gate:** curl 建单 201 且三列冻结/跨组织 422/过滤只回该单/清空读回 null；表单预填实测（来源已填、行已复制且单价空）。

### Phase 3 — 销售订单详情 hub + 下游预填（REQ-002/007/008）

- **Depends on:** Phase 2（hub 的「采购订单」分区按 `sourceSalesOrderId` 取数）
- **Outcome:** 一张销售订单的全部后续填写都能从它的详情页分区进入，且新建时已带上订单、方向、币种与商品行。
- **Why this order / value delivered:** hub 是「以订单为根」的核心体验；它的数据来源一半来自 Phase 2。
- **Deliverables:** `internal_sales/backend/internal-sales/orders/[id]/{page.tsx,page.meta.ts}`（`navHidden: true`）+ `external-sales/orders/[id]`（re-export）、`components/OrderDetail.tsx`（五个 `RelatedSection`）、`cross_border/lib/contractReads.ts` + `loadShipmentIdsForSalesOrder`、`api/shipments/route.ts`（`salesOrderId` 过滤）、发运单列表横幅、`ShipmentForm.tsx`/`ContractForm.tsx`/`DocumentsForm.tsx` 预填、`__integration__/shipment-sales-order-filter.spec.ts`、README。
- **Independent slices:** ① hub 页面 + 抬头 + 明细；② 五个分区的数据源；③ 发运单过滤（lib + API + 横幅）；④ 三张表单的预填；⑤ 集成测试 + README。
- **Requirements closed:** REQ-002, REQ-007, REQ-008
- **Tests:** TEST-204, TEST-205
- **Validation:** 门禁全套 + `yarn jest --config jest.config.cjs src/modules/internal_sales src/modules/cross_border` + `yarn mercato test:integration shipment-sales-order-filter`
- **Exit gate:** 浏览器五项（hub 渲染、发运预填含跳过提示、合同预填、PI 复制行与合同学、收汇/退税链接可达）全部通过。

### Phase 4 — `order_hub` 模块 + 订单工作台（REQ-001/009/010）

- **Depends on:** Phase 1（工作台入口进树）、Phase 2（采购来源列）、Phase 3（发运过滤与 hub 路由）
- **Outcome:** 一屏三类订单 + 四阶段进度 + 全字段抽屉；落地页不变。
- **Why this order / value delivered:** 工作台是入口层的汇总面，只有在三个阶段的数据都能取到之后才有意义。
- **Deliverables:** 新 app 模块 `src/modules/order_hub/`：`index.ts`、`acl.ts`（`order_hub.view`）、`setup.ts`（`superadmin`/`admin` 默认授予）、`lib/requestScope.ts`、`lib/orderStages.ts`、`api/stages/route.ts`、`backend/orders/{page.tsx,page.meta.ts}`（`navHidden: true`）、`components/OrderWorkbench.tsx`、`components/OrderFieldsDrawer.tsx`、`i18n/{zh,en}.json`、`lib/__tests__/orderStages.test.ts`、`__integration__/stages.spec.ts`、`README.md`；`src/lib/orders/purchaseOrderStatus.tsx`（从 `PurchasingPurchaseOrderForm` 抽出共享徽章/状态映射，原处改为 re-import）；`nav_shell` 的 `NAV_TREE` 增「订单工作台」条目；`docs/plans/README.md`。
- **Independent slices:** ① 模块骨架 + ACL + requestScope；② `orderStages` 投影 + 单测；③ stages API；④ 工作台列表 + 四源合并；⑤ 全字段抽屉；⑥ 共享状态件抽取 + 树条目 + i18n/README。
- **Requirements closed:** REQ-001, REQ-009, REQ-010
- **Tests:** TEST-301, TEST-302, TEST-303
- **Validation:** 门禁全套 + `yarn jest --config jest.config.cjs src/modules/order_hub` + `yarn mercato test:integration order_hub-stages` + `yarn mercato auth sync-role-acls`
- **Exit gate:** 浏览器六项（树入口、三类订单与阶段列一致、0 格直达预填、按钮按 manage 显隐、抽屉三组与订单档案同值/无权限组文案、`/backend` 仍是仪表盘）全部通过。

### Phase 5 — 录入减负（REQ-011）

- **Depends on:** none（与 Phase 1–4 无文件冲突）
- **Outcome:** 买方内联建档、币种智能默认、行内小数校验、（条件项）零行草稿。
- **Why this order / value delivered:** 它降低的是「每一次建单」的成本，与入口重排正交，可以独立交付与回滚。
- **Deliverables:** `src/lib/parties/CustomerQuickCreateDialog.tsx`（从 `trade_docs` 提升为 app 共享件，更新既有引用）、`internal_sales/components/InternalSalesForm.tsx`（买方旁「新建客户」）、订单币种默认（`fromQuote` → 上次使用 → 现状）+ 单测、采购单供应商币种默认、行内 `inputMode="decimal"` + blur 错误、`sales.orders.create` 零行能力核实（TEST-306）、README/spec 的必填收敛说明。
- **Independent slices:** ① 共享对话框搬迁 + 引用更新；② 买方内联建档；③ 币种默认（含供应商）；④ 行内校验；⑤ 零行草稿核实（条件项）。
- **Requirements closed:** REQ-011
- **Tests:** TEST-304, TEST-305, TEST-306
- **Validation:** 门禁全套 + `yarn jest --config jest.config.cjs src/modules/internal_sales src/modules/trade_docs` + 浏览器冒烟
- **Exit gate:** 浏览器四项（内联建档自动选中、币种记忆、供应商币种、数量 5 位小数行内报错且提交被拦）通过；零行草稿项有明确结论（放开或记录放弃理由）。

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001, `/backend/orders` | `GET /api/sales/orders`, `GET /api/purchasing/purchase-orders`, `GET /api/order_hub/stages` | Phase 4 | TEST-301, TEST-303 | AC-001 |
| REQ-002 | J-002, `/backend/internal-sales/orders/[id]` | 既有 sales/purchasing/cross_border/trade_docs/export_finance 读路径 | Phase 3 | TEST-205 | AC-002 |
| REQ-003 | J-003, 侧边栏（`backend:sidebar:nav` + `mobileSidebarSlot`） | `GET /api/nav_shell/chrome`, `GET /api/nav_shell/tree` | Phase 1 | TEST-101, TEST-102, TEST-103, TEST-104 | AC-003 |
| REQ-004 | J-004, `/backend/sidebar-customization` | 既有偏好 API（`GET/PUT /api/auth/sidebar/preferences`） | Phase 1 | TEST-101, TEST-104 | AC-004 |
| REQ-005 | J-003 | `order_hub.view`、树的服务端有效功能位过滤 + 客户端 `grantedFeatures` | Phase 1 | TEST-103, TEST-104 | AC-005 |
| REQ-006 | J-002, J-005, `/backend/purchasing/orders/create` | `PurchasingPurchaseOrder` 三列 + 索引；`{sourceSalesOrderId}` | Phase 2 | TEST-201, TEST-202, TEST-203 | AC-006 |
| REQ-007 | J-001, `/backend/cross_border/shipments?salesOrderId=` | `GET /api/cross_border/shipments` 新增过滤 | Phase 3 | TEST-204 | AC-007 |
| REQ-008 | J-002, 三个 create 页的 `?orderKind=&orderId=` | 既有 create 页 + `/api/sales/order-lines` | Phase 3 | TEST-205 | AC-008 |
| REQ-009 | J-001, `/api/order_hub/stages` | `StageItem[]` | Phase 4 | TEST-301, TEST-302 | AC-009 |
| REQ-010 | `/backend/orders` 行操作抽屉 | `GET /api/export_finance/order-files` | Phase 4 | TEST-303 | AC-010 |
| REQ-011 | J-006, 订单/采购单新建页 | `POST /api/parties`、`GET /api/purchasing/suppliers/[id]`、`sales.orders.create` | Phase 5 | TEST-304, TEST-305, TEST-306 | AC-011 |
| REQ-012 | 本文档 | `.ai/specs/**`、`docs/plans/README.md`、各模块 README | Phase 1–5 | TEST-102（覆盖测试即登记证明） | AC-012 |
| REQ-013 | `/backend/purchasing/orders/[id]`、`/backend/cross_border/shipments?purchaseOrderId=` | `GET /api/cross_border/shipments` 新增可选 `purchaseOrderId`；`trade_docs/contracts/orders` + `trade_docs/contracts` 只读 | 第三轮 | TEST-307 | AC-013 |

## Extension-Surface Traceability

每个新增或实质变更的运行时/发现面一行；「效仿文件」是 `src/modules/example/references/surface-inventory.json` 映射过的**具体文件**。分类：`emitted-example`（参考模块已发出该机制）/ `framework-only`（app 级、不成为模块贡献）。

| Requirement | Surface | Capability ID | 效仿的 `src/modules/example/**` 文件 | Phase | 自带集成测试 | 机制分类 |
|---|---|---|---|---|---|---|
| REQ-003 | `nav_shell/index.ts` 模块元数据 | `module.metadata` | `src/modules/example/index.ts` | Phase 1 | TEST-103 | emitted-example |
| REQ-003 | 手写守卫读路由 `GET /api/nav_shell/chrome` | `api.custom-route` | `src/modules/example/api/organizations/route.ts` | Phase 1 | TEST-103 | emitted-example |
| REQ-003, REQ-005 | 手写守卫读路由 `GET /api/nav_shell/tree` | `api.custom-route` | `src/modules/example/api/organizations/route.ts` | Phase 1 | TEST-103 | emitted-example |
| REQ-003 | 注入件渲染 `backend:sidebar:nav` | `umes.injection.rendered-widget` | `src/modules/example/widgets/injection/customer-priority-detail/widget.ts` | Phase 1 | TEST-104 | emitted-example |
| REQ-003 | 注入表条目 | `umes.injection-table` | `src/modules/example/widgets/injection-table.ts` | Phase 1 | TEST-104 | emitted-example |
| REQ-003, REQ-004 | 遮蔽设置页 `/backend/sidebar-customization` | `ui.page-shell` | `src/modules/example/backend/todos/page.tsx` | Phase 1 | TEST-104 | emitted-example |
| REQ-003 | `nav_shell` 语言包 `i18n/{zh,en}.json` | `module.i18n-catalogs` | `src/modules/example/i18n/en.json` | Phase 1 | TEST-102（语言纯度 + 覆盖测试） | emitted-example |
| REQ-003, REQ-004 | 树构建 + 偏好分层 + 有效功能位过滤 `lib/buildNavTree.ts` | `runtime.tenant-scoped-cache`（最近的「服务端 lib + 同目录单测」行） | `src/modules/example/lib/todoSummaryService.ts` | Phase 1 | TEST-101 | framework-only |
| REQ-001 | `order_hub/index.ts` 模块元数据 | `module.metadata` | `src/modules/example/index.ts` | Phase 4 | TEST-302 | emitted-example |
| REQ-001, REQ-005 | `order_hub/acl.ts` 功能位 | `module.acl-features` | `src/modules/example/acl.ts` | Phase 4 | TEST-303 | emitted-example |
| REQ-001, REQ-005 | `order_hub/setup.ts` 默认角色授予 | `module.setup-role-features` | `src/modules/example/setup.ts` | Phase 4 | TEST-303 | emitted-example |
| REQ-001 | 工作台页 `/backend/orders` + `page.meta.ts` | `ui.page-shell` | `src/modules/example/backend/todos/page.tsx` | Phase 4 | TEST-303 | emitted-example |
| REQ-001, REQ-010 | 工作台表格（`DataTable`）与行操作 | `ui.datatable` | `src/modules/example/components/TodosTable.tsx` | Phase 4 | TEST-303 | emitted-example |
| REQ-009 | 手写守卫读路由 `GET /api/order_hub/stages` | `api.custom-route` | `src/modules/example/api/organizations/route.ts` | Phase 4 | TEST-302 | emitted-example |
| REQ-009 | scoped 阶段投影 `lib/orderStages.ts` + 同目录单测 | `runtime.tenant-scoped-cache` | `src/modules/example/lib/todoSummaryService.ts` | Phase 4 | TEST-301, TEST-302 | framework-only |
| REQ-001 | `order_hub` 语言包 | `module.i18n-catalogs` | `src/modules/example/i18n/en.json` | Phase 4 | TEST-301（语言纯度由平台测试守） | emitted-example |
| REQ-006 | `PurchasingPurchaseOrder` 三列 + 索引 | `data.entities` | `src/modules/example/data/entities.ts` | Phase 2 | TEST-202 | emitted-example |
| REQ-006 | 迁移（3 列 + 1 索引） | `data.migrations` | `src/modules/example/migrations/Migration20251030150038.ts` | Phase 2 | TEST-202（迁移审阅证据 + 读回断言） | emitted-example |
| REQ-006 | 采购单 create/update 校验 | `data.validators` | `src/modules/example/data/validators.ts` | Phase 2 | TEST-201 | emitted-example |
| REQ-006 | 采购单命令（来源解析 + 冻结） | `commands.write` | `src/modules/example/commands/todos.ts` | Phase 2 | TEST-202 | emitted-example |
| REQ-006 | 采购单列表/写路由（过滤 + 追加出参） | `api.crud-factory` | `src/modules/example/api/customer-priorities/route.ts` | Phase 2 | TEST-202 | emitted-example |
| REQ-006 | 采购单列表横幅筛选（`?sourceSalesOrderId=`） | `ui.datatable-perspectives-filters` | `src/modules/example/components/TodosTable.tsx` | Phase 2 | TEST-202 | emitted-example |
| REQ-006 | 采购单 create 表单预填 + 行复制 | `ui.form-create` | `src/modules/example/backend/todos/create/page.tsx` | Phase 2 | TEST-203 | emitted-example |
| REQ-002 | 订单 hub 页 `/backend/internal-sales/orders/[id]` + `page.meta.ts` | `ui.page-shell` | `src/modules/example/backend/todos/page.tsx` | Phase 3 | TEST-205 | emitted-example |
| REQ-002 | hub 分区渲染（复用 app 内 `trade_docs/components/ContractDetail.tsx` 的 `RelatedSection`） | `ui.page-shell`（页面壳；分区件为 app 内复用） | `src/modules/example/backend/page.tsx` | Phase 3 | TEST-205 | framework-only |
| REQ-007 | 发运单列表路由新增 `salesOrderId` 过滤 | `api.crud-factory` | `src/modules/example/api/customer-priorities/route.ts` | Phase 3 | TEST-204 | emitted-example |
| REQ-008 | 发运单/合同/PI-CI create 表单预填 | `ui.form-create` | `src/modules/example/components/TodoForm.tsx` | Phase 3 | TEST-205 | emitted-example |
| REQ-011 | 买方内联快速建档（复用 `parties` 选项源与写路径） | `api.option-source-routes` | `src/modules/example/api/tags/route.ts` | Phase 5 | TEST-305 | framework-only |
| REQ-011 | 币种智能默认 + 行内小数校验 | `ui.form-create` | `src/modules/example/components/TodoForm.tsx` | Phase 5 | TEST-304, TEST-305 | framework-only |
| REQ-011 | 共享件 `src/lib/parties/CustomerQuickCreateDialog.tsx`（app 级共享，非模块贡献） | `umes.component-replacement`（最近的「组件复用」行） | `src/modules/example/components/ComponentOverrideShowcase.tsx` | Phase 5 | TEST-305 | framework-only |

**未映射的行（诚实登记）：** 「app 级纯函数 lib + 同目录单测」（`buildNavTree`、`orderStages`）与「app 级共享组件」在 `surface-inventory.json` 中没有一一对应的能力行，上表用最近的行（`runtime.tenant-scoped-cache` / `umes.component-replacement`）承载并标 `framework-only`——它们不发出任何框架机制，因此不存在 `emitted-example` 的对照物。没有任何行使用 `negative-fixture`。

## Rollout, Migration, and Rollback

- **迁移生成/应用边界：** 唯一迁移来自 Phase 2 的 `yarn db:generate`（3 列 + 1 索引）。**审阅后提交**，不在验证流程里跑 `yarn db:migrate`；本机 dev 由 dev supervisor 在下次 `yarn dev` 时应用，生产走既有部署流程。
- **Rollout order:** Phase 1（入口）→ Phase 2（链路）→ Phase 3（hub）→ Phase 4（工作台）→ Phase 5（录入）。三个无依赖阶段（1、2、5）可在各自 worktree 内并行，合入顺序不强制；Phase 3 需 Phase 2；Phase 4 需 Phase 1+2+3。
- **Feature flags:** 不使用。回滚粒度就是 PR 粒度：
  - Phase 1 回滚 = 恢复 `layout.tsx` 的 `adminNavApi`/`mobileSidebarSlot` 并删除 `nav_shell` 与遮蔽页 → 内置平铺列表（`nav.groupOrder` 从未改动）立即回来。
  - Phase 2 回滚 = 回退代码（列与索引可留，空值不参与任何既有逻辑）。
  - Phase 3/4 回滚 = 删除新页面/新 API；阶段投影与集成测试随后端一起消失，既有列表不受影响。
  - Phase 5 回滚 = 回退表单改动；共享对话框留在 `src/lib/parties`（其余引用不受影响）。
- **可观测性:** 失败是行内可见的（每源错误 + 重试）而不是静默；`order_hub` 与 `nav_shell` 的路由用 `createLogger` 记录异常（照 `boss_cockpit/api/summary/route.ts`）。
- **`order_hub.view` 授予：** 既有租户需 `yarn mercato auth sync-role-acls`；超管不受影响。不授予时页面 403、树里该条目消失（fail closed）。

## Migration & Backward Compatibility

（`.ai/guides/upstream/BACKWARD_COMPATIBILITY.md` 要求：任何触及契约面的 PR 必须引用一份含本节、并在其中说明不兼容影响的 spec。）

| 契约类别 | 本规格的改动 | BC 判定 | 依据 |
|---|---|---|---|
| DB schema（`purchasing_purchase_orders`） | 追加 3 个可空列 + 1 个新索引 | **允许**（`MAY add new columns with defaults` / `MAY add new indexes freely`） | BC §8 |
| API 请求（purchasing 列表/写） | 追加**可选**参数 `sourceSalesOrderId` | **允许**（`MAY add new optional fields to request schemas`） | BC §7 |
| API 响应（purchasing 列表） | 追加 `sourceSalesOrderId`/`Kind`/`Number` | **允许**（`MAY add new optional fields`；无字段移除/改名/类型收窄） | BC §7 |
| API 路由（cross_border shipments） | 追加**可选**查询参数 `salesOrderId` | **允许**（不新增方法、不改 URL） | BC §7 |
| 新 API 路由 | `/api/nav_shell/*`、`/api/order_hub/stages` | **允许**（`MAY add new API routes freely`） | BC §7 |
| ACL feature | 新增 `order_hub.view`（不改名/不删除既有） | **允许** | BC §10 |
| 页面元数据 | **不改**任何既有 `page.meta.ts`；新增两个 `navHidden: true` 页面 | **允许**（`PageMetadata` 全部字段保持可选、无字段移除） | BC §2 |
| 注入位 | 消费既有 spot `backend:sidebar:nav`（不改名/不移除；不改变其 context 类型） | **允许** | BC §6 |
| chrome payload 消费者 | 只把 `groups` 置空（**不修改安装层**；payload 类型与其余字段不变） | **允许**；消费者影响见下 | BC §2 |
| 事件 / worker / 通知 / DI / CLI / 生成物 | 无改动 | **无影响** | BC §5, §9, §11, §13, §14 |
| 函数签名 / import path | 无改动，不新增安装层导出 | **无影响** | BC §3, §4 |

**Deprecations / removals:** 无（本规格不弃用、不移除任何契约面，因此无 `UPGRADE_NOTES.md` 条目）。

**Compatibility bridge & 知情披露（对 `chromePayload.groups` 的消费者）:** app 的 `groups` 置空只作用于**侧边栏渲染**这一个消费点（内置列表渲染器），而渲染器改用注入件实现同一功能；第二个消费者——侧边栏自定义编辑器——通过显式 `groups` prop 拿到同一棵树，因此**功能没有丢失**。另有两处**一次性**行为变化必须披露：

1. **组级偏好错位：** 条目级偏好键仍是 href → 继续生效；组级键从旧 `*.nav.group` 变为节点 id（`tree:*`），因此组排序/组名的历史偏好失效一次，用户在 `/backend/sidebar-customization` 重设即可恢复。
2. **设置/个人资料段不受影响**（`settingsSections`/`profileSections`/`grantedFeatures`/`brand` 原样透传）。

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 清空 `chromePayload.groups` 影响未知的第三消费者 | 某个注入件/第三方扩展读 `groups` 会拿到空数组 | 全仓 grep `groups` 消费者（已知仅两处：内置渲染器 + 自定义编辑器）；改动只发生在 app 路由，安装层未动，回滚即恢复 | 第三方扩展不在本仓，无法穷举；披露在本节与 README |
| 组级偏好一次性错位 | 个别用户的侧栏顺序变化一次 | 明确写进 spec/README 与 PR 描述；偏好在自定义页一键重设；条目级偏好不受影响 | 用户需要自己重排一次 |
| 自绘树与框架侧栏行为漂移（折叠状态、活跃高亮、紧凑态） | 观感不一致或某状态缺失 | 用 `useSidebarCollapse()` 与平台同样的活跃判定；TEST-104 逐项覆盖紧凑/移动/暗色 | 框架升级引入新的侧栏状态时需同步 |
| 工作台聚合读的一致性问题（分页/排序/去重） | 行重复或漏行；带筛选时的 `total` 是窗口内的下限 | 按 `createdAt desc` + 同 id 去重；每源 500 行扫描上限，窗口被截断时置 `totalIsCapped` 并在工作台提示收窄；口径写进路由 `openApi` 与 README；单元 `mergeOrders`（12 例）+ TEST-303 覆盖 | 极端数据量下用户需收窄筛选；精确全量 total 需另立单元（缓存/无上限扫描） |
| 阶段投影的跨模块列名/软删假设错误 | 计数为 0 或 SQL 报错 | `order_hub/lib/orderStages.ts` 单点实现 + TEST-302 用真实构造数据断言；列名以安装源码实体定义为准（`unverified` 处在实现时逐条核对） | 安装层列名变化需同步该文件 |
| 采购来源解析引入跨模块读 | 事务内多一次读；解析到已删/跨组织订单的风险 | 解析在同一事务作用域内、scoped 读、失败 422 回滚；TEST-202 覆盖跨组织与不存在两种失败 | 无（失败路径已显式覆盖） |
| `sales.orders.create` 可能不接受零行 | REQ-011 的草稿项无法交付 | TEST-306 先核实；不接受则放弃该项并在 Resolved decisions 记录 | 用户仍需先加一行 |
| 历史销售单未标贸易类型 | 工作台不列出这些单 | 与两个入口列表口径一致（同一 filter）；`yarn mercato internal_sales backfill-trade-type --apply` 归类 | 未归类期间该单只能从原列表进入 |
| 无埋点，成功度量不可测 | 无法量化「减少点击数」 | 用浏览器实测的点击路径（AC-001 的 ≤3 次）代替；成功度量另行立项 | 产品侧量化缺口 |
| 迁移只加列但可能被误跑成回滚 | 数据面风险 | 迁移向前-only、无回填；回滚回退代码不删列；审阅 SQL 后才提交 | 无 |

## Acceptance Criteria

- [ ] **AC-001** — 登录后从侧边栏「订单工作台」进入 `/backend/orders`，一屏看到三类订单，且每行的采购/发运/单证/收汇·退税四列与 `GET /api/order_hub/stages` 的返回逐行一致（≤2 次点击到达任一订单的 hub）。
- [ ] **AC-002** — `/backend/orders/<id>`（旧 `/backend/{internal,external}-sales/orders/<id>` 服务端重定向到此）显示抬头、明细行与六个分区；每区在有数据时列出对应单据并可点入、可就地编辑头部字段，无数据时为空态 + 分区内「去填写」入口；某区读失败时该区显示错误与重试而其余区照常。
- [ ] **AC-003** — 侧边栏渲染 8 个域并可逐级折叠，活跃项高亮，无内置平铺列表重复；桌面/紧凑态/移动抽屉（≤420px）三态均可用；顶部过滤框输入关键词只剩命中项。
- [ ] **AC-004** — `/backend/sidebar-customization` 上隐藏一条目、调整同组顺序、改一个显示名后保存，刷新后树生效；`applyToRoles` 生效于该角色用户，而该用户自己的偏好优先于角色偏好；历史条目级（href）偏好仍生效。
- [ ] **AC-005** — 只授 `cross_border.shipments.view` 的用户：树里只出现命中条目（服务端不返回无权条目，客户端二次过滤），直接访问 `/backend/finance/payables` 被页面门禁拒绝。
- [ ] **AC-006** — `POST /api/purchasing/purchase-orders {sourceSalesOrderId}` → 201 且三列冻结（`_number` = 订单号）；跨组织或不存在 → 422 `source_sales_order_not_found`；`GET …?sourceSalesOrderId=<id>` 只回该单；显式清空后读回 `null`；从 `?orderKind=internal_sales_order&orderId=<id>` 进表单：来源已填、行已复制且**单价为空**。
- [ ] **AC-007** — `GET /api/cross_border/shipments?salesOrderId=<id>` 只回该订单经分摊关联的发运单；未知 id → 空列表；跨组织 id 不泄露任何行。
- [ ] **AC-008** — 从订单 hub 新建发运单/合同/PI：发运单销售分摊已预填（无官方目录链接的行被跳过并提示）、合同方向/币种/行已填、PI 行已复制且（订单仅一张合同时）合同已选；参数非法时行内提示且表单仍可手工使用。
- [ ] **AC-009** — `GET /api/order_hub/stages?ids=` 对构造数据返回的计数/勾选与构造一致；未知 id 与跨组织 id 不出现在 `items`；`ids` 超过 200 或非法 → 400。
- [ ] **AC-010** — 工作台采购行的「全字段」抽屉三组数值与 `/backend/export-finance/orders/<id>` 同值，页脚「在订单档案中打开」可达；销售行抽屉为抬头 + 四分支计数并可打开订单详情；无 `export_finance.orders.view` 时该组显示无权限文案而其余组照常。
- [ ] **AC-011** — 订单新建页「新建客户」建档后自动选中；同组织同入口连续两次建单，第二次币种 = 上次选择；采购单选供应商后币种 = 供应商默认币种（未手改时）；数量输 5 位小数 blur 即行内报错且提交被拦。
- [ ] **AC-012** — 本文件与 `docs/plans/README.md` 状态板一致；每个 Phase 落地时同步更新对应 `docs/dev/*`、模块 README 与本文件的 Phase/Changelog。
- [ ] **AC-013** — 采购单详情页在明细行后按 关联订单 → 关联合同 → 关联发运单 给出三个区块：有数据时每行可点入（订单 → `/backend/orders/<id>`、合同 → 合同详情、发运单 → 发运单详情），无数据时给空态文案，读失败时该区块显示错误与重试而其余区块照常；发运单超过预览条数时「查看全部」进入带 `?purchaseOrderId=` 横幅的发运单列表。
- [ ] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light-mode, and dark-mode states.
- [ ] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | `AGENTS.md`（route 三轴）、`.ai/guides/spec-delivery.md`、`om-spec-writing`、`.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`、`.ai/specs/SPEC-000-template.md`；实现阶段再按路由加载 `om-module-scaffold` / `om-backend-ui-design` / `.ai/guides/backend-ui.md` |
| Data models, APIs, events, UI, and tests are internally consistent | pass | 唯一 schema 变更（3 列 + 索引）只由 REQ-006 引入并被 TEST-202 覆盖；无新增事件；每个 UI 面都有对应 API 与 TEST |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001…J-006 各自映射到 Phase 1–5 的退出闸门；无「整合收尾」阶段 |
| Platform-native reuse and extension points were chosen before custom code | pass | Reuse and Ownership Map：注入位 + chrome 转发 + 偏好纯函数 + `DataTable` + `RelatedSection` + `export_finance` 投影 + `parties` 写路径；自绘仅限树（框架无多级原语）与工作台组合页（`boss_cockpit` 先例） |
| UI contracts identify references, canonical components, and theme/state coverage | pass | `### Surface inventory` 逐面给出最近参考、规范组件与状态；含明暗/窄屏/a11y |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | `## Implementation Phases` 每阶段均有 Depends on / Outcome / Deliverables / Slices / Requirements / Tests / Validation / Exit gate |
| Verdict | **Ready for implementation** | Phase 1–5 可依序（或 1/2/5 并行）交付 |

## Resolved decisions

本规格的全部开放问题已按用户批准的计划（`local://order-centric-revamp-plan.md` 所载的同一份方案）定案，不留悬空问题：

| ID | Question | Decision | Rationale / 影响 |
|---|---|---|---|
| Q-001 | 一级入口的根是什么？ | 公司订单（订单工作台 → 订单详情 hub），每个后续模块是根上的填写分支 | 业务口径是「一张订单为主线」，见 Problem Statement |
| Q-002 | 三类订单合并还是分列三个列表？ | 统一工作台 | 缺口列需横向比较；避免三处口径漂移 |
| Q-003 | 菜单层级用什么机制实现？ | app 自绘导航树 + chrome 包装路由置空 `groups` | 框架侧栏不支持分组嵌套，也没有壳的替换句柄；跨仓改动出本单元 |
| Q-004 | 是否改变页面授权？ | 不。树是显示层；`requireFeatures` 仍是唯一闸门 | 隐藏不授予、不剥夺 |
| Q-005 | 角色/个人侧边栏自定义是否继续可用？ | 继续，用同一套偏好数据与同一个编辑器组件 | 复用安装层语义，避免两套偏好 |
| Q-006 | 预填范围？ | 四项全做：采购（Phase 2）、发运/合同/单据（Phase 3） | 预填是「减少重复录入」的核心价值 |
| Q-007 | 落地页是否改成工作台？ | 不。`/backend` 保持现有仪表盘 | 老板驾驶舱/仪表盘已有既定读者 |
| Q-008 | 订单 → 采购单如何锚定？ | 采购单加 `source_sales_order_id/_kind/_number` 三列 + 索引 | 唯一 schema 变更；纯追加，BC §8 允许 |
| Q-009 | 阶段计数在哪算？ | `order_hub` 的只读 scoped SQL 投影，客户端合并列表 | 避免服务端合并时解密买方名 |
| Q-010 | 35 字段全字段视图怎么呈现？ | 右侧抽屉，复用 `SourcePreviewDrawer` 外壳与既有 `export_finance` 投影 | `DataTable` 展开行装不下分组字段，窄屏跑位 |
| Q-011 | 零行草案（REQ-011 条件项） | **放弃本项**：实装核实安装层 `orderCreateSchema`（`node_modules/@open-mercato/core/src/modules/sales/data/validators.ts:724`）要求 `lines.min(1)`，引擎不接受零行订单；客户端「至少一行」的拦截保持不变，本规格不为了录入便利去改订单引擎的完整性约束 | 实测依据 + 数据完整性优先 |
| Q-012 | 必填是否进一步收敛？ | 币种有默认、行可后补；买方/供应商作为业务锚点保持必填 | 有意为之，写进 README |
| Q-013 | 历史组级偏好是否迁移？ | 不迁移，一次性错位并在 PR/README 披露 | 自绘树的既定代价 |

## Changelog

| Date | Change |
|---|---|
| 2026-10-10 | **第三轮的 UI 部分撤回（owner 2026-10-10 口径）**：采购单详情页的 关联订单 / 关联合同 / 关联发运单 三区块与 `purchasing.orders.detail.{related,sourceOrder,contracts,shipments}.*` 词条移除，来源单号回到抬头摘要格（本次执行见 [`2026-10-09-company-order-root.md`](./2026-10-09-company-order-root.md) 第十轮 REQ-045 / REQ-041）。`cross_border` 的 `?purchaseOrderId=` 过滤、列表横幅与集成 TEST-307 **保留**——owner 口径是只撤 UI 区块。注：2026-10-09 曾有过一次同口径撤回（本地提交 `3c3459d`，PR #149 关闭未合并），但它没有进 `dev`，公司订单发布波段 #161 把区块重新带了回来；本次是落到 trunk 的那一次。 |
| 2026-10-09 | **部分被取代**：owner 反馈「不复用既有列表的 UI/服务端聚合，完全新增一个表存数据、用表的数据关联构成功能模块；点击工作台订单 item 不应直接跳采购单模块 item；要像购销合同一样关联式填入不同模块的数据」⇒ 新规格 [`2026-10-09-company-order-root.md`](./2026-10-09-company-order-root.md)（容器根单 + 关联表 + 全量补录）接管工作台与订单详情 hub；本文件的 REQ-001/009/010 与 Non-goals 第一条（「不新增业务实体」）随之失效。 |
| 2026-10-09 | **侧栏菜单收平一层（owner 复审）**——采购 / 出口销售 / 合同与单据 / 发运与装箱 从「订单工作台」之下移到与它平级：公司订单域的第二层 = 订单工作台（页面叶子，`/backend/orders`）+ 四个业务组，域内三层（公司订单 → 工作台 / 组 → 页面）。分支节点不再有「自带页面」（`NavTreeBranch.href` 与 builder 的 own-page 解析删除，组标题即它第一个仍在的子页），`nav_shell.tree.module.orderWorkbench` 键随工作台改回页面叶子删除。词表「导航树节点」行、`docs/dev/navigation.md` 与 `nav_shell` README 同步；PR #147 追加提交。 |
| 2026-10-09 | **第三轮：采购单详情页补关联区块 + 发运单 `?purchaseOrderId=` 过滤**——`/backend/purchasing/orders/<id>` 在明细行后给出 关联订单（来源销售订单，只读，链 `/backend/orders/<id>`）/ 关联合同（`trade_docs/contracts/orders?orderKind=purchase_order` → `contracts?ids=`，行链合同详情）/ 关联发运单（`cross_border/shipments?purchaseOrderId=`，超过预览条数时「查看全部」带同款过滤横幅）三区块，壳复用 `src/lib/related/RelatedSection.tsx`（`framed`），i18n 新增 `purchasing.orders.detail.{related,sourceOrder,contracts,shipments}.*`；来源单号从抬头摘要格移入关联订单区块（同一事实只留一处）；`cross_border` 新增 `loadShipmentIdsForPurchaseOrder`（scoped 只读采购分摊表）+ `shipments` 列表可选 `purchaseOrderId` + 列表页横幅；REQ-013 / TEST-307 / AC-013 建立。 |
| 2026-10-09 | **侧栏当前页标识收敛（owner 复审）**——树只标一次：当前页那一行带左侧竖条 + 底色并加粗，其上的域标题与分支行只加粗（不画竖条/底色）。判定抽成纯模块 `nav_shell/lib/navActive.ts`（`hrefIsActive` / `collectActiveIds` / `resolveRowState` → `active` / `on-path` / `idle`，单测 `lib/__tests__/navActive.test.ts`）。起因：分组行没有自己的页面时 href 取第一个子页（采购 → `/backend/purchasing/orders`），旧规则「本行或子行命中即高亮」把采购、订单工作台、采购单三行一起点亮。本规格的词表「导航树节点」行、`nav_shell` README 与 `docs/dev/navigation.md` 同步；PR #147 追加提交。 |
| 2026-10-08 | **第二轮重构 · 阶段 C + D：订单单据维度 + hub 对齐合同页**——新表 `trade_docs_order_documents`（订单自己的单据维度，多态、无外键；迁移 `Migration20261008095745_trade_docs` 已应用）、命令 `trade_docs.orders.documents.replace`（成套替换 + 订单 `updated_at` 乐观锁 + 两侧 scoped 解析）、`GET/POST /api/trade_docs/orders/documents`、单据/税票建单在同一事务写关联行（create 页带 `?orderKind=&orderId=`）、删除单据一并删关联行；hub 重排为六区块（采购单 / 购销合同 / 单据 / 发运单 / 装箱单 / 收汇·退税），块壳抽成 `src/lib/related/RelatedSection.tsx`，区块行可就地编辑头部字段（`src/lib/quick-edit/QuickEditDialog.tsx` + 五个模块字段工厂，各模块自己的 `PUT` + 行版本乐观锁），新增装箱单区块（按发运单读 `docType=packing_list`）；销售行的 `documentCount` 口径改为「订单自己的关联行 + 其发运单的出口单证」。REQ-002、Surface inventory、TEST-205、AC-002 同步改口径。 |
| 2026-10-08 | **第二轮重构 · 阶段 A + B：菜单再分层 + 报价单合并**——公司订单域变成四层（公司订单 → 订单工作台 → 采购 / 出口销售 / 合同与单据 / 发运与装箱 → 页面），分支行的标题变成链接（节点自带页面就链到它，否则链第一个子页），箭头按钮只做展开/收起；报价单两种贸易类型合并成 `/backend/quotes` 一条列表（类型列 + 类型筛选，请求参数由 `lib/quoteListParams.ts` 纯函数产出），两个旧列表 URL 307 进来并预选类型。词表「导航树节点」行、`docs/dev/navigation.md` 与两个模块 README 同步；已知限制：新加的一层不能拖拽排序（安装层编辑器只对域顶层给把手）。 |
| 2026-10-08 | **第二轮重构 · 阶段 E：工作台取消「只看待补」**——勾选框、`pending` 查询参数、服务端 `isOrderPending` 过滤与 `lib/orderPending.ts` 一并删除（类型 / 状态 / 关键词三个筛选与四个阶段列保留；`?pending=…` 变为未声明参数被 zod 丢弃，不再 400）。本规格的 REQ-001、J-001、UI 架构表、Surface inventory、TEST-301/303、Phase 4（Outcome/slices/exit gate）、AC-001 与词表「待补」行同步改口径；Changelog 的历史行不动。 |
| 2026-10-08 | **入口重构（菜单收敛 + 服务端分页 + 订单为根的填写面）已交付并实测**（PRs #144 / #145 / #146，均 off `dev`；追踪计划 `.ai/runs/2026-10-08-order-centric-entry-rework.md`）。三条分支的门禁各自全绿（`yarn generate` / `typecheck` / `lint` 0 error / `check-lessons` / `ds:check` / `test` / `build`）。**单元**：`nav_shell` 覆盖率与构建 21 tests、`order_hub` 23 tests（`mergeOrders` 12 例）、三模块合并 99 tests。**集成**：新 `order_hub/__integration__/order-hub-aggregate.spec.ts` **6 passed**（页不重叠且 `createdAt desc`、无筛选 `total` = 三源 total 之和、`type=purchase` 只回采购单、`pending=true` 全为有缺口的单、跨组织看不到夹具订单、`pageSize=101` → 400）；回归 `shipment-sales-order-filter` **4 passed**、`order-source-link` **4 passed**。**真机**：聚合 API `page=1\|2\|3&pageSize=5` → 5/5/2 行不重叠且 `createdAt desc`、`total=12`；`total`(17) = 1+1+15（三源各自 total）；`pending=true` 13 行全命中；`pageSize=101`/`page=0`/`type=bogus`/`pending=maybe` 各 400。**浏览器**：侧栏 8 域（公司订单 = 工作台 + 采购 / 出口销售 / 合同与单据 / 发运与装箱，二级组展开到三级页面；两个订单列表不进树）、系统域 7 条各带图标；工作台每页只发一次聚合请求且底部是页码（点「下一页」发 `page=2`，无「加载更多」）；工具栏只有一个「新建订单」，弹窗选类型；建单 `POST /api/sales/orders` 201 后落到 `/backend/orders/<新 id>` 的 hub（抬头/明细/五分区/锚点/去填写/查看全部/空态），四个旧 URL 307 重定向。**落地口径**（D11 取代 D1–D4）：菜单分组在公司订单域内；`?type=` 由工作台内的 `useSearchParams()` 读取（后端 catch-all `src/app/(backend)/backend/[...slug]/page.tsx` 不向模块页转发 `searchParams`，服务端 prop 方案实测无效）；带 `status`/`pending` 筛选时 `total` 为扫描窗口内下限（`totalIsCapped` 标记，精确全量合计另立单元）；聚合路由把调用者凭据转给各模块列表路由，某源不可读降级为 `unavailableSources` 而非整单失败 |
| 2026-10-08 | Initial draft — 由已批准的计划（订单工作台 + 填入式补充 + 自绘多级导航树）落成规格；Phase 1–5 与 REQ-001…REQ-012、TEST-101…TEST-306、AC-001…AC-012 建立追溯关系 |
| 2026-10-08 | **Phase 5 已交付并实测**（PR `feat/order-entry-friction`，off `dev`）。证据：单元 `src/lib/parties/__tests__/customerQuickCreate.test.ts`（随共享件搬迁）+ `src/modules/internal_sales/lib/__tests__/currencyDefault.test.ts`（键构造与 `resolveInitialCurrency` 优先级）→ `yarn jest` 全绿（69 suites · 571 tests）；`yarn typecheck` / `yarn lint`（0 error）/ `yarn ds:check`（998 files）/ `yarn build` 全绿；浏览器实测：对外订单新建页出现「新建客户」按钮且点开即既有快速建档对话框（客户编码/名称/国家/联系人/电话/邮箱/银行，保存并选用）；把 `om:internalSales:currency:<orgId>:external` 置为 `USD` 后重新打开新建页，币种字段预选 **USD**（币种记忆读路径）；行内数量输 `1.23456` 后 blur → 行内出现「数量与单价最多 4 位小数」且输入框 `aria-invalid=true`（提交拦截未改）。**未在浏览器单独复现**：采购单「选中供应商后币种默认」——实现为无头观察分组（读 `GET /api/purchasing/suppliers/<id>` 的 `defaultCurrencyCode`，仅在操作员未手改币种时写入），typecheck/lint 通过但选择器交互未打通，按「已实现未实测」记录。搬迁：`CustomerQuickCreateDialog.tsx` + `lib/customerQuickCreate.ts`（含其单测）→ `src/lib/parties/`，`trade_docs` 的 `CounterpartyPicker` 改 import，行为不变；词条仍留在 `trade_docs` 的 i18n（共享件可读模块词表，与 `@/lib/orders/purchaseOrderStatus` 同例） |
| 2026-10-08 | **Phase 4 已交付并实测**（PR `feat/order-workbench`，**stack 在 Phase 3 之上并合并了 Phase 1 的 `feat/sidebar-nav-tree`**——工作台入口要加进 P1 的 `NAV_TREE`；两个父 PR 合入后 retarget 到 `dev`）。证据：单元 `src/modules/order_hub/lib/__tests__/orderPending.test.ts` **9 passed**（待补判定 × 三类订单 × 终态 + 合并排序）；集成 `__integration__/order-hub-stages.spec.ts` → `yarn mercato test:integration order-hub-stages` **5 passed**（① 两类订单的计数/勾选：销售行采购 1 / 发运 1 / 单证 2（PI + 税务发票）/ 已收汇 / 已退税，采购行采购 0 / 发运 1 / 单证 0；② 取消的采购单不再计入采购数；③ 未知 id 不出现；④ 跨组织不出现；⑤ 超过 200 个 id → 400）；`yarn typecheck` / `yarn lint`（0 error）/ `yarn ds:check`（1032 files）/ `yarn test` 全绿；浏览器实测（真实订单）：树「公司订单 → 订单工作台」可进入 `/backend/orders`，三类订单列出且类型/金额/状态/四个阶段列正确（采购行「采购」列 `—`），「只看待补」只留有缺口且未取消的订单，阶段为 0 的格子直达预填新建，采购行「全字段」抽屉三组与 `/backend/export-finance/orders/<id>` 同值且页脚可达，销售行抽屉 = 抬头 + 四分支计数；受限账号（只有 `order_hub.view` + `purchasing.orders.view` + `sales.order.view`）**看不到新建按钮**（manage 功能位显隐生效）且列表/树照常；`/backend` 落地页仍是仪表盘。实现中修正自身三处：类型列文案键（snake_case kind → camelCase key）、金额列要读数字型（销售列表的 `grandTotalNetAmount` 是 number）、hub 明细行 `pageSize` 上限 100；集成夹具踩到三处既有契约（发票 `direction` 是 inbound/outbound 且行用 `description` + 必填 `amount`；收汇/退税是 PUT upsert；取消采购单必须带 reason），均已按实装修正并断言。已知：`/backend/orders` 无权限组的抽屉文案由实现覆盖（lint/typecheck 通过），未在浏览器单独复现 |
| 2026-10-08 | **Phase 3 已交付并实测**（PR `feat/sales-order-hub`，**stack 在 Phase 2 之上**，父 PR 合入后 retarget 到 `dev`）。证据：集成 `src/modules/cross_border/__integration__/shipment-sales-order-filter.spec.ts` → `yarn mercato test:integration shipment-sales-order-filter` **4 passed**（命中只回带该订单货物的发运单、未知订单空页、未知合同空页、跨组织空页）；单元：`?orderKind=&orderId=` 解析迁到 `src/lib/orders/sourceOrderParams.ts` 并由 `src/lib/orders/__tests__/sourceOrderParams.test.ts` 覆盖（12 passed，与 purchasing 的行映射测试合并计算）；`yarn typecheck` / `yarn lint`（0 error）/ `yarn ds:check`（1008 files）/ `yarn test`（70 suites · 573 tests）/ `yarn build` 全绿；浏览器实测（真实订单）：hub 抬头 + 明细行（5.0000 / ¥150.00）+ 五个分区与各自预填入口、无失败分区；发运单新建页提示「已按来源订单预填销售分摊」且行带数量/单价/币种；合同新建页方向=销售、币种=CNY、行已复制；PI 新建页同上并带合计。**实测发现并修掉一处既有缺陷**：链接表解析出空集时 `{ $in: [] }` 以 `in ()` 到达 Postgres → `?contractId=`（发运单列表、装箱单列表）与新增的 `?salesOrderId=` 返回 500 而非空页；`cross_border/lib/linkIdFilter.ts` 用 nil uuid 表达「匹配不到任何行」，三个入口统一修好（集成用例 2/3 即回归测试）。另修正自身两处：hub 明细行的 `pageSize` 必须是 `/api/sales/order-lines` 的上限 100（200 会 400）；明细行金额列要读数字型 `unit_price_net`。共用件：`lib/salesStatusWrite.ts`（列表与 hub 同一套状态写）、`lib/salesDocumentRecord.ts`（同一套列表行投影） |
| 2026-10-08 | **Phase 2 已交付并实测**（PR `feat/order-to-purchase-order-link`）。证据：单元 `src/modules/purchasing/lib/__tests__/sourceSalesOrder.test.ts` **12 passed**（参数解析：none/ok/未知 kind/非 uuid/半对；行映射：只复制商品引用与数量、主数据优先、catalog 兜底、缺引用与缺数量计数、snake_case 读法）；集成 `__integration__/order-source-link.spec.ts` → `yarn mercato test:integration order-source-link` **4 passed**（① 建单 201 且三列冻结、单号 = 销售订单号；② 422 `source_sales_order_not_found` 三种情形——不存在、无贸易类型通道、跨组织；③ `?sourceSalesOrderId=` 只回该单且不含未挂来源的单；④ 显式 `null` 清空三列）；`yarn typecheck` / `yarn lint`（0 error）/ `yarn ds:check`（1000 files）/ `yarn test`（69 suites · 573 tests）/ `yarn build` 全绿；迁移 `Migration20261008042809_purchasing.ts` 审阅通过（3 列 + 1 索引，无回填）。实现中修正两处自身缺陷：`Scope` 类型应取自 `commands/shared.ts`（无 `lib/scope.ts`）；编辑表单的 `initialValues` 必须带上 `sourceSalesOrderId`。已知前提（非本次引入）：`/api/sales/order-lines` 与 `/api/sales/orders` 的门禁是复数 `sales.orders.view`，而页面声明单数 `sales.order.view`——非超管角色需同时授予复数 id，行复制失败时表单保留来源锚并提示手动补行 |
| 2026-10-08 | **Phase 1 已交付并实测**（PR `feat/sidebar-nav-tree`）。证据：单元 `src/modules/nav_shell/lib/__tests__/buildNavTree.test.ts` + 覆盖测试 `navTree.coverage.test.ts` → `yarn jest --config jest.config.cjs src/modules/nav_shell` **16 passed**；`yarn typecheck` 0 error、`yarn lint` 0 error、`yarn ds:check` 1008 files passed；浏览器实测：9 个域且无内置平铺重复、逐级折叠、活跃高亮（仅命中页有标记）、搜索「发运」只剩命中项、折叠态只显示图标、≤420px 抽屉内 `mobileSidebarSlot` 渲染并可跳转；RBAC：只授 `cross_border.shipments.view` 的账号树里只有「业务办理 → 发运与装箱（发运单/装箱单）」，直接访问 `/backend/finance/payables` 仍被页面门禁拒绝；偏好：角色布局（`applyToRoles`）生效、用户偏好覆盖角色、href 级 `hiddenItems`/改名/`itemOrder` 全部生效（`itemOrder` 由本模块应用，安装层只存不读）。实测中修掉两处自身缺陷：app 遮蔽页漏带 `page.meta.ts` 会丢掉 `auth.sidebar.manage` 门禁（覆盖测试拦下）；设计系统检查拦下 `max-h-[68dvh]` 与内联 `paddingLeft`。已知限制：框架自带侧栏搜索框因分组置空而失效（本树自带可用搜索框），记录在模块 README 与 `docs/dev/navigation.md` |
