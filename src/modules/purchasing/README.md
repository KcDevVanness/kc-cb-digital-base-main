# `purchasing` — 供应商、采购单、阶段付款

app 自有模块。跨境采购的**唯一采购台账**：供应商主数据 → 采购单（含行）→ 定金/尾款等阶段付款 →
收货回写（数量进 `wms`）。需求见 [`docs/prd/cross-border-erp.md`](../../../docs/prd/cross-border-erp.md)，
阶段证据见 [`docs/plans/cross-border-erp.md`](../../../docs/plans/cross-border-erp.md)。

## 表面

| 层 | 内容 |
|---|---|
| 实体（`data/entities.ts`） | `PurchasingSupplier` / `PurchasingPurchaseOrder` / `PurchasingPurchaseOrderLine` / `PurchasingPurchasePayment` → 表 `purchasing_suppliers` / `purchasing_purchase_orders` / `purchasing_purchase_order_lines` / `purchasing_purchase_payments` |
| API | `GET|POST /api/purchasing/suppliers`、`/purchase-orders`、`/purchase-orders/lines`、`/purchase-orders/payments`（`makeCrudRoute`），`POST /api/purchasing/purchase-orders/transitions`（阶段流转），`PUT /api/purchasing/purchase-orders/payments`（绑定付款凭证） |
| 命令 | `purchasing.suppliers.{create,update,delete}`、`purchasing.purchase-orders.{create,update,delete,transition,apply-receipt}`、`purchasing.purchase-payments.{record,attach,delete}` |
| 后台页面 | `/backend/purchasing/suppliers`（列表/新建/编辑）、`/backend/purchasing/orders`（列表/新建/详情） |
| 事件 | `purchasing.supplier.{created,updated,deleted}`、`purchasing.purchase_order.{created,updated,placed,shipped,received,closed,cancelled,deleted}`、`purchasing.purchase_payment.{recorded,deleted}` |
| 权限 | `purchasing.suppliers.view|manage`、`purchasing.orders.view|manage`、`purchasing.payments.manage` |
| 迁移 | `migrations/Migration20260921*_purchasing.ts`（建表 / 付款阶段 / 付款凭证列） |

## 商品引用：自建商品主数据优先（REQ-017）

采购单行现在引用**自建商品主数据** `products_products.id`（列 `purchasing_purchase_order_lines.product_id`，可空，2026-09-22 迁移加列），
选择器读 `GET /api/products/items`（按当前组织收敛），行的显示快照（`product_snapshot` 的 title/sku/unit/model/spec）在写入时从该商品冻结。

- **一行恰好一个商品引用**（三种，互斥且不可混用）：
  - `supplier_product_id` → **供应商产品库行**（`sourcing_supplier_products`，2026-09-22 迁移加列）。采购员在行编辑器里可以从**该供应商的产品库**选品，
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
- 供应商列表的行操作里有「产品库」入口，直达 `/backend/sourcing/supplier-products?supplierId=<id>`（实体归 `sourcing`，页面挂在本菜单组）。

## 规则（有意为之）

- **金额是推导值**：单头金额、定金、尾款由行与付款推导，不落人工填写的"总价"；币种走 `currencies` 主数据。
- **阶段流转集中在命令**：`purchase-orders.transition` 校验合法前驱态；非法流转与并发冲突都返回 **409**，客户端必须带版本号（`updated_at`/`updatedAt`）。
- **收货是唯一的库存入口**：`apply-receipt` 写 `wms` 余额并回写采购单行 `receivedQty`；已收数量不允许超过订购数量。
- **付款凭证先建后绑**：付款先 `record` 拿到 `id`，再上传附件（`attachments`）并 `attach` 绑定；上传失败不回滚付款，行内可重试。
- **不跨模块 ORM 关联**：对 `wms`、`catalog`、`products` 只存 ID/快照，靠命令与事件联动（商品主数据优先，catalog 只作历史与收货变体桥接）。

## 验证

```bash
yarn generate && yarn typecheck
yarn test src/modules/purchasing
# 冒烟（dev server 在跑时）：供应商 201 → 采购单 201 → 付款 201 → 附件 200 → 绑定 200 → 列表 attachment: yes
```

## 回滚

从 `src/modules.ts` 移除 `{ id: 'purchasing', from: '@app' }` 并 `yarn generate`；表与迁移保留
（迁移文件已应用，回滚数据需另行走 `yarn db:migrate:down` 并确认目标库）。

## 相关知识（`.ai/lessons/`）

- `currency-dictionary-seeding.md` — 币种字典与汇率主数据的播种顺序。
- `per-user-acl-is-an-absolute-override.md` — 写权限测试时的用户级 ACL 覆盖坑。
