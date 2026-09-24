# `cross_border` — 发运单、在途里程碑、出口单证

app 自有模块。把多张采购单**拼柜**成一张发运单，跟踪在途节点与出口单证，收货时把数量回写
`purchasing`（采购单行）与 `wms`（库存）。需求见 [`docs/prd/cross-border-erp.md`](../../../docs/prd/cross-border-erp.md)。

## 表面

| 层 | 内容 |
|---|---|
| 实体（`data/entities.ts`） | `CrossBorderShipment` / `CrossBorderShipmentAllocation` / `CrossBorderShipmentMilestone` / `CrossBorderExportDocument` → 表 `cross_border_shipments` / `cross_border_shipment_allocations` / `cross_border_shipment_milestones` / `cross_border_export_documents` |
| API | `GET|POST|PUT|DELETE /api/cross_border/shipments`、`/shipments/documents`；`GET /shipments/allocations`（只读：分摊只经发运单 create/update 写入，超发校验在那里）；`GET|POST /shipments/milestones`（POST = 前进里程碑）；动作路由 `POST /shipments/{depart,receive,cancel}`（同路径的 GET 列表只为 CRUD 工厂解析作用域，不是 UI 契约） |
| 命令 | `cross_border.shipments.{create,update,delete,depart,receive,cancel,advance-milestone}`、`cross_border.documents.{create,update,delete}` |
| 后台页面 | `/backend/cross_border/shipments`（列表/新建/详情：分配明细、节点时间线、单证） |
| 事件 | `cross_border.shipment.{created,updated,departed,received,cancelled,deleted,milestone_recorded}`、`cross_border.export_document.{created,updated,deleted}` |
| 权限 | `cross_border.shipments.view|manage`、`cross_border.shipments.receive`、`cross_border.documents.manage` |
| 迁移 | `migrations/Migration20260921092726_cross_border.ts`（发运单 / 分摊 / 里程碑 / 出口单证四表）、`Migration20260922082558_cross_border.ts`（发运单头 `container_type` / `container_number` / `seal_number` / `booking_number`） |

## 规则（有意为之）

- **分摊不可超发**：`allocations` 累计数量不得超过采购单行的订购数量，超出返回 **422**；同一采购单**行**重复分摊同样拒绝（载荷内重复，或该发运单已占用该行，唯一约束 `(shipment_id, purchase_order_line_id)`）。
- **发运即锁定**：`depart` 把已分摊采购单推进到 `shipped`，之后不允许再改分摊。
- **里程碑单调**：`advance-milestone` 只允许前进，回退返回 **422**；历史节点保留可查。
- **收货幂等**：`receive` 写 `wms` 余额并回写采购单行已收数量，重复收货不重复计数（按采购单行累加）。
- **单证是弱类型集合**：类型枚举校验（`customs_declaration` / `packing_list` / `commercial_invoice` / `bill_of_lading` / `so` / `telex_release` / `domestic_freight_receipt` / `booking_charges_receipt` / `other`），非法类型返回 **400**；`so` 与 `telex_release` 的单号落在单头 `booking_number`、不写单证行，两种 receipt 一类收多份就是多行；单证文件走 `attachments`，行里只存 `attachment_id`。
- **货柜型号读字典**：单头 `container_type` 的选项来自本模块播种的 `container_type` 字典（`setup.ts` 幂等写入七种型号），字典里没有的型号存不进单据；字典缺失或不可读时选择器给空列表（字段可空，不挡发运）。柜号 / 封签号 / 订舱号是自由文本。
- **港口与承运人读字典、允许例外**：单头 `departurePort` / `carrierName` 的选项来自本模块播种的 `port` / `carrier`
  字典（`setup.ts` 幂等写入，`yarn mercato seed:defaults --module cross_border`），界面是带建议的下拉——
  字典没收录的港口/承运人仍可直接输入，订舱不会被词表缺口卡住。`trade_docs` 合同头的「目的地」读同一份 `port` 字典。
- **分摊快照带供应商货号**：分摊行引用采购单行并把该行的 `product_snapshot` 原样冻结，快照里的 `supplierSku`（= 供应商产品库的 `item_no ?? supplier_sku`）随 `GET /api/cross_border/shipments/allocations` 的 `supplierSku` 输出，界面在商品名后显示"货号"；历史快照没有该键，读侧按 null。**分摊载荷本身不变**（仍是 `{ purchaseOrderLineId, quantity }`）。
- **没有目录链接就不能收货**：采购单行没有官方目录链接时拒绝分摊（**422**），报错直接点明要"先把供应商产品同步成商品并补目录链接"——收货是变体级（`wms.inventory.receive`），而变体只能经官方目录解析。收货时若该目录商品没有变体，同样 **422**。外贸侧**不另建产品清单**，出货依据就是采购单行来源 + 快照。
- **不跨模块 ORM 关联**：对 `purchasing`、`wms`、`attachments` 只存 ID，靠命令与事件联动。

## 验证

```bash
yarn generate && yarn typecheck
yarn test src/modules/cross_border
# 冒烟：两张采购单合并一张发运单 201 → 超发 422 → depart 后两张采购单转 shipped →
#       里程碑前进 201 / 回退 422 → receive 后 wms 余额与采购单行已收数量一致
```

## 回滚

从 `src/modules.ts` 移除 `{ id: 'cross_border', from: '@app' }` 并 `yarn generate`；已应用的迁移
与既有数据保留（数据回滚需单独评估）。

## 相关知识（`.ai/lessons/`）

- `installed-inputs-have-no-component-override.md` — 详情页里复用安装组件时的边界。
