# 销售单据并入公司订单（协作=对内销售 · 报价挂根单 · 模块合并）

**Date**: 2026-10-09
**Status**: Draft

> Route: `module-data`（`order_hub` / `internal_sales` 界面层）+ `backend-ui`；交付 `spec-pr`（本文件随实现同 PR，见 `AGENTS.md` Delivery Flow）。
> Owner 口径来源：2026-10-09 在 `/backend/orders/e9ad342f-…`（公司订单 hub 的「对内销售订单」区块）的设计反馈，以及同日对本调研三条问题的答复（见 Resolved decisions R-001…R-003）。

## TLDR

三件互相咬合的事，一次做成：

1. **「协作组织」= 对内销售单的派生结果**。建/关联一张对内销售单（买方 = 分公司组织 X）→ 同事务把 X 写进该根单协作组织（分公司因此可见 + 可写状态/备注）；移除对内链接即撤销；手工维护的对话框退役为只读。操作员从此只录一次「这笔生意的分公司是谁」。
2. **报价单挂进公司订单（按需关联）**。`order_hub_company_order_links` 追加两类 kind（对内/对外报价单），hub 新增「报价单」区块；报价列表行操作「挂到公司订单」；报价新建页接 `?companyOrderId=` 预填并保存后自动关联；报价「转为订单」时把来源写进新订单 metadata（引擎会删掉报价行且不留来源）。不自动建根、不新增阶段词。
3. **`internal_sales` 模块并入 `order_hub`，导航收敛**。页面 URL、`/api/internal_sales/trade-type-channels/*`、页面功能位都不变（路由用 `metadata.path` 钉住旧 URL）；侧边栏「出口销售」组取消，销售报价单直接挂「公司订单」域。

## Problem Statement

owner 在 hub 页面上看到「对内销售订单」区块与抬头「协作组织」并存，反馈「协作组织功能可以用成对内销售的功能」；同时认为「公司订单-订单工作台」与「出口销售-销售报价单」两个模块重复，应当合并。代码查证（2026-10-09）：

- **同一个「分公司」在三处独立表达、互不联动**：
  | 表达 | 存储 | 作用 |
  |---|---|---|
  | 对内销售单买方 | `sales_orders.customer_snapshot.internalSales.organizationId` + 通道 `INTERNAL_SALES` | 钱/行/状态；发运分摊、合同关联、采购来源锚都指向它 |
  | 根单关联 | `order_hub_company_order_links.kind='internal_sales_order'` | hub 区块出现 |
  | 协作组织 | `order_hub_company_order_collaborators` | 分公司**可见**根单 + 可写 状态/备注 |
  写协作表的只有 `order_hub.orders.collaborators.replace` 一个命令（`src/modules/order_hub/commands/companyOrders.ts:906-1004`），`link-child` / `links.replace` / 建单 `links[]` 都不碰它——所以**关联或新建了对内销售单，分公司仍然看不到这张公司订单**，必须在「协作组织」对话框里再选一遍同一个组织（证据：`__integration__/company-order-collaborators.spec.ts` 里协作与链接是两步）。
- **反方向同样空转**：hub「新建（对内）」带 `?companyOrderId=`，但预填只覆盖对外（外部客户 party）；对内买方（关联组织）既不预填也不受协作组织约束（`src/modules/internal_sales/components/InternalSalesForm.tsx:996-1037`，注释原话 *an internal sale's buyer is a sibling organization, so only the printed name is filled there*）。
- **报价单与公司订单没有任何关系**：`COMPANY_ORDER_LINK_KINDS` 只有三类订单（`src/modules/order_hub/data/validators.ts:62-67`）；`lib/orderStages.ts` 的 `SALES_KINDS` 只含订单类；`lib/companyOrderFields.ts` 只读 `sales_orders`/`purchasing`——报价阶段这笔生意在工作台/根单视角**不存在**，金额聚合也不含报价。报价「转为订单」时引擎硬删报价行（安装源 `node_modules/@open-mercato/core/src/modules/sales/commands/documents.ts` 的 `nativeDelete`+`em.remove(quote)`）且不给订单留来源；只有「载入」路径写 `metadata.internalSales.sourceQuote`（`InternalSalesForm.tsx:299`）。
- **模块边界错位**：订单**列表**（工作台）与**详情 hub** 在 `order_hub`；报价列表、4 个表单页、贸易类型/通道/买方机制在 `internal_sales`（62 文件），两边互相直接 import（`order_hub` → `internal_sales/lib/*` 3 处；`cross_border`、`trade_docs` 共 4 处）；侧边栏「公司订单」域下「出口销售」组只有一个页面（`src/modules/nav_shell/lib/navTree.ts`）。

受影响用户：总部操作员（同一关系录两处）、分公司（默认看不到自己被卖的货）、以及一切从根单视角工作的人（报价阶段无入口）。

## Overview and Success Measures

- **Primary outcome:** 录一处——建/关联一张对内销售单，分公司即获得该根单的可见性与状态/备注写权；报价可从根单发起、可挂到根单、转换后仍在根单上可追溯；`internal_sales` 的产品代码不再作为独立模块存在（弃用壳保留一版；页面 URL/API/功能位不变），侧边栏少一级分组。
- **Leading indicators:** 集成测试断言「链接后协作行存在、分公司可读、解链后撤销」；hub「报价单」区块行数 = 关联的报价单数；`yarn mercato order_hub sync-collaborators`（dry-run）能报出派生集合；`GET /api/internal_sales/trade-type-channels/orders` 在模块合并后仍 200。
- **Baseline:** 手工协作对话框（第四轮，`order_hub.orders.collaborators.replace` 是唯一写入者）；报价 0 关联（`COMPANY_ORDER_LINK_KINDS` 只有三类订单）；`internal_sales` 作为独立模块占 `src/modules.ts:292` 一行、62 个文件；导航「公司订单」域内 5 个二级节点（工作台 + 4 组，其中「出口销售」组只含 1 页）。
- **Market / product reference:** 复用本仓既有模式——`trade_docs.contracts.orders.replace` 的「成套替换 + 快照冻结」、`order_hub` 的关联表 + `RelatedSection` + `CompanyOrderLinkDialog`、报价列表的「类型筛选 + 双类型入口」；不新造机制。

## Goals

