# `purchasing` — 供应商、采购单、阶段付款

app 自有模块。跨境采购的**唯一采购台账**：供应商主数据 → 采购单（含行）→ 定金/尾款等阶段付款 →
收货回写（数量进 `wms`）。需求见 [`docs/prd/cross-border-erp.md`](../../../docs/prd/cross-border-erp.md)，
阶段证据见 [`docs/plans/cross-border-erp.md`](../../../docs/plans/cross-border-erp.md)。

> **2026-10-10 单一商品存储改造**（[spec](../../../.ai/specs/2026-10-10-catalog-single-store.md)）：
> 商品身份/变体/价格/分类全部落官方 `catalog`，本模块的**供应商产品库保留为供应商方向**的表——
> 它的商品指针由 `product_id` 改名为 **`catalog_product_id`**（迁移 `Migration20261010081055_sourcing.ts`，
> 放在 sourcing 链内，见 `.ai/lessons/cross-module-rename-migration-ordering.md`）；采购单行不再有 `product_id`，
> 只引用 `catalog_product_id` 或 `supplier_product_id`。「建商品档案 / 同步字段到商品」改为经
> `products/lib/store.ts` 写 catalog；SKU 手填（发号面板与 `/api/product_codes/*` 已删除，旧码只登记别名）。

## 表面

| 层 | 内容 |
|---|---|
| 实体（`data/entities.ts`） | `PurchasingSupplier` / `PurchasingSupplierProduct` / `PurchasingSupplierProductPrice` / `PurchasingPurchaseOrder` / `PurchasingPurchaseOrderLine` / `PurchasingPurchasePayment` / `PurchasingPurchaseOrderDocument` → 表 `purchasing_suppliers` / `purchasing_supplier_products` / `purchasing_supplier_product_prices` / `purchasing_purchase_orders` / `purchasing_purchase_order_lines` / `purchasing_purchase_payments` / `purchasing_purchase_order_documents` |
| API | `GET|POST|PUT|DELETE /api/purchasing/suppliers`、`/purchase-orders`、`/purchase-orders/documents`（**2026-10-10 起无 UI 入口**：路由与命令保留、表已清空、页面不再读取）、`/purchase-orders/payments`（`makeCrudRoute`；payments 的 PUT 是绑定付款凭证）；`GET /api/purchasing/purchase-orders/lines`（只读行面，行只经订单命令写入）；`POST /api/purchasing/purchase-orders/transitions`（阶段流转：同路径的 GET 列表只为 CRUD 工厂解析作用域，不是 UI 契约）；供应商产品库：`GET|POST|PUT|DELETE /api/purchasing/supplier-products`、`POST …/import`、`POST …/promote`、`GET|PUT /api/purchasing/supplier-products/prices` |
| 命令 | `purchasing.suppliers.{create,update,delete}`、`purchasing.supplier-products.{create,update,delete,import-from-quote,promote,replace-prices}`、`purchasing.purchase-orders.{create,update,delete,transition,apply-receipt}`、`purchasing.purchase-payments.{record,attach,delete}`、`purchasing.order-documents.{create,update,delete}`（**2026-10-10 起无 UI 入口**，契约保留） |
| 后台页面 | `/backend/purchasing/suppliers`（列表/新建/编辑）、`/backend/purchasing/supplier-products`（列表/新建/编辑：字段分组、供货价、商品图片）、`/backend/purchasing/orders`（列表/新建/详情/编辑：行、阶段付款）。列表列＝单号 / 供应商 / 状态 / **订单金额** / 预付款金额 / 尾款金额 / **预计交货日期**，行操作＝「打开」（详情）；公司订单关联列**先算后显**（页面加载时一次 `order_hub/orders/links?refIds=` 批量反查）且是**菜单里的一项**：行操作只有一个「⋯」菜单（`ActionsDropdown`），「打开」常驻；已关联＝菜单项「打开公司订单」直达根单，未关联＝菜单项「未关联公司订单」置灰不可点，读不到（无 `order_hub.view` 的 403）＝连该项都不出现（不给错误状态）。详情页只有本单自己的工作面（抬头摘要 + 行 + 付款，抬头带「打开公司订单」）；「单证」区块是**根单「单据与文件」的只读镜像**（`GET /api/order_hub/orders/fields` 的 `documents.bySlot`：槽位文件带预览/下载、子单来源带深链），录入仍只在根单 |
| 事件 | `purchasing.supplier.{created,updated,deleted}`、`purchasing.supplier_product.{created,updated,deleted}`、`purchasing.supplier_product_prices.updated`、`purchasing.purchase_order.{created,updated,placed,shipped,received,closed,cancelled,deleted}`、`purchasing.purchase_payment.{recorded,deleted}`；单证 CRUD 侧效另发 `purchasing.purchase_order_document.{created,updated,deleted}`（`commands/orders.ts` 的 `purchaseOrderDocumentCrudEvents`，实体 `purchase_order_document`；这三个 id 目前未登记在 `events.ts`）；本模块还**订阅** `order_hub.company_order.order_fields_updated`（根单的订单描述/采购负责人镜像到采购单，见「根单持有字段与镜像订阅」） |
| 权限 | `purchasing.suppliers.view|manage`、`purchasing.supplier-products.view|manage|promote`、`purchasing.orders.view|manage`、`purchasing.payments.manage` |
| 命令公共件 | `commands/shared.ts`：本模块唯一的 `ensureScope`（可信作用域、缺组织 fail closed）与产品库的实体 id / 资源类型 / 事件与索引桥配置 |
| 迁移 | `migrations/Migration20260921081717_purchasing.ts`（`purchasing_suppliers`）、`Migration20260921085348_purchasing.ts`（订单 / 行 / 付款三表）、`Migration20260921100702_purchasing.ts`（付款 `attachment_id`）、`Migration20260922073530_purchasing.ts`（行 `product_id` + `catalog_product_id` 放开 NOT NULL）、`Migration20260922082559_purchasing.ts`（`purchasing_purchase_order_documents` 表 + 单头 `business_number`/`product_category`/`owner_*`/`customer_*`）、`Migration20260922103027_purchasing.ts`（行 `supplier_product_id`）、`Migration20260924041621_purchasing.ts`（供应商 `brand_value`）、`Migration20260928073630_purchasing.ts`（订单/行/付款金额列收窄为 `numeric(18,2)`）、`Migration20261008042809_purchasing.ts`（采购单来源销售订单三列 + 索引）、`Migration20260929063626_purchasing.ts`（`purchasing_supplier_bank_accounts` 供应商银行账户表）；产品库的表由 `sourcing` 侧的迁移建出并在 `Migration20260923043000_sourcing.ts` **改名为 `purchasing_*`**（含 `Migration20260923044000_sourcing.ts` 的 pkey 改名），数据原样保留；**单一存储改造**：`Migration20261010081054_purchasing.ts`（采购行 drop `product_id`）+ `Migration20261010081055_sourcing.ts`（库行 `product_id` → `catalog_product_id`，放在 sourcing 链内以避开模块顺序陷阱） |

