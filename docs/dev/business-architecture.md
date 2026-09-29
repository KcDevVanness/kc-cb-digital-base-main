# 业务架构：外贸 + 跨境电商

## 适用范围

本文件沉淀**公司实际业务**与**系统落地**的对应关系：业务链路、模块归属、数据主源约定、
已定决策与依据。新增任何业务流程前先读这里，再决定"复用 / 自建 / 待启用"。

不适用于：组织与权限的后台配置步骤（→ [`multi-company-org-model.md`](./multi-company-org-model.md)）、
具体实现契约（→ `.ai/specs/` 下的 spec）、**产品需求与实施计划（→ [`../prd/cross-border-erp.md`](../prd/cross-border-erp.md)、[`../plans/cross-border-erp.md`](../plans/cross-border-erp.md)）**、
环境与上线（→ `../deploy/`）。

## 业务全景

**组织**：广州总部是外贸主体（采购 + 出口），海外分公司（俄罗斯，未来东南亚）做跨境电商运营。

**链路**：国内代理商采购 → 供应商**直发**（国内不设仓、不拼柜、无退货回国）→ 出口/在途 →
海外仓收货 → 平台订单履约 → 平台结算；退换货由海外仓就地处理。

```text
① 采购      代理商 ──采购订单──→ 供应商直发 ──→ 在途 ──→ 海外仓收货
                                                      └─→ 采购应付（定金 / 尾款）

② 出口      内部销售订单(对分公司) ──→ 拣货装箱 ──→ 报关/出口单证 ──→ 发运(在途)

③ 履约      平台订单 ──→ 拣货打包 ──→ 发货(面单/轨迹) ──→ 平台结算(回款/佣金/费用)

④ 反向      退货入库 / 换货 / 残次（由海外仓处理）

⑤ 结算线    采购应付 · 内部结算价 · 平台回款与费用 · 汇率(FX)
```

采购单与发运单是**多对多**：一张采购单可拆多次发运，多张小额采购单可合并拼柜发运。

## 模块归属地图