- **REQ-001 — 派生写入**：所有链接写路径在**同一事务**内调用 `syncDerivedCollaborators(em, scope, companyOrderId)`（新 `lib/collaborators.ts` 函数）——`order_hub.orders.link-child`、`order_hub.orders.links.replace`、建单 `create.links[]`、以及 `order_hub backfill-company-orders` CLI；**移动语义**（子单从根 A 移到根 B）对 A、B 两个根单分别重算并各自失效缓存。派生集合 = 该根单上 kind ∈ {`internal_sales_order`, `internal_sales_quote`} 的**对内**单据买方组织（`customerSnapshot.internalSales.organizationId`）的并集。对端单据是 `sales_orders`/`sales_quotes` 的加密 `customer_snapshot`，必须走 `findWithDecryption`（既有 `lib/companyOrder.ts:loadCompanyOrderRefs` 已是这条读法）。
- **REQ-002 — 派生撤销**：某组织在该根单上不再有任何对内链接（订单或报价）时，同一事务删除其协作行；多张对内单据指向同一组织时只删最后一张之后的行；**移动语义**（子单从根 A 移到根 B，`moveCompanyOrderChildren` 已返回 `movedFrom`）对 A、B 分别重算并各自调用 `invalidateCompanyOrderCollaboratorCaches`。
- **REQ-003 — 协作读面不变**：列表 scope（显式可见 id 集）、工作台「协作」徽标、hub 协作只读视图、`update` 的 `status`/`notes` 白名单、owner-only 动作 403 —— 语义与代码均不变；hub「协作组织」对话框退化为**只读面板**（列出派生组织 + 来源单据号 + 「为什么在这里」的一句话）。
- **REQ-004 — 手工维护退役（按 BC 弃用协议保留一版桥）**：hub 的手工写入口（对话框保存）移除；`POST /api/order_hub/orders/collaborators`（`order_hub.orders.collaborators.replace`）**保留一个发布周期**并标记弃用（`openApi` 的 `deprecated: true` + 路由/命令 JSDoc `@deprecated` 指向替代路径「经对内单据派生」与移除版本）；`GET` 保留（只读面板）。既有手工行（无对内链接来源）保留可读，`sync-collaborators --prune` 可清理并在 dry-run 中列出。
- **REQ-005 — 报价链接词汇**：`COMPANY_ORDER_LINK_KINDS` 追加 `internal_sales_quote` / `external_sales_quote`（additive，`validators.ts` 注释已声明「a fourth kind is additive」）；`GET /api/order_hub/orders/links` 的 `kind` 参数接受逗号分隔列表（additive），供「报价单」区块一次取两类；**报价 kind 必须携带显式 `companyOrderId`——无目标时 `link-child` 422（报价不自动建根，与订单 kind 的既有自动建根行为不同）**；`lib/companyOrder.ts` 的引用解析按 kind 分流（订单类读 `SalesOrder`、报价类读 `SalesQuote`，两套 id 集合不合并），快照冻结的是对端自身的数据。
- **REQ-006 — hub「报价单」区块**：一个区块展示两类报价（行带对内/对外徽章），锚点 `#quotes`，排在三个订单区块之前；支持「关联…」（复用 `CompanyOrderLinkDialog`，选项源为 `GET /api/sales/quotes`：两类通道 + **`channelIdsEmpty=true` 未标记桶**（照发运分摊 loader 口径，`cross_border/components/shipmentFormOptions.ts:118-136`），未标记报价的归行类型由买方快照推导（`tradeTypeFromSnapshot`），两者皆无的报价不入选）、「新建」（先选对内/对外 → 对应 create 页）、「移除」（成套替换）；报价已被「转为订单」时行内显示「已转为订单 ORDER-…」且不给「打开」。
- **REQ-007 — 报价/订单新建预填与回落**：create 页支持 `?companyOrderId=`：对外预填买方 = 根单默认客户（party，已有逻辑）；对内买方候选按该根单协作组织**三态**——**0 个 → 回退为全量关联组织**（现状口径，新根的第一张对内单据仍可建）、恰 1 个 → 预填、≥2 个 → 选择器只列协作组织；保存成功后 `link-child`（kind 按入口/单据通道推导）并回落 hub 对应锚点；关联失败不阻断已创建的单据（warning 闪讯，与订单同口径，`InternalSalesForm.tsx:1220-1232` 既有实现）。
- **REQ-008 — 报价列表「挂到公司订单」**：`/backend/quotes` 行操作新增「挂到公司订单/新建公司订单并关联」——两入口交互照 hub 的未关联态（`OrderDetail.tsx` 的 `UnlinkedOrderState` + `ExistingCompanyOrderPicker`；`lib/companyOrderResolve.ts` 只做旧 URL→根单 id 反查，不是该 UX 的实现处）；需要一个「选目标根单」对话框——把既有根单选择器（`ExistingCompanyOrderPicker`）抽成共享组件，hub 与报价列表共用（`CompanyOrderLinkDialog` 要求已定 `companyOrderId`+kind，不可直接复用）。
- **REQ-009 — 转换留痕**：报价列表「转为订单」成功后，app 读回新订单并**合并**写入 `metadata.internalSales.sourceQuote = { id, number }`——引擎的更新是整对象覆盖（安装源 `entity.metadata = input.metadata ?? null`），且 convert 会把报价 `metadata` 克隆进新订单，必须**读-合并-写**、保留其它键；若该报价已挂在某根单上，把新订单 `link-child` 到同一根单（kind 由通道推导）。载入路径已有，不动。
- **REQ-010 — 模块合并**：`src/modules/internal_sales/**` 的**产品代码**（页面/组件/lib/API/i18n/测试）迁入 `src/modules/order_hub/**`（页面在 `backend/` 下的路径逐字保留 → URL 不变；API 路由经 `metadata.path` 钉住 `/api/internal_sales/trade-type-channels/{quotes,orders}`）；`src/modules.ts` 的 `internal_sales` 条目**降级为弃用壳**（目录仅留 `index.ts` + `cli.ts`，一个发布周期后整体移除）；`cross_border`/`trade_docs` 的 4 处跨模块 import 改为 `order_hub`；i18n 键命名空间保持 `internal_sales.*`（不搬家，避免 60+ 文件无行为差异的改写）。
- **REQ-011 — CLI 迁移（含弃用桥）**：Phase 1 在当时的模块名下新增 `yarn mercato internal_sales sync-collaborators`（`[--apply] [--prune] [--tenant=] [--organization=]`，dry-run 默认、幂等）；Phase 3 合并后两条命令落在 `order_hub`（`backfill-trade-type` 逐字迁移 + `sync-collaborators`），旧名 `internal_sales backfill-trade-type` 经弃用壳（`cli.ts` re-export + `@deprecated` 注明替代与移除版本）保留至少一个发布周期。命令名出现在用户可见文案里（`internal_sales/i18n/{zh,en}.json` 的提示、`InternalSalesTable.tsx` 的硬编码 fallback、README/升级步骤）——全部换成新名，旧名只出现在弃用说明中。
- **REQ-012 — 导航收敛**：`nav_shell` 的 `NAV_TREE` 去掉「出口销售」分组节点，`{ href: '/backend/quotes' }` 直接挂在「公司订单」域、位于订单工作台之后；`nav_shell.tree.module.exportSales` 两个语言字典条目删除；`navTree.coverage.test.ts` 与导航文档同步。
- **REQ-013 — 字段归位口径 + 文档**：把「什么放根单、什么留单据」写进 `docs/dev/business-architecture.md` 与两个 README（根单 = 生意容器：标题/CO- 编号/下单日期/预计交货/阶段状态/是否已收款/备注/协作/文件/关联，**不存币种、金额、行**；报价单保留行/价/币种/有效期/发送与接受/报价状态机/客户参考号/收件邮箱；根单的下单日期/预计交货是**唯一手填处**，单据侧 `placed_at`/`expected_delivery_at` 由引擎在转换时从报价有效期映射，app 表单不写，不构成第二真源）；并同步引用 `internal_sales` 的其余文档：`docs/dev/architecture.md`、`docs/dev/multi-company-org-model.md`、`docs/dev/currency-policy.md`、`docs/dev/navigation.md`、进度表/状态板。

## Non-goals

- **不自动为报价建根**（owner 选定「按需关联」）：`link-child` 的报价 kind 缺 `companyOrderId` → 422（订单 kind 的自动建根行为不变）；工作台不出现报价阶段的行，不新增「报价中」阶段词，`stages.amounts` 与 35 列聚合不纳入报价金额（报价只在「报价单」区块按单据展示）。
- **不动**金额口径（money-scale spec）、单据状态机（`2026-09-30-document-status-lifecycle`）、发运分摊口径、`finance` 应收——注意 `finance` 里的 `internal_sales` 是**应收 kind 枚举值**（`finance/lib/ledger.ts:298`），与模块 id 无关，绝不受本次合并影响。
- **不新增表、不新增迁移、不新增功能位**（协作写权沿用 `order_hub.manage`；协作组织读沿用 `order_hub.view`）。
- 不改 `customer_snapshot` 的加密映射与快照形状；不改 `sales`、`purchasing`、`cross_border`、`trade_docs` 的既有契约。
- 不做「根单默认币种」「根单金额字段」等新字段（属于把账本搬进根单，见 Design Decisions 的反例）。
- 不搬 i18n 键名、不改页面 `requireFeatures`（包括已知的 `sales.quote.view` 单复数口径，另案）。

## Proposed Solution

### 1) 协作组织由对内单据派生（Phase 1）

- **写入点收敛到链接命令**：`link-child`（含建单页 `?companyOrderId=` 与建单表单 `links[]` 的调用方）与 `links.replace` 在写链接行的同一事务里调用新 `lib/collaborators.ts` 的 `syncDerivedCollaborators(em, scope, companyOrderId)`：重算该根单上 kind ∈ {`internal_sales_order`, `internal_sales_quote`} 的对内单据买方组织集合，与现有行求差后增删。
- **来源读取**：对端单据的 `customer_snapshot` 是加密列 → 用 `findWithDecryption`（与 `loadCompanyOrderRefs` 同一条读法、同一 scope 校验）；`customerSnapshot.internalSales.organizationId` 存在即该单据的对内买方组织（`lib/tradeType.ts` 的 `tradeTypeFromSnapshot` 同口径）。外部买方（`partyId`）不派生。
- **读面零改**：`loadCollaboratorCompanyOrderIds`、列表 scope、hub 只读视角、`forbiddenCollaboratorFields` 白名单全部照旧——变的只有「谁写这张表」。
- **历史数据与修复**：新增 `yarn mercato internal_sales sync-collaborators`（Phase 1 期模块名；Phase 3 合并后为 `order_hub sync-collaborators`）——dry-run 默认：每个根单打印派生集合、将增/将删的行；`--apply` 幂等重建；`--prune` 同时删除无来源的手工行并逐条报告。
- **UI**：hub「协作组织」由可写对话框改为只读弹窗：每行「组织名 — 来源：对内销售单 ORDER-… / 对内报价单 QUOTE-…」，底部一句「给分公司可见性的方式：建/关联一张对内销售单」。`CompanyOrderCollaboratorsDialog` 保留组件名与只读渲染；对话框的保存按钮与写调用移除（`POST` 路由本身按弃用面保留一版）。

