# `purchasing` — 供应商、采购单、阶段付款

app 自有模块。跨境采购的**唯一采购台账**：供应商主数据 → 采购单（含行）→ 定金/尾款等阶段付款 →
收货回写（数量进 `wms`）。需求见 [`docs/prd/cross-border-erp.md`](../../../docs/prd/cross-border-erp.md)，
阶段证据见 [`docs/plans/cross-border-erp.md`](../../../docs/plans/cross-border-erp.md)。

## 表面

| 层 | 内容 |
|---|---|
| 实体（`data/entities.ts`） | `PurchasingSupplier` / `PurchasingSupplierProduct` / `PurchasingSupplierProductPrice` / `PurchasingPurchaseOrder` / `PurchasingPurchaseOrderLine` / `PurchasingPurchasePayment` / `PurchasingPurchaseOrderDocument` → 表 `purchasing_suppliers` / `purchasing_supplier_products` / `purchasing_supplier_product_prices` / `purchasing_purchase_orders` / `purchasing_purchase_order_lines` / `purchasing_purchase_payments` / `purchasing_purchase_order_documents` |
| API | `GET|POST|PUT|DELETE /api/purchasing/suppliers`、`/purchase-orders`、`/purchase-orders/documents`、`/purchase-orders/payments`（`makeCrudRoute`；payments 的 PUT 是绑定付款凭证）；`GET /api/purchasing/purchase-orders/lines`（只读行面，行只经订单命令写入）；`POST /api/purchasing/purchase-orders/transitions`（阶段流转：同路径的 GET 列表只为 CRUD 工厂解析作用域，不是 UI 契约）；供应商产品库：`GET|POST|PUT|DELETE /api/purchasing/supplier-products`、`POST …/import`、`POST …/promote`、`GET|PUT /api/purchasing/supplier-products/prices` |
| 命令 | `purchasing.suppliers.{create,update,delete}`、`purchasing.supplier-products.{create,update,delete,import-from-quote,promote,replace-prices}`、`purchasing.purchase-orders.{create,update,delete,transition,apply-receipt}`、`purchasing.purchase-payments.{record,attach,delete}`、`purchasing.order-documents.{create,update,delete}` |
| 后台页面 | `/backend/purchasing/suppliers`（列表/新建/编辑）、`/backend/purchasing/supplier-products`（列表/新建/编辑：字段分组、供货价、商品图片）、`/backend/purchasing/orders`（列表/新建/详情/编辑：行、阶段付款、单证） |
| 事件 | `purchasing.supplier.{created,updated,deleted}`、`purchasing.supplier_product.{created,updated,deleted}`、`purchasing.supplier_product_prices.updated`、`purchasing.purchase_order.{created,updated,placed,shipped,received,closed,cancelled,deleted}`、`purchasing.purchase_payment.{recorded,deleted}`；单证 CRUD 侧效另发 `purchasing.purchase_order_document.{created,updated,deleted}`（`commands/orders.ts` 的 `purchaseOrderDocumentCrudEvents`，实体 `purchase_order_document`；这三个 id 目前未登记在 `events.ts`） |
| 权限 | `purchasing.suppliers.view|manage`、`purchasing.supplier-products.view|manage|promote`、`purchasing.orders.view|manage`、`purchasing.payments.manage` |
| 命令公共件 | `commands/shared.ts`：本模块唯一的 `ensureScope`（可信作用域、缺组织 fail closed）与产品库的实体 id / 资源类型 / 事件与索引桥配置 |
| 迁移 | `migrations/Migration20260921081717_purchasing.ts`（`purchasing_suppliers`）、`Migration20260921085348_purchasing.ts`（订单 / 行 / 付款三表）、`Migration20260921100702_purchasing.ts`（付款 `attachment_id`）、`Migration20260922073530_purchasing.ts`（行 `product_id` + `catalog_product_id` 放开 NOT NULL）、`Migration20260922082559_purchasing.ts`（`purchasing_purchase_order_documents` 表 + 单头 `business_number`/`product_category`/`owner_*`/`customer_*`）、`Migration20260922103027_purchasing.ts`（行 `supplier_product_id`）；产品库的表由 `sourcing` 侧的迁移建出并在 `Migration20260923043000_sourcing.ts` **改名为 `purchasing_*`**（含 `Migration20260923044000_sourcing.ts` 的 pkey 改名），数据原样保留 |