| 能力 | 归属 | 依据 |
|---|---|---|
| 商品主数据 | **自建** `products` | 业务口径变更（2026-09-22）：官方 `catalog` 后续会有大量定制点，业务要自管产品 UI 与流程 → 商品、产品线（原「产品类型」）、产品品类树（原「产品类别」）、三档价格全部自有表；官方 `catalog` 保留为平台级商品注册表，经 `products_products.catalog_product_id` 可选链接。详见 [`.ai/specs/2026-09-22-products-and-trade-docs.md`](../../.ai/specs/2026-09-22-products-and-trade-docs.md) 与 [`.ai/specs/2026-09-23-product-taxonomy-consolidation.md`](../../.ai/specs/2026-09-23-product-taxonomy-consolidation.md)（术语定名：产品线＝平铺标签，产品品类＝唯一层级）。**变体（SKU）维度已迁入 `products`**（2026-09-22 决策，Phases 1–2 已实现并验证：`products_variants` 表 + 商品表单步骤 4「变体/SKU」+ `/api/products/variants/options`；发运与海外仓收货的切换仍延后到 wms 轮 → spec：[`.ai/specs/2026-09-22-product-variants.md`](../../.ai/specs/2026-09-22-product-variants.md)）。**自产/委托加工商品也进这一套**（2026-09-23 决策：「当普通商品建库」，见下方决策表），不另建商品库或生产链路 |
| **商品编码规则**（编码规则 / 发号台账 / 旧码映射 / 正反解析） | **自建** `product_codes` | 平台没有"编码规则"实体：品牌与类别码表放官方 `dictionaries`（业务人员在字典库维护，值一旦发号即冻结、只可改显示名），规则、append-only 发号台账（唯一索引兜底重试、号永不回收）与三态解析在自建模块。供应商产品库的「商品 SKU」由它发号，旧码只登记别名、永不重编。详见 [`.ai/specs/2026-09-24-supplier-product-code-rules.md`](../../.ai/specs/2026-09-24-supplier-product-code-rules.md) |
| **供应商报价单 + Excel 报价导入** | **自建** `sourcing` | 平台没有供应商报价/价目表实体：`products_prices` 唯一键是 `(product, tier, currency, minQuantity)`，没有 `supplier_id`/报价日期/来源文件，而采购单行价是谈判值、不承担报价历史（Q-P-004） → 报价历史与"任意版式 Excel → 商品库"由自有模块承载（产品库自 2026-09-23 起另有「当前价」清单，但它不是历史），提升时调用 `products` 命令。详见 [`.ai/specs/2026-09-22-supplier-quotation-import.md`](../../.ai/specs/2026-09-22-supplier-quotation-import.md) |
| **供应商产品库**（每个供应商的货品清单：货号/中英品名/申报要素/单位/装箱数/单件毛重 G.W.+单件净重 N.W.+单件体积（cm³）（2026-09-24 起，三项都可留空）/产品尺寸/MOQ/HS/图片，价格按「价格类型 × 币种 × 起订量」维护（表单只录一条**供货价**：币种 + 单价 + 折扣，2026-09-24 起）；可同步为商品，毛重/净重/体积都会写到商品主数据的 `gross_weight`/`net_weight`/`volume`。**2026-09-23 业主口径：采购只维护单件数据，整箱毛重/净重与外箱尺寸已从产品库与商品主数据一并移除**） | **自建** `purchasing`（2026-09-23 从 `sourcing` 整体移交：实体/命令/API/页面都在本模块） | 平台没有“供应商侧货品”实体：报价行是**文档级**的（只能经 `sourcing_quotes.supplier_id` 反查），商品主数据 `products_products` 是内部唯一主源（库存/内部销售/合同需要它），两者都不是“这家供应商卖这些货”的清单。页面挂在「采购」菜单组；实体、命令、API 与页面自 2026-09-23 起整体归 `purchasing`（`sourcing` 的报价提升经 `purchasing` 的命令喂数据，报价行只经只读投影读取）。详见 [`.ai/specs/2026-09-22-supplier-product-library.md`](../../.ai/specs/2026-09-22-supplier-product-library.md) |
| **购销合同与发票**（采购/销售合同、进项/销项发票、双口径金额） | **自建** `trade_docs` | 平台没有购销合同单据；合同两方向（采购/销售）、发票挂合同、财务金额与合同金额两个口径与差额自管 |
| **出口收汇与出口退税档案**（是否已收款、涉外收入证明、退税状态/金额/备注、报告草单、退税资料整理，以及订单档案/柜档案两种只读输出） | **自建** `export_finance` | 平台没有收汇与出口退税实体。**两个锚点**：收汇按**采购单**（`export_finance_collections`，唯一键 `(tenant, org, purchase_order_id)`），退税按**柜/发运单**（`export_finance_refunds`，唯一键 `(tenant, org, shipment_id)`）——退税以柜为申报单位，拼柜时按各订单采购金额占比把税额**反向分摊**回订单（读时派生，不落库）。柜与订单的关系只走 `cross_border_shipment_allocations`，不新增关联表；聚合层以只读 Kysely 跨表读取 `purchasing`/`cross_border`/`trade_docs`。详见 [`.ai/specs/2026-09-22-order-file-and-export-finance.md`](../../.ai/specs/2026-09-22-order-file-and-export-finance.md) |
| **柜级费用与到岸成本**（海运/空运/报关/保险/关税…每笔柜费用的金额+币种+汇率+往来方+附件；到岸成本 = 采购价 + 按采购行分摊的柜费用，读时派生不落库）、**库存资金占用**（单位成本取该 SKU 最近一次已收货柜的到岸单价，其次采购价档，都无则单列未计价）、以及**期间费用单**与**应付 / 应收两本只读台账**（应付按供应商×币种分组、状态复用采购模块的推导；应收三类来源统一行形、是否已收只看收款日期；跨币种一律不加总）；（损益为后续阶段） | **自建** `finance`（2026-09-28 立项，Phase 1–2 已实现并验证） | 平台与既有自建模块都没有费用/成本实体：`cross_border_shipments` 零金额列（运费/关税只有两个单证类型枚举）、收货只动数量（`wms` 无成本层）、`export_finance_collections` 只有状态没有金额 → 钱的口径缺一层。与 `export_finance`（收汇/退税档案）分模块的理由：生命周期与权限面不同（成本毛利敏感），页面共用同一个「财务」菜单组 key（`export_finance.nav.group`）。只写自己的两张表，读 peer 表一律 scoped 只读投影。详见 [`.ai/specs/2026-09-28-finance-ledger-and-cockpit-data.md`](../../.ai/specs/2026-09-28-finance-ledger-and-cockpit-data.md) |
| **俄方供应链数据同步**（PETKIT 合同 17 个端点：supply 8 = SKU/库存/在途/未识别在途/计划/供应单/参数/映射表；ads 9 = 总览/订单/站内销售/平台销售/月度汇总/结算/广告类型/价格/成本） | **自建** `ru_sync` | provider 代码归 provider 模块：适配器实现 `DataSyncAdapter`（`providerKey: ru_petkit`），每端点一份 zod schema + 快照投影（`(endpoint, 自然键, as_of)` 幂等 upsert）+ 每端点游标（整轮成功才推进）；订单落 `platform_ops.orders.ingest`、结算落 `settlements.import`，其余只入快照；RU 码→商品映射与未映射派生清单同在此模块。详见 [`.ai/specs/2026-09-28-finance-ledger-and-cockpit-data.md`](../../.ai/specs/2026-09-28-finance-ledger-and-cockpit-data.md) |
| **老板驾驶舱**（只读：供应三数 + 未识别在途 + CN 资金三数 + SKU 覆盖率 + ДРР 双口径 + 周复盘） | **自建** `boss_cockpit` | 平台没有这个聚合面：一页只读、零写表，数据来自 `ru_sync` 快照投影与 `finance` 派生台账；4 个 dashboard widget 与页面读同一个 `GET /api/boss_cockpit/summary`，逐 widget 走 `metadata.features` 门禁；四预警由 `ru_sync` 在对应端点拉取收尾后评估并发 typed event → `notifications`（同条件按 `groupKey` 刷新） |
| 客户 / 分公司档案 | **自建** `parties`（2026-09-22 决策，Phases 1–3 已实现并验证，迁移已应用；Phase 4 待 Q-P-004） | 官方 CRM 的拓客半部（deal/pipeline/calendar/tasks）不适用、档案半部语义不匹配货代/报关行/银行等服务方 → 买方/分公司/服务方统一进 `parties`（`parties_parties` + `parties_roles` + `parties_bank_accounts`）；`customers` 保留启用（`sales requires customers`，对分公司的内部销售单据仍挂它）。spec：[`.ai/specs/2026-09-22-app-owned-party-master.md`](../../.ai/specs/2026-09-22-app-owned-party-master.md) |
| 官方 `catalog` 的后台页面 | **全部隐藏**（模块与 API 保留） | 自建 `products` 才是业务商品主数据 → 官方 `catalog` 的 商品/变体/类别 页面通过 `src/modules.ts` 的 `routes.pages` 覆盖隐藏；`config/catalog`（价格类型 + 欧盟单位价展示开关）自 2026-09-23 起同样 `navHidden`——本部署没有任何自有面读它（价格词表是 `products_prices.price_tier`，`purchasing`/`sourcing` 用自己的 `supplier_cost`/`company_offer`，`catalog_price_kinds` 为空），页面仍可 URL 直达、删一行即恢复；`sales` 单据行仍从 catalog 取商品/价格（切换是后续独立切片） |
| 官方 `dictionaries` 的字典库页面 | **复用** `dictionaries`（引擎）+ **自建页面体**（2026-09-23） | 字典实体、命令、`/api/dictionaries**`、ACL 与「条目」编辑器仍归官方模块；但官方列表不显示字典归属组织，而本部署每个组织各有一份同名词表（`currency`、`supplier_product_unit`…）→ 页面体由 `src/modules/dictionaries/backend/config/dictionaries/page.tsx` 遮蔽包内同名文件，按组织分组、只放开当前组织的写，「所有组织」下整页只读；`page.meta.ts` 转出官方元数据（导航与门禁不变）。见 [`src/modules/dictionaries/README.md`](../../src/modules/dictionaries/README.md) |
| 对分公司的内部销售 | **复用** `sales`（引擎）+ **自建界面** `internal_sales` | 单据编号/状态/金额/发货/发票/收款仍在官方 `sales` 链；新建与编辑走自建页面（选品用自建 `products`、行自动带官方目录变体桥接；买方 = 关联组织 + 外部客户，2026-09-28 见下「已切换的 `customers` 消费方」）；官方「新建单据」页隐藏、列表保留 → [`.ai/specs/2026-09-22-products-and-trade-docs.md`](../../.ai/specs/2026-09-22-products-and-trade-docs.md) Phase 6；报价→订单两条路（2026-09-29）：**就地转换**（`sales.quotes.convert_to_order`，报价消失、1:1）或**引用加载**（订单从报价载入、报价保留、可出多张订单，[`.ai/specs/2026-09-29-internal-sales-order-from-quote.md`](../../.ai/specs/2026-09-29-internal-sales-order-from-quote.md)） | 报价→订单→发货→退货→发票→贷项→收款整链、单据编号序列、多币种、渠道与报价 |
| 多仓库存与仓内作业 | **复用** `wms` | 仓库/库位/批次/余额/预留/**移动台账**/盘点 + 收货/调整/移库/预留/分配命令 |
| 币种与汇率 | **复用** `currencies` | 汇率主数据 + 抓取配置 |
| 组织与多公司 | **复用** `directory` | 组织树 + 后代展开可见性，配置见 [`multi-company-org-model.md`](./multi-company-org-model.md) |
| **采购**（供应商、采购单、定金/尾款） | **自建** `purchasing` | 平台安装清单里没有任何采购/供应商模块（`supplier` 仅出现在 `eudr`、`vendor` 仅在 `warranty_claims`） |
| **跨境发运/在途/出口单证** | **已实现** `cross_border` | 发运单（多采购单合并/拆分的多对多分摊）、在途里程碑（单调）、出口单证（最小结构化字段 + 附件）；收货时调 `wms.inventory.receive` 并回写采购单行已收数量。**2026-09-29（合同为主体的关联）**：发运单 ↔ **购销合同** M:N 关联（`cross_border_shipment_contracts`，冻结合同号/方向快照，`?contractId=` 过滤）；装箱单升级为**带明细行的单据**（`cross_border_export_document_lines`，明细只在 `packing_list` 上，登记/详情/编辑三页）；发运单分摊、装箱单明细都支持「从合同引用商品」（一次性复制、可编辑；分摊侧按本柜已选订单行用商品主数据 id 匹配） |
| **平台订单与结算同步/对账** | **已实现**（核心）`platform_ops` | 渠道、订单镜像（幂等 ingest）、结算单与明细（幂等 import）、对账队列（resolve/ignore，不复活）；**传输层**（`data_sync` 适配器 / 文件 / 第三方）待 Q4 定 |
| 外部集成底座 | **已启用** `integrations` + `data_sync`（2026-09-21，随 `platform_ops` 一起建表） | "external ID mapping / integration registry" 与 "streaming data sync hub"，`platform_ops` 的**传输层**（连接器/文件/第三方，PRD Q4）仍待定 |
| 审批规则 / 长流程 | **按需启用** `business_rules`、`workflows` | 当前采购不审批，暂不启用 |
| 定时任务 | **按需启用** `scheduler` | 拉单、对账等周期性作业 |
| 物流面单与轨迹 | **按需启用** `shipping_carriers` | 货代有实时接口就用实时，否则按里程碑 |
| 多语言商品内容 | **按需启用** `translations` | 多国分公司，先中文 + 英文 |
| Excel 导入导出 | **已由 `sourcing` 承担**（供应商报价导入）；通用 CSV 导入 `sync_excel` 仍**按需启用** | 报价 → 商品库走 `sourcing`（SheetJS 读 `.xls`/`.xlsx`/`.csv`）；`sync_excel` 只有 CSV 解析器、目标实体是安装在 `node_modules` 的封闭枚举，暂不启用 |
| 邮件转任务 | **按需启用** `messages` + `inbox_ops` + 邮件渠道 | 供应商/货代邮件落地为待办 |
| EU 合规（EUDR） | **不启用** | 不卖欧盟，品类不涉及 |

