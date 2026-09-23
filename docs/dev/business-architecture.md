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
| 商品主数据 | **自建** `products` | 业务口径变更（2026-09-22）：官方 `catalog` 后续会有大量定制点，业务要自管产品 UI 与流程 → 商品、产品类型、类别树、三档价格全部自有表；官方 `catalog` 保留为平台级商品注册表，经 `products_products.catalog_product_id` 可选链接。详见 [`.ai/specs/2026-09-22-products-and-trade-docs.md`](../../.ai/specs/2026-09-22-products-and-trade-docs.md)。**变体（SKU）维度已迁入 `products`**（2026-09-22 决策，Phases 1–2 已实现并验证：`products_variants` 表 + 商品表单步骤 4「变体/SKU」+ `/api/products/variants/options`；发运与海外仓收货的切换仍延后到 wms 轮 → spec：[`.ai/specs/2026-09-22-product-variants.md`](../../.ai/specs/2026-09-22-product-variants.md)）|
| **供应商报价单 + Excel 报价导入** | **自建** `sourcing` | 平台没有供应商报价/价目表实体：`products_prices` 唯一键是 `(product, tier, currency, minQuantity)`，没有 `supplier_id`/报价日期/来源文件，而 `purchasing` 的 Q-P-004 明确"不做供应商价格表" → 报价历史与"任意版式 Excel → 商品库"由自有模块承载，提升时调用 `products` 命令。详见 [`.ai/specs/2026-09-22-supplier-quotation-import.md`](../../.ai/specs/2026-09-22-supplier-quotation-import.md) |
| **供应商产品库**（每个供应商的货品清单：货号/品名/规格/单位/箱规/MOQ/HS，**不含价格**；可同步为商品） | **自建** `sourcing`（同一模块的另一张表） | 平台没有“供应商侧货品”实体：报价行是**文档级**的（只能经 `sourcing_quotes.supplier_id` 反查），商品主数据 `products_products` 是内部唯一主源（库存/内部销售/合同需要它），两者都不是“这家供应商卖这些货”的清单。页面挂在「采购」菜单组，实体与命令归 `sourcing`（它已拥有报价与提升路径，报价→产品库是同模块写入）。详见 [`.ai/specs/2026-09-22-supplier-product-library.md`](../../.ai/specs/2026-09-22-supplier-product-library.md) |
| **购销合同与发票**（采购/销售合同、进项/销项发票、双口径金额） | **自建** `trade_docs` | 平台没有购销合同单据；合同两方向（采购/销售）、发票挂合同、财务金额与合同金额两个口径与差额自管 |
| **出口收汇与出口退税档案**（是否已收款、涉外收入证明、退税状态/金额/备注、报告草单、退税资料整理，以及订单档案/柜档案两种只读输出） | **自建** `export_finance` | 平台没有收汇与出口退税实体。**两个锚点**：收汇按**采购单**（`export_finance_collections`，唯一键 `(tenant, org, purchase_order_id)`），退税按**柜/发运单**（`export_finance_refunds`，唯一键 `(tenant, org, shipment_id)`）——退税以柜为申报单位，拼柜时按各订单采购金额占比把税额**反向分摊**回订单（读时派生，不落库）。柜与订单的关系只走 `cross_border_shipment_allocations`，不新增关联表；聚合层以只读 Kysely 跨表读取 `purchasing`/`cross_border`/`trade_docs`。详见 [`.ai/specs/2026-09-22-order-file-and-export-finance.md`](../../.ai/specs/2026-09-22-order-file-and-export-finance.md) |
| 客户 / 分公司档案 | **自建** `parties`（2026-09-22 决策，Phases 1–3 已实现，待迁移审批） | 官方 CRM 的拓客半部（deal/pipeline/calendar/tasks）不适用、档案半部语义不匹配货代/报关行/银行等服务方 → 买方/分公司/服务方统一进 `parties`（`parties_parties` + `parties_roles` + `parties_bank_accounts`）；`customers` 保留启用（`sales requires customers`，对分公司的内部销售单据仍挂它）。spec：[`.ai/specs/2026-09-22-app-owned-party-master.md`](../../.ai/specs/2026-09-22-app-owned-party-master.md) |
| 官方 `catalog` 的后台页面 | **隐藏**（模块与 API 保留） | 自建 `products` 才是业务商品主数据 → 官方 `catalog` 的 商品/变体/类别 页面通过 `src/modules.ts` 的 `routes.pages` 覆盖隐藏，`config/catalog` 仍保留；`sales` 单据行仍从 catalog 取商品/价格（切换是后续独立切片） |
| 对分公司的内部销售 | **复用** `sales`（引擎）+ **自建界面** `internal_sales` | 单据编号/状态/金额/发货/发票/收款仍在官方 `sales` 链；新建与编辑走自建页面（选品用自建 `products`、行自动带官方目录变体桥接）；官方「新建单据」页隐藏、列表保留 → [`.ai/specs/2026-09-22-products-and-trade-docs.md`](../../.ai/specs/2026-09-22-products-and-trade-docs.md) Phase 6 | 报价→订单→发货→退货→发票→贷项→收款整链、单据编号序列、多币种、渠道与报价 |
| 多仓库存与仓内作业 | **复用** `wms` | 仓库/库位/批次/余额/预留/**移动台账**/盘点 + 收货/调整/移库/预留/分配命令 |
| 币种与汇率 | **复用** `currencies` | 汇率主数据 + 抓取配置 |
| 组织与多公司 | **复用** `directory` | 组织树 + 后代展开可见性，配置见 [`multi-company-org-model.md`](./multi-company-org-model.md) |
| **采购**（供应商、采购单、定金/尾款） | **自建** `purchasing` | 平台安装清单里没有任何采购/供应商模块（`supplier` 仅出现在 `eudr`、`vendor` 仅在 `warranty_claims`） |
| **跨境发运/在途/出口单证** | **已实现** `cross_border` | 发运单（多采购单合并/拆分的多对多分摊）、在途里程碑（单调）、出口单证（最小结构化字段 + 附件）；收货时调 `wms.inventory.receive` 并回写采购单行已收数量 |
| **平台订单与结算同步/对账** | **已实现**（核心）`platform_ops` | 渠道、订单镜像（幂等 ingest）、结算单与明细（幂等 import）、对账队列（resolve/ignore，不复活）；**传输层**（`data_sync` 适配器 / 文件 / 第三方）待 Q4 定 |
| 外部集成底座 | **待启用** `integrations` + `data_sync` | "external ID mapping / integration registry" 与 "streaming data sync hub" |
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
| `products`、`purchasing`（采购单 + 供应商）、`trade_docs`、`platform_ops`、`internal_sales` | `GET /api/currency_policy/currencies`（自建） | 币种下拉，共 6 处——2026-09-22 已从 `customers` 托管的字典路由切换过来，不再依赖 `customers` 及其 `customers.people.view` 门禁；数据仍取自官方 `dictionaries` 模块（见 [`.ai/specs/2026-09-22-app-owned-party-master.md`](../../.ai/specs/2026-09-22-app-owned-party-master.md) Phase 3） | 各模块的 `CURRENCY_DICTIONARY_URL` 常量 |
| `products` | `GET /api/catalog/products` | 商品表单的「官方目录链接」字段（变体解析桥） | `products/components/ProductForm.tsx:540` |
| `cross_border` | `GET /api/wms/warehouses`、`GET /api/wms/locations` | 发运单的仓库/库位选择器 | `cross_border/components/ShipmentForm.tsx:48-49` |