## 商品引用：自建商品主数据优先（REQ-017）

采购单行现在引用**自建商品主数据** `products_products.id`（列 `purchasing_purchase_order_lines.product_id`，可空，2026-09-22 迁移加列），
选择器读 `GET /api/products/items`（按当前组织收敛），行的显示快照（`product_snapshot` 的 title/sku/unit/model/spec）在写入时从该商品冻结。

- **一行恰好一个商品引用**（三种，互斥且不可混用）：
  - `supplier_product_id` → **供应商产品库行**（`purchasing_supplier_products`，2026-09-22 加列、2026-09-23 随产品库移交改名）。采购员在行编辑器里从**一个搜索框**里选品：
    该供应商的产品库与商品库同时搜，产品库结果排在前面，每条建议的**标签以来源开头**（`本供应商产品库 · 货号 — 品名` / `商品库 · SKU — 品名`，键 `lines.source.*`），选中哪条就写哪条引用——
    2026-09-23 之前是两个选择器 + 「改从商品库选择」切换按钮，业务上看不懂"现在在哪个库"；
    来源 2026-09-24 起放标签首段（owner 实测反馈「分不清哪个是供应商哪个是自建产品」：同一货品在两个库里各一条、货号与品名完全相同，只靠标签下方的小字来源分辨不出来），标签下面那行只剩「未建档」这类代价提示。
    产品库行已同步过商品时按商品主数据解析（并带上目录桥接），未同步时行上 `product_id`/`catalog_product_id` 均为 null，
    只冻结供应商快照（`title`/`sku`/`unit`/`spec` + `supplierSku`）。**同行的产品库行必须属于本单供应商**，否则 **422 `supplier_product_supplier_mismatch`**。
  - `product_id` → 商品主数据（上面那段）。
  - `catalog_product_id` → 历史行（切换前写入），照常可读可显示。
  - 三个都缺 → 400；`supplier_product_id` 与另两个同时出现 → 400。
- **编辑草稿会重新解析**：保存草稿时行会按现在的规则重新解析，所以产品库行**后来**同步成商品后，再保存一次草稿就会自动补上 `product_id` 与目录桥。
  冻结的是 `product_snapshot` 的内容，不是解析规则；已下单（非草稿）的单不重算。
