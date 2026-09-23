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
| 后台页面 | `/backend/purchasing/suppliers`（列表/新建/编辑）、`/backend/purchasing/supplier-products`（列表/新建/编辑：字段分组、价格行、商品图片）、`/backend/purchasing/orders`（列表/新建/详情/编辑：行、阶段付款、单证） |
| 事件 | `purchasing.supplier.{created,updated,deleted}`、`purchasing.supplier_product.{created,updated,deleted}`、`purchasing.supplier_product_prices.updated`、`purchasing.purchase_order.{created,updated,placed,shipped,received,closed,cancelled,deleted}`、`purchasing.purchase_payment.{recorded,deleted}`；单证 CRUD 侧效另发 `purchasing.purchase_order_document.{created,updated,deleted}`（`commands/orders.ts` 的 `purchaseOrderDocumentCrudEvents`，实体 `purchase_order_document`；这三个 id 目前未登记在 `events.ts`） |
| 权限 | `purchasing.suppliers.view|manage`、`purchasing.supplier-products.view|manage|promote`、`purchasing.orders.view|manage`、`purchasing.payments.manage` |
| 命令公共件 | `commands/shared.ts`：本模块唯一的 `ensureScope`（可信作用域、缺组织 fail closed）与产品库的实体 id / 资源类型 / 事件与索引桥配置 |
| 迁移 | `migrations/Migration20260921081717_purchasing.ts`（`purchasing_suppliers`）、`Migration20260921085348_purchasing.ts`（订单 / 行 / 付款三表）、`Migration20260921100702_purchasing.ts`（付款 `attachment_id`）、`Migration20260922073530_purchasing.ts`（行 `product_id` + `catalog_product_id` 放开 NOT NULL）、`Migration20260922082559_purchasing.ts`（`purchasing_purchase_order_documents` 表 + 单头 `business_number`/`product_category`/`owner_*`/`customer_*`）、`Migration20260922103027_purchasing.ts`（行 `supplier_product_id`）；产品库的表由 `sourcing` 侧的迁移建出并在 `Migration20260923043000_sourcing.ts` **改名为 `purchasing_*`**（含 `Migration20260923044000_sourcing.ts` 的 pkey 改名），数据原样保留 |

## 商品引用：自建商品主数据优先（REQ-017）

采购单行现在引用**自建商品主数据** `products_products.id`（列 `purchasing_purchase_order_lines.product_id`，可空，2026-09-22 迁移加列），
选择器读 `GET /api/products/items`（按当前组织收敛），行的显示快照（`product_snapshot` 的 title/sku/unit/model/spec）在写入时从该商品冻结。

- **一行恰好一个商品引用**（三种，互斥且不可混用）：
  - `supplier_product_id` → **供应商产品库行**（`purchasing_supplier_products`，2026-09-22 加列、2026-09-23 随产品库移交改名）。采购员在行编辑器里可以从**该供应商的产品库**选品，
    也可以切成商品库选品；产品库行已同步过商品时按商品主数据解析（并带上目录桥接），未同步时行上 `product_id`/`catalog_product_id` 均为 null，
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
中/英文品名、规格描述、申报要素（`declaration_elements`）、单位、HS CODE、MOQ、Qty/Box、单件净重、
整箱 G.W/N.W、内盒/外箱尺寸、商品图片、备注；价格在 `purchasing_supplier_product_prices`。