币种链路现在只有**一跳**到官方数据：路由在自建 `currency_policy`（门禁 `currencies.view`），数据取自 `dictionaries` 模块的
`dictionaries`/`dictionary_entries` 表。切换前的旧路由 `customers/api/dictionaries/currency/route.ts` 仍在官方包里、无人调用。

**尚未切换的 `customers` 消费方**（各自 spec 负责，不由 `parties` spec 单方面改语义）：

| 消费方 | 位置 | 说明 |
|---|---|---|
| `purchasing` 采购单的「客户」选择器 | `purchasing/components/orderFormOptions.ts:20` | `.ai/specs/2026-09-22-order-file-and-export-finance.md` 给采购单加了 `customer_id`，其对方仍取自 `customers/companies`；该 spec 决定何时切 `parties` |
| `internal_sales` 内部销售表单的对方选择器 | `internal_sales/components/InternalSalesForm.tsx:46` | 对分公司的内部销售；分公司已是 `parties` 里的主体，切换与否则由 `internal_sales` 的 spec 决定 |

### 服务端契约消费（实体 / 命令 / 工具函数）

| 消费方 | 官方契约 | 形式 | 位置 |
|---|---|---|---|
| `cross_border` | `wms.inventory.receive` | 命令（`dispatchPeerCommand`）：收货入账并回写采购单行已收数量 | `cross_border/commands/shipments.ts:578` |
| `currency_policy` | `currencies:currency`、`dictionaries:dictionary*`、`directory:organization` | 直接 import 实体，对账 FX 主数据与币种字典 | `currency_policy/lib/apply.ts:2-3`、`cli.ts:4` |
| `products`、`purchasing`、`sourcing` | `dictionaries:dictionary*` + `normalizeDictionaryValue` | 服务端校验币种码必须存在于字典 | 各模块 `lib/currencyDictionary.ts` |
| `scope_guards` | `auth:user/role/acl` 实体 + `RbacService`、`directory` scope 工具 | 拦截越权写入 | `scope_guards/lib/scopeGuard.ts:3-5` |
| `sourcing`、`trade_docs` | `attachments`（`AttachmentService`、`Attachment`/`AttachmentPartition`、`StorageDriverFactory`、`createAttachmentFromBuffer`） | 报价源文件与合同/发票单证的附件读写 | `sourcing/commands/quotes.ts:8`、`trade_docs/commands/contracts.ts:17`、`trade_docs/api/contracts/[id]/document/route.ts:8-10` |
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
| 商品主数据 | 本系统 `products`（自建） | 唯一来源；官方 `catalog` 作为平台级商品注册表，经 `catalog_product_id` 可选链接 | — |
| 供应商报价 | 本系统 `sourcing`（自建） | 唯一来源；报价行保留原始 Excel 行与来源文件，提升后写入 `products` + `purchase` 档价格 | 同组织内乐观锁 409；已提升的行重复提升只计 `skipped`，不重复建商品 |
| 供应商货品库（每家供应商卖什么） | 本系统 `sourcing.sourcing_supplier_products`（自建） | 唯一来源；**不含价格**（价格仍在报价行与采购单行，`purchasing` Q-P-004）；`product_id` 由「同步为商品」回填，商品侧没有反向列 | 同一供应商内货号唯一（**含软删行**，货号永久占用）；重复导入只写非空且变化的值，第二次计 `skipped`；已下采购单的行保留自己的 `product_snapshot` |
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
| 金额口径 | **双口径**：财务金额 = `HALF_UP(数量×单价, 币种小数位)`（绑定已确认发票行时取发票金额）；合同金额 = `HALF_UP(数量×单价, 2)`；差额落合同头 | 财务金额必须与发票对得上、合同金额只要 2 位四舍五入；量化必须走 BigInt（`toFixed` 有二进制误差）→ [`.ai/specs/2026-09-22-products-and-trade-docs.md`](../../.ai/specs/2026-09-22-products-and-trade-docs.md) |
| 业务模块能否随业务增删 | **可以**，纯注册表行为、不动数据 | 收缩演练：关掉 `sales`+`wms` 后 `/api` 240→181、`/backend` 105→80，`yarn db:generate` 零迁移 → [收缩实测](../../.ai/analysis/2026-09-21-disable-official-chain-drill.md) |
| 订单档案字段归属（业务给的 35 字段清单） | **不建"统一订单"实体**：字段按四段归位——采购段（`purchasing`：业务订单号/订单描述/采购负责人/客户 + 采购单级单证）、发运段（`cross_border`：柜型/箱号/封条/订舱号·提单号 + 出口单证）、贸易单证段（`trade_docs`：合同盖章件、KC 订单价格 `finance_total`、销项发票 USD）、财务段（`export_finance`：收汇按单、退税按柜 + 两者单证）；业务/财务两种输出是只读投影，订单状态由采购单状态 + 发运里程碑**派生**，不新存列 | 35 字段里 12 个已存在、9 个由既有机制（单证行/付款行/派生金额）承载，仅 14 个是真缺口；复制采购单/发运单数据的"统一订单"会立刻产生第二份真源。多文件一律用"单证行"（一行一个文件）而非新的一对多附件范式 → [`.ai/specs/2026-09-22-order-file-and-export-finance.md`](../../.ai/specs/2026-09-22-order-file-and-export-finance.md) |
| 国内是否建仓 | **不建**（不拼柜、无退货回国） | 建仓但不入库只会产生假库存；在途挂在发运单上 |
| 采购单引用哪套商品 | **自建 `products` 优先**（2026-09-22）：`purchasing_purchase_order_lines.product_id` 指向 `products_products`；`catalog_product_id` 仅保留给历史行与"收货需要变体"的桥接 | 商品主数据已自建；发货与海外仓收货按变体入账（`wms`），变体只能经官方目录解析，因此商品需要填「官方目录链接」才能发运/收货 |
| 采购付款 | 定金 + 尾款，可全付可部分；**无审批、无账期** | 业务口径确认；应付 = 订单总额 − 已付（派生） |
| 语言 | 中文 + 英文先行，其他语言后续追加 | 多国分公司，先跑通流程再补语言 |
| 报价导入的 AI 兜底边界 | **默认关闭**；只在操作员点击时发送「表头 + 前 3 行样例」，界面先展示将发送的 JSON；无 Key 时置灰且接口 503，不写库、不回落硬编码 provider | 供应商报价是商业敏感数据，出网范围必须是可解释的最小集；细节见 [`src/modules/sourcing/README.md`](../../src/modules/sourcing/README.md) 「AI mapping — data boundary」 |
| 供应商产品库与商品主数据的关系（Q-SPL-001 / D1） | **产品库优先，商品按需同步**（2026-09-22）：供应商侧货品进 `sourcing_supplier_products`；需要内部流转（库存/内部销售/合同）时用「同步为商品」按 SKU 新建或更新 `products_products` 并回填 `product_id`；未同步的行也能下单（采购行冻结供应商快照），但发运/收货前必须已同步 | 报价/采购解决的是“向谁买、多少钱”，库存/内部销售解决的是“内部怎么记账”；把供应商清单直接做成商品主数据会让每个报价品都要先建商品，且供应商改货号会污染主数据 |
| 供应商产品库的模块归属（Q-SPL-002 / D2） | 实体/命令/API/页面**都在 `sourcing`**，页面用 `pageGroupKey: 'purchasing.nav.group'` 渲染在「采购」菜单组 | 报价→产品库是同模块写入（不新增跨模块写），也不与 Q-P-004“不做供应商价格表”冲突；采购员看到的位置与放在 `purchasing` 一致 |
| 后台菜单分组（Q-SPL-003 / D3） | **六组**：采购 / 外贸 / 财务 / 商品主数据 / 交易对手 / 平台运营；组 id 复用既有键，只新增 `export_finance.nav.group`；顺序由 `src/modules.ts` 的 `overrides.nav.groupOrder` 声明一次 | 一个业务角色 = 一个 `pageGroupKey`；组 id 是按用户持久化的侧边栏偏好键，重命名会让偏好失效。原「采购」下并存 `purchasing.nav.group` 与 `sourcing.nav.group` 两个同名分组，正是“同 key 才是同组”的反例（[`.ai/lessons/sidebar-group-is-the-role-boundary.md`](../../.ai/lessons/sidebar-group-is-the-role-boundary.md)） |
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
| 变体 | 同一商品下的 SKU 维度（本系统 `catalog` 支持；采购按商品级引用） |
| 报价单 / 供应商报价 | 供应商在某一时点给出的商品价格集合；在 `sourcing` 里是一张 `sourcing_quotes`（可来自 Excel 导入，也可手工录入），确认后单号 `SQ-<年>-<4位>` |
| 版式指纹 | 工作表名 + 归一化表头算出的 16 位哈希；同一个供应商下次发来同样版式时用它命中已保存的列映射模板 |
| 提升 | 把报价单里勾选的行写成商品主数据 + `purchase` 档价格的动作；按 SKU 匹配已有商品，空值不覆盖，重复执行只计 `skipped` |
| 供应商产品库 / 供应商货品 | 某家供应商卖的商品清单：`sourcing_supplier_products`，键是 `(供应商, 货号)`；**不含价格**，价格在报价行与采购单行 |
| 供应商货号 | 产品库行的唯一键 = 报价行的 `derived_sku ?? item_no`（或采购员自填）；同一供应商内永久占用，含软删行；采购单与发运单上展示的是 `item_no ?? supplier_sku` |
| 同步为商品 | 把产品库行按货号写成/更新商品主数据，并按最近一条同货号报价行合并 `purchase` 档价格，回填 `product_id`；幂等（已同步返回 `skipped`） |