## 自建模块对官方模块的消费清单

自建模块不复制官方能力，只从两处以已实现代码接官方契约：**界面层的 API 调用**、**服务端的实体/命令/工具函数**。
下表每一行都是已实现代码——**改官方模块的启用状态或页面路由前先看这里**。隐藏页面（`routes.pages`）不影响这些接口；停用模块才会。
事件订阅与 response enricher 这两个 seam 目前**没有任何启用的自建模块**在用：`.mercato/generated/enrichers.generated.ts` 里只有
`customers`/`sales`/`wms`/`integrations` 四个官方模块，`subscribers/` 目录只出现在未启用的 `example` 系列。

### 界面层的 API 消费

| 消费方 | 官方接口 | 用途 | 位置 |
|---|---|---|---|
| `trade_docs` | `GET /api/parties/options`（自建） | 合同/发票的买方对方选择器（与 `purchasing/suppliers` 合并成一张列表）——原读 `customers/companies`，2026-09-22 切换 | `trade_docs/components/formOptions.ts:25` |
| `products`、`purchasing`（采购单 + 供应商）、`trade_docs`、`platform_ops`、`internal_sales`、`sourcing`（报价面板）、`export_finance`（收汇/退税） | `GET /api/currency_policy/currencies`（自建） | 币种下拉——2026-09-22 已从 `customers` 托管的字典路由切换过来，不再依赖 `customers` 及其 `customers.people.view` 门禁；数据仍取自官方 `dictionaries` 模块（见 [`.ai/specs/2026-09-22-app-owned-party-master.md`](../../.ai/specs/2026-09-22-app-owned-party-master.md) Phase 3） | 客户端加载器统一在 `currency_policy/lib/clientOptions.ts`（`loadCurrencyOptions` / `useCurrencyOptions` / `withCurrentCurrency`），`sourcing` 经 `components/currencyOptions.ts` 转出；各模块早先自带的 `CURRENCY_DICTIONARY_URL` 常量仍在使用，尚未收敛 |
| `products` | `GET /api/catalog/products` | 商品表单的「官方目录链接」字段（变体解析桥） | `products/components/ProductForm.tsx:561` |
| `cross_border` | `GET /api/wms/warehouses`、`GET /api/wms/locations` | 发运单的仓库/库位选择器 | `cross_border/components/ShipmentForm.tsx:49-50` |
| `products`（分发对话框）、`internal_sales`（买方选择器） | `GET /api/directory/organization-switcher`（官方） | 组织选项：分发目标 = 调用者可写组织 − 当前组织；内部买方 = `selectable` 节点 − 当前组织。共享装配在 `src/lib/orgs/organizationOptions.ts`（与顶栏切换器同一份 payload，因此可见性规则天然一致） | `products/components/DistributeProductsDialog.tsx`、`internal_sales/components/InternalSalesForm.tsx` |

币种链路现在只有**一跳**到官方数据：路由在自建 `currency_policy`（门禁 `currencies.view`），数据取自 `dictionaries` 模块的
`dictionaries`/`dictionary_entries` 表。切换前的旧路由 `customers/api/dictionaries/currency/route.ts` 仍在官方包里、无人调用。

**汇率与 CNY 换算（2026-09-24）**：同一模块还拥有汇率供给与全站金额的人民币换算——抓取用 app 自有的
`OPEN_ER_API` provider（CNY 基准，覆盖全部 15 个外币；安装层自带的两个波兰 provider 在本部署产不出 `USD→CNY`），
显示走 `GET /api/currency_policy/rates`（只读库内已存汇率，无汇率即不显示）+ `src/lib/money/MoneyAmount`；
金额格式统一用框架的 `formatCurrency`。规格与分期见
[`.ai/specs/2026-09-24-cny-equivalent-amounts.md`](../../.ai/specs/2026-09-24-cny-equivalent-amounts.md)。

**已切换的 `customers` 消费方**：`internal_sales` 内部销售表单的买方选择器（2026-09-28）不再读
`customers/companies`——买方改为**关联组织**（顶栏组织切换器 payload：可见组织集 − 当前组织，分公司账号因此没有
内部选项）**加外部客户**（自建 `parties`，角色 `buyer`/`branch`，由该路由新增的可选 `?roles=` 过滤）的合并选择器；
选中即回填买方名称，链接冻结在单据快照 `customerSnapshot.internalSales.{organizationId|partyId}`（不占
`customerEntityId`——那是 `customer_entities.id`）。决定与证据：
[`.ai/specs/2026-09-28-internal-sales-buyer-linkage.md`](../../.ai/specs/2026-09-28-internal-sales-buyer-linkage.md)。

