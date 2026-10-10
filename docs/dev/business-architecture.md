# 业务架构：外贸 + 跨境电商

## 适用范围

本文件沉淀**公司实际业务**与**系统落地**的对应关系：业务链路与入口、模块归属、数据主源约定、已定决策与依据。
新增任何业务流程前先读这里 + [`business-conventions.md`](./business-conventions.md)（owner 口径清单），再决定"复用 / 自建 / 待启用"。

不适用于：组织与权限的后台配置步骤（→ [`multi-company-org-model.md`](./multi-company-org-model.md)）、
具体实现契约（→ `.ai/specs/`）、产品需求与实施计划（→ [`../prd/cross-border-erp.md`](../prd/cross-border-erp.md)、[`../plans/cross-border-erp.md`](../plans/cross-border-erp.md)）、
环境与上线（→ `../deploy/`）。

> **2026-10-10 重大修订：商品单一存储。** 商品身份/变体/价格/分类统一落官方 `catalog`；自建
> `products_products` / `products_types` / `products_categories` / `products_variants` / `products_prices`
> 退役；`product_codes` 自动编码停用、SKU 手填；供应商产品库保留为**供应商方向**的表。
> 决策、字段落位与验收见 [`.ai/specs/2026-10-10-catalog-single-store.md`](../../.ai/specs/2026-10-10-catalog-single-store.md)。

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

> 上面五条链**挂在公司订单（根单）之下**：工作台建一张公司订单，再把采购/对内/对外三类子单关联进来，下游（合同/单证/发运/收汇·退税）按子单并集只读——入口见下一节。

## 业务入口总纲（2026-10-10 基准）

**公司订单是唯一的订单入口**（`.ai/specs/2026-10-09-company-order-root.md`，已交付）：

```text
公司订单工作台 /backend/orders（每行 = 一张公司订单）
  └─ 公司订单详情 /backend/orders/<companyOrderId>（根单）
       ├─ 关联区块（可写）：对内销售订单 / 对外销售订单 / 采购订单   ← 关联已有 / 预填新建 / 移除
       └─ 下游区块（按子单并集只读 + 预填新建）：购销合同 / 单据 / 发运单 / 装箱单 / 收汇·退税
```

- 属于这笔生意的字段（订单描述、采购负责人、单证槽位）**只在根单可写**；子单页面只读镜像，改要跳回根单（C-27）。
- 各业务组的台账页（采购单、合同、发运单…）保留自己的「新建」，用于**无来源单据**；有来源的单从工作台或根单起手。
- 侧边栏结构、组的 key 与权限语义见 [`navigation.md`](./navigation.md)。

| 角色 | 主入口 | 主要动作 |
|---|---|---|
| 采购员 | 公司订单 → 采购 → 供应商产品库 | 维护供应商货品、建商品档案、下单、跟进付款 |
| 商品管理员 | 基础数据 → 商品主数据（自有商品库） | 自有商品建档（catalog）、三档价、变体、分发到分公司 |
| 单证/物流 | 公司订单 → 出口销售 / 合同与单据 / 发运与装箱 | 合同、PI/CI、发运单、装箱单 |
| 财务 | 财务组 / 经营概览 | 收汇、退税、费用与到岸成本、损益与台账 |
| 老板 | 经营概览 | 驾驶舱、月损益、SKU 毛利、库存资金占用 |

## 模块归属地图