## 采购单的来源销售订单（2026-10-08）

采购单可以挂在一张**销售订单**上——「这张订单的采购单是哪些」由此可查（订单详情 hub 的采购分区、
订单工作台的「采购」阶段列都读它）。

| 事项 | 口径 |
|---|---|
| 列 | `source_sales_order_id` / `source_sales_order_kind` / `source_sales_order_number`（都可空；索引 `purchasing_purchase_orders_source_sales_order_idx` 前缀是 `organization_id, tenant_id`） |
| 谁能写 | 只有**销售订单 id**：`kind`（`internal_sales_order` / `external_sales_order`）与 `number` 在命令内由销售订单**推导并冻结**，客户端直写会被忽略 |
| 解析规则 | 命令内 scoped 只读 `sales_orders`（同租户 + 同组织 + 未软删），经 `sales_channels.code` 判定贸易类型；解析不到 → **422 `source_sales_order_not_found`**（跨组织与不存在返回同一码：不确认他组织记录的存在） |
| 更新语义 | 不出现即不改；显式 `null` 清空三列；来源是**链接不是商务条款**，因此已下单（非 `draft`）也可改 |
| 列表 | `GET /api/purchasing/purchase-orders?sourceSalesOrderId=<uuid>` 只回该销售订单的采购单；出参带三个 camelCase 字段 |
| 新建预填 | `/backend/purchasing/orders/create?orderKind=<kind>&orderId=<uuid>`：来源已填、行按销售订单行复制（**只复制商品引用与数量，不复制销售单价**——那是客户价）；供应商选定后自动带出该供应商供货价（未手填的行）。从公司订单的「新建采购单」进入时另带 `?companyOrderId=`（建好后自动挂回根单并跳回），带出根单的默认供应商；表单**没有**订单描述 / 采购负责人两格——两者由根单持有并镜像下来（见下节） |
| 页面 | 列表页带可清除的来源筛选横幅；详情页的抬头摘要格只读显示来源单号并链到该销售订单（`external_sales_order` → `/backend/external-sales/orders/<id>`，否则 `/backend/internal-sales/orders/<id>`） |
| 纯函数 | `lib/sourceSalesOrder.ts`（参数解析、行映射、kind 映射，客户端与服务端共用）+ `lib/sourceSalesOrderReads.ts`（scoped 只读与 422 前置） |

## 根单持有字段与镜像订阅（2026-10-10）

**订单描述**（字典 `product_category` 的 code）与**采购负责人**（人员账号 + 冻结快照 `owner_snapshot`）只由
**公司订单根单**持有：采购单上的两列是根单的投影，采购侧一律只读。

| 事项 | 口径 |
|---|---|
| 唯一写入口 | 根单（`order_hub`）。两个采购表单（新建/编辑）**没有**这两格，也不把它们放进 payload；`buildPurchaseOrderPayload` 只构建本模块自己拥有的键 |
| 只读显示 | 详情页抬头摘要格读采购单自身投影（镜像保证与根单一致）；已挂根单时「订单描述」格旁给「去公司订单修改」链接（根单 id 由 `GET /api/order_hub/orders/links?refId=<采购单 id>&kind=purchase_order` 反查，读不到就不显示链接——无 `order_hub.view` 的 403 只是没有入口，不影响页面） |
| 镜像事件 | `order_hub.company_order.order_fields_updated`（载荷 `{ id, tenantId, organizationId, productCategory, ownerUserId, ownerSnapshot, purchaseOrderIds[] }`），订阅者 `subscribers/mirror-root-order-fields.ts`（`purchasing:mirror-root-order-fields`，`persistent: true`） |
| 写入语义 | 按 `tenantId` + `organizationId` + `id ∈ purchaseOrderIds` 覆盖写三列（幂等）；载荷**缺席**的字段不写（只有显式值 / 显式 `null` 才落），因此只报一个字段的事件不会清掉另一个。写失败只记日志不抛，一条失败不中断同批其余采购单 |
| 表单的锁定语义 | 已下单（非 `draft`）订单的可改集合（`POST_PLACEMENT_FIELDS`，镜像 `commands/orders.ts` 的 `POST_PLACEMENT_UPDATE_FIELDS`）不含这三列——锁单保存不会把镜像值改回旧值 |
| 列表 | 列＝单号 / 供应商 / 状态 / 订单金额 / 预付款金额 / 尾款金额 / 预计交货日期；「打开公司订单」是**行「⋯」菜单里的一项**（`components/purchaseOrderRowActions.ts` 构建，与常驻的「打开」同一个菜单，`TEST-037` 钉住三种菜单），按上面同一条反查跳 `/backend/orders/<id>`；未关联＝该项置灰（`list.actions.noCompanyOrder`），读不到＝该项不出现，不跳空页、不报错、不影响列表本身 |
| 预付款/尾款金额 | **实际口径**：该单已登记付款里 `stage='deposit'` / `stage='balance'` 的合计（`lib/orderTotals.ts` 的 `stagePaidTotals`，与 `paidTotal`/`outstanding` 同一批 payment 行在 `afterList` 里算出），不是计划值（计划值仍是 `depositPercent`/`depositAmount`）；`other` 阶段不计入这两列 |