## 开放问题

| 问题 | 影响 | 谁来定 |
|---|---|---|
| `parties` 服务方专有属性（货代追踪/报关资质/银行账户）与「按名称搜索」是否需要明文投影 | 决定 Phase 4 的建模与是否需要额外列；Phase 1–3 不受阻 | 见 [`.ai/specs/2026-09-22-app-owned-party-master.md`](../../.ai/specs/2026-09-22-app-owned-party-master.md) 的 Q-P-004 / Q-P-008 | 业务 + 技术 |
| **wms 轮**：自建 SKU 如何进入 wms 账（传自建变体 id 还是保留 catalog 桥）、存量库存与历史单据处理、采购/发运粒度、新 SKU 是否即时建 inventory profile | 决定发运与海外仓收货能否脱离官方 catalog；已量出的证据（wms 列为纯 uuid 无外键、receive 会读 `catalog_product_variant` 且要求 profile 行）已沉淀 | 见 [`.ai/specs/2026-09-22-product-variants.md`](../../.ai/specs/2026-09-22-product-variants.md) 的 *Deferred — the wms round*（Q-V-003/004/005/007/008） | 业务 + 技术（等 wms 流程打通时再定） |
| 平台与货代的对接形态：API 直连、平台导出文件，还是第三方 ERP 服务商 | 决定 `platform_ops` 连接器形状与凭证存放 | 业务 + 技术 |
| 跨组织主数据分发（总部商品给各分公司） | 影响 `catalog` 使用方式与是否需要共享读路径 | 业务 + 技术 |
| 提醒规则（触发、阈值、收件人、渠道） | 影响通知与定时作业设计 | 业务 |
| 货代是否提供实时轨迹 | 决定用实时状态还是里程碑模型 | 业务（问货代） |