| 能力 | 归属 | 依据 |
|---|---|---|
| **商品主数据（身份 / 变体 / 价格 / 分类）** | **官方 `catalog`**（唯一存储）+ **自绘 UI** | 2026-10-10 决策：库存/收货按 catalog 变体入账，商品身份不能有第二个；app 侧只保留页面与命令壳（自有商品库、供应商库建档、分发），经 catalog 命令/API 写入，不写官方代码。三档价 = `catalog_price_kinds`（purchase/internal/export）× 币种 × 起订量；业务字段（品牌/系列/型号/申报要素/装箱/重量体积/尺寸/图片）用自定义字段 + 附件。spec → [`.ai/specs/2026-10-10-catalog-single-store.md`](../../.ai/specs/2026-10-10-catalog-single-store.md) |
| **商品编码** | **停用**（保留旧码别名表） | 手填 SKU 一直是一等路径（生成器只是可选，`rule.enforce` 不拦写路径）。发号规则/台账/品牌码表删除；`product_codes_aliases` 保留（单据上的旧码必须可搜）。重做另立切片（spec Phase 4）。原实现见 [`.ai/specs/2026-09-24-supplier-product-code-rules.md`](../../.ai/specs/2026-09-24-supplier-product-code-rules.md)（已停用） |
| **供应商报价单 + Excel 报价导入** | **自建** `sourcing` | 平台没有供应商报价/价目表实体；报价历史与"任意版式 Excel → 商品"由自有模块承载；提升时写 catalog（商品 + purchase 档价格）。spec → [`.ai/specs/2026-09-22-supplier-quotation-import.md`](../../.ai/specs/2026-09-22-supplier-quotation-import.md)、变更分析 → [`.ai/specs/2026-09-24-supplier-quotation-change-analysis.md`](../../.ai/specs/2026-09-24-supplier-quotation-change-analysis.md) |
| **供应商产品库**（供应商方向：货号/原始品名/供货价+折扣/MOQ/报价来源/候选状态/供应商表原文组） | **自建** `purchasing` | 键是（供应商 × 货号）、候选货先于商品存在、采购 ACL 与读取面需隔离——官方 registry 不该被候选货污染。`product_id` 改指 `catalog_product_id`；「建商品档案」一次产生 catalog 商品 + 默认变体。 |
| **购销合同与发票**（采购/销售合同、进项/销项发票、双口径金额） | **自建** `trade_docs` | 平台没有购销合同单据；合同两方向、发票挂合同、财务金额与合同金额两个口径与差额自管 |
| **出口收汇与出口退税档案** | **自建** `export_finance` | 平台没有收汇与出口退税实体。收汇按**采购单**、退税按**柜/发运单**；柜级退税按采购金额占比反向分摊（读时派生）。spec → [`.ai/specs/2026-09-22-order-file-and-export-finance.md`](../../.ai/specs/2026-09-22-order-file-and-export-finance.md) |
| **柜级费用与到岸成本 / 库存资金占用 / 期间费用 / 应付·应收台账 / 损益** | **自建** `finance` | 平台与既有自建模块都没有费用/成本实体；只写自己的表，读 peer 表一律 scoped 只读投影。spec → [`.ai/specs/2026-09-28-finance-ledger-and-cockpit-data.md`](../../.ai/specs/2026-09-28-finance-ledger-and-cockpit-data.md) |
| **俄方供应链数据同步**（PETKIT 合同 17 端点） | **自建** `ru_sync` | 适配器实现 `DataSyncAdapter`（`providerKey: ru_petkit`）：每端点 schema + 快照投影 + 游标；RU 码 → 商品映射（目标 = catalog 商品）。 |
| **老板驾驶舱**（只读聚合 + 四预警） | **自建** `boss_cockpit` | 一页只读、零写表；数据来自 `ru_sync` 快照与 `finance` 台账；四预警由 `ru_sync` 评估并发 typed event → `notifications` |
| **公司订单根单（订单工作台）** | **自建** `order_hub` | 平台没有「公司订单」实体：根单 + 关联表 + 工作台/详情 + 补录 CLI。spec → [`.ai/specs/2026-10-09-company-order-root.md`](../../.ai/specs/2026-10-09-company-order-root.md) |
| 客户 / 分公司 / 服务方档案 | **自建** `parties` | 官方 CRM 拓客半部不适用、档案半部语义不匹配货代/报关行/银行；`customers` 保留启用（`sales requires customers`）。spec → [`.ai/specs/2026-09-22-app-owned-party-master.md`](../../.ai/specs/2026-09-22-app-owned-party-master.md) |
| **对分公司的内部销售** | **复用** `sales`（引擎）+ **自建界面** `internal_sales` | 单据编号/状态/金额/发货/发票/收款仍在官方 `sales` 链；新建与编辑走自建页面，行引用 catalog 商品并带默认变体桥接。 |
| 官方 `catalog` 的后台页面 | **导航隐藏**（API 与页面保留） | 商品/变体/类别/价格类型页面仍 `navHidden`（URL 直达可用、删 route 会断通知链接）；**数据面现在是主存储**，app 全程经 catalog 命令/API 读写。 |
| 官方 `dictionaries` 的字典库页面 | **复用**（引擎）+ 自建页面体 | 字典实体/命令/ACL 归官方；页面体由 `src/modules/dictionaries/backend/config/dictionaries/page.tsx` 遮蔽，按组织分组、只放开当前组织的写。 |
| 多仓库存与仓内作业 | **复用** `wms` | 仓库/库位/批次/余额/预留/移动台账/盘点 + 收货/调整/移库/预留/分配命令；**收货按 catalog 变体入账** |
| 币种与汇率 | **复用** `currencies` + 自建 `currency_policy` | 汇率主数据 + 抓取；`currency_policy` 托管选币器路由与 CNY 换算汇率供给，见 [`currency-policy.md`](./currency-policy.md) |
| 组织与多公司 | **复用** `directory` | 组织树 + 后代展开可见性，见 [`multi-company-org-model.md`](./multi-company-org-model.md) |
| **采购**（供应商、采购单、定金/尾款） | **自建** `purchasing` | 平台安装清单里没有任何采购/供应商模块 |
| **跨境发运/在途/出口单证** | **自建** `cross_border` | 发运单（多采购单合并/拆分的多对多分摊）、在途里程碑、出口单证（含带明细的装箱单）；收货调 `wms.inventory.receive` 并回写采购单行已收数量 |
| **平台订单与结算同步/对账** | **自建**（核心）`platform_ops` | 渠道、订单镜像（幂等 ingest）、结算单与明细（幂等 import）、对账队列；传输层由 `ru_sync` 的 `ru_petkit` provider 交付 |
| 外部集成底座 | **已启用** `integrations` + `data_sync` | 连接器注册 / 外部 ID 映射 / 数据同步 hub |
| 认证域越权写入加固 | **自建** `scope_guards` | 拦截 `auth.*` 的跨组织写入，无页面 |
| **存储运维** | **自建** `storage_ops` | 操作员 CLI：`audit` / `migrate` / `verify` / `rollback` / `prune-local`，不写业务数据 |
| 审批规则 / 长流程 / 定时任务 / 物流面单 / 多语言商品内容 / 通用 CSV 导入 / 邮件转任务 | **按需启用** | `business_rules`、`workflows`、`scheduler`、`shipping_carriers`、`translations`、`sync_excel`、`messages` + `inbox_ops`；报价导入已由 `sourcing` 承担 |
| EU 合规（EUDR） | **不启用** | 不卖欧盟，品类不涉及 |