- 关联区块（来源订单 / 关联合同 / 关联发运单）**不在采购单详情页**：来源单号回到抬头摘要格，合同与发运单
  的关联面归各自模块与公司订单。`cross_border` 的 `?purchaseOrderId=` 过滤保留（发运单列表自己的入口）。

## 商品引用：catalog 单一存储（2026-10-10）

采购单行引用**官方 catalog 商品**（列 `purchasing_purchase_order_lines.catalog_product_id`；旧的 `product_id` 列已随单一存储改造删除），
选择器读 `GET /api/products/items`（按当前组织收敛），行的显示快照（`product_snapshot` 的 title/sku/unit/model/spec）在写入时从该商品冻结。

- **一行恰好一个商品引用**（互斥且不可混用）：
  - `supplier_product_id` → **供应商产品库行**（`purchasing_supplier_products`）。采购员在行编辑器里从**一个搜索框**里选品：
    该供应商的产品库与商品库同时搜，产品库结果排在前面，每条建议的**标签以来源开头**（`本供应商产品库 · 货号 — 品名` / `商品库 · SKU — 品名`，键 `lines.source.*`）；
    来源 2026-09-24 起放标签首段（owner 实测反馈「分不清哪个是供应商哪个是自建产品」），标签下面那行只剩「未建档」这类代价提示。
    产品库行**已建档**时按 catalog 商品解析；未建档时行上 `catalog_product_id` 为 null，只冻结供应商快照（`title`/`sku`/`unit`/`spec` + `supplierSku`）。
    **同行的产品库行必须属于本单供应商**，否则 **422 `supplier_product_supplier_mismatch`**。
  - `catalog_product_id` → catalog 商品（上面那段）。
  - 两个都缺 → 400；两个同时出现 → 400。
- **编辑草稿会重新解析**：保存草稿时行会按现在的规则重新解析，所以产品库行**后来**建档后，再保存一次草稿就会自动补上 `catalog_product_id`。
  冻结的是 `product_snapshot` 的内容，不是解析规则；已下单（非草稿）的单不重算。
- **`supplierSku` 是快照键**：产品库行的 `item_no ?? supplier_sku`，展示用，随快照透传到发运分摊（历史快照没有该键，读侧按 null）。
- **收货需要变体**：`wms.inventory.receive` 按变体级入账，发运分摊时会校验该 catalog 商品是否有**启用的变体**——没有变体的商品可下单但**不能发运/收货**，
  报错直接说明要先给这个商品建一个启用的变体；变体在自有商品库页（`/backend/products/items`）维护。
- 供应商列表的行操作里有「产品库」入口，直达 `/backend/purchasing/supplier-products?supplierId=<id>`（实体与页面都归本模块）。

## 供应商产品库（产品明细表）

`sourcing_supplier_products` 在 2026-09-23 **整体移交到本模块**：实体、命令、API、页面、权限、事件
（表已改名为 `purchasing_supplier_products`，数据原样保留；报价模块只通过本模块的命令喂数据）。
它是**供应商侧的货品清单**：供应商货号（`supplier_sku`）、原始货号、供应商原始商品名、**我们自己的**
中/英文品名、规格描述、申报要素（`declaration_elements`）、单位、HS CODE、MOQ、Qty/Box、单件毛重
（`unit_gross_weight`，供应商表的 G.W.）、单件净重（`unit_net_weight`，N.W.）、单件体积
（`unit_volume`，cm³）、产品尺寸（界面名；字段仍是 `inner_packing`，名字来自供应商表的「内箱尺寸」列）、
商品图片、备注；价格在 `purchasing_supplier_product_prices`。