**尚未切换的 `customers` 消费方**（各自 spec 负责，不由 `parties` spec 单方面改语义）：

| 消费方 | 位置 | 说明 |
|---|---|---|
| `purchasing` 采购单的「客户」选择器 | `purchasing/components/orderFormOptions.ts:21` | `.ai/specs/2026-09-22-order-file-and-export-finance.md` 给采购单加了 `customer_id`，其对方仍取自 `customers/companies`；该 spec 决定何时切 `parties` |

### 服务端契约消费（实体 / 命令 / 工具函数）

| 消费方 | 官方契约 | 形式 | 位置 |
|---|---|---|---|
| `cross_border` | `wms.inventory.receive` | 命令（`dispatchPeerCommand`）：收货入账并回写采购单行已收数量 | `cross_border/commands/shipments.ts:586` |
| `products` | `directory:organization` | 直接 import 实体：分发命令在写入前校验目标组织存在且属于本租户（无 ACL 组织集的调用者路径） | `products/commands/distribution.ts:8` |
| `currency_policy` | `currencies:currency`、`dictionaries:dictionary*`、`directory:organization` | 直接 import 实体，对账 FX 主数据与币种字典 | `currency_policy/lib/apply.ts:2-3`、`cli.ts:4` |
| `products`、`purchasing`、`sourcing` | `dictionaries:dictionary*` + `normalizeDictionaryValue` | 服务端校验币种码必须存在于字典 | 各模块 `lib/currencyDictionary.ts` |
| `scope_guards` | `auth:user/role/acl` 实体 + `RbacService`、`directory` scope 工具 | 拦截越权写入 | `scope_guards/lib/scopeGuard.ts:3-5` |
| `sourcing`、`trade_docs` | `attachments`（`AttachmentService`、`Attachment`/`AttachmentPartition`、`StorageDriverFactory`、`createAttachmentFromBuffer`） | 报价源文件与合同/发票单证的附件读写 | `sourcing/commands/quotes.ts:8`、`trade_docs/commands/contracts.ts:17`、`trade_docs/api/contracts/[id]/document/route.ts:8-9` |
| `sourcing`、`trade_docs`、`platform_ops` | `directory` 的 `resolveOrganizationScopeForRequest` | 请求期组织作用域解析 | 各模块 api 路由 |
| `sourcing`、`trade_docs` | `staff/lib/timesheets-reports/xlsx`（`buildXlsx`） | 生成 Excel 模板 / 合同打印件 | `sourcing/api/template/route.ts:2`、`trade_docs/lib/contractTemplate.ts:1` |
| `trade_docs` | `dashboards/lib/exactDecimal` | 金额精确计算（BigInt） | `trade_docs/lib/money.ts:7` |

**隐性耦合**：`staff` 模块**未启用**，但 `sourcing`/`trade_docs` 直接 import 它的 xlsx 工具函数。这是 lib 级 import
（不是模块注册），当前能编译能跑；`staff` 一旦卸载或升级改名就会断——接受现状，或把 xlsx 生成收进自建模块。

### 反向依赖与方向性约束

官方 7 个 ERP 模块不认识任何自建模块，耦合方向永远是「自建 → 官方」。唯一的反向约束是官方的 `requires` 闭包：
`sales requires catalog, customers, dictionaries`；`wms requires catalog, sales, feature_toggles`。
因此**「页面不用」≠「模块能停用」**：`customers` 被 `sales` 依赖、`catalog` 被 `sales`/`wms` 依赖，且上面两处界面消费直接打在它们身上。

## 数据主源与同步约定

| 数据 | 真源 | 本系统的角色 | 冲突处理 |
|---|---|---|---|
| 平台库存 / 上下架 | **平台** | 只拉取镜像，默认不回写 | 镜像与账面差异进对账，不静默覆盖 |
| 海外仓（3PL）库存与出入库 | **本系统 `wms` 账** | 3PL API 仅作同步输入 | 差异进对账队列，账面为准 |
| 商品主数据 | 本系统 `products`（自建） | 唯一来源；**外购、自产、委托加工共用同一套主数据与三档价格**（货源只影响品牌/型号/成本价的填法）；官方 `catalog` 作为平台级商品注册表，经 `catalog_product_id` 可选链接 | — |
| 供应商报价 | 本系统 `sourcing`（自建） | 唯一来源；报价行保留原始 Excel 行与来源文件，提升后写入 `products` + `purchase` 档价格 | 同组织内乐观锁 409；已提升的行重复提升只计 `skipped`，不重复建商品 |
| 供应商货品库（每家供应商卖什么） | 本系统 `purchasing.purchasing_supplier_products`（自建） | 唯一来源；当前价格在同模块 `purchasing_supplier_product_prices`（`price_kind × 币种 × 起订量`；**表单只录一条供货价**，2026-09-24 起按该货号在售的基准 `supplier_cost` 行编辑，其余行只读保留，见 spec D11/REQ-SPL-025），报价单仍是谈判文档、采购单行价仍是谈判值（`purchasing` Q-P-004 不被自动带价取代）；`product_id` 由「同步为商品」回填，商品侧没有反向列 | 同一供应商内货号唯一（**含软删行**，货号永久占用）；重复导入只写非空且变化的值，第二次计 `skipped`；已下采购单的行保留自己的 `product_snapshot` |
| 采购与付款 | 本系统 `purchasing` | 唯一来源 | 并发编辑 409，不静默覆盖 |
| 收汇（是否已收款）与出口退税（状态/金额/备注） | 本系统 `export_finance`（自建） | 唯一来源；柜级退税金额分摊到订单的**分摊额是读时派生**（按采购金额占比、余差落占比最大者），不落库 | 保存按锚点 upsert（订单级/柜级各一行），乐观锁不一致 409；对已取消的发运单拒绝建退税档案 |
| 订单档案（35 字段业务/财务两种输出） | **派生视图**，无自有表 | 只读聚合 `purchasing` + `cross_border` + `trade_docs` + `export_finance`（`/api/export_finance/order-files`、`/api/export_finance/container-files`，均支持 CSV） | — |
| 内部销售单据 | 本系统 `sales` | 唯一来源 | 同上 |

## 已定决策与依据