## 自建模块对官方模块的消费清单

自建模块不复制官方能力，只从两处接官方契约：**界面层的 API 调用**、**服务端的实体/命令/工具函数**。
隐藏页面（`routes.pages`）不影响这些接口；**停用模块才会**。改官方模块的启用状态或页面路由前先看这里。

### 界面层的 API 消费

| 消费方 | 官方接口 | 用途 | 位置 |
|---|---|---|---|
| `trade_docs` | `GET /api/parties/options`（自建） | 合同/发票的对方选择器 | `trade_docs/components/formOptions.ts` |
| `products`、`purchasing`、`trade_docs`、`platform_ops`、`internal_sales`、`sourcing`、`export_finance` | `GET /api/currency_policy/currencies`（自建） | 币种下拉（数据仍取自官方 `dictionaries`） | `currency_policy/lib/clientOptions.ts` 统一加载器 |
| `products`（自有商品库） | `GET/POST/PUT /api/catalog/*`（官方） | 商品/变体/价格/分类的读写（经官方命令与 CRUD 路由） | spec 2026-10-10 Phase 1–2 |
| `cross_border` | `GET /api/wms/warehouses`、`GET /api/wms/locations` | 发运单的仓库/库位选择器 | `cross_border/components/ShipmentForm.tsx` |
| `products`（分发对话框）、`internal_sales`（买方选择器） | `GET /api/directory/organization-switcher` | 组织选项（分发目标 / 内部买方），共享装配 `src/lib/orgs/organizationOptions.ts` | `products/components/DistributeProductsDialog.tsx` 等 |