| 关注点 | 约定 |
|---|---|
| 单件物理数据（2026-09-24） | 表单分组「装箱、重量与体积」= 每箱数量 + 单件毛重（G.W.）+ 单件净重（N.W.）+ 单件体积 + MOQ。毛重/净重/体积三个字段**都可留空**（供应商表印了才填），单位固定 kg / **整数 cm³**（`numeric(16,0)`，表单显示 `88642` 而非 `88642.000000`）；毛重与净重都是**单件**口径（整箱口径 2026-09-23 已删），体积按供应商印的数照录、不由产品尺寸推算。建商品档案时 `unitNetWeight`/`unitGrossWeight`/`unitVolume` → catalog 商品的自定义字段 `unit_net_weight`/`unit_gross_weight`/`unit_volume`（同样是 cm³、同样只记录不推算） |
| 商品 SKU 与品牌（2026-09-24；2026-10-10 起 SKU 手填） | 「商品 SKU」= 我方编码（本供应商下唯一，建档时写进 catalog 商品的 `sku`）；「供应商货号」= 对方表格上印的号。**编码发号已停用**（单一存储改造）：`/api/product_codes/generate|parse` 与表单里的编码面板已删除，SKU 由操作员**手输**；旧码仍可搜索，靠 `product_codes_aliases`（`target_kind='product'`）在商品/产品库列表搜索里兜底。手输码要能「建商品档案」必须满足 `SKU_PATTERN`（`^[A-Za-z0-9._\-/]{1,64}$`；库行本身只校验 1–120 字符），否则建档 422。品牌取「行的品牌 → 供应商默认品牌」（`brand_value`，字典 `product_brand`，字典由 `product_codes` 播种、业务在字典库维护）；**默认品牌是字典值、写入即校验**（`purchasing.suppliers.create/update` → `assertDictionaryValue`），清空始终允许、改成**新**值才校验。**迁移落点**：`purchasing_suppliers.brand_value` 在 purchasing 的迁移里加；`purchasing_supplier_products.brand_value` 由 **sourcing** 的迁移加（该表由 sourcing 改名而来，模块顺序 purchasing 在前）——见 `.ai/lessons/cross-module-rename-migration-ordering.md` |
| 唯一键 | `(tenant, organization, supplier_id, supplier_sku)`，**含软删行**（货号永久占用）：查重必须一起查已删行，否则唯一索引把可读的 409 变成 500 |
| 价格 | **表单只录一条供货价**（2026-09-24，owner 在新建页反馈「只有一种类型…新增多条好像意义不大了」）：`币种 + 单价 + 折扣`，填的就是该货号在售的**基准** `supplier_cost` 行（列表列与建档路径解析的那一行，比法唯一实现于 `lib/priceKinds.ts` 的 `comparePriceBaseRows`/`pickBasePriceRow`）；其余行（其它币种/起订量档、已停用的旧价、历史 `company_offer`）在「其它价格行（只读）」里列出并**原样提交回去**，所以保存不改写历史；已停用的价绝不回填（否则下次保存会把它悄悄复活）；清空单价 = 停用该价（不删除）。数据层仍是价格表：一行 = `price_kind × 币种 × 起订量`；`supplier_cost` = **供应商供货价**（供应商报给我们的价）。整组提交（`replace-prices`），载荷里消失的行**停用不删**，币种必须存在于币种字典。**折扣在产品库行上**（`purchasing_supplier_products.discount_percent`，`numeric(3,0)`，**0–100 的整数**、可空）：同供应商不同货号折扣不同，所以按货号一条，不是按价格行、也不是按供应商；**不收小数**（owner 2026-09-24 在新建页反馈「价格-折扣，只有使用整数，不需要保留小数点」；与 `unit_volume` 同一种收窄——0 位小数的 `nullableDecimalSchema(0)` + `Migration20260924054410_sourcing` 的 `numeric(3,0)`，表单 `inputMode="numeric"`，库里读回 `5` 而不是 `5.0000`）；折后价 = 单价 ×（1 − 折扣），六位小数，唯一实现 `lib/priceKinds.ts` 的 `netUnitPrice`（表单预览、列表列、建档写入共用）。`company_offer` = **本公司报价**：2026-09-24 起**不再在产品库录入**（表单只为新行提供供货价，已存在的行照常显示与提交），列表的该列改为只读展示**已建档商品**的 `internal`（内部结算价）档基准价——我们的对外报价是商品属性，主流 ERP（Odoo supplierinfo 的 price+discount 对 list_price/pricelist、SAP 采购信息记录对销售条件）都不把它挂在供应商记录上 |
| 单位 | 读字典 `supplier_product_unit`（`setup.ts` 播种，11 个海关常用码；`value` = 码、`label` = 纯中文名）；表单走全 app 唯一的 loader `products/lib/unitOptions.ts`，它把选项渲染成 `PCS — 件`（码在前，因为记录存的是码），字典没有的码仍可手输 |
| 图片 | `image_attachment_ids` 有序数组；文件走 `attachments`（`entityId = purchasing:purchasing_supplier_product` + 行 id），**先建行后绑图**，绑定走行更新（受乐观锁保护）；解绑只删 id，文件留在附件库。**新建页**先选图（本地 blob 预览）再点保存：提交时先建行、再上传、再带版本回写列表，一步完成；编辑页仍是选中即上传。图片失败不回滚行，页面跳到该行的编辑页提示重试 |
| 建商品档案（原「同步为商品」，2026-10-10 起写 catalog） | `purchasing.supplier-products.promote` 按 SKU 建/更新 **catalog 商品**（经 `products/lib/store.ts`：`createStoreProduct`/`updateStoreProduct`），`name_zh ?? name` → 商品名、`name_en` → 英文名；价格优先用产品库里的 `supplier_cost`（没有才回退到最新报价行）——**两条路径都先打折**，写进 `purchase`（成本价）档的是**折后价**（报价行没有自己的折扣，用的是产品库行上那个）；整组价格提交以保住 `internal`/`export`；幂等（已建档返回 `skipped`），SKU 属于已软删商品时 422（`catalog_products.sku` 的唯一性含软删行，store 的可见读不到它，故命令另做一次原始探测）。列表行操作的文案是「**建商品档案**」，确认框写明"建过档才能发运、收货"；回填的是库行的 `catalog_product_id` |
| 关联已有商品 / 换绑 / 解除关联（2026-09-23；2026-10-10 指向 catalog） | `purchasing.supplier-products.link`：`{ id, productId }`（request/response 的 `productId` 键名保留），`productId: null` = 解除。**只写 `catalog_product_id` 这一列**，不改商品任何字段与价格——供应商编码 ≠ 我们 SKU 时，这是唯一不产生重复商品档案的做法。目标商品的**作用域与存活检查在写这一列的同一个事务里**（`select … for update` 锁住 `catalog_products` 行；这是跨模块标量 ID、没有外键，所以只能这么做）：跨组织 → 404 `product_not_found`，已软删（或在选择与写入之间被删）→ 422 `product_deleted`，两种都不落任何写入 |
| 同步字段到商品（2026-09-23；2026-10-10 起写 catalog） | `purchasing.supplier-products.sync-fields`：`promote` 对已关联行是幂等的（`skipped`），所以产品库改完名字/规格/供货价后用这个动作推回商品。与 `promote` **共用同一段写入**（`lib/supplierProductPromotion.ts`）：只写非空且变化的字段（`changedProductFields` + 与当前 `StoreProduct` 的 merge，保证 store 的原生载荷不会清空未提交的列）+ 合并 `purchase` 价格档（整组提交，消失的行以 `ends_at` 关窗），返回 `fieldsChanged[]` / `priceChanged` 让界面说清写了什么；`internal`/`export` 价、变体一律不碰。未关联 → 422 `supplier_product_not_linked`，商品已删 → 422 `product_deleted` |
| 停用 / 启用（2026-09-30） | 列表行操作直接改 `status`（`active`/`inactive`），走既有 `purchasing.supplier-products.update` 命令——乐观锁 + `purchasing.supplier_product.updated` 事件 + 索引副作用；载荷只带更新契约的必填字段（`supplierSku`/`name`/`unit`）+ `status`，命令对未提交字段保持不动，**编码、价格、图片、历史全保留，什么都不删**。列表默认按 `status=active` 读，因此停用行立刻离开默认视图，切「停用」筛选可见，并可在同一处一键恢复 |
| 批量建商品档案（2026-09-23） | `purchasing.supplier-products.promote-batch`：`{ ids: uuid[1..100] }`，**逐行隔离**（与报价导入同款）：某行失败（SKU 属于已删商品、未知 id）只记进 `failed[{ id, code, message }]`，其余照常落库；重复 id 折叠为首次出现，折叠后为空 → 400 |
| 建档状态（2026-09-23；2026-10-10 指向 catalog） | 列表筛选 `GET …?linked=all\|linked\|unlinked` **按库里的 `catalog_product_id` 服务端过滤**（不是按实时解析出来的名称——否则商品被删后这行会悄悄掉出「已建档」桶）；列表项多一个 `productDeleted`：`catalog_product_id` 有值但解析不到活商品（被删或不在本作用域）时，单元格显示「关联的商品已删除」，动作换成换绑/解除（`promote` 会 skip、`sync-fields` 会 422，都不该再点） |
| 动作的权限面（2026-09-23） | 写商品主数据的三个动作（建商品档案 / 批量建商品档案 / 同步字段到商品）要 `purchasing.supplier-products.promote`；三个关联动作（关联已有商品 / 换绑 / 解除关联）要 `…manage`。客户端用 `useBackendChrome()` + `hasFeature` 只决定**要不要显示**，服务端始终是权威（403） |
| 采购单行选择器的建档标记（2026-09-23） | 合并选择器里，产品库行的描述带上建档状态：未建档的行仍可选（先谈价后建档是合法顺序），但选项上直接写「未建档：建过档才能发运、收货」，不再让后果留到发运分摊时才暴露。`loadSupplierProductOptions` 因此返回 `SupplierProductOption`（多一个 `linked`），而 `loadOwnedProductOptions` 从 `PurchaseOrderForm.tsx` 挪到 `orderFormOptions.ts`——订单行选择器与产品库的「关联已有商品」共用同一个商品候选源 |
| 导出列语言 | 产品库列表的 CSV/JSON 导出表头只用英文：CRUD 工厂的 `header` 是静态字符串，这个接缝上没有按请求本地化的口子，混排中英表头是唯一不能接受的做法 |
| 报价侧入口 | 报价控制台的「加入产品库」与「提升所选为商品」都调用 `purchasing.supplier-products.import-from-quote`；本模块用只读投影读报价行（`lib/quoteLineReads.ts`），**不引用 `sourcing` 的实体** |
| 列表价格列的列宽（2026-09-24） | `DataTable` 默认给**每一列**套 `TruncatedCell`，没有 `maxWidth` 时按 **150px** 截断（`getColumnTruncateConfig` 的兜底分支）。本公司报价格子是三行右对齐（金额 / `≈ ¥…` / 图例「取自商品档案（内部结算价）」，`text-xs` 下 **156px**），溢出的是右对齐子元素、截断容器自己不滚，于是 `scrollWidth == clientWidth`：既不出现省略号也不弹 tooltip，图例的开头被**静默**切掉。修法＝该列 `truncate: false` + 单元格 `whitespace-nowrap`，列宽随内容（实测 188px）——只加 `truncate: false` 而不加 nowrap 会更糟：自动布局把列压到 102px，13 个字的图例断成四行。证据与通则见 `.ai/lessons/datatable-cell-truncates-at-150px.md` |
| 与 Q-P-004 的关系 | 采购单行价仍是**谈判值**，绝不被产品库价格自动带出；产品库只提供"当前价"清单，报价单仍是谈判文档 |