### 2) 报价单按需挂进公司订单（Phase 2）

- **词汇**：`internal_sales_quote` / `external_sales_quote` 两个 kind；`links` GET 的 `kind` 支持逗号列表。快照复用现有 `ref_number`/`ref_counterparty`/`ref_snapshot`（关联时冻结），不新增键——类型徽章由 kind 推导。
- **hub 区块**：`OrderDetail.tsx` 的 `AttachBlock` 描述符扩展为「一组 kind」（`kinds: CompanyOrderLinkKind[]`）；「报价单」区块排三个订单区块之前；「新建」弹窗先选对内/对外（复用报价列表的 create 弹窗）→ `/backend/{internal,external}-sales/quotes/create?companyOrderId=<id>`；「关联…」用同一对话框，选项源 `GET /api/sales/quotes?channelIds=…`（两类通道 + 未标记桶按现有 `loadSalesOrderOptions` 的口径），选项标签带类型词。
- **创建与回落**：报价 create 页接 `?companyOrderId=`（两个入口页共用一份 `page.tsx`，只加参数解析）：`CompanyOrderBuyerPrefill` 扩展对内分支（0 个协作组织 → 全量关联组织；恰 1 个 → 预填；≥2 个 → `BuyerPickerField` 候选收敛为协作组织）；保存成功后 `link-child { kind: internal|external_sales_quote }` → 回落 hub `#quotes`。
- **列表入口**：`/backend/quotes` 行操作「挂到公司订单」→ 对话框选一张根单（搜索 `GET /api/order_hub/orders`）→ `link-child`；没有根单时可「新建公司订单并关联」（两入口交互照 hub 未关联态，共享同一个根单选择器，见 REQ-008）。
- **转换留痕与去向**：`InternalSalesTable` 的「转为订单」在 `POST /api/sales/quotes/convert` 成功后：① 追加 `sales.orders.update`（携带 `metadata.internalSales.sourceQuote` 与最新版本）——失败只记 warning，不回滚已完成的转换；② 若报价已挂根（`orders/links?refId=` 反查），`link-child` 新订单到同一根。hub 报价行读侧：若能经 `metadata.internalSales.sourceQuote.id` 找到同一根上的订单，渲染「已转为订单 ORDER-…」并去掉「打开」（报价行此时已被引擎硬删）。

### 3) 模块合并与导航收敛（Phase 3）

- **目录迁移**：`src/modules/internal_sales/{backend,components,lib,i18n,__integration__}` → `src/modules/order_hub/` 同名子路径（`backend/quotes/**`、`backend/{internal,external}-sales/**` 逐字保留）；`setup.ts`/`cli.ts`/`index.ts` 合并进 `order_hub` 的同名文件；`api/trade-type-channels/**` 迁入后加 `export const metadata = { path: '/internal_sales/trade-type-channels/…', … }` 钉住 URL（生成器读 `metadata?.path ?? '<模块 id>/<路径>'`，core 的 `payment_gateways/api/*/route.ts` 是既有用法）。
- **注册与引用**：`src/modules.ts` 的 `internal_sales` 条目降级为弃用壳（保留注册一行）；`cross_border`（2 处）、`trade_docs`（2 处）、`order_hub`（3 处）的 import 改为新路径；`docs/dev/parallel-development.md` 若列模块清单则同步。
- **导航**：`NAV_TREE` 去掉 `tree:module:export-sales` 分组；quotes 页成为「公司订单」域的直接子节点（工作台之后）。
- **合并后模块的 README**：`internal_sales/README.md` 的「表面/规则」并进 `order_hub/README.md`（作为「销售单据与报价」一节），原文中指向 `internal_sales` 模块的表述改为 order_hub；删除的文件/CLI 名称在本 spec 的 BC 节登记。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| 协作组织由对内单据**派生**（物化表保留） | owner 口径「单据为准、协作自动」；同一关系只录一次；物化表让「我协作哪些根单」仍是索引读（列表 scope 与附件代理都靠它） | 保留手工白名单 + 双向同步 | 两个入口会再次不一致；owner 已选最简口径 |
| 派生来源 = 对内**订单 + 报价** | 报价阶段就关联的生意，分公司应当先看到；与「报价单挂根单」同批落地 | 只由订单派生 | 报价先行时分公司看不到，又回到「手工补看」 |
| 手工协作对话框退成**只读** | 一个概念一个入口；来源可解释（哪张单据给的可见性） | 保留手工例外 | owner 未选；需要时后续加回即可（一条命令） |
| 报价**按需关联**，不自动建根 | owner 选定；根单阶段词表从「已下单」开始，报价阶段无词条；避免工作台噪声与聚合口径分叉 | 渠道内报价自动建根 | 需要新增「报价中」阶段 + 聚合含报价 + 回填全部历史报价，超出本次口径 |
| 模块合并**保留全部 URL**（页面路径 + `metadata.path`） | BC：API 路由/页面 URL 是稳定面；迁移对调用方不可见 | 顺带改名 `/api/order_hub/trade-type-channels/*` | 破坏面为零的选项存在时不该制造破坏 |
| CLI 新旧名并存一版（弃用壳） | BC §13 要求先弃用后移除；旧脚本/运维记忆不受损；新名同批上线 | 立即改名 + 全量文档替换 | 违反弃用协议（先弃用、保留桥、一个发布周期后再移除）；`internal_sales` 的壳只承担这一件事 |
| i18n 键保持 `internal_sales.*` | 键不是契约面也不是用户可见文本；改键要动 60+ 文件、零行为收益 | 统一改成 `order_hub.*` | 纯 churn |
| 根单不搬账本字段（币种/金额/行仍留单据） | 35 列汇总 + `stages.amounts` 已提供只读聚合；多单据多币种是常态，根单存摘要必然与单据漂移 | 把报价/订单的币种与金额「抽」到根单 | 第二本账：每个写路径都要同步，金额口径冲突（本轮 owner 明确「部分数据适合放报价单」） |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| 协作组织（派生集合） | 某根单上 kind ∈ {`internal_sales_order`,`internal_sales_quote`} 的对外/对内单据中，**对内**单据买方组织（`customerSnapshot.internalSales.organizationId`）的并集 | 物化于 `order_hub_company_order_collaborators`，由链接命令/`sync-collaborators` 维护 | 派生态与链接不一致 → `sync-collaborators` 可重建（幂等） |
| 对内/对外判定 | 单据的贸易类型：通道 `INTERNAL_SALES`/`EXTERNAL_SALES`，快照链接兜底（`tradeTypeFromSnapshot`），与「挂根」时冻结的 kind 同口径 | `internal_sales/lib/tradeType.ts`（合并后为 order_hub lib） | **预期跳过**：两种来源都判不出（或快照里没有 `internalSales.organizationId`）→ 不派生协作并记 log，链接照常成功；**基础设施错误**（解密/DB 读失败）→ 整个命令失败回滚（与链接写同事务），不产生「链接成功但协作缺失」的半态 |
| 协作写权 | 协作组织只能写 `status`/`notes`（白名单），其余 422 `collaborator_field_not_allowed`；owner-only 动作 403 `company_order_owner_required` | `commands/companyOrders.ts` + `lib/collaborators.ts` | 保持现状，不动 |
| 报价挂根 | 链接是**登记**：不改变报价与订单的任何字段；同一报价可挂到根单再被转换为订单，链接快照冻结在关联时 | `order_hub_company_order_links` | 报价被硬删（转换后）→ 行渲染冻结值 + 去向，不给「打开」 |
| 转换留痕 | 「转为订单」后：新订单 `metadata.internalSales.sourceQuote = { id, number }`；已挂根的报价把新订单挂到同一根 | 引擎命令 + app 追加写 | 追加写失败 → warning，不回滚转换（单据已存在） |
| 根单日期口径 | 根单 `order_date`/`eta_date` 是唯一手填处；单据 `placed_at`/`expected_delivery_at` 由引擎在转换时从报价有效期映射，app 表单不写 | 本 spec + README | — |
| 模块边界 | 一个 app 模块 `order_hub` 拥有「公司订单容器 + 销售报价/订单界面 + 贸易类型机制」；`sales` 引擎仍是单据真源 | `src/modules.ts` | — |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 所有者组织操作员 | 根单 CRUD、建/关联/解链子单（订单/报价）、建报价并回落、看协作只读面板 | 自己的组织集（`ctx.organizationIds`，ACL 展开） | `order_hub.view` / `order_hub.manage` |
| 协作组织（派生） | 看根单（工作台/hub/文件/字段抽屉）、写 `status`/`notes` | 显式可见 id 集 = 我的组织集 ∪ 我协作的根单 | `order_hub.view`（写由白名单裁决） |
| 无关组织 | 什么都看不到（列表空、hub 404/空对象、字节 404） | fail-closed | — |