## 验证方式

1. 模块清单一致：`grep -n "id: '" src/modules.ts` 与 `.mercato/generated/enabled-module-ids.generated.ts` 对齐。
2. 链路里每张单据都能落到模块：`sales`（`/backend/sales/{quotes,orders,documents}`）、`wms`（`/backend/wms/{inventory,warehouses,reservations,movements}`）、`products`（`/backend/products/{items,types,categories}`）、`sourcing`（`/backend/sourcing/quotes`、`/backend/sourcing/supplier-products` 供应商产品库）、`trade_docs`（`/backend/trade-docs/{contracts,invoices}`）、`purchasing`（`/backend/purchasing/suppliers`）、`catalog`（`/api/catalog/products`）。其中 `sales`/`wms` 的官方页面已从侧边栏隐藏（`src/modules.ts` 的 `routes.pages`，URL 直达仍可用），`catalog` 的 8 个产品/变体/类目页则是彻底摘除（`null`）。
3. 菜单按角色成组：侧边栏恰好六组且顺序为 采购 / 外贸 / 财务 / 商品主数据 / 交易对手 / 平台运营——“采购”只有一组（供应商、供应商产品库、采购单、供应商报价），“外贸”含内部销售报价/订单、购销合同、发票、发运单，“财务”含订单档案、柜档案。同一 `pageGroupKey` 才是同一个组，组的默认顺序由 `overrides.nav.groupOrder` 前置声明。组 id 同时是按用户持久化的侧边栏偏好键（`/backend/sidebar-customization`）：本次只新增 `export_finance.nav.group`、删掉 `sourcing.nav.group`/`internal_sales.nav.group`/`trade_docs.nav.group`，**不做数据迁移**，点过自定义排序的用户在那三组消失后按新分组重排即可；新建的角色要看到「供应商产品库」入口需 `yarn mercato auth sync-role-acls` + 重启（`.ai/lessons/module-features-need-role-acl-sync.md`）。
4. 主源表与本仓 spec 的 REQ 对齐：`purchasing` → [`.ai/specs/2026-09-21-purchasing-module.md`](../../.ai/specs/2026-09-21-purchasing-module.md)；`products` + `trade_docs` → [`.ai/specs/2026-09-22-products-and-trade-docs.md`](../../.ai/specs/2026-09-22-products-and-trade-docs.md)；`sourcing` → [`.ai/specs/2026-09-22-supplier-quotation-import.md`](../../.ai/specs/2026-09-22-supplier-quotation-import.md) 与 [`.ai/specs/2026-09-22-supplier-product-library.md`](../../.ai/specs/2026-09-22-supplier-product-library.md)（供应商产品库）；总纲 → [`.ai/specs/2026-09-21-app-owned-business-module.md`](../../.ai/specs/2026-09-21-app-owned-business-module.md)。