| 关注点 | 约定 |
|---|---|
| 唯一键 | `(tenant, organization, supplier_id, supplier_sku)`，**含软删行**（货号永久占用）：查重必须一起查已删行，否则唯一索引把可读的 409 变成 500 |
| 价格 | 一行 = `price_kind × 币种 × 起订量`；`supplier_cost`（原「PK 单价」）/ `company_offer`（原「KC 单价」）。整组提交（`replace-prices`），载荷里消失的行**停用不删**，币种必须存在于币种字典 |
| 单位 | 读字典 `supplier_product_unit`（`setup.ts` 播种，11 个海关常用码，`value` = 码、`label` = 中文+码）；表单走全 app 唯一的 loader `products/lib/unitOptions.ts`，字典没有的码仍可手输 |
| 图片 | `image_attachment_ids` 有序数组；文件走 `attachments`（`entityId = purchasing:purchasing_supplier_product` + 行 id），**先建行后绑图**，绑定走行更新（受乐观锁保护）；解绑只删 id，文件留在附件库 |
| 同步为商品 | `purchasing.supplier-products.promote` 按 SKU 建/更新 `products_products`，`name_zh ?? name` → 商品名、`name_en` → 英文名；价格优先用产品库里的 `supplier_cost`（没有才回退到最新报价行），整组价格提交以保住 `internal`/`export`；幂等（已同步返回 `skipped`），软删商品的 SKU 直接 422 |
| 报价侧入口 | 报价控制台的「加入产品库」与「提升所选为商品」都调用 `purchasing.supplier-products.import-from-quote`；本模块用只读投影读报价行（`lib/quoteLineReads.ts`），**不引用 `sourcing` 的实体** |
| 与 Q-P-004 的关系 | 采购单行价仍是**谈判值**，绝不被产品库价格自动带出；产品库只提供"当前价"清单，报价单仍是谈判文档 |

## 规则（有意为之）

- **金额是推导值**：单头金额、定金、尾款由行与付款推导，不落人工填写的"总价"；币种走 `currencies` 主数据。
- **阶段流转集中在命令**：`purchase-orders.transition` 校验合法前驱态；非法流转与并发冲突都返回 **409**，客户端必须带版本号（`updated_at`/`updatedAt`）。
- **库存只由 `wms` 变更，采购模块不写库存**：`apply-receipt` 只回写采购单行 `receivedQty` 与订单状态；真正入库的是 `cross_border.shipments.receive` → `wms.inventory.receive`（发运单收货时调用，见 `cross_border` README）。已收数量不允许超过订购数量。
- **付款凭证先建后绑**：付款先 `record` 拿到 `id`，再上传附件（`attachments`）并 `attach` 绑定；上传失败不回滚付款，行内可重试。
- **单证一行一个文件**：`purchasing_purchase_order_documents` 挂在**订单**上（不挂发运单：这些纸件在发运前就存在），一行 = 一个文件，文件本体走 `attachments`，行里只存 `attachment_id`（可空：允许先登记纸件、后补扫描件）；`docType` 是 `supplier_invoice` / `packing_list` / `purchase_payment_receipt` / `other`，同类型多份就是多行；非法类型由命令返回 **400**。
- **产品库的金额是 decimal 字符串**：`unit_price` 是 `numeric(18,6)`，整组最多 24 行；提交前校验重复键（400）与未知币种（400，报错信息里带编码——与供应商/订单表单同一约定）。
- **价格组是"替换"不是"补丁"**：`replace-prices` 对载荷里缺失的行做停用；它**故意不加乐观锁**——整组提交不是局部编辑，拒绝其中一次完整提交只会让操作员无法保存（与商品主数据价格路由同一决定）。
- **单位字典是 insert-only**：重复播种不覆盖操作员改过的条目，字段也接受字典外的编码，字典缺口永远不是写入失败。
- **产品库不跨模块 ORM 关联**：对 `wms`、`catalog`、`products`、`sourcing` 只存 ID/快照；报价行只经 `lib/quoteLineReads.ts` 的只读投影读取。
- **不跨模块 ORM 关联**：对 `wms`、`catalog`、`products` 只存 ID/快照，靠命令与事件联动（商品主数据优先，catalog 只作历史与收货变体桥接）。

## 验证

```bash
yarn generate && yarn typecheck
yarn test src/modules/purchasing
yarn test:integration:ephemeral   # 含 purchasing/__integration__/supplier-products.spec.ts（产品库 CRUD/导入/同步/价格/字段/图片）
# 冒烟（dev server 在跑时）：供应商 201 → 采购单 201 → 付款 201 → 附件 200 → 绑定 200 → 列表 attachment: yes
# 产品库冒烟：/backend/purchasing/supplier-products 建行（单位下拉、两条价格、上传图片）→ 列表显示中英品名与两类价格
# 已有租户需要：yarn mercato seed:defaults --module purchasing（单位字典）+ yarn mercato auth sync-role-acls（新权限）
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