| 决策 | 结论 | 依据 |
|---|---|---|
| 交易对手方主数据（买方/分公司/服务方） | **自建** `parties`（2026-09-22）：新主体走自有模块；`customers` 保留启用但不再作为新建业务的对方来源；**开发阶段数据可清空重来，不做数据迁移**，测试数据按新流程重新写入 | 官方 CRM 的拓客半部（deal/pipeline/calendar/tasks）不适用，档案半部（company/address/billing）语义不匹配货代/报关行/银行；`sales requires customers` 使其无法停用。spec → [`.ai/specs/2026-09-22-app-owned-party-master.md`](../../.ai/specs/2026-09-22-app-owned-party-master.md)（Phases 1–3 就绪）；受影响接口见上文消费清单 |
| SKU/变体归属 | **自建进** `products`（2026-09-22）：变体（SKU）成为 `products` 的一等实体；官方 `catalog` 保留启用并退化为 legacy/可选链接。**分两段走**：Phases 1–2（SKU 主数据 + 商品表单步骤 + option source）现在就绪；发运与海外仓收货的切换（wms 轮）延后 | 库存按变体入账而变体只在官方 `catalog`（`.ai/lessons/stock-receipt-needs-variant-resolution.md`），商品主数据被拆成两处；`sales` 依赖 `catalog` 故不能停用。spec → [`.ai/specs/2026-09-22-product-variants.md`](../../.ai/specs/2026-09-22-product-variants.md) |
| 是否自建一套产品目录 / eject `catalog` | **改为自建** `products`；eject 仍**不做**，官方 `catalog` 保留启用 | 业务口径变更（2026-09-22）：官方组件需大量定制，业务要自管 UI 与流程 → 自建模块只利用平台底层能力（CRUD/命令/scope/附件/币种/事件），并用 `catalog_product_id` + 快照保持与官方链路兼容。原「复用 `catalog`」结论的依据（eject 的升级责任）仍成立，所以不 eject → [eject 实测](../../.ai/analysis/2026-09-21-catalog-eject-spike.md) |
| 自产 / 委托加工商品怎么建模（2026-09-23） | **当普通商品建库，不新增链路**：外购、自产、委托加工共用 `products` 一套主数据与三档价格；货源只影响「品牌 / 型号 / 成本价」的填法（`brand` 已去掉 `'Petkit'` 默认值，`manufacturer_model` 业务名为「型号」，`purchase` 档界面标签为「成本价（采购 / 自产）」）。发运/收货仍要求**一张采购单 + 商品的官方目录链接**，自产商品把工厂建成供应商即可；不做 BOM/工单/成本核算 | 业务确认（2026-09-23）：自产部分是**委托加工（外部工厂）**，前面的建档只要「普通商品 + 成本价/销售价」，后面的销售链路走系统原有流程。因此 `purchasing`→`cross_border`→`wms` 的锚点全部保持不动；若将来出现"没有供应商单据的自产入库"，那是独立立项（改动面：`cross_border` 分摊来源、`export_finance` 收汇锚点、订单档案行集） |
| 金额口径 | **统一 2 位**：财务金额 = `HALF_UP(数量×单价, 2)`（绑定已确认发票行时取发票金额）；合同金额 = `HALF_UP(数量×单价, 2)`；差额落合同头。金额与币种无关（JPY 也是 2 位），单价恒 4 位；量化必须走 BigInt 引擎单点（`toFixed` 有二进制误差）→ [`.ai/specs/2026-09-28-money-scale-2dp-unification.md`](../../.ai/specs/2026-09-28-money-scale-2dp-unification.md) |
| 业务模块能否随业务增删 | **可以**，纯注册表行为、不动数据 | 收缩演练：关掉 `sales`+`wms` 后 `/api` 240→181、`/backend` 105→80，`yarn db:generate` 零迁移 → [收缩实测](../../.ai/analysis/2026-09-21-disable-official-chain-drill.md) |
| 订单档案字段归属（业务给的 35 字段清单） | **不建"统一订单"实体**：字段按四段归位——采购段（`purchasing`：业务订单号/订单描述/采购负责人/客户 + 采购单级单证）、发运段（`cross_border`：柜型/箱号/封条/订舱号·提单号 + 出口单证）、贸易单证段（`trade_docs`：合同盖章件、KC 订单价格 `finance_total`、销项发票 USD）、财务段（`export_finance`：收汇按单、退税按柜 + 两者单证）；业务/财务两种输出是只读投影，订单状态由采购单状态 + 发运里程碑**派生**，不新存列 | 35 字段里 12 个已存在、9 个由既有机制（单证行/付款行/派生金额）承载，仅 14 个是真缺口；复制采购单/发运单数据的"统一订单"会立刻产生第二份真源。多文件一律用"单证行"（一行一个文件）而非新的一对多附件范式 → [`.ai/specs/2026-09-22-order-file-and-export-finance.md`](../../.ai/specs/2026-09-22-order-file-and-export-finance.md) |
| 国内是否建仓 | **不建**（不拼柜、无退货回国） | 建仓但不入库只会产生假库存；在途挂在发运单上 |
| 采购单引用哪套商品 | **自建 `products` 优先**（2026-09-22）：`purchasing_purchase_order_lines.product_id` 指向 `products_products`；`catalog_product_id` 仅保留给历史行与"收货需要变体"的桥接 | 商品主数据已自建；发货与海外仓收货按变体入账（`wms`），变体只能经官方目录解析，因此商品需要填「官方目录链接」才能发运/收货 |
| 采购付款 | 定金 + 尾款，可全付可部分；**无审批、无账期** | 业务口径确认；应付 = 订单总额 − 已付（派生） |
| 语言 | 中文 + 英文先行，其他语言后续追加 | 多国分公司，先跑通流程再补语言 |
| 报价导入的 AI 兜底边界 | **默认关闭**；只在操作员点击时发送「表头 + 前 3 行样例」，界面先展示将发送的 JSON；无 Key 时置灰且接口 503，不写库、不回落硬编码 provider | 供应商报价是商业敏感数据，出网范围必须是可解释的最小集；细节见 [`src/modules/sourcing/README.md`](../../src/modules/sourcing/README.md) 「AI mapping — data boundary」 |
| 供应商产品库与商品主数据的关系（Q-SPL-001 / D1） | **产品库优先，商品按需同步**（2026-09-22）：供应商侧货品进 `purchasing_supplier_products`；需要内部流转（库存/内部销售/合同）时用「同步为商品」按 SKU 新建或更新 `products_products` 并回填 `product_id`；未同步的行也能下单（采购行冻结供应商快照），但发运/收货前必须已同步 | 报价/采购解决的是“向谁买、多少钱”，库存/内部销售解决的是“内部怎么记账”；把供应商清单直接做成商品主数据会让每个报价品都要先建商品，且供应商改货号会污染主数据 |
| 供应商产品库的模块归属（Q-SPL-002 / D2 → **2026-09-23 被 D4 取代**） | 实体/命令/API/页面**都在 `purchasing`**（表名 `purchasing_supplier_products` / `purchasing_supplier_product_prices`，由 `Migration20260923043000_sourcing` **改名保留数据**）；`sourcing` 只保留报价与提升，经 `purchasing.supplier-products.import-from-quote` 喂数据，报价行上的反向指针已删除 | 报价→产品库是同模块写入（不新增跨模块写），与 Q-P-004 也不冲突（2026-09-23 起产品库自带价格清单，但采购单行价仍是谈判值、不被自动带出）；采购员看到的位置与放在 `purchasing` 一致 |
| 后台菜单分组（Q-SPL-003 / D3；2026-09-28 按受众再分） | **八组角色/维护组 + 一组基础数据**：采购 / 出口业务 / **经营概览**（老板视角：驾驶舱 + 月损益 + SKU 毛利 + 库存资金占用）/ 财务（财务人员作业：单证档案 + 税务发票台账 + 柜费用/到岸成本/期间费用 + 应付/应收台账）/ **数据同步**（RU 管道运维页）/ 商品主数据 / 交易对手 / 平台运营 / **基础数据**（2026-09-24 追加，字典库的主菜单入口 `/backend/dictionaries`，业务人员维护词表用）；组 id 复用既有键——`export_finance.nav.group` 保持键名与「财务」label 不变（用户侧边栏偏好不失效），只新增 `executive_overview.nav.group`、`ru_sync.nav.group` 与 `master_data.nav.group`；顺序由 `src/modules.ts` 的 `overrides.nav.groupOrder` 声明一次 | 一个业务角色 = 一个 `pageGroupKey`；组 id 是按用户持久化的侧边栏偏好键，重命名会让偏好失效。原「采购」下并存 `purchasing.nav.group` 与 `sourcing.nav.group` 两个同名分组，正是“同 key 才是同组”的反例（[`.ai/lessons/sidebar-group-is-the-role-boundary.md`](../../.ai/lessons/sidebar-group-is-the-role-boundary.md)） |
| 出口业务组再分（2026-09-29，业主口径） | 「出口业务」一个组拆成四个**组名前缀**组：`出口业务-内部销售`（内部销售报价/订单）、`出口业务-购销合同`（购销合同）、`出口业务-发运`（发运单/装箱单）、`出口业务-单证`（形式发票/商业发票）；四个 group key 新增、`nav.groupOrder` 一次声明，**只有「购销合同」页面的 `pageOrder` 不变、其余按业务时序** | 平台主侧边栏只有「组 → 条目 → 条目子项（一层，URL 前缀推导）」，**组不能嵌套**（`buildAdminNav` 的层级只按 href 前缀生成，注入菜单项的 children 在主侧边栏会被丢弃）；业主选择用组名前缀读出层级感 | 代价：老 key 的历史侧边栏偏好失效（四个新键），不做数据迁移 |
| 合同为主体的单据关联（2026-09-29，业务口径） | 出口业务以**购销合同**为主体：发运单 / 装箱单（PL）/ PI / CI 都关联合同（发运单可挂多张，其余可空、可换绑）；合同再以 **1:N 关联表**挂采购单与销售单（`trade_docs_contract_orders`：成套替换、快照冻结单号/对方/日期、作废合同拒绝、乐观锁）；合同详情的关联单据区块是枢纽，新建入口带 `?contractId=` 预填 | 合同先签、订单后下——单据上的 `source_kind/source_id` 只是「从哪张单开的」单一锚点，表达不了「一张合同覆盖多张订单」，所以订单关联用独立表（`source_*` 保留为历史读）；订单档案的 KC 口径同时认关联表与历史锚点（`export_finance/lib/fileRules.ts` 的 `selectKcContract`），迁移期不回归 | 细节、验收与证据见 spec [`.ai/specs/2026-09-29-contract-linked-export-documents.md`](../../.ai/specs/2026-09-29-contract-linked-export-documents.md) |
| 组织可见性 | 总部看全部下级；分公司看不到上级与同级 | 平台机制（ACL 组织白名单 + 后代展开）→ [`multi-company-org-model.md`](./multi-company-org-model.md) |