### 服务端契约消费（实体 / 命令 / 工具函数）

| 消费方 | 官方契约 | 形式 | 位置 |
|---|---|---|---|
| 本 app 全部商品面 | `catalog.products.*` / `catalog.variants.*` / `catalog.prices.*` / `catalog.priceKinds.*` / `catalog.categories.*` | peer 命令 / API（**不直接写表**） | spec 2026-10-10 |
| `cross_border` | `wms.inventory.receive` | 命令：收货入账并回写采购单行已收数量 | `cross_border/commands/shipments.ts` |
| `products`（分发） | `directory:organization` 实体 | 直接 import：写入前校验目标组织 | `products/commands/distribution.ts` |
| `currency_policy` | `currencies:currency`、`dictionaries:dictionary*`、`directory:organization` | 直接 import 实体 | `currency_policy/lib/apply.ts` |
| 自绘商品面（自有商品库 / 供应商产品库）、`purchasing`、`sourcing` | `dictionaries:dictionary*` + `normalizeDictionaryValue` | 币种码校验 | 各模块 `lib/currencyDictionary.ts` |
| `scope_guards` | `auth:*` 实体 + `RbacService` + directory scope 工具 | 拦截越权写入 | `scope_guards/lib/scopeGuard.ts` |
| `sourcing`、`trade_docs` | `attachments`（服务与实体） | 报价源文件与单证附件 | 各模块命令/路由 |
| `sourcing`、`trade_docs` | `staff/lib/timesheets-reports/xlsx`（`buildXlsx`） | Excel 模板 / 合同打印件 | `sourcing/api/template/route.ts`、`trade_docs/lib/contractTemplate.ts` |
| `trade_docs` | `dashboards/lib/exactDecimal` | 金额精确计算（BigInt） | `trade_docs/lib/money.ts` |

**反向约束**：耦合方向永远是「自建 → 官方」。官方 `requires` 闭包：`sales requires catalog, customers, dictionaries`；
`wms requires catalog, sales, feature_toggles`。因此「页面不用」≠「模块能停用」——`catalog` 被 `sales`/`wms` 依赖，
且现在是商品主存储，任何变更不得破坏其保留契约（see `.ai/specs/2026-09-21-catalog-customization-and-eject-decision.md`）。

## 数据主源与同步约定

| 数据 | 真源 | 本系统的角色 | 冲突处理 |
|---|---|---|---|
| 商品身份 / 变体 / 三档价格 / 分类 | **官方 `catalog`** | 唯一存储；app 自绘两页 UI（供应商库 + 自有商品库）经命令读写 | 唯一键冲突 409；软删占码 |
| 供应商报价 | 本系统 `sourcing` | 唯一来源；报价行保留原始 Excel 行与来源文件；提升写 catalog + purchase 档价格 | 乐观锁 409；已提升行重复提升只计 `skipped` |
| 供应商货品库 | 本系统 `purchasing.purchasing_supplier_products` | 供应商方向唯一来源：货号/原始品名/供货价+折扣（`price_kind × 币种 × 起订量`）/MOQ/报价来源/候选状态/供应商表原文组；指针 `catalog_product_id` | 货号唯一（含软删）；报价单仍是谈判文档、采购单行价仍是谈判值 |
| 采购与付款 | 本系统 `purchasing` | 唯一来源 | 并发编辑 409，不静默覆盖 |
| 内部销售单据 | installed `sales` | 唯一来源（界面自建） | 同上 |
| 收汇与出口退税 | 本系统 `export_finance` | 唯一来源；柜级退税分摊额读时派生 | 按锚点 upsert；取消的发运单拒绝建档案 |
| 平台库存 / 上下架 | **平台** | 只拉取镜像，默认不回写 | 差异进对账，不静默覆盖 |
| 海外仓（3PL）库存与出入库 | **本系统 `wms` 账** | 3PL API 仅作同步输入 | 差异进对账队列，账面为准 |
| 订单档案（业务/财务两种输出） | **派生视图**，无自有表 | 只读聚合（`/api/export_finance/order-files`、`/container-files`） | — |