### Excel 导入（供应商产品表，2026-10-10）

产品库列表抬头「Excel 导入」三步：选供应商 + 上传（`.xlsx`/`.xls`/`.csv`）→ 核对列映射 + 预览 → 导入。文件先进
`attachments`（`entityId = purchasing:purchasing_supplier` + 供应商 id、`partitionCode = privateAttachments`），
解析路由只读回**本供应商名下**的文件（`readScoped({ expectedOwner })`；读不到或归属不符 → 422
`attachment_unreadable`，绝不 500）。

| 关注点 | 约定 |
|---|---|
| 路由 | `POST /api/purchasing/supplier-products/excel-import/parse`（手写只读路由：不落库、不派命令、不留审计）与 `POST /api/purchasing/supplier-products/excel-import`（CRUD 工厂 + 命令）。两者都按 `purchasing.supplier-products.manage` 收口，路径与既有 `…/import`（报价行导入）不同 |
| 表头探测 | 前 20 行里**别名命中最多**的一行，并列取靠前者；一个字段只由一列导入（精确标签 > 别名 > 靠左），落败的重复列在映射表里标「与第 N 列同字段，已忽略」；前 20 行一个已知列都没有 → 422 `header_not_found`（宁可失败也不把标题块当数据行），空表 → `empty_sheet`；只读**第一个**工作表（多表选择器待做） |
| 别名表 | `lib/supplierProductExcelImport/aliases.ts`：字段名就是 `supplierProductCreateSchema` 的 key；`exact` = 本库/标准模板的写法（供应商货号、品名（中文）、单位、每箱数量…），`alias` = 同义写法（货号、SKU、N.W.、装箱数…）。比对前 NFKC 折叠全角、去空白与标点、大小写不敏感；未知表头 = 忽略，不是错误 |
| 价格列 | 「供货价/单价/Unit Price…」被识别但**本轮不导入**：一条价格行是 `价格类型 × 币种 × 起订量`，单元格只给一个金额无法无歧义地决定另外两维。映射表给这些列标「价格列，本轮不导入」，不静默丢弃。**折扣（%）**列可导入（落在产品库行 `discount_percent`） |
| 行构建与编号 | `lib/supplierProductExcelImport/rows.ts`（纯函数，浏览器与命令共用）：trim、空行跳过、数字列去千分位/货币/单位后缀（`1,200 PCS` → `1200`；`100-200`、`46.5*46.5*40cm` 判为不可识别并保留原文，让契约拒绝）、上限与 `readWorkbook` 的 caps 对齐（20000 行 / 256 列，超出上报 `truncated`）。**行号 = 表格行号**（首行数据 = `headerRowIndex + 2`），失败列表里的「第 N 行」就是 Excel 左侧行号 |
| 导入命令 | `purchasing.supplier-products.import-excel`：`{ supplierId, rows }`，逐行复用现有 `purchasing.supplier-products.create` 命令（先 `supplierProductCreateSchema` 校验，再走 `commandBus`），因此查重（含软删行）、品牌解析、事件与索引副作用只有一份实现；逐行隔离：失败只进 `failed[{ row, reason }]`，其余照常落库；供应商不在本组织 → 400（一次，不是每行一次）。代价是每写入一行留一条 create 审计，与逐行手工录入同规模 |
| 未导入的列 | 单价、`inner_packing`（产品尺寸要三个数）、备注、状态、图片都不在别名表里（未知列 = 忽略）；`unit` 留空取契约默认 `PCS`，`status` 默认 `active` |
| 前置 | 上传走 `attachments` 的 `POST /api/attachments`（要 `attachments.manage`，与报价导入向导同一前置）；解析与导入要 `purchasing.supplier-products.manage`。不新增 feature，已有租户无需重新 `sync-role-acls` |