## 新增业务流程时的对齐规则

1. **先查归属表**：已有能力一律复用，不改包、不 eject；缺口才自建。
2. **自建模块命名用业务域**：`purchasing`、`cross_border`、`platform_ops` 这类；一个模块一个可独立交付的能力。
3. **先写 spec 再写代码**：`.ai/specs/<date>-<name>.md`（含实体、状态机、页面、测试、分阶段），实现走 `om-module-scaffold`。
4. **跨模块只走 ID + 快照 / 事件 / enricher / extension**，禁止跨模块 ORM 关联。
5. **组织作用域从会话取且 fail-closed**；产品/客户/订单/仓库目前都是**组织级私有**，"总部一份商品卖给所有分公司"需要单独立项（分发或共享读路径）。
6. **接外部系统**：按 `sync_akeneo` 的形状（`integrations` + `data_sync`），凭证加密、外部 ID 映射、幂等 upsert、游标可重跑。

## 术语表

| 术语 | 含义 |
|---|---|
| 代理商 | 国内供货方（本系统里的"供应商"） |
| 直发 | 供应商直接发往海外仓，国内不经本系统仓库 |
| 拼柜 | 多张采购单合并到同一批发运 |
| 在途 | 已发出、海外仓未收货的库存状态（挂发运单，不占仓库余额） |
| 海外仓 / 3PL | 第三方海外仓库，有 API，但账以本系统为准 |
| 平台结算 | 电商平台按周期回款并扣佣金/费用，需要与本系统对账 |
| 关联交易 | 总部与分公司之间的内部买卖（内部销售价、内部对账） |
| 定金 / 尾款 | 采购付款的两个阶段，允许部分支付 |
| 变体 | 同一商品下的 SKU 维度。商品主数据自建后变体也进 `products`（`products_variants`，商品表单步骤 4）；库存仍按变体入账，收货要求商品有「官方目录链接」桥接官方 `catalog` 变体 |
| 报价单 / 供应商报价 | 供应商在某一时点给出的商品价格集合；在 `sourcing` 里是一张 `sourcing_quotes`（可来自 Excel 导入，也可手工录入），确认后单号 `SQ-<年>-<4位>` |
| 报价变更分析（版本对比 / 版本序列 / 货号时间线） | 对存档的**只读**投影：任选两份报价按"归一派生 SKU"逐行对比，得到 新增 / 消失 / 涨价 / 降价 四类，另有 币种不同、缺价、未匹配 三种诚实态；**版本**=已确认/已归档 + 有版式指纹，同一版式**同日折叠为一版**（`quote_date` 优先于导入时间）；货号时间线给出单个货号历次报价与首/末次出现。实现于 `src/modules/sourcing/lib/quoteChanges.ts`，spec [`.ai/specs/2026-09-24-supplier-quotation-change-analysis.md`](../../.ai/specs/2026-09-24-supplier-quotation-change-analysis.md) |
| 版式指纹 | 工作表名 + 归一化表头算出的 16 位哈希；同一个供应商下次发来同样版式时用它命中已保存的列映射模板 |
| 提升 | 把报价单里勾选的行写成商品主数据 + `purchase` 档价格的动作；按 SKU 匹配已有商品，空值不覆盖，重复执行只计 `skipped` |
| 供应商产品库 / 供应商货品 | 某家供应商卖的商品清单：`purchasing_supplier_products`，键是 `(供应商, 货号)`；当前价格在 `purchasing_supplier_product_prices`（`price_kind × 币种 × 起订量`：**供应商供货价**；2026-09-24 起**本公司报价**改由商品主数据的 `internal`（内部结算价）档维护，产品库列表只读展示），折扣挂在产品库行上（`discount_percent`，**0–100 的整数**，折后价 = 单价 ×（1 − 折扣），建档时写进商品的 `purchase`（成本价）档），报价单仍是谈判文档、采购单行价仍是谈判值 |
| 供应商货号 | 产品库行的唯一键 = 报价行的 `derived_sku ?? item_no`（或采购员自填）；同一供应商内永久占用，含软删行；采购单与发运单上展示的是 `item_no ?? supplier_sku` |
| 同步为商品（界面：**建商品档案**） | 把产品库行按货号写成/更新商品主数据，并按最近一条同货号报价行（优先产品库自己的 `supplier_cost` 价）合并 `purchase` 档价格，回填 `product_id`；幂等（已同步返回 `skipped`）。**2026-09-23 起界面文案统一为「建商品档案」**，并发运/收货仍需商品的「官方目录链接」（见下） |
| 关联已有商品 / 换绑 / 解除关联 | 供应商编码 ≠ 我们自己的 SKU 时，不做重复建档，而是把产品库行**手动**挂到已存在的商品上（`purchasing.supplier-products.link`）：只写 `product_id`，不改商品字段与价格；换绑改指向，解除回「未建档」。目标商品的作用域与存活检查在写链接的同一事务里（`for update`），跨组织 404、已删 422，都不落写入 |
| 同步字段到商品 | 已关联的行把当前非空字段与 `supplier_cost` 价推回商品（`purchasing.supplier-products.sync-fields`）；`promote` 对已关联行是幂等的，所以这条是产品库改完之后唯一的回写路径。不碰官方目录链接、`internal`/`export` 价与变体 |
| 官方目录链接 | 商品主数据 `products_products.catalog_product_id` → 官方 `catalog` 商品；发运与海外仓收货按**变体**入账，所以这是「可发运/可收货」的前置（商品页填写，产品库的下一步提示直达这里） |