## 已定决策与依据

### 现行

| 决策 | 结论 | 依据 |
|---|---|---|
| **商品单一存储**（2026-10-10） | **官方 `catalog`** 是商品身份/变体/价格/分类的唯一存储；app 只保留自绘 UI 与命令壳；供应商产品库保留为供应商方向并改指 `catalog_product_id`；SKU 手填、发号停用；品类用 catalog 分类树（可选、不再自动建）；分发副本在 catalog 上重造；开发期不写迁移、重建开发库 | spec → [`.ai/specs/2026-10-10-catalog-single-store.md`](../../.ai/specs/2026-10-10-catalog-single-store.md)；owner 2026-10-10 |
| 商品引用与文档纪律 | 单据引用商品 = 标量 id + 冻结快照；文档与代码同 PR、状态双写、写结论带可重跑凭据；owner 口径清单见 [`business-conventions.md`](./business-conventions.md) | `docs/README.md`；`AGENTS.md` |
| 交易对手方主数据 | **自建** `parties`（2026-09-22）；`customers` 保留启用但不再作为新建业务的对方来源 | spec → [`.ai/specs/2026-09-22-app-owned-party-master.md`](../../.ai/specs/2026-09-22-app-owned-party-master.md) |
| 自产 / 委托加工商品 | **当普通商品建库，不新增链路**：与自购共用同一套商品与三档价格；货源只影响「品牌 / 型号 / 成本价」的填法；发运/收货仍要求一张采购单（工厂建成供应商）+ 商品的目录变体 | owner 2026-09-23；[`business-conventions.md`](./business-conventions.md) C-32…C-34 |
| 公司订单根单化 | **根单实体 + 关联表**：工作台行 = 公司订单，详情页关联三类子单、下游按子单并集只读；历史渠道内销售单 1:1 补录 | owner 2026-10-09；spec → [`.ai/specs/2026-10-09-company-order-root.md`](../../.ai/specs/2026-10-09-company-order-root.md) |
| 根单持有 | 订单描述（`product_category` 字典码）、采购负责人（id + 冻结快照）、单证槽位由根单持有；子单只读镜像，改回根单；**后续新字段沿用** | owner 2026-10-10；同上 spec 第十轮 |
| 金额口径 | 统一 2 位：财务金额/合同金额 = `HALF_UP(数量×单价, 2)`；单价恒 4 位；量化走 BigInt 引擎单点（不用 `toFixed`） | spec → [`.ai/specs/2026-09-28-money-scale-2dp-unification.md`](../../.ai/specs/2026-09-28-money-scale-2dp-unification.md) |
| 国内是否建仓 | **不建**（不拼柜、无退货回国）；在途挂发运单 | 业务口径 |
| 采购付款 | 定金 + 尾款，可全付可部分；无审批、无账期；页面显示**实际口径**（已登记付款合计） | owner 2026-10-10 补充 |
| 业务模块能否随业务增删 | **可以**，纯注册表行为、不动数据 | [收缩实测](../../.ai/analysis/2026-09-21-disable-official-chain-drill.md) |
| 报价导入的 AI 兜底边界 | 默认关闭；只在操作员点击时发送「表头 + 前 3 行样例」；无 Key 时置灰且接口 503 | `src/modules/sourcing/README.md`「AI mapping — data boundary」 |
| 后台菜单分组 | 十四组（公司订单 / 财务 / 经营概览 / 仓储与库存 / 平台运营 / 数据同步 / 基础数据 / 系统 + 出口业务五组 + 采购等），组 id 复用既有键、顺序由 `overrides.nav.groupOrder` 声明一次；**一个销售入口 = 一种贸易类型** | [`navigation.md`](./navigation.md)；owner 2026-09-29/09-30 |
| 合同为主体的单据关联 | 出口业务以购销合同为主体：发运单/装箱单/PI/CI 关联合同；合同再以 1:N 关联表挂采购单与销售单 | spec → [`.ai/specs/2026-09-29-contract-linked-export-documents.md`](../../.ai/specs/2026-09-29-contract-linked-export-documents.md) |
| 组织可见性 | 总部看全部下级；分公司看不到上级与同级 | 平台机制 → [`multi-company-org-model.md`](./multi-company-org-model.md) |
| 语言 | 中文 + 英文先行，其他语言后续追加 | 多国分公司；单语言文案规则见 C-01 |