## 供应商银行账户（2026-09-29）

- **子表 `purchasing_supplier_bank_accounts`**（镜像 `parties_bank_accounts`）：`beneficiary_bank` / `account_number` / `swift_code` / `bank_address` + `is_default`；一个供应商最多一行默认（命令校验 + 部分唯一索引 `purchasing_supplier_bank_accounts_default_unique_idx` 兜住并发），无标记时第一行自动成为默认。
- **加密**：四个银行列由本模块根的 `encryption.ts` 声明（`purchasing:purchasing_supplier_bank_account`）——付款目标是支付欺诈高危数据；已有租户需要 `yarn mercato entities seed-encryption --tenant <id>` 才会物化映射。列是密文，因此**不参与搜索、排序、唯一索引或列表投影**。
- **写入**：`purchasing.suppliers.create/update` 接受可选 `bankAccounts[]`（≤10 行；命名 id 更新、无名行新建、缺席行删除；显式 `[]` 清空）。update 的银行块分两个边界写：先删行并把保留下来的行 `is_default` 清掉，再写最终值——否则一次批量更新里「把默认从 A 换到 B」会让部分唯一索引看到两行默认。update 的 undo 快照携带银行行，可精确重建上一版。
- **读取**：新增 `GET /api/purchasing/suppliers/[id]`（`purchasing.suppliers.view`）返回抬头 + 银行块（经 `findWithDecryption` 解密）；**列表与任何选项源都不含银行字段**。编辑页也改读该路由（列表投影没有银行行，且它同时回传 `updatedAt`）。
- **选择器收窄**：`supplierListSchema` 新增可选 `organizationId`（`buildFilters` 落到 `organization_id`），与合同/发票列表同一约定——合同的选择器按所选组织收窄，写入命令的对方校验也在同一作用域，不会出现「选得到、存不了」。
- **表单**：供应商表单的「银行信息」块直接复用 `parties` 的 `BankAccountsEditor`（同一个值对象只留一份交互实现）。

## 规则（有意为之）