- `tenantId` 与 `organizationId` 一律来自 `requestScope`（`ctx.organizationIds` 展开）；缺 scope → 400 `organization_scope_required`（沿用现状）。
- 派生写入发生在 owner-gated 的链接命令内，**不引入新的提权路径**：能建立对内销售单的人本来就是能把该根单可见性给出去的人（同组织 + `order_hub.manage`）。
- `sync-collaborators` CLI：与既有补录 CLI 同口径（显式 `--tenant/--organization` 或全部 scope；dry-run 默认）。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 子单关联 / 快照冻结 / 成套替换 | extend | `order_hub` | 现有 kind 枚举 + `CompanyOrderLinkDialog` | 第 4/5 类 kind 是注释里已声明的 additive 扩展 |
| 协作行读写 | reuse（写入点改为命令内调用） | `order_hub` | `lib/collaborators.ts` | 读面（scope 展开、附件授权、字段白名单）零改动 |
| 报价单据本体（编号/状态/行/有效期/发送接受） | reuse | installed `sales` | `GET/POST/PUT /api/sales/quotes*` | 引擎是唯一真源，不重写 |
| 报价列表 / 表单 / 买方选择器 / 状态动作 / 通道解析 | reuse（随模块迁入） | `internal_sales` → 并入 `order_hub` | 相对 import 路径更新 | 62 文件整体搬家，行为不变 |
| 通道解析 API | reuse（URL 钉住） | `order_hub`（路由 `metadata.path`） | `GET /api/internal_sales/trade-type-channels/*` | 外部可解析路径不变 |
| hub 区块壳 / 只读面板 | reuse | `src/lib/related/RelatedSection.tsx`、`Dialog` | 同 `AttachBlock` 模式 | 与既有区块同款 |
| 根单「未关联」两入口模式 | reuse | `order_hub/components/OrderDetail.tsx`（`UnlinkedOrderState` + `ExistingCompanyOrderPicker`） | 报价列表「挂到公司订单」 | 交互口径与销售单一致；选择器抽成共享组件 |
| installed `attachments` | reuse | installed | 既有 `entityId='order_hub:company_order'` | 本次不新增文件槽位 |

## Architecture and Data Flow

```text
报价/订单表单（order_hub 页面，?companyOrderId= 预填）
  └─ POST /api/sales/{quotes,orders}            (installed sales 引擎，unchanged)
       └─ POST /api/order_hub/orders/link-child {kind, refId, companyOrderId?}
            └─ order_hub.orders.link-child（同一事务）
                 ├─ upsert 链接行（快照冻结）
                 └─ syncDerivedCollaborators：解密读对端快照 → upsert/删除协作行
报价列表「转为订单」
  └─ POST /api/sales/quotes/convert (installed)
       ├─ app 追加写新订单 metadata.internalSales.sourceQuote
       └─ 若报价已挂根：link-child 新订单到同一根（kind 由通道推导）

hub「报价单」区块  ← GET /api/order_hub/orders/links?companyOrderId=&kind=internal_sales_quote,external_sales_quote
CLI：order_hub sync-collaborators [--apply] [--prune]（历史重建/清手工行）
     order_hub backfill-trade-type（原 internal_sales 命令）
```

- **Module boundaries:** 合并后 `order_hub` 是「公司订单容器 + 销售单据界面」的唯一 app 模块；交易一致性由「链接命令内联派生」保证（不跨模块事务、不事件补偿）。
- **Extension points:** 无 UMES 参与；合并后 `order_hub` 的既有 `events.ts`/`acl.ts`/`setup.ts` 追加（CLI 命令、setup 播种沿用 `internal_sales/setup.ts` 的 `onTenantCreated`+`seedDefaults` 实现）。
- **Alternatives considered:** 见 Design Decisions（手工白名单、自动建根、账本搬根单、URL 顺带改名均被否）。
- **Compatibility:** 页面 URL、`/api/internal_sales/trade-type-channels/*`、`order_hub.*` API/事件/ACL、销售引擎契约全部不变；只有 CLI 命令名（新名上线、旧名经弃用壳保留一版）与模块 id 的降级（产品代码迁走、弃用壳保留）变化（BC 节逐项登记）。

## User Journeys

### Journey J-001 — 总部建一张对内销售单，分公司自动可见

1. 操作员在 hub「对内销售订单」区块点「新建」→ `/backend/internal-sales/orders/create?companyOrderId=<id>`。
2. 买方选择器按三态取候选（0 个协作组织 → 全量关联组织；恰 1 个 → 已预填；≥2 个 → 只列协作组织），保存成功 → `link-child`。
3. 同一事务：链接行 + 协作行写入；分公司账号的工作台出现该根单（「协作」徽标）、hub 只读、文件可下载、可写状态/备注。
4. 失败：`link-child` 失败不阻断已创建的销售单（warning + 落回根单页）；买方缺失/跨组织 422 行内提示。

### Journey J-002 — 从根单发起报价 / 把已有报价挂到根单

1. hub「报价单」区块点「新建」→ 选对内/对外 → create 页（预填买方：对外=默认客户，对内=协作组织／0 个时全量关联组织）。
2. 保存 → `link-child(internal|external_sales_quote)` → 回到 hub `#quotes`，行可见（编号/对方/类型徽章/状态）。
3. 已有报价：`/backend/quotes` 行操作「挂到公司订单」→ 选根单（或「新建公司订单并关联」）→ hub 出现该行；重复挂载幂等（唯一键）。

### Journey J-003 — 报价转订单后仍可在根单上追溯

1. `/backend/quotes` 行操作「转为订单」→ 引擎就地转换（报价行被删）。
2. app 把 `metadata.internalSales.sourceQuote` 写到新订单；若报价已挂根，把新订单挂到同一根。
3. hub「报价单」区块该行显示「已转为订单 ORDER-…」（无「打开」）；「对内/对外销售订单」区块出现新订单行。

### Journey J-004 — 分公司（协作）视角

1. 分公司账号工作台只看到自己被协作的根单，带「协作」徽标。
2. hub：所有写入口隐藏；只提供「修改状态与备注」；文件区块只读（可下载）。
3. 服务端同裁决：写其它字段 422；删除/关联/建子单 403。

### Journey J-005 — 升级与历史数据

1. 部署后运行 `yarn mercato internal_sales sync-collaborators`（Phase 3 合并后同一条命令落在 `order_hub`）：打印每个根单的派生集合与将变更的行（含无来源手工行）。
2. owner 批准后 `--apply`（可选 `--prune` 清理手工行）；重跑为零差异。
3. 命令名：新名 `yarn mercato order_hub backfill-trade-type` 与 `… sync-collaborators` 是文档/README 的唯一写法；旧名 `internal_sales backfill-trade-type` 经弃用壳继续可用一个发布周期（输出弃用提示）。

## UI and Interaction Contracts