### 已被取代（保留记录）

| 决策 | 原结论 | 被谁取代 |
|---|---|---|
| 商品主数据自建 `products`（2026-09-22） | 官方 `catalog` 只作可选链接的平台注册表 | 2026-10-10 单一存储决策（spec 2026-10-10） |
| 产品线 / 自建品类树（2026-09-23 定名与合并） | 产品线平铺、品类树唯一层级 | 同上（两表删除；品类用 catalog 分类树，不再自动建） |
| 自建变体与 wms 轮（2026-09-22，Phase 3 待定） | 是否把库存落点切到自建变体待定 | 同上（库存落点 = catalog 变体，问题关闭） |
| 编码规则 / 发号台账 / 品牌码表（2026-09-24） | 发号器 + 三态解析 + 旧码别名 | 同上（停用；别名表保留；重做另立切片） |
| 供应商产品库与商品主数据的关系（Q-SPL-001 / D1） | 产品库优先、商品按需同步、`product_id` 回填 | 同上（指针改 `catalog_product_id`；建商品档案一次产生 catalog 商品 + 变体） |
| 分发副本用 `source_product_id`（2026-09-28） | 复制进目标组织、用 `source_product_id` 回指 | 同上（在 catalog 上重造，语义保留） |
| 采购单引用自建 `products` 优先（2026-09-22） | `purchasing_purchase_order_lines.product_id` → `products_products` | 同上（改指 catalog 商品） |

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
| 商品 | 一件可售/可入库的货 = catalog 商品 + 至少一个启用变体；**外购、自产、委托加工共用同一套** |
| 变体 | 商品的 SKU 维度（catalog 变体）；库存按变体入账，收货无变体即 422 |
| 三档价 | purchase（成本价）/ internal（内部结算价）/ export（对外销售价），落 catalog 价格（price kind × 币种 × 起订量） |
| 供应商产品库 / 供应商货品 | 某家供应商卖的商品清单：`purchasing_supplier_products`，键 =（供应商, 货号）；装供应商方向字段；候选期即存在 |
| 供应商货号 | 产品库行的唯一键（同一供应商内永久占用，含软删行）；采购单与发运单上展示 `item_no ?? supplier_sku` |
| 建商品档案（原「同步为商品」） | 产品库行 → catalog 商品 + 默认启用变体 + 回填指针；幂等（已建档返回 skipped） |
| 供应商表原文组 | 产品库行上"供应商印的"那组字段（原始品名/规格/G.W./N.W./体积/装箱/尺寸）——与我方申报值分开，不双向同步 |
| 提升 | 把报价单勾选行写进供应商产品库（并可在建档时写 catalog + purchase 档价格）的动作 |
| 报价单 / 供应商报价 | 供应商在某一时点给出的价格集合（`sourcing_quotes`，单号 `SQ-<年>-<4位>`）；是谈判文档 |
| 报价变更分析 | 对已确认/归档报价的只读版本对比（新增/消失/涨价/降价 + 三种诚实态），货号时间线 |
| 版式指纹 | 工作表名 + 归一化表头的哈希；命中已保存的列映射模板 |
| 订单描述 | `product_category` 字典码，由公司订单根单持有（原属采购段的字段） |
| 内部结算价 | 报给海外子公司的价格（三档价中的 `internal`） |
| 旧码别名 | `product_codes_aliases`：手填/改码后旧码仍能被搜索命中 |

### 业务术语 ↔ 系统单据（业务说的 X 在系统里叫什么）