- **`supplierSku` 是快照键**：产品库行的 `item_no ?? supplier_sku`，展示用，随快照透传到发运分摊（历史快照没有该键，读侧按 null）。
- **收货需要变体**：`wms.inventory.receive` 按变体级入账，发运分摊时会校验该行是否有目录链接——没有链接的商品可下单但**不能发运/收货**，
  报错会直接说明"先把供应商产品同步成商品并补官方目录链接"；补链接的地方是 `products` 的「官方目录链接」字段（产品库页也有「同步为商品」按钮）。
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
| 单件物理数据（2026-09-24） | 表单分组「装箱、重量与体积」= 每箱数量 + 单件毛重（G.W.）+ 单件净重（N.W.）+ 单件体积 + MOQ。毛重/净重/体积三个字段**都可留空**（供应商表印了才填），单位固定 kg / **整数 cm³**（`numeric(16,0)`，表单显示 `88642` 而非 `88642.000000`）；毛重与净重都是**单件**口径（整箱口径 2026-09-23 已删），体积按供应商印的数照录、不由产品尺寸推算。同步为商品时 `unitNetWeight`/`unitGrossWeight`/`unitVolume` → 商品主数据的 `net_weight`/`gross_weight`/`volume`（商品侧同样是 cm³、同样只记录不推算） |
| 商品 SKU 与品牌（2026-09-24） | 「商品 SKU」= 我方编码（本供应商下唯一，建档时写入商品主数据的 SKU）；「供应商货号」= 对方表格上印的号。表单的编码面板调 `product_codes`：`POST /api/product_codes/generate` 发号（`dryRun: true` 只试算不占号）、`GET /api/product_codes/parse` 拆解（规范编码 / 手工编码 / 沿用旧码三态，永不报错），「改用规范编码」把旧码登记为别名，供应商产品库与商品库的搜索都能按旧码命中。品牌取「行的品牌 → 供应商默认品牌」（`brand_value`，字典 `product_brand`），两者都没有时按钮禁用并给出提示。**三件套一个卡片（2026-09-24）**：新建/编辑页把「商品 SKU 与品牌」独立成一张卡片——`品牌（编码前缀）`（CrudForm 字段，可清空、带帮助文本）+ `商品 SKU`（`type: 'custom'` 字段，生成器就在字段内部：`类别` 下拉 + `生成` / `改用规范编码` + 拆解行 + 提示），品牌→类别→生成→SKU 的关系在视觉上是一个板块；供应商与品名留在「商品标识」卡片。面板**不再**另设品牌控件（同一值两个控件会被读成两个品牌，owner 2026-09-24 反馈「好像有两个地方重复」），只在品牌留空时显示一行「品牌留空，用供应商默认品牌：PK — PetKit」。`类别` 从字典 `product_category` 里选（`CODE — name`，不再手输）——它此前是自由文本，输入字典外的值（中文标签「猫砂」、任意字母）只会在点「生成」时拿到 400 `Unknown product_category value: …`，而发号命令本来就照字典校验，所以这个拒绝属于选择器而不是报错横幅；两个码表共用 loader `lib/codeListOptions.ts`（`product_brand` / `product_category` 一份实现、按字典 key 缓存）。**手输编码是一等公民（2026-09-24，owner：「生成后也可以自定义修改…这个品牌+类别的方式只是一个工具」）**：生成只把值写进「商品 SKU」，那一格始终可改（自定义字段内就是一个普通 `<Input>`，没有 readOnly），面板只按解析结果贴标签（规范编码 / 手工编码 / 沿用旧码）而**从不拦截**——写路径里没有任何地方读 `rule.enforce`，`strict` 目前是规则上的一个字段、不是闸门；规则描述的是**一种**品牌的编码形状，规则外的品牌照旧手输。两处已知边界：① 手输码要能「建商品档案」必须满足商品主数据的 `SKU_PATTERN`（`^[A-Za-z0-9._\-/]{1,64}$`，库行本身只校验 1–120 字符），否则建档 422；② 已建档行仍可改行上的编码，但 `sync-fields` **不写** `sku`（`changedProductFields` 里没有它），所以行上的码与商品主数据的 SKU 会分叉——只有「改用规范编码」在建档后被禁用（不能让主数据的 SKU 在已打印的单据背后被换掉）。**默认品牌是字典值、写入即校验**（2026-09-24）：下拉只列 `product_brand` 的条目、不接受手输，命令里也照 `defaultCurrencyCode` 的先例校验（`purchasing.suppliers.create/update` → `assertDictionaryValue`），否则 API 调用方可以存进一个永远无法生成的品牌，而失败要到点「生成」时才暴露；清空品牌（`null`）始终允许，改成一个**新**值才校验——字典里被删掉的旧值不会因此锁死供应商。字典由 `product_codes` 播种（品牌 SP/DK/PK、类别 CL/TP/LB/LS/CB），业务在**字典库**页面维护。**迁移落点**：`purchasing_suppliers.brand_value` 在 purchasing 的迁移里加；`purchasing_supplier_products.brand_value` 必须由 **sourcing** 的迁移加（该表由 sourcing 改名而来，而模块顺序 purchasing 在前）——见 `.ai/lessons/cross-module-rename-migration-ordering.md` |
| 唯一键 | `(tenant, organization, supplier_id, supplier_sku)`，**含软删行**（货号永久占用）：查重必须一起查已删行，否则唯一索引把可读的 409 变成 500 |
| 价格 | **表单只录一条供货价**（2026-09-24，owner 在新建页反馈「只有一种类型…新增多条好像意义不大了」）：`币种 + 单价 + 折扣`，填的就是该货号在售的**基准** `supplier_cost` 行（列表列与建档路径解析的那一行，比法唯一实现于 `lib/priceKinds.ts` 的 `comparePriceBaseRows`/`pickBasePriceRow`）；其余行（其它币种/起订量档、已停用的旧价、历史 `company_offer`）在「其它价格行（只读）」里列出并**原样提交回去**，所以保存不改写历史；已停用的价绝不回填（否则下次保存会把它悄悄复活）；清空单价 = 停用该价（不删除）。数据层仍是价格表：一行 = `price_kind × 币种 × 起订量`；`supplier_cost` = **供应商供货价**（供应商报给我们的价）。整组提交（`replace-prices`），载荷里消失的行**停用不删**，币种必须存在于币种字典。**折扣在产品库行上**（`purchasing_supplier_products.discount_percent`，`numeric(3,0)`，**0–100 的整数**、可空）：同供应商不同货号折扣不同，所以按货号一条，不是按价格行、也不是按供应商；**不收小数**（owner 2026-09-24 在新建页反馈「价格-折扣，只有使用整数，不需要保留小数点」；与 `unit_volume` 同一种收窄——0 位小数的 `nullableDecimalSchema(0)` + `Migration20260924054410_sourcing` 的 `numeric(3,0)`，表单 `inputMode="numeric"`，库里读回 `5` 而不是 `5.0000`）；折后价 = 单价 ×（1 − 折扣），六位小数，唯一实现 `lib/priceKinds.ts` 的 `netUnitPrice`（表单预览、列表列、建档写入共用）。`company_offer` = **本公司报价**：2026-09-24 起**不再在产品库录入**（表单只为新行提供供货价，已存在的行照常显示与提交），列表的该列改为只读展示**已建档商品**的 `internal`（内部结算价）档基准价——我们的对外报价是商品属性，主流 ERP（Odoo supplierinfo 的 price+discount 对 list_price/pricelist、SAP 采购信息记录对销售条件）都不把它挂在供应商记录上 |
| 单位 | 读字典 `supplier_product_unit`（`setup.ts` 播种，11 个海关常用码；`value` = 码、`label` = 纯中文名）；表单走全 app 唯一的 loader `products/lib/unitOptions.ts`，它把选项渲染成 `PCS — 件`（码在前，因为记录存的是码），字典没有的码仍可手输 |
| 图片 | `image_attachment_ids` 有序数组；文件走 `attachments`（`entityId = purchasing:purchasing_supplier_product` + 行 id），**先建行后绑图**，绑定走行更新（受乐观锁保护）；解绑只删 id，文件留在附件库。**新建页**先选图（本地 blob 预览）再点保存：提交时先建行、再上传、再带版本回写列表，一步完成；编辑页仍是选中即上传。图片失败不回滚行，页面跳到该行的编辑页提示重试 |
| 同步为商品（界面文案「建商品档案」） | `purchasing.supplier-products.promote` 按 SKU 建/更新 `products_products`，`name_zh ?? name` → 商品名、`name_en` → 英文名；价格优先用产品库里的 `supplier_cost`（没有才回退到最新报价行）——**两条路径都先打折**，写进 `purchase`（成本价）档的是**折后价**（报价行没有自己的折扣，用的是产品库行上那个）；整组价格提交以保住 `internal`/`export`；幂等（已同步返回 `skipped`），软删商品的 SKU 直接 422。列表行操作的文案改为「**建商品档案**」，确认框写明"建过档才能发运、收货"——原来的「同步为商品」看不出这一步是发运/收货的前置 |
| 关联已有商品 / 换绑 / 解除关联（2026-09-23） | `purchasing.supplier-products.link`：`{ id, productId }`，`productId: null` = 解除。**只写 `product_id` 这一列**，不改商品任何字段与价格——供应商编码 ≠ 我们 SKU 时，这是唯一不产生重复商品档案的做法。目标商品的**作用域与存活检查在写 `product_id` 的同一个事务里**（`select … for update` 锁住商品行；这是跨模块标量 ID、没有外键，所以只能这么做）：跨组织 → 404 `product_not_found`，已软删（或在选择与写入之间被删）→ 422 `product_deleted`，两种都不落任何写入。命令里刻意**不先经 EM 读取该行**（写入走原生 Kysely，预载的实体会让副作用读到陈旧的 identity map） |
| 同步字段到商品（2026-09-23） | `purchasing.supplier-products.sync-fields`：`promote` 对已关联行是幂等的（`skipped`），所以产品库改完名字/规格/供货价后用这个动作推回商品。与 `promote` **共用同一段写入**（`lib/supplierProductPromotion.ts` 的 `applySupplierProductToMaster`）：只写非空且变化的字段 + 合并 `purchase` 价格档，返回 `fieldsChanged[]` / `priceChanged` 让界面说清写了什么；官方目录链接、`internal`/`export` 价、变体一律不碰。未关联 → 422 `supplier_product_not_linked`，商品已删 → 422 `product_deleted` |
| 批量建商品档案（2026-09-23） | `purchasing.supplier-products.promote-batch`：`{ ids: uuid[1..100] }`，**逐行隔离**（与报价导入同款）：某行失败（SKU 属于已删商品、未知 id）只记进 `failed[{ id, code, message }]`，其余照常落库；重复 id 折叠为首次出现，折叠后为空 → 400 |
| 建档状态（2026-09-23） | 列表筛选 `GET …?linked=all\|linked\|unlinked` **按库里的 `product_id` 服务端过滤**（不是按实时解析出来的名称——否则商品被删后这行会悄悄掉出「已建档」桶）；列表项多一个 `productDeleted`：`product_id` 有值但解析不到活商品（被删或不在本作用域）时，单元格显示「关联的商品已删除」，动作换成换绑/解除（`promote` 会 skip、`sync-fields` 会 422，都不该再点） |
| 动作的权限面（2026-09-23） | 写商品主数据的三个动作（建商品档案 / 批量建商品档案 / 同步字段到商品）要 `purchasing.supplier-products.promote`；三个关联动作（关联已有商品 / 换绑 / 解除关联）要 `…manage`。客户端用 `useBackendChrome()` + `hasFeature` 只决定**要不要显示**，服务端始终是权威（403） |
| 采购单行选择器的建档标记（2026-09-23） | 合并选择器里，产品库行的描述带上建档状态：未建档的行仍可选（先谈价后建档是合法顺序），但选项上直接写「未建档：建过档才能发运、收货」，不再让后果留到发运分摊时才暴露。`loadSupplierProductOptions` 因此返回 `SupplierProductOption`（多一个 `linked`），而 `loadOwnedProductOptions` 从 `PurchaseOrderForm.tsx` 挪到 `orderFormOptions.ts`——订单行选择器与产品库的「关联已有商品」共用同一个商品候选源 |
| 导出列语言 | 产品库列表的 CSV/JSON 导出表头只用英文：CRUD 工厂的 `header` 是静态字符串，这个接缝上没有按请求本地化的口子，混排中英表头是唯一不能接受的做法 |
| 报价侧入口 | 报价控制台的「加入产品库」与「提升所选为商品」都调用 `purchasing.supplier-products.import-from-quote`；本模块用只读投影读报价行（`lib/quoteLineReads.ts`），**不引用 `sourcing` 的实体** |
| 列表价格列的列宽（2026-09-24） | `DataTable` 默认给**每一列**套 `TruncatedCell`，没有 `maxWidth` 时按 **150px** 截断（`getColumnTruncateConfig` 的兜底分支）。本公司报价格子是三行右对齐（金额 / `≈ ¥…` / 图例「取自商品档案（内部结算价）」，`text-xs` 下 **156px**），溢出的是右对齐子元素、截断容器自己不滚，于是 `scrollWidth == clientWidth`：既不出现省略号也不弹 tooltip，图例的开头被**静默**切掉。修法＝该列 `truncate: false` + 单元格 `whitespace-nowrap`，列宽随内容（实测 188px）——只加 `truncate: false` 而不加 nowrap 会更糟：自动布局把列压到 102px，13 个字的图例断成四行。证据与通则见 `.ai/lessons/datatable-cell-truncates-at-150px.md` |
| 与 Q-P-004 的关系 | 采购单行价仍是**谈判值**，绝不被产品库价格自动带出；产品库只提供"当前价"清单，报价单仍是谈判文档 |