参考页（最近既有实现）：hub 三个关联区块与 `CompanyOrderLinkDialog`（`src/modules/order_hub/components/OrderDetail.tsx`、`CompanyOrderLinkDialog.tsx`）、报价列表与新建弹窗（`src/modules/internal_sales/components/InternalSalesTable.tsx`）、报价表单（`InternalSalesForm.tsx`）、侧边栏树（`src/modules/nav_shell/components/SidebarNavTree.tsx`）。规范壳层/组件：`FormHeader`、`RelatedSection`、`DataTable`、`CrudForm`、`Dialog`、`ComboboxInput`、`Button`、`StatusBadge`、`MoneyAmount`、语义 token；不新增自绘控件。文案走 `t()`（键保持 `internal_sales.*` / `order_hub.*`）。

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/orders/<id>`（hub）「报价单」区块 | 列出/关联/新建/移除报价；显示类型与去向 | `GET /orders/links?kind=internal_sales_quote,external_sales_quote`；`POST /orders/links`；`POST /orders/link-child`；`GET /api/sales/quotes` | 同页既有关联区块（`AttachBlock`） | `RelatedSection`、`CompanyOrderLinkDialog`、`Dialog` | loading/empty/error(+重试)/conflict(409 冲突条)/权限不足 | REQ-005, REQ-006 |
| hub「协作组织」只读弹窗 | 展示派生组织与来源 | `GET /orders/collaborators?companyOrderId=` | 本组件旧版（去掉保存） | `Dialog`、只读列表 | loading/empty/error | REQ-003, REQ-004 |
| `/backend/quotes` 行操作 | 「挂到公司订单」 | `POST /orders/link-child`（+ `GET /orders` 选择器） | 报价列表既有行操作 / `OrderDetail` 未关联态两入口 | `DataTable` 行操作、`Dialog`、`ComboboxInput` | loading/empty/error/conflict | REQ-008 |
| `/backend/{internal,external}-sales/quotes/create?companyOrderId=` | 预填买方 + 保存后关联回落 | `POST /api/sales/quotes`、`POST /orders/link-child` | 既有报价 create 页 + 订单页的 `?companyOrderId=` | `CrudForm`、`ComboboxInput`、`flash` | 预填失败静默（照旧）、关联失败 warning | REQ-007 |
| 侧边栏（nav_shell） | 「出口销售」组取消，报价单挂「公司订单」域 | `NAV_TREE` | 既有树/组节点 | `SidebarNavTree` | 空搜索/无权限（既有） | REQ-012 |

```text
# hub「报价单」区块（排在三个订单区块之前，锚点 #quotes）
┌──────────────────────────────────────────────────────────────┐
│ 报价单                                   [新建 ▾(对内/对外)] [关联…] │
├──────────────────────────────────────────────────────────────┤
│ QUOTE-20260929-00022  [对内] 俄罗斯 AB 有限公司   已发出  打开  移除 │
│ QUOTE-20261009-00003  [对外] ACME GmbH            已转订单 ORDER-… 移除 │
└──────────────────────────────────────────────────────────────┘
```

- **Behavior:** 报价区块与订单区块同一套「成套替换 + 快照 + 版本锁」；「打开」按行类型跳 `/backend/{internal,external}-sales/quotes/<id>/edit`；报价已删（已转订单）→ 冻结值 + 去向文案、无「打开」；移除走 `POST /orders/links`（携带 `updatedAt`），409 → 平台冲突条并重读。
- **Responsive and accessibility:** 行在窄屏换行不横向溢出；对话框 Esc 关闭、首焦点在首个输入；错误用行内提示 + `role` 由平台组件提供；键盘可完成关联/移除。
- **Localization:** 新键前缀 `order_hub.detail.quotes.*`、`order_hub.companyOrders.collaborators.*`（来源文案）、`internal_sales.list.actions.linkToCompanyOrder*`；zh 只写中文、en 只写英文。
- **Design-system and theming:** 仅语义 token 与共享原语；无硬编码状态色；明暗两态与窄屏实测。

## Data Models

| Entity | Change | Notes |
|---|---|---|
| `CompanyOrderLink`（`order_hub_company_order_links`） | 无 schema 变更 | `kind` 是 text 列，词汇表在 `validators.ts`；追加 `internal_sales_quote`/`external_sales_quote`（additive，注释已声明） |
| `CompanyOrderCollaborator`（`order_hub_company_order_collaborators`） | 无 schema 变更 | 写入者由 `collaborators.replace` 改为链接命令 + `sync-collaborators` |
| `sales_quotes` / `sales_orders` | 不读不写结构 | 只经引擎 API 与既有解密读（`findWithDecryption`） |

- **无迁移**（`yarn db:generate` 预期 no changes；作为 Phase 3 的验证点之一）。
- 历史数据（`customer_snapshot` 加密）：不由迁移处理，走 `sync-collaborators` CLI（解密读 + 幂等写）。
- 唯一键/索引不变：协作行 `(company_order_id, organization_id)` 唯一键继续兜底并发重复写。

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET` | `/api/order_hub/orders/links` | `order_hub.view` | `kind` 支持逗号列表（additive） | `{items,total}` 不变 | 400（未知 kind）/403 | REQ-005 |
| `POST` | `/api/order_hub/orders/link-child` | `order_hub.manage` | `{kind,refId,companyOrderId?}`（kind 枚举扩展） | 200 `{companyOrderId,linked,created}` + `links.updated` | 422（未知/跨组织）/409 | REQ-001, REQ-005, REQ-007 |
| `POST` | `/api/order_hub/orders/links` | `order_hub.manage` | `{companyOrderId,kind,refs,updatedAt}`（kind 枚举扩展） | 200 + `links.updated` + `collaborators.updated`（派生有变更时） | 422/409 | REQ-001, REQ-002, REQ-006 |
| `GET` | `/api/order_hub/orders/collaborators` | `order_hub.view` | `companyOrderId` | `{items:[{organizationId,organizationName,sourceKind,sourceNumber}],total}`（`source*` additive；来源 = 该组织在该根单上的对内链接，经链接表 + 解密读装配） | 403/空列表 | REQ-003 |
| `POST` | `/api/order_hub/orders/collaborators` | `order_hub.manage` | `{companyOrderId,organizationIds,updatedAt}` | 200 + `collaborators.updated` | **弃用保留一版**：`openApi.deprecated: true` + JSDoc `@deprecated`（替代：经对内单据派生），UI 不再调用；下一发布周期移除 | REQ-004 |
| `GET` | `/api/internal_sales/trade-type-channels/{quotes,orders}` | `sales.{quotes,orders}.view` | 不变 | 不变 | 不变 | REQ-010 |
| CLI | `yarn mercato order_hub backfill-trade-type` | — | 原 `internal_sales` 命令逐字迁移 | dry-run/`--apply` | 幂等 | REQ-011 |
| CLI | `yarn mercato order_hub sync-collaborators` | — | `[--apply] [--prune] [--tenant=] [--organization=]` | dry-run 默认；幂等 | 逐行报告 | REQ-002, REQ-004 |

- `links` GET 的 `kind` 逗号列表：非法值 → 400，不静默忽略（避免把「筛选错」读成「没有」）。
- `syncDerivedCollaborators` 在命令事务内执行（与链接行同提交）；事件 `order_hub.company_order.collaborators.updated` 仅在集合实际变化时发出（payload `count` 不变）。
- `collaborators.replace` 按弃用协议保留一版：`data/validators.ts` 的 schema 与 `commands/companyOrders.ts` 的注册保留、标 `@deprecated`（替代：链接命令内联派生），UI 不再调用；下一发布周期随弃用面一并删除（登记于本 spec 的 BC 表）。

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| 链接新增/移除（含报价） | `order_hub.orders.link-child` / `links.replace` | 本模块缓存失效；工作台/hub 查询 | `links.updated` + 派生变化时 `collaborators.updated`（`clientBroadcast`） | 幂等键 = 唯一键；同事务；失败整体回滚 |
| 协作集合重建 | `order_hub sync-collaborators` CLI | 无（直接写表 + 显式失效缓存） | 与请求路径同一失效函数 | 幂等（重跑零差异） |

不进 worker/通知；不新增定时任务；模块合并不新增事件 id。

## Security, Privacy, and Compliance