### 业务术语 ↔ 系统单据（业务说的 X 在系统里叫什么）

| 业务说的 | 系统里是 | 承载 / 状态 |
|---|---|---|
| 采购订单（PO） | 采购单 `/backend/purchasing/orders`，单号 `PO-<年>-<4位>` | `purchasing_purchase_orders` |
| 内部销售订单（PO） | 「总部 → 分公司」的销售订单，界面在 `internal_sales`（引擎仍是 installed `sales`），单号 `ORDER-` | installed `sales` 单据；界面名挂缩写 PO（2026-09-29 落到字典；采购组的采购单**未挂**，只靠 `PO-` 单号区分，见上行） |
| 形式发票（PI） | 形式发票（PI）——发货前开给分公司/供应商的收款依据，单号 `PI-<年>-<4位>`（签发时按组织发号） | **已实现（2026-09-28，Phase 1）**：`trade_docs_documents(kind='proforma')` + `/backend/trade-docs/proformas`，见 [`.ai/specs/2026-09-24-pi-ci-tax-invoice-documents.md`](../../.ai/specs/2026-09-24-pi-ci-tax-invoice-documents.md) |
| 商业发票（CI） | 商业发票（CI）——出口报关/清关用，单号 `CI-<年>-<4位>`（签发时按组织发号） | **已实现（2026-09-28，Phase 2）**：`trade_docs_documents(kind='commercial')` + `/backend/trade-docs/commercial-invoices`；明细按发运单的销售分摊汇总（无销售分摊时回退采购分摊），逐行留来源；旧槽位（发运单详情的 `commercial_invoice`）只读保留、不再新建 |
| 税务发票（增值税专用 / 普通 / 出口发票） | 税务发票台账 `/backend/trade-docs/invoices`（「财务」组），销项单号 `TI-<年>-<4位>`（确认时发号） | `trade_docs_invoices`；**已实现（2026-09-28，Phase 3）**：票种 + 税率/税额/价税合计（`lib/invoiceTax.ts`）；出口发票（0%）不参与合同财务金额 |
| 供应商报价 | 供应商报价单（SQ）`/backend/sourcing/quotes`，单号 `SQ-<年>-<4位>` | `sourcing_quotes`（变更分析在详情与「变更」页签） |
| 内部销售报价 | 内部销售报价单 `/backend/internal-sales/quotes`（**≠ PI**） | installed `sales` 报价 |
| 引用加载（订单从报价单载入） | 订单新建页「从报价单载入」/报价列表「按此报价新建订单」：把报价的抬头与行**一次性**填入新订单，报价保留、可出多张订单；新订单 `metadata.internalSales.sourceQuote` 记来源 | 本模块界面层（installed `sales` 只读 + 既有创建命令），[`.ai/specs/2026-09-29-internal-sales-order-from-quote.md`](../../.ai/specs/2026-09-29-internal-sales-order-from-quote.md) |
| 合同 | 购销合同（采购 `PC-` / 销售 `SC-`）`/backend/trade-docs/contracts` | `trade_docs_contracts` |
| 发运单 / 柜 | 发运单 `/backend/cross_border/shipments` | `cross_border_shipments` |
| 装箱单（PL） | 装箱单——**一类出口单证 + 一张带明细的单据**（2026-09-29 起）：单号/签发日/附件之外还有可编辑明细（数量/箱数/毛重/净重/体积/备注，可从合同商品行批量带出）；台账页 `/backend/cross_border/packing-lists`（出口业务-发运组）跨发运单列出全部 PL，登记/详情/编辑走 `/…/packing-lists/{create,[id],[id]/edit}` 三页，写路径仍是发运单单证命令（`cross_border.documents.*`） | `cross_border_export_documents` + `cross_border_export_document_lines`；订单档案的「采购·合同类」清单另有一条 `packingList` 位（供应商箱单） |

> 界面命名口径（2026-09-28，PL 2026-09-29 补）：业务缩写进界面名，用括号形式（`内部销售订单（PO）`、`形式发票（PI）`、`商业发票（CI）`、`供应商报价单（SQ）`）；报价单不挂缩写，因为它不是 PI。**PL 有自己的菜单项**（`/backend/cross_border/packing-lists` 装箱单（PL），2026-09-29），但**发运单的菜单名不挂 PL**：发运单不是装箱单，PL 只是它单证区里的一类单证。括号内的拉丁缩写按注释处理，不算第二种语言（[`i18n.md`](./i18n.md)）。

## 开放问题