## 规则（有意为之）

- **供应商编码由系统发号（2026-09-24）**：`purchasing_suppliers.code` 是**我方**给供应商编的内部号（不是对方表格上印的「供应商货号」）。创建时由命令发 `SUP-0001` 形状的下一个号——扫本组织**全部行（含软删行）**取最大序号 +1，唯一索引 `purchasing_suppliers_scope_code_uniq` 是最终保证、撞号在命令内**有界重试（≤5，每次 `em.fork()`）**；因此新建表单**不渲染**编码字段、编辑页只读展示，接口仍接受显式 `code`（导入与集成测试走老契约，非 `SUP-` 形状的历史编号不参与发号计算）。编号永不复用：软删行占号，且编号已冻结进采购单的 `supplier_snapshot`。规则与决策见 [`.ai/specs/2026-09-24-supplier-code-issuance.md`](../../../.ai/specs/2026-09-24-supplier-code-issuance.md)。
- **金额是推导值**：单头金额、定金、尾款由行与付款推导，不落人工填写的"总价"；币种走 `currencies` 主数据。
- **阶段流转集中在命令**：`purchase-orders.transition` 校验合法前驱态；非法流转与并发冲突都返回 **409**，客户端必须带版本号（`updated_at`/`updatedAt`）。
- **库存只由 `wms` 变更，采购模块不写库存**：`apply-receipt` 只回写采购单行 `receivedQty` 与订单状态；真正入库的是 `cross_border.shipments.receive` → `wms.inventory.receive`（发运单收货时调用，见 `cross_border` README）。已收数量不允许超过订购数量。
- **付款凭证先建后绑**：付款先 `record` 拿到 `id`，再上传附件（`attachments`）并 `attach` 绑定；上传失败不回滚付款，行内可重试。
- **单证一行一个文件**：`purchasing_purchase_order_documents` 挂在**订单**上（不挂发运单：这些纸件在发运前就存在），一行 = 一个文件，文件本体走 `attachments`，行里只存 `attachment_id`（可空：允许先登记纸件、后补扫描件）；`docType` 是 `supplier_invoice` / `packing_list` / `purchase_payment_receipt` / `other`，同类型多份就是多行；非法类型由命令返回 **400**。
- **产品库的金额是 decimal 字符串**：`unit_price` 是 `numeric(18,6)`，整组最多 24 行；提交前校验重复键（400）与未知币种（400，报错信息里带编码——与供应商/订单表单同一约定）。
- **价格组是"替换"不是"补丁"**：`replace-prices` 对载荷里缺失的行做停用；它**故意不加乐观锁**——整组提交不是局部编辑，拒绝其中一次完整提交只会让操作员无法保存（与商品主数据价格路由同一决定）。
- **价格组进主列（2026-09-23 修"布局很局促"，2026-09-24 组内只剩三个控件）**：`CrudFormGroup.column` 只有 `1 | 2`，没有"整行"分组；`column: 2` 会被画进 `3fr` 侧栏——1440px 视口下实测 389px，价格行的五个控件只剩 73/73/45/45/45px，「供应商供货价」被截成「供应」。价格组因此进主列（本 app 的行编辑器一律如此：采购单行、合同行、发票行、内销行、发运分摊），行内栅格用**容器查询**而非视口断点：`@md` 两组控件配对、`@3xl` 恢复单行 12 列，表单在 `lg` 以下退回单列时同样成立。修复后实测：1440px 卡片 907px（当时五个控件 203/203/131/131/131）、1024px 616px（两列配对）、390px 358px（选择器上下叠、数字并排）。2026-09-24 起组内是 `币种 / 单价 / 折扣（%）` 三个控件（多行编辑器已删，见上一节「价格」），仍留主列。
- **单位字典是 insert-only**：重复播种不覆盖操作员改过的条目，字段也接受字典外的编码，字典缺口永远不是写入失败。
- **产品库不跨模块 ORM 关联**：对 `wms`、`catalog`、`products`、`sourcing` 只存 ID/快照；报价行只经 `lib/quoteLineReads.ts` 的只读投影读取。
- **不跨模块 ORM 关联**：对 `wms`、`catalog`、`products` 只存 ID/快照，靠命令与事件联动（商品主数据优先，catalog 只作历史与收货变体桥接）。
- **界面文案单一语言（2026-09-23）**：`i18n/zh.json` 只写中文、`en.json` 只写英文；组件里 `t()` 的兜底一律用英文（见 [`docs/dev/i18n.md`](../../../docs/dev/i18n.md)）。此前的"中文 + 英文并列"标签（如「供应商货号 Supplier code」）已清掉，`HS CODE`/`MOQ` 这类业务缩写保留；2026-09-24 又把「PK 单价」「KC 单价」两个 PetKit 时代的列名去掉了——那是单个供应商的说法，不是价格类型的名字。
- **选项加载器不得超过列表路由的 `pageSize` 上限**：上限是每个路由自己声明的（供应商 100、产品库/商品/报价行 200、合同行 500），超了是 **400 且下拉框空白且无报错**；规则与清单见 `.ai/lessons/option-loaders-must-respect-page-size-caps.md`。

## 验证

```bash
yarn generate && yarn typecheck
yarn test src/modules/purchasing
yarn test:integration:ephemeral   # 含 purchasing/__integration__/supplier-products.spec.ts（产品库 CRUD/导入/同步/价格/字段/图片）与 supplier-code-issuance.spec.ts（供应商编码发号：连续、不复用、按组织独立、显式码不变）
# 冒烟（dev server 在跑时）：供应商 201 → 采购单 201 → 付款 201 → 附件 200 → 绑定 200 → 列表 attachment: yes
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