- **Authorization:** 页面/路由功能位不变（`order_hub.view/manage`；报价页面沿用 `sales.*`）；协作写白名单不变；不使用角色名判断。
- **Tenant isolation:** 派生读与链接写都在同一可信 scope（`tenant_id` + 组织集）；跨组织引用 → 422（不泄露存在性）；CLI 显式 scope 且默认 dry-run。
- **Sensitive data:** 只经 `findWithDecryption` 读 `customer_snapshot` 的 `internalSales.organizationId`（不写日志、不落明文）；不新增加密映射、不新增 PII 面。
- **Abuse and failure modes:** `sync-collaborators` 破坏性写入需 `--apply`（默认 dry-run）；幂等键兜底重放；缓存失效在提交后；日志 `createLogger('order_hub')` 且不含密文。

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | integration | 两组织（HQ/Branch）+ 各用户；HQ 根单 | 关联对内销售单 → 立即以 Branch 读根单/列表；写 status 200、写 title 422；解链 → Branch 再读为空 | 协作行由链接产生与撤销；白名单与 scope 不变 | REQ-001, REQ-002, REQ-003 |
| TEST-002 | integration | 同一组织两张对内单 + 一张对外单 + 第三方根单 | 链接两张 → 解链一张 → 再解另一张；把一张子单从根 A 移到根 B | 组织只在最后一张解链后失去可见性；对外单不派生；移动后 A 失去、B 获得 | REQ-002 |
| TEST-003 | integration | 3 张根单（1 张有手工行、1 张有对内单、1 张无关）+ backfill 场景（渠道内销售单尚未建根） | `sync-collaborators` dry-run → `--apply` → 重跑；再 `--prune`；随后 `backfill-company-orders --apply` | dry-run 零写入且列出将删行；apply 幂等；prune 只删无来源行；backfill 新建的根自带派生协作 | REQ-002, REQ-004 |
| TEST-004 | integration | 根单 + 报价（含无通道历史报价桶） | 挂对内/对外报价（link-child 与 links.replace）；重复挂载；跨组织报价 | 链接行 + 快照；幂等；422 跨组织 | REQ-005, REQ-006 |
| TEST-005 | integration | 报价 → 转换 | 报价转订单（app 行操作路径的 API 等价：convert + metadata 写 + link-child） | 新订单 metadata 含 sourceQuote；已挂根时新订单在同根；hub 读侧能推出「已转为订单」 | REQ-009 |
| TEST-006 | integration | 模块合并后的运行面 | `GET /api/internal_sales/trade-type-channels/{orders,quotes}`；`/backend/quotes`、`/backend/internal-sales/quotes/create`、`/backend/external-sales/orders/create` 渲染 | 旧 URL 全 200；页面标题/功能位不变 | REQ-010, REQ-012 |
| TEST-007 | UI（浏览器） | dev 数据 | hub 报价区块（新建/关联/移除/已转订单行）；协作只读弹窗；报价列表「挂到公司订单」；从根单建报价的预填与回落；侧边栏无「出口销售」组 | 明暗两态、窄屏、Esc/键盘；409 冲突条 | REQ-006, REQ-007, REQ-008, REQ-012 |
| TEST-008 | unit | 纯函数夹具 | 派生集合计算（多单据/同组织/无链接/外部买方）、kind 映射、CLI 参数解析 | 边界与幂等 | REQ-001, REQ-002, REQ-011 |

## Implementation Phases

### Phase 1 — 协作组织由对内单据派生

- **Depends on:** none
- **Outcome:** 建/关联一张对内销售单后分公司立即可见（工作台徽标 + hub 只读 + 状态/备注可写）；解链即撤销；hub 协作对话框只读并显示来源；`sync-collaborators` 可重建历史。
- **Why this order / value delivered:** 消掉 owner 反馈的直接痛点（同一关系录两处），且不依赖报价/合并（可独立上线）。
- **Deliverables:** `lib/collaborators.ts`（`syncDerivedCollaborators` + 来源组装）、`commands/companyOrders.ts`（link-child / links.replace / 建单 `links[]` 内联派生；移动语义对 A/B 双根重算；`collaborators.replace` 标弃用保留）、`api/orders/collaborators/route.ts`（GET 扩展来源字段、POST 标 `deprecated: true`）、`components/CompanyOrderCollaboratorsDialog.tsx`（只读 + 来源）、`cli.ts`（`internal_sales sync-collaborators`，含 `--apply/--prune/--tenant/--organization`）、`cli.ts` 的 `backfill-company-orders` 同步派生、缓存失效（`invalidateCompanyOrderCollaboratorCaches`，含 movedFrom）、i18n、单测/集成改写（`company-order-collaborators.spec.ts` 改为经链接产生协作）。
- **Independent slices / estimated commits:** ①派生库 + 命令内联（含移动/建单） + 单测；②CLI + dry-run 报告 + backfill 派生；③hub 只读弹窗 + i18n；④集成测试改写（含移动与 backfill 两条用例）。
- **Requirements closed:** REQ-001, REQ-002, REQ-003, REQ-004
- **Tests:** TEST-001, TEST-002, TEST-003, TEST-008
- **Validation:** `yarn generate`、`yarn typecheck && yarn lint && yarn ds:check`、`npx jest src/modules/order_hub`、`yarn test:integration:ephemeral company-order-collaborators`（+新 sync spec）
- **Exit gate:** 关联对内单 → 分公司读得到、写 status 200、写 title 422；解链后读不到；移动 A→B 后 A 失去、B 获得；backfill 新建的根也派生协作；`sync-collaborators` dry-run/apply/重跑/prune 行为如 TEST-003；hub 无任何手工写协作入口（POST 仅存于弃用面）。

### Phase 2 — 报价挂根单（区块 / 列表 / 预填 / 转换留痕）

- **Depends on:** Phase 1（预填用协作组织集合）
- **Outcome:** 报价可从根单发起、可挂到根单、转换后可在根单上追溯；hub 报价区块可用。
- **Deliverables:** `data/validators.ts`（两个 kind + `kind` 列表参数）、`lib/companyOrder.ts`（引用解析按 kind 分流读 `SalesQuote`/`SalesOrder`；报价 kind 无目标 → 422）、`components/OrderDetail.tsx`（`AttachBlock` 支持 kind 组 + 报价区块；`ExistingCompanyOrderPicker` 抽成共享组件）、`components/CompanyOrderLinkDialog.tsx`（报价选项源：两类通道 + 未标记桶 + 快照推导类型）、`internal_sales/components/InternalSalesTable.tsx`（挂根行操作 + 转换留痕含 metadata 读-合并-写）、`InternalSalesForm.tsx`（对内预填三态 + 报价页参数）、报价 create 页（`page.tsx`/`page.meta.ts` 参数）、i18n、单测/集成。
- **Independent slices / estimated commits:** ①kind 词汇 + links GET 列表参数 + 引用解析分流 + 单测；②hub 区块 + 对话框（含根单选择器抽取）；③列表行操作 + 转换留痕（metadata 合并）；④预填三态与回落链路 + 集成。
- **Requirements closed:** REQ-005, REQ-006, REQ-007, REQ-008, REQ-009
- **Tests:** TEST-004, TEST-005, TEST-007（报价部分）, TEST-008
- **Validation:** `yarn generate`、`yarn typecheck && yarn lint && yarn ds:check`、`npx jest src/modules/order_hub src/modules/internal_sales`、`yarn test:integration:ephemeral company-order-links`、浏览器实测
- **Exit gate:** hub 报价区块可关联/新建/移除（含未标记报价按快照归行、两者皆无者不入选）；报价 create 带根单时预填三态正确且保存后自动回落；转换后 hub 行显示去向且新订单其它 metadata 键保留；重复挂载幂等；跨组织 422；窄屏/暗色通过。

### Phase 3 — 模块合并与导航收敛