- **供应商编码由系统发号（2026-09-24）**：`purchasing_suppliers.code` 是**我方**给供应商编的内部号（不是对方表格上印的「供应商货号」）。创建时由命令发 `SUP-0001` 形状的下一个号——扫本组织**全部行（含软删行）**取最大序号 +1，唯一索引 `purchasing_suppliers_scope_code_uniq` 是最终保证、撞号在命令内**有界重试（≤5，每次 `em.fork()`）**；因此新建表单**不渲染**编码字段、编辑页只读展示，接口仍接受显式 `code`（导入与集成测试走老契约，非 `SUP-` 形状的历史编号不参与发号计算）。编号永不复用：软删行占号，且编号已冻结进采购单的 `supplier_snapshot`。规则与决策见 [`.ai/specs/2026-09-24-supplier-code-issuance.md`](../../../.ai/specs/2026-09-24-supplier-code-issuance.md)。
- **金额是推导值**：单头金额、定金、尾款由行与付款推导，不落人工填写的"总价"；币种走 `currencies` 主数据。
- **阶段流转集中在命令**：`purchase-orders.transition` 校验合法前驱态；非法流转与并发冲突都返回 **409**，客户端必须带版本号（`updated_at`/`updatedAt`）。
- **库存只由 `wms` 变更，采购模块不写库存**：`apply-receipt` 只回写采购单行 `receivedQty` 与订单状态；真正入库的是 `cross_border.shipments.receive` → `wms.inventory.receive`（发运单收货时调用，见 `cross_border` README）。已收数量不允许超过订购数量。
- **付款凭证先建后绑**：付款先 `record` 拿到 `id`，再上传附件（`attachments`）并 `attach` 绑定；上传失败不回滚付款，行内可重试。
- ~~**单证一行一个文件**~~（**2026-10-10 退休，owner 口径**）：原先 `purchasing_purchase_order_documents` 挂在采购单上（一行 = 一个文件，`docType` ∈ `supplier_invoice`/`packing_list`/`purchase_payment_receipt`/`other`，文件本体走 `attachments`，行里只存可空 `attachment_id`）。owner 2026-10-10 决定：**单证改在公司订单（根订单）统一录入**，采购单只留一个指向根订单的入口——详情页的「单证」区块不再有新增/编辑/删除，也不读这张表。落地：UI 与客户端读取已删（路由/命令/实体保留，未做破坏性删表；表内 4 行历史数据**已按 owner 要求清空**——其他环境执行 `delete from purchasing_purchase_order_documents;`）。**同一条注意**：`export_finance` 订单档案的「单据齐套」里由这张表供数的三项（供应商发票 / 装箱单 / 采购水单）在清空后回到「未上传」；是否改读根订单的槽位（如 `purchase_slip_invoice` → 采购水单/发票）需要业务口径，尚未改。
- **采购单详情的单证是根单的只读镜像（2026-10-10 复查·三）**：录入只在根单（上一条），采购单详情只读展示 `order_hub/orders/fields` 的 `documents.bySlot` 里**有内容**的槽位——本单文件 chips（预览/下载走根单的字节代理 `/api/order_hub/orders/attachments/<id>`）与子单来源 chips（深链到根单页 `#contracts`/`#shipments`/`#money`/`#purchasing`）；解析在 `components/rootDocuments.ts`（跨模块 HTTP 载荷的边界，`TEST-038` 钉住：空槽位丢弃、坏行丢弃、非数组答空列表）。读不到（无 `order_hub.view` 的 403）或读失败时只留入口按钮，页面自身读取不受影响。槽位/来源文案沿用 `order_hub.documents.*` 键（app 字典按模块合并，`trade_docs` 的对话框同一做法），采购侧自己的空态是 `purchasing.orders.documents.rootEmpty`。
- **产品库的金额是 decimal 字符串**：`unit_price` 是 `numeric(18,4)`（单价 4 位；金额一律 2 位）、整组最多 24 行；提交前校验重复键（400）与未知币种（400，报错信息里带编码——与供应商/订单表单同一约定）。
- **价格组是"替换"不是"补丁"**：`replace-prices` 对载荷里缺失的行做停用；它**故意不加乐观锁**——整组提交不是局部编辑，拒绝其中一次完整提交只会让操作员无法保存（与商品主数据价格路由同一决定）。
- **价格组进主列（2026-09-23 修"布局很局促"，2026-09-24 组内只剩三个控件）**：`CrudFormGroup.column` 只有 `1 | 2`，没有"整行"分组；`column: 2` 会被画进 `3fr` 侧栏——1440px 视口下实测 389px，价格行的五个控件只剩 73/73/45/45/45px，「供应商供货价」被截成「供应」。价格组因此进主列（本 app 的行编辑器一律如此：采购单行、合同行、发票行、内销行、发运分摊），行内栅格用**容器查询**而非视口断点：`@md` 两组控件配对、`@3xl` 恢复单行 12 列，表单在 `lg` 以下退回单列时同样成立。修复后实测：1440px 卡片 907px（当时五个控件 203/203/131/131/131）、1024px 616px（两列配对）、390px 358px（选择器上下叠、数字并排）。2026-09-24 起组内是 `币种 / 单价 / 折扣（%）` 三个控件（多行编辑器已删，见上一节「价格」），仍留主列。
- **单位字典是 insert-only**：重复播种不覆盖操作员改过的条目，字段也接受字典外的编码，字典缺口永远不是写入失败。
- **产品库不跨模块 ORM 关联**：对 `wms`、`catalog`、`products`、`sourcing` 只存 ID/快照；报价行只经 `lib/quoteLineReads.ts` 的只读投影读取。
- **不跨模块 ORM 关联**：对 `wms`、`catalog`、`products` 只存 ID/快照，靠命令与事件联动（商品主数据优先，catalog 只作历史与收货变体桥接）。
- **界面文案单一语言（2026-09-23）**：`i18n/zh.json` 只写中文、`en.json` 只写英文；组件里 `t()` 的兜底一律用英文（见 [`docs/dev/i18n.md`](../../../docs/dev/i18n.md)）。此前的"中文 + 英文并列"标签（如「供应商货号 Supplier code」）已清掉，`HS CODE`/`MOQ` 这类业务缩写保留；2026-09-24 又把「PK 单价」「KC 单价」两个 PetKit 时代的列名去掉了——那是单个供应商的说法，不是价格类型的名字。
- **附件可预览（2026-09-24）**：付款水单、采购单证与产品照片的「预览」都打开同一个 app 级查看器（`src/lib/attachments/AttachmentPreview.tsx`），「下载」入口与 `?download=1` 行为不变。图片按容器等比显示；**PDF 用 Mozilla PDF.js（`pdfjs-dist`，Apache-2.0，本 app 已声明的依赖）渲染到 canvas**（`src/lib/attachments/PdfPreview.tsx`，最多 30 页、按舞台宽度缩放、`PDFDocumentLoadingTask.destroy()` 释放）——平台按安全策略把 PDF 当二进制附件下发（`SAFE_INLINE_MIME_TYPES` 只有图片），因此不能把 URL 交给浏览器；PDF.js 自己解析字节，渲染结果是与页面同源的 canvas（可被断言），不依赖任何浏览器插件、也不改平台策略。非图片/PDF 的类型给出说明并保留下载，超过 25 MiB 的文件在读取正文前放弃预览。
- **选项加载器不得超过列表路由的 `pageSize` 上限**：上限是每个路由自己声明的（供应商 100、产品库/商品/报价行 200、合同行 500），超了是 **400 且下拉框空白且无报错**；规则与清单见 `.ai/lessons/option-loaders-must-respect-page-size-caps.md`。

## 验证

