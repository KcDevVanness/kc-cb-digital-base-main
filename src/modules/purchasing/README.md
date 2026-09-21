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

## 规则（有意为之）

- **金额是推导值**：单头金额、定金、尾款由行与付款推导，不落人工填写的"总价"；币种走 `currencies` 主数据。
- **阶段流转集中在命令**：`purchase-orders.transition` 校验合法前驱态；非法流转与并发冲突都返回 **409**，客户端必须带版本号（`updated_at`/`updatedAt`）。
- **收货是唯一的库存入口**：`apply-receipt` 写 `wms` 余额并回写采购单行 `receivedQty`；已收数量不允许超过订购数量。
- **付款凭证先建后绑**：付款先 `record` 拿到 `id`，再上传附件（`attachments`）并 `attach` 绑定；上传失败不回滚付款，行内可重试。
- **不跨模块 ORM 关联**：对 `wms`、`catalog` 只存 ID/快照，靠命令与事件联动。

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