| 问题 | 影响 | 谁来定 |
|---|---|---|
| `parties` 服务方专有属性（货代追踪/报关资质/银行账户）与「按名称搜索」是否需要明文投影 | 决定 Phase 4 的建模与是否需要额外列；Phase 1–3 不受阻 | 见 [`.ai/specs/2026-09-22-app-owned-party-master.md`](../../.ai/specs/2026-09-22-app-owned-party-master.md) 的 Q-P-004 / Q-P-008 | 业务 + 技术 |
| **wms 轮**：自建 SKU 如何进入 wms 账（传自建变体 id 还是保留 catalog 桥）、存量库存与历史单据处理、采购/发运粒度、新 SKU 是否即时建 inventory profile | 决定发运与海外仓收货能否脱离官方 catalog；已量出的证据（wms 列为纯 uuid 无外键、receive 会读 `catalog_product_variant` 且要求 profile 行）已沉淀 | 见 [`.ai/specs/2026-09-22-product-variants.md`](../../.ai/specs/2026-09-22-product-variants.md) 的 *Deferred — the wms round*（Q-V-003/004/005/007/008） | 业务 + 技术（等 wms 流程打通时再定） |
| 平台与货代的对接形态：API 直连、平台导出文件，还是第三方 ERP 服务商 | 决定 `platform_ops` 连接器形状与凭证存放 | 业务 + 技术 |
| ~~跨组织主数据分发（总部商品给各分公司）~~ **已决（2026-09-28）** | 选**分发副本**：`products.items.distribute` 把总部的商品（字段白名单 + 变体 + 首次价格）复制进目标组织，副本用 `source_product_id` 回指来源；共享读路径被否决（会破坏「分公司看不到上级」的可见性不变量，且价格只有一个来源）。影响面：`products` 一列一命令一路由 + 商品列表两个分发入口 | 见 [`.ai/specs/2026-09-28-product-distribution-to-branches.md`](../../.ai/specs/2026-09-28-product-distribution-to-branches.md) | 业务已定（业主 2026-09-28） |
| 提醒规则（触发、阈值、收件人、渠道） | 影响通知与定时作业设计 | 业务 |
| 货代是否提供实时轨迹 | 决定用实时状态还是里程碑模型 | 业务（问货代） |

## 验证方式

1. 模块清单一致：`grep -n "id: '" src/modules.ts` 与 `.mercato/generated/enabled-module-ids.generated.ts` 对齐。
2. 链路里每张单据都能落到模块：`sales`（`/backend/sales/{quotes,orders,documents}`）、`wms`（`/backend/wms/{inventory,warehouses,reservations,movements}`）、`products`（`/backend/products/{items,types,categories}`）、`sourcing`（`/backend/sourcing/quotes` 供应商报价单（SQ））、`purchasing`（`/backend/purchasing/{suppliers,orders,supplier-products}` 供应商产品库自 2026-09-23 起归本模块）、`trade_docs`（`/backend/trade-docs/{contracts,invoices}`）、`purchasing`（`/backend/purchasing/suppliers`）、`catalog`（`/api/catalog/products`）。其中 `sales`/`wms`/`catalog` 的官方页面都只做**导航隐藏**（`src/modules.ts` 的 `routes.pages` + `metadata.navHidden`，URL 直达仍可用）——不用 `null`，因为官方通知的 `linkHref` 在创建时冻结成行数据（[`.ai/lessons/module-override-page-hide-needs-routes-domain.md`](../../.ai/lessons/module-override-page-hide-needs-routes-domain.md)）。
3. 菜单按角色成组：侧边栏为 采购 / **出口业务-内部销售** / **出口业务-购销合同** / **出口业务-发运** / **出口业务-单证**（2026-09-29 前是单一「出口业务」组，因平台组不能嵌套、按业主口径改用**组名前缀拆组**，见下） / **经营概览** / 财务 / **数据同步** / 商品主数据 / 交易对手 / 平台运营 八组角色/维护组，其后是**基础数据**（2026-09-24 起：字典维护 `/backend/dictionaries`，见 [`.ai/specs/2026-09-24-dictionary-main-menu-entry.md`](../../.ai/specs/2026-09-24-dictionary-main-menu-entry.md)）——“采购”只有一组（供应商、供应商产品库、采购单、供应商报价单（SQ）），“出口业务”（2026-09-29 起拆成四组：**出口业务-内部销售**含内部销售报价、内部销售订单（PO）；**出口业务-购销合同**含购销合同；**出口业务-发运**含发运单、装箱单（PL，2026-09-29 起；同日新增登记/详情/编辑三页）；**出口业务-单证**含形式发票（PI）、商业发票（CI）；四个键是 `cross_border.nav.group.{internal,contracts,shipping,documents}`，组顺序在 `src/modules.ts` 的 `groupOrder` 里一次声明——改键会让该组的历史侧边栏偏好失效，这是拆组方案的已知代价），“财务”只留财务人员的作业与台账：订单档案、柜档案、税务发票台账（2026-09-28 起从出口业务组移入）与自建 `finance` 的柜费用 / 到岸成本 / 期间费用 / 应付台账 / 应收台账（`pageOrder` 420+）；“经营概览”放老板看的结果页——老板驾驶舱、月损益、SKU 毛利、库存资金占用（2026-09-28 从「财务」拆出，新键 `executive_overview.nav.group`）；“数据同步”放 RU 管道运维页——RU SKU 映射、RU 同步健康（同日从「财务」拆出，新键 `ru_sync.nav.group`；它们是维护页，不是财务页也不是老板页）。同一 `pageGroupKey` 才是同一个组，组的默认顺序由 `overrides.nav.groupOrder` 前置声明。组 id 同时是按用户持久化的侧边栏偏好键（`/backend/sidebar-customization`）：那一轮只新增 `export_finance.nav.group`、删掉 `sourcing.nav.group`/`internal_sales.nav.group`/`trade_docs.nav.group`（2026-09-28 再新增 `executive_overview.nav.group` 与 `ru_sync.nav.group`，都是新增键、无重命名），**不做数据迁移**，点过自定义排序的用户在那三组消失后按新分组重排即可；新建的角色要看到「供应商产品库」入口需 `yarn mercato auth sync-role-acls` + 重启（`.ai/lessons/module-features-need-role-acl-sync.md`）。
4. 主源表与本仓 spec 的 REQ 对齐：`purchasing` → [`.ai/specs/2026-09-21-purchasing-module.md`](../../.ai/specs/2026-09-21-purchasing-module.md)；`products` + `trade_docs` → [`.ai/specs/2026-09-22-products-and-trade-docs.md`](../../.ai/specs/2026-09-22-products-and-trade-docs.md)；`sourcing` → [`.ai/specs/2026-09-22-supplier-quotation-import.md`](../../.ai/specs/2026-09-22-supplier-quotation-import.md)、[`.ai/specs/2026-09-24-supplier-quotation-change-analysis.md`](../../.ai/specs/2026-09-24-supplier-quotation-change-analysis.md)（报价变更分析）与 [`.ai/specs/2026-09-22-supplier-product-library.md`](../../.ai/specs/2026-09-22-supplier-product-library.md)（供应商产品库）；总纲 → [`.ai/specs/2026-09-21-app-owned-business-module.md`](../../.ai/specs/2026-09-21-app-owned-business-module.md)。