```bash
yarn generate && yarn typecheck
yarn test src/modules/purchasing
yarn test:integration:ephemeral   # 含 purchasing/__integration__/supplier-products.spec.ts（产品库 CRUD/导入/同步/价格/字段/图片）与 supplier-code-issuance.spec.ts（供应商编码发号：连续、不复用、按组织独立、显式码不变）
# 冒烟（dev server 在跑时）：供应商 201 → 采购单 201 → 付款 201 → 附件 200 → 绑定 200 → 列表 attachment: yes
# 附件预览冒烟（2026-09-24）：采购单详情 → 单证行「预览」→ 图片在对话框内等比显示 / PDF 由 PDF.js 渲染到 canvas（3 页 PDF 实测 3 个 canvas、每页 960×1358、蓝色块像素数吻合、无控制台报错）/
#   文本文件显示「此文件类型不支持预览，请下载后用本地程序打开。」+「下载」；行操作菜单与单证表单字段同样有「预览」；产品照片缩略图（aria-label 预览这张照片）点击放大
# 产品库冒烟：/backend/purchasing/supplier-products 建行（单位下拉、供货价 + 折扣）→ 列表显示中英品名、折后价与商品的内部结算价
# 折扣冒烟（2026-09-24）：新建页价格组填 折扣 5 + 单价 100 → 行下实时显示「折后价 ¥95.00」→ 保存 → 列表「供应商供货价」显示 ¥95.00、副行「报价 ¥100.00 − 5%」→
#   建商品档案 → 商品价格档的 purchase（成本价）= 95.000000；本公司报价不再在本页录入，列表该列读商品的 internal 档
#   折扣只收整数（2026-09-24 收窄）：填 3.75 → 400（`nullableDecimalSchema(0)`），库里读回 `5` 而不是 `5.0000`
#   （`Migration20260924054410_sourcing` 把列收成 numeric(3,0)，与 `unit_volume` 同一种收窄）
#   注意：新增实体属性后 dev 服务器要重启（面板 restart action）才认，否则写入会被 ORM 元数据静默丢掉
# 单件物理数据冒烟（2026-09-24）：编辑页「装箱、重量与体积」填 单件毛重/单件净重/单件体积 → 保存 → GET 回读三个字段
#   （净重与毛重成对写入商品主数据的 net_weight/gross_weight；体积没有主数据列，只留产品库行）
#   注意：新增实体属性后 dev 服务器要重启（面板 restart action）才认，否则写入会被 ORM 元数据静默丢掉
# 图片一步建行冒烟（2026-09-23 实测）：新建页选图（本地预览）→ 保存 → 行上的 image_attachment_ids 已带该附件
# 采购单行选择器冒烟：/backend/purchasing/orders/create 选供应商 → 商品框里同时出现「本供应商产品库」与「商品库」两条建议 →
#   选产品库那条保存 → GET /api/purchasing/purchase-orders/lines?orderId=… 的 supplierProductId 已落库、productId/catalogProductId 为 null
# 关联冒烟（2026-09-23）：列表按「建档状态=未建档」筛出待办 → 行内点「建商品档案」（或勾选多行「批量建商品档案」）→
#   页面顶部出现「去填官方目录链接」的下一步 → 换「关联已有商品」把编码不一致的行挂到已有商品（商品总数不变）→
#   同步字段到商品后提示写明写了哪些字段 → 换绑 / 解除关联各回到预期状态
# 品牌冒烟（2026-09-24）：/backend/purchasing/suppliers/create 的「默认品牌」下拉列出 SP/DK/PK（`CODE — name`，来自字典 product_brand）→ 保存 → GET 回读 brandValue；
#   POST 一个字典外的品牌（如 XX）→ 400 `Unknown product_brand value: XX`；PUT 把它清空 → 200（清空始终允许，只有改成新值才校验）
# 编码面板冒烟（2026-09-24）：/backend/purchasing/supplier-products/create 的「品牌（编码前缀）」选 PK → 面板「品牌」行显示 `PK — PetKit`（取自供应商默认品牌时附一行说明）；
#   「类别」下拉列出 CL — 猫砂 等字典条目（手输已不可用）→ 选 CL → 生成 → 商品 SKU 得 `PK-CL001` + 拆解；
#   类别码表读不到/为空时面板给「字典 product_category 里没有可用条目…」而不是空白下拉框；手输类别那条路已不存在，因此 `Unknown product_category value: …` 只可能来自 API 调用方
# 生成后可手改（2026-09-24）：生成得到 `PK-CL001` 后把「商品 SKU」改成手工码（如 `DK-MANUAL-01`）→ 面板徽章变「沿用旧码」且不拦截 → 保存 → 列表与 `GET /api/purchasing/supplier-products` 回读的就是手输值（写路径不读 `rule.enforce`，`strict` 也不拦）
# 已有租户需要：yarn mercato seed:defaults --module purchasing（单位字典）+ yarn mercato seed:defaults --module product_codes（品牌/类别字典 + 默认编码规则）
#   + yarn mercato auth sync-role-acls（新权限）。漏掉 product_codes 那一步的表现是「默认品牌」下拉为空、字典库里没有 product_brand，
#   且 product_codes_rules 为空（生成按钮没有规则可解析）——见 `.ai/lessons/module-seeded-dictionaries-need-seed-defaults.md`
# Excel 导入冒烟（2026-10-10）：产品库列表「Excel 导入」→ 选供应商 → 上传 .xlsx/.xls/.csv → 出现表头探测与列映射建议 →
#   改一列映射后预览立即重算（不必重新上传）→ 导入 → 结果页给出成功/失败计数与失败行原因；关闭对话框后列表自动刷新
#   边界：非本供应商的 attachmentId → 422 attachment_unreadable；没有已知表头的表 → 422 header_not_found；
#   单价列不被导入（映射表标「价格列，本轮不导入」）
# 单证镜像与行菜单冒烟（2026-10-10 复查·三）：列表每行只有一个「⋯」菜单——已关联行 = 打开 / 打开公司订单，未关联行 = 打开 / 未关联公司订单（disabled、pointer-events: none）；
#   采购单详情「单证」= 根单槽位只读镜像：在根单上传一张单 → 采购单页随之出现该槽位，根单删除 → 采购单页随之消失（双向联动实测）；
#   槽位「下载」走 /api/order_hub/orders/attachments/<id>（200 + 原字节 + UTF-8 文件名）；本地存储按工作树分开，别的树上传的旧文件在本树答 404「File not available」（根单页自己的下载链在该服务器上同样如此）
yarn test src/modules/purchasing/lib/supplierProductExcelImport
```

## 回滚

从 `src/modules.ts` 移除 `{ id: 'purchasing', from: '@app' }` 并 `yarn generate`；表与迁移保留
（迁移是**向前-only** 的，`yarn mercato db` 只有 `generate` / `migrate` / `greenfield`，没有 `down`：
回滚数据只能从备份恢复，或用 `yarn db:greenfield` 重建库——后者是破坏性的，需所有者批准）。

## 相关知识（`.ai/lessons/`）

- `currency-dictionary-seeding.md` — 币种字典与汇率主数据的播种顺序。
- `per-user-acl-is-an-absolute-override.md` — 写权限测试时的用户级 ACL 覆盖坑。
- `unit-pickers-read-the-app-unit-dictionary.md` — 单位选择器只读 app 自有的 `supplier_product_unit` 字典。
- `kysely-bare-handle-types-tables-away.md` — 本模块的表走实体管理器；读别的模块的表（报价行）用带类型声明的只读投影。
- `option-loaders-must-respect-page-size-caps.md` — 选项加载器问的 `pageSize` 超过路由上限就是 400 + 空白下拉框。