| 业务说的 | 系统里是 | 承载 / 状态 |
|---|---|---|
| 采购订单（PO） | 采购单 `/backend/purchasing/orders`，单号 `PO-<年>-<4位>` | `purchasing_purchase_orders` |
| 内部销售订单（PO） | 「总部 → 分公司」的销售订单，界面在 `internal_sales`（引擎 installed `sales`），单号 `ORDER-` | installed `sales` 单据 |
| 形式发票（PI） | `/backend/trade-docs/proformas`，单号 `PI-<年>-<4位>` | `trade_docs_documents(kind='proforma')` |
| 商业发票（CI） | `/backend/trade-docs/commercial-invoices`，单号 `CI-<年>-<4位>`；明细按销售分摊（回退采购分摊）汇总 | `trade_docs_documents(kind='commercial')` |
| 税务发票 | 税务发票台账 `/backend/trade-docs/invoices`，销项单号 `TI-<年>-<4位>` | `trade_docs_invoices` |
| 供应商报价 | 供应商报价单（SQ）`/backend/sourcing/quotes` | `sourcing_quotes` |
| 公司订单 | 订单工作台 `/backend/orders` → `/backend/orders/<companyOrderId>`，单号 `CO-<年>-<4位>` | `order_hub_company_orders` + `order_hub_company_order_links` |
| 合同 | 购销合同（采购 `PC-` / 销售 `SC-`）`/backend/trade-docs/contracts` | `trade_docs_contracts` |
| 发运单 / 柜 | 发运单 `/backend/cross_border/shipments` | `cross_border_shipments` |
| 装箱单（PL） | 出口单证 + 带明细的单据；台账 `/backend/cross_border/packing-lists` | `cross_border_export_documents(_lines)` |
| 商品主数据 / 商品档案 | 自有商品库 `/backend/products/items`（**数据在官方 `catalog`**） | `catalog_products` / `catalog_product_variants` / 价格 |
| 供应商产品库 | `/backend/purchasing/supplier-products` | `purchasing_supplier_products` |

## 开放问题

| 问题 | 影响 | 谁来定 |
|---|---|---|
| SKU 自动编码何时重做、以什么形态（spec Phase 4） | 影响编码纪律与批量建档效率；手填期间靠唯一校验 + 别名表 | 业务 + 技术 |
| 平台与货代的对接形态：API 直连、平台导出文件，还是第三方 ERP | 决定 `platform_ops` 连接器形状与凭证存放 | 业务 + 技术 |
| 提醒规则（触发、阈值、收件人、渠道） | 影响通知与定时作业设计 | 业务 |
| 货代是否提供实时轨迹 | 决定用实时状态还是里程碑模型 | 业务（问货代） |
| Linear 孤儿 issue 的界面清理（历史需求 ID 变更时） | 同步不删除；需人工在 Linear 处理 | 业务 + 技术 |

## 验证方式

1. **模块清单一致**：`grep -n "id: '" src/modules.ts` 与 `.mercato/generated/enabled-module-ids.generated.ts` 对齐。
2. **主源一致**：`grep -rn "products_products" src/` 只应命中迁移历史/注释/测试（大改完成后为 0）；商品读写统一经 `catalog.*` 命令/API。
3. **入口树一致**：`src/modules/nav_shell/lib/navTree.ts` 的 `NAV_TREE` 与 [`navigation.md`](./navigation.md) 的树形一致；`navTree.coverage.test.ts` 全绿。
4. **状态双写**：spec 的 `**Status**`、[`../plans/README.md`](../plans/README.md) 状态板、模块 README 三处同步。
5. **约定对照**：本文件的决策与 [`business-conventions.md`](./business-conventions.md) 的条款不冲突；冲突即为缺陷。
6. **spec 对齐**：`purchasing` → [`.ai/specs/2026-09-21-purchasing-module.md`](../../.ai/specs/2026-09-21-purchasing-module.md)；商品与单据 → [`.ai/specs/2026-10-10-catalog-single-store.md`](../../.ai/specs/2026-10-10-catalog-single-store.md)；`sourcing` → [`.ai/specs/2026-09-22-supplier-quotation-import.md`](../../.ai/specs/2026-09-22-supplier-quotation-import.md)；公司订单 → [`.ai/specs/2026-10-09-company-order-root.md`](../../.ai/specs/2026-10-09-company-order-root.md)。