- **Depends on:** Phase 1–2 的退出闸门（合并是对已稳定代码的搬家）
- **Outcome:** `internal_sales` 的产品代码全部在 `order_hub`（弃用壳仅剩 `index.ts` + `cli.ts`）；页面/API URL 不变；侧边栏「出口销售」组消失；CLI 新旧名并存一版。
- **Deliverables:** 目录搬迁（`backend/**`、`components/**`、`lib/**`、`i18n/**`、`__integration__/**`、`setup.ts`/`cli.ts`/`index.ts` 合并）、路由 `metadata.path` 钉 URL、`src/modules.ts` 条目降级为弃用壳（`index.ts` + `cli.ts` re-export `backfill-trade-type`，`@deprecated`）、跨模块 import 更新、`NAV_TREE` 与 nav i18n、README 合并、文档更新（business-architecture/architecture/multi-company-org-model/currency-policy/navigation/parallel-development）、CLI 用户可见文案换新名（`internal_sales/i18n/{zh,en}.json`、`InternalSalesTable.tsx` 硬编码 fallback、README/升级步骤）、测试迁移。
- **Independent slices / estimated commits:** ①目录搬迁 + import 更新 + 路由钉 URL + `yarn generate` 断言；②CLI 合并（新名 + 弃用壳 + 文案）；③导航 + i18n + 测试。
- **Requirements closed:** REQ-010, REQ-011, REQ-012, REQ-013
- **Tests:** TEST-006, TEST-007（导航部分）
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build`；`yarn db:generate`（no changes）；集成套件全量（含迁移后的 spec 路径）
- **Exit gate:** 旧 API/页面 URL 全绿；`yarn mercato order_hub backfill-trade-type`/`sync-collaborators` 可跑且旧名 `internal_sales backfill-trade-type` 仍可跑（弃用壳 + 弃用提示）；侧边栏无「出口销售」组且 quotes 页可达；`yarn db:generate` 零对话。

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001 | `link-child`/`links.replace` → `collaborators` 表 | Phase 1 | TEST-001, TEST-008 | AC-001 |
| REQ-002 | J-001, J-005 | 同上（撤销/重建） | Phase 1 | TEST-002, TEST-003 | AC-002 |
| REQ-003 | J-004 | `GET /orders/collaborators`、scope 读 | Phase 1 | TEST-001 | AC-003 |
| REQ-004 | J-005 | 弃用 `collaborators.replace`（保留一版）；`sync-collaborators --prune` | Phase 1 | TEST-003 | AC-004 |
| REQ-005 | J-002 | `COMPANY_ORDER_LINK_KINDS` + `kind` 列表参数 | Phase 2 | TEST-004 | AC-005 |
| REQ-006 | J-002 | hub 报价区块 + `links` API | Phase 2 | TEST-004, TEST-007 | AC-006 |
| REQ-007 | J-002 | 报价 create 页 `?companyOrderId=` | Phase 2 | TEST-007 | AC-007 |
| REQ-008 | J-002 | 报价列表行操作 | Phase 2 | TEST-007 | AC-008 |
| REQ-009 | J-003 | convert + metadata 写 + link-child | Phase 2 | TEST-005 | AC-009 |
| REQ-010 | 模块面 | 目录搬迁 + `metadata.path` | Phase 3 | TEST-006 | AC-010 |
| REQ-011 | J-005 | CLI 新增/迁移 + 弃用壳 | Phase 1, Phase 3 | TEST-003, TEST-008 | AC-011 |
| REQ-012 | 侧边栏 | `NAV_TREE` + nav i18n | Phase 3 | TEST-006, TEST-007 | AC-012 |
| REQ-013 | 文档 | README/business-architecture/plan | Phase 1–3 | 文档 diff | AC-013 |

## Extension-Surface Traceability

| Requirement | Surface | Capability ID | 效仿的 `src/modules/example/**` 文件 | Phase | 自带集成测试 | 机制分类 |
|---|---|---|---|---|---|---|
| REQ-010 | `order_hub/api/trade-type-channels/**`（自 `internal_sales` 迁入，`metadata.path` 钉 URL） | `api.custom-route` | `src/modules/example/api/organizations/route.ts` | Phase 3 | TEST-006 | emitted-example |
| REQ-011 | `order_hub/cli.ts` 新增 `sync-collaborators`（并入 `backfill-trade-type`） | `module.cli` | `src/modules/example/cli.ts` | Phase 1, Phase 3 | TEST-003, TEST-008 | emitted-example |
| REQ-001 | `order_hub/commands/companyOrders.ts`（派生写入；弃用一个命令） | `commands.write` | `src/modules/example/commands/todos.ts` | Phase 1 | TEST-001, TEST-002 | emitted-example |
| REQ-005 | `order_hub/data/validators.ts`（kind 词汇扩展 + 参数） | `data.validators` | `src/modules/example/data/validators.ts` | Phase 2 | TEST-004 | emitted-example |
| REQ-003 | `order_hub/api/orders/collaborators/route.ts`（GET 扩展来源、POST 标弃用） | `api.crud-factory` | `src/modules/example/api/customer-priorities/route.ts` | Phase 1 | TEST-001 | emitted-example |
| REQ-006 | hub 报价区块（app 内复用 `RelatedSection`） | `ui.page-shell` | `src/modules/example/backend/page.tsx` | Phase 2 | TEST-007 | framework-only |
| REQ-010 | `internal_sales/setup.ts` 并入 `order_hub/setup.ts`（通道播种） | `module.setup-role-features`（最近行） | `src/modules/example/setup.ts` | Phase 3 | TEST-006 | emitted-example |

## Rollout, Migration, and Rollback

- **无迁移**：`yarn db:generate` 预期零对话（Phase 3 验证点）；不触碰用户数据库。
- **历史数据**：`yarn mercato order_hub sync-collaborators`（默认 dry-run；`--apply` 幂等；`--prune` 清手工行）——在部署后按 owner 批准执行，README 升级步骤收录。
- **模块合并的部署面**：先 `yarn generate`（页面/路由清单重排），再常规构建；运行期无数据变更。
- **回滚**：回退本 PR 即恢复旧实现（无 schema 变化）；`sync-collaborators --prune` 删除的手工行如需恢复，按当时 dry-run 报告手工重建（报告即恢复清单）。
- **观测**：`createLogger('order_hub')` 记录派生失败/CLI 摘要；无新增指标面。

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 派生撤销误删（同组织多张对内单） | 分公司短时失去可见性 | 同组织只删最后一张解链后的行；TEST-002 固定该口径 | 接受 |
| 密文快照读失败/组织缺失 | 预期跳过（无链接来源组织）或整体回滚（解密/DB 错误） | 与链接写同事务（一起失败）；`sync-collaborators` 可重建；日志记录 | 需人工重跑修复 |
| 手工行被 `--prune` 删除 | 某些「先看单」的可见性消失 | dry-run 逐行列出、`--apply` 才写；owner 批准 | 接受（owner 已选「单据为准」） |
| 62 个文件搬迁引入引用遗漏 | 构建/页面 404 | `yarn generate` + typecheck + 全量测试 + 旧 URL 回归断言（TEST-006）；分 slice 提交 | 低 |
| 与在途 PR #154（`feat/order-hub-layout-preview`，触 hub 组件）冲突 | 合并期 rebase 冲突 | 本单元从 `origin/dev` 起；实现前 rebase 到最新 `dev`；冲突时保留双方语义（见 parallel-development 共享文件规则） | 中（时序风险，非语义风险） |
| 报价被引擎硬删后的链接悬空 | 行无法打开 | 行渲染冻结值 + 去向；不给「打开」；REQ-006 明确口径 | 接受 |
| CLI 改名 | 旧脚本/记忆断裂 | 旧名经弃用壳保留一版（BC §13 协议）；用户可见文案全量换新名；spec 登记移除版本 | 低（旧名在下一周期移除时仍有文档提示） |

## Acceptance Criteria

- [ ] **AC-001** — 在 hub 关联或新建一张对内销售单后，同一事务内协作行出现：分公司账号工作台可见该根单（协作徽标）、hub 只读打开、写 `status` 200 / 写 `title` 422；`GET /orders/collaborators?companyOrderId=` 带 `sourceKind`/`sourceNumber`。*证据：TEST-001、TEST-007。*
- [ ] **AC-002** — 同一组织有两张对内单时，解链一张不撤销可见性；解链最后一张后分公司读不到（列表为空、hub 404/不可见）；对外单据（party 买方）从不派生。*证据：TEST-002。*
- [ ] **AC-003** — 协作读面语义与今一致（白名单 422/403 文案与代码路径不变）；无新增功能位。*证据：TEST-001（改写后的 `company-order-collaborators.spec.ts`）。*
- [ ] **AC-004** — hub 不再有任何手工添加/保存协作组织的入口（`POST /orders/collaborators` 仅以弃用面保留一版：`deprecated: true` + JSDoc）；`sync-collaborators` dry-run 零写入、`--apply` 幂等（重跑零差异）、`--prune` 只删无来源行并逐条报告。*证据：TEST-003。*
- [ ] **AC-005** — `links` GET 接受 `kind` 逗号列表、非法值 400；link-child / links.replace 接受两个报价 kind；重复挂载幂等；跨组织 422。*证据：TEST-004。*
- [ ] **AC-006** — hub「报价单」区块列出两类报价（含未标记通道的历史报价），可关联/新建/移除；报价已转订单的行显示「已转为订单 ORDER-…」且无「打开」；区块失败隔离（其余区块不受影响）。*证据：TEST-004、TEST-007。*
- [ ] **AC-007** — 带 `?companyOrderId=` 的报价 create：对外预填默认客户；对内买方三态正确（0 个协作组织 → 全量关联组织、1 个 → 预填、≥2 个 → 只列协作组织）；保存成功后自动关联并回落 hub `#quotes`；关联失败不阻断且提示可见。*证据：TEST-007。*
- [ ] **AC-008** — `/backend/quotes` 行操作「挂到公司订单」可用（含「新建公司订单并关联」），成功后 hub 出现该行。*证据：TEST-007。*
- [ ] **AC-009** — 报价「转为订单」成功后新订单 metadata 含 `internalSales.sourceQuote` 且**其它 metadata 键保留**（读-合并-写）；报价已挂根时新订单在同根；追加写失败仅 warning。*证据：TEST-005。*
- [ ] **AC-010** — 合并后 `GET /api/internal_sales/trade-type-channels/{orders,quotes}` 仍 200；页面 URL（`/backend/quotes`、四个 create/edit 页）不变；`yarn db:generate` 零对话；产品代码全在 `order_hub`，`src/modules.ts` 的 `internal_sales` 条目仅剩弃用壳。*证据：TEST-006。*
- [ ] **AC-011** — `yarn mercato order_hub backfill-trade-type`（dry-run/`--apply`/重跑）与原命令行为逐字一致；旧名 `yarn mercato internal_sales backfill-trade-type` 仍可跑（弃用壳）；`sync-collaborators` 在 `--tenant/--organization` 下可限定 scope。*证据：TEST-003、TEST-008。*
- [ ] **AC-012** — 侧边栏「公司订单」域下不再有「出口销售」组，销售报价单为域内直接页面；`navTree.coverage.test.ts` 绿。*证据：TEST-006、TEST-007。*
- [ ] **AC-013** — 文档同步：`order_hub/README.md`（含并模块后的销售单据章节）、`docs/dev/business-architecture.md`（字段归位口径）、`docs/dev/architecture.md`、`docs/dev/multi-company-org-model.md`、`docs/dev/currency-policy.md`、`docs/dev/navigation.md`、进度表/状态板、本 spec 状态与 Changelog。*证据：本 PR 文档 diff。*
- [ ] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light-mode, and dark-mode states.
- [ ] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | `AGENTS.md` 三轴路由（`module-data` + `backend-ui`，SDLC `spec-first`）；`om-spec-writing`（OMH-005）+ `.ai/guides/spec-delivery.md`；`.ai/guides/contracts.md`；`.ai/guides/backend-ui.md`；`.ai/guides/upstream/BACKWARD_COMPATIBILITY.md` |
| Data models, APIs, events, UI, and tests are internally consistent | pass | 无新表/迁移；kind 词汇追加；每 REQ 有 TEST/AC/Phase |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001…J-005 分别落在 Phase 1–3 退出闸门 |
| Platform-native reuse and extension points were chosen before custom code | pass | Reuse 表：引擎、`RelatedSection`、`CompanyOrderLinkDialog`、`companyOrderResolve` 两入口、既有 CLI 模式 |
| UI contracts identify references, canonical components, and theme/state coverage | pass | 上表逐面给出最近参考、组件、状态（含明暗/窄屏/键盘） |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phase 1–3 各节 |
| Verdict | **Blocked — owner implementation approval pending**（三条 owner 口径已记录于 Resolved decisions；其余矩阵全过。收到确认后把 Status 改为 `Ready for implementation` 并开始 Phase 1） |

## Open Questions

无阻塞问题（owner 2026-10-09 已答复三条，见下）。

## Resolved decisions

| ID | Question | Decision | Rationale / 影响 |
|---|---|---|---|
| R-001 | 报价单与公司订单的关联口径 | **按需关联**（hub 区块 + 列表行操作 + 新建预填；不自动建根） | 不新增阶段词、不扩金额聚合；报价可独立存在 |
| R-002 | 「对内销售单」与「协作组织」的统一程度 | **单据为准、协作自动**：派生写入、解链撤销、手工对话框退成只读 | owner 原话「协作组织可以用成对内销售的功能」的最简落法 |
| R-003 | 两个模块合并到哪一层 | **并代码模块 + 收敛导航**：`internal_sales` 并入 `order_hub`；页面/API URL 不变；CLI 迁移 | 消除跨模块 import 与一个只含单页的导航组 |

## Migration & Backward Compatibility

| Surface | 分类 | 处理 | 证据 / 说明 |
|---|---|---|---|
| 页面 URL（`/backend/quotes`、`/backend/{internal,external}-sales/**`） | 稳定 | **不变**（`backend/` 下路径逐字保留） | 页面 URL 由模块内目录决定，与模块 id 无关 |
| `GET /api/internal_sales/trade-type-channels/{quotes,orders}` | 稳定 | **不变**（迁入路由声明 `metadata.path` 钉住旧路径） | 生成器读取 `metadata?.path ?? '<模块 id>/<路径>'`；core `payment_gateways/api/*/route.ts` 同法 |
| 模块 id `internal_sales` | app 自有 | **降级为弃用壳**（目录仅留 `index.ts` + `cli.ts`，一个发布周期后整体移除） | 持久引用排查：仅 `src/modules.ts` 与模块目录（grep 证据）；`finance` 的 `internal_sales` 是应收 kind 枚举值、无关 |
| CLI `internal_sales backfill-trade-type` | STABLE（BC §13） | **保留（弃用桥）**：旧名继续可用（壳模块 re-export 实现）；新名 `order_hub backfill-trade-type` 同批上线；`@deprecated` 注明替代与移除版本 | BC 弃用协议要求先弃用后移除；本仓无 `UPGRADE_NOTES.md`，按既有先例（如 taxonomy 合并、`marks` 列删除）以本 spec 的 BC 节 + 模块 README/升级步骤作为等价记录 |
| `POST /api/order_hub/orders/collaborators` + 命令 | STABLE（BC §7） | **弃用保留一版**：`openApi.deprecated: true` + JSDoc `@deprecated`（替代：经对内单据派生），UI 停止调用；下一发布周期移除 | GET 保留（只读面板）；`sync-collaborators` 覆盖手工维护的运维需求 |
| `GET /api/order_hub/orders/links` 的 `kind` 参数 | STABLE | 追加逗号列表支持（additive） | 单值行为逐字不变 |
| `COMPANY_ORDER_LINK_KINDS` | STABLE（构造 `validators.ts` 注释已声明 additive） | 追加两个报价 kind | 既有三类值不变 |
| 事件 `order_hub.company_order.*` | FROZEN | **不变**（id/载荷不变；`collaborators.updated` 仅在派生实际变化时发出） | — |
| ACL `order_hub.view/manage`、报价页 `sales.*` | FROZEN | **不变** | — |
| i18n 键 `internal_sales.*` | 非契约 | 保持（文件随模块迁移） | 改键为零收益 churn |
| 迁移/DB schema | ADDITIVE-ONLY | **无变更** | `yarn db:generate` 零对话作为验证 |

## Changelog

| Date | Change |
|---|---|
| 2026-10-09 | Initial draft — owner 三条决定落地：协作=对内销售派生、报价按需挂根单、`internal_sales` 并入 `order_hub`；三阶段（派生/报价/合并）。 |
| 2026-10-09 | Fresh-eyes review 修复轮：派生写入补 CLI（`backfill-company-orders`）与移动语义（A/B 双根 + 缓存失效）；报价 kind 的引用解析按 `SalesQuote`/`SalesOrder` 分流且**无目标 422**（不自动建根）；对内买方预填改「三态」；转换留痕改为 metadata **读-合并-写**；未标记报价按快照归行（`channelIdsEmpty` 桶）；派生的预期跳过 vs 基础设施回滚定稿；CLI 与 `POST /orders/collaborators` 改按 BC 弃用协议保留一版（弃用壳 / `deprecated: true`）并补上用户可见命令文案的替换清单；文档清单补 `architecture/multi-company-org-model/currency-policy`。 |
