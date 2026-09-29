# `cross_border` — 发运单、在途里程碑、出口单证

app 自有模块。把多张采购单**拼柜**成一张发运单，跟踪在途节点与出口单证，收货时把数量回写
`purchasing`（采购单行）与 `wms`（库存）。需求见 [`docs/prd/cross-border-erp.md`](../../../docs/prd/cross-border-erp.md)。

## 表面

| 层 | 内容 |
|---|---|
| 实体（`data/entities.ts`） | `CrossBorderShipment` / `CrossBorderShipmentAllocation` / `CrossBorderShipmentMilestone` / `CrossBorderExportDocument` → 表 `cross_border_shipments` / `cross_border_shipment_allocations` / `cross_border_shipment_milestones` / `cross_border_export_documents`；**2026-09-28（Phase 2）** 新增 `CrossBorderShipmentSalesAllocation` → `cross_border_shipment_sales_allocations`（发运单 ↔ 内部销售订单**分摊到行**：`sales_order_id`/`sales_order_line_id`/`sales_order_number` 快照、`catalog_product_id`、`product_snapshot`、`quantity`、`unit_price`/`currency_code` 快照；唯一键 `(shipment_id, sales_order_line_id)`） |
| API | `GET|POST|PUT|DELETE /api/cross_border/shipments`、`/shipments/documents`；`GET /shipments/allocations`（只读：分摊只经发运单 create/update 写入，超发校验在那里）；**新增** `GET /shipments/sales-allocations?shipmentId=`（只读，同样只经发运单命令写入）；`GET|POST /shipments/milestones`（POST = 前进里程碑）；动作路由 `POST /shipments/{depart,receive,cancel}`（同路径的 GET 列表只为 CRUD 工厂解析作用域，不是 UI 契约） |
| 命令 | `cross_border.shipments.{create,update,delete,depart,receive,cancel,advance-milestone}`、`cross_border.documents.{create,update,delete}`（`create`/`update` 的载荷新增可选 `salesAllocations`：**整体替换**语义，与采购分摊同构；解析走 `lib/shipmentSalesReads.ts` 的 `loadSalesOrderLines`，销售行必须能经商品主数据的 `catalog_product_id` 桥接到官方目录，否则 422） |
| 后台页面 | `/backend/cross_border/shipments`（列表/新建/详情：采购分摊、**销售分摊**、节点时间线、单证）；**`/backend/cross_border/packing-lists`（装箱单（PL）台账，2026-09-29）**：跨发运单列出全部 `packing_list` 单证（单号/发运单/签发日/文件/备注），登记与编辑在同一对话框内先选发运单、文件按该发运单归档（`components/PackingListsTable.tsx` + `components/shipmentDocumentAttachmentField.tsx`） |
| 读缝（跨模块） | `lib/shipmentSalesReads.ts`：`readShipmentSalesAllocations` / `readShipmentPurchaseAllocations` / `loadSalesOrderLines`（其他模块读分摊只走这里，不直接碰本模块实体） |
| 事件 | `cross_border.shipment.{created,updated,departed,received,cancelled,deleted,milestone_recorded}`、`cross_border.export_document.{created,updated,deleted}` |
| 权限 | `cross_border.shipments.view|manage`、`cross_border.shipments.receive`、`cross_border.documents.manage` |
| 迁移 | `migrations/Migration20260921092726_cross_border.ts`（发运单 / 分摊 / 里程碑 / 出口单证四表）、`Migration20260922082558_cross_border.ts`（发运单头 `container_type` / `container_number` / `seal_number` / `booking_number`） |

## 规则（有意为之）

- **分摊不可超发**：`allocations` 累计数量不得超过采购单行的订购数量，超出返回 **422**；同一采购单**行**重复分摊同样拒绝（载荷内重复，或该发运单已占用该行，唯一约束 `(shipment_id, purchase_order_line_id)`）。
- **销售分摊是「一柜多单」的另一半（2026-09-28）**：采购分摊记录货从哪些采购单来，销售分摊记录同一批货卖给了哪些内部销售订单（同一柜可跨多张订单，唯一键 `(shipment_id, sales_order_line_id)`）；单价/币种取自销售行的当时值作为**快照**（单价 4 位；事后改价不改已开单据），CI 的明细按它汇总。
- **出口单证的「商业发票」槽位已停用（不删枚举）**：`commercial_invoice` 仍是合法枚举值（既有行继续显示/可读），但新建单证的下拉不再提供它，单证区与对话框都给出「已改为结构化单据」提示并链接 `/backend/trade-docs/commercial-invoices`——系统里商业发票只有一个真相源（`trade_docs_documents(kind='commercial')`）。
- **写后列表即新（2026-09-28）**：平台的 CRUD 列表缓存在 `ENABLE_CRUD_API_CACHE=true` 时生效，而工厂只失效本路由自己的资源；发运单命令因此显式失效本模块的全部集合（`lib/cacheInvalidation.ts`：`cross_border.shipment` + `.allocation` + `.sales.allocation` + `.milestone` + `cross_border.document`，后两者按实体名推导，因为对应的读取路由没有命令可推导）。回归口径见 trade_docs 的 `__integration__/crud-cache-freshness.spec.ts` 与 [lesson](../../../.ai/lessons/crud-cache-invalidation-spans-resources.md)。
- **里程碑单调**：`advance-milestone` 只允许前进，回退返回 **422**；历史节点保留可查。
- **收货幂等**：`receive` 写 `wms` 余额并回写采购单行已收数量，重复收货不重复计数（按采购单行累加）。
- **单证是弱类型集合**：类型枚举校验（`customs_declaration` / `packing_list` / `commercial_invoice` / `bill_of_lading` / `so` / `telex_release` / `domestic_freight_receipt` / `booking_charges_receipt` / `other`），非法类型返回 **400**；`so` 与 `telex_release` 的单号落在单头 `booking_number`、不写单证行，两种 receipt 一类收多份就是多行；单证文件走 `attachments`，行里只存 `attachment_id`。
- **PL 是单证、发运单不是 PL（2026-09-29）**：外贸口径的 **PL（装箱单）在本模块是一类出口单证**（`packing_list`，登记单号/签发日/附件，界面标签「装箱单（PL）」/ "Packing list (PL)"）；发运单是**这批货的承运批次**（拼柜来源 + 销售分摊 + 柜型/箱号/封签 + 里程碑 + 单证区）。同日起 PL 有自己的**台账页**（`/backend/cross_border/packing-lists`，出口业务组 `pageOrder 345`）——它只换了个列表视角，**写入路径没变**：仍是发运单单证命令（`cross_border.documents.*`），登记时在表单里选发运单、文件按该发运单归档，编辑不允许改挂（改挂会把附件留在旧发运单上）。CI（商业发票）同样不再走单证槽位（`commercial_invoice` 枚举只读保留，见下条）。
- **货柜型号读字典**：单头 `container_type` 的选项来自本模块播种的 `container_type` 字典（`setup.ts` 幂等写入七种型号），字典里没有的型号存不进单据；字典缺失或不可读时选择器给空列表（字段可空，不挡发运）。柜号 / 封签号 / 订舱号是自由文本。
- **港口与承运人读字典、允许例外**：单头 `departurePort` / `carrierName` 的选项来自本模块播种的 `port` / `carrier`
  字典（`setup.ts` 幂等写入，`yarn mercato seed:defaults --module cross_border`），界面是带建议的下拉——
  字典没收录的港口/承运人仍可直接输入，订舱不会被词表缺口卡住。`trade_docs` 合同头的「目的地」读同一份 `port` 字典。
- **分摊快照带供应商货号**：分摊行引用采购单行并把该行的 `product_snapshot` 原样冻结，快照里的 `supplierSku`（= 供应商产品库的 `item_no ?? supplier_sku`）随 `GET /api/cross_border/shipments/allocations` 的 `supplierSku` 输出，界面在商品名后显示"货号"；历史快照没有该键，读侧按 null。**分摊载荷本身不变**（仍是 `{ purchaseOrderLineId, quantity }`）。
- **没有目录链接就不能收货**：采购单行没有官方目录链接时拒绝分摊（**422**），报错直接点明要"先把供应商产品同步成商品并补目录链接"——收货是变体级（`wms.inventory.receive`），而变体只能经官方目录解析。收货时若该目录商品没有变体，同样 **422**。外贸侧**不另建产品清单**，出货依据就是采购单行来源 + 快照。
- **不跨模块 ORM 关联**：对 `purchasing`、`wms`、`attachments` 只存 ID，靠命令与事件联动。

- **单证可预览（2026-09-24）**：单证列的「预览」与单证表单字段的「预览」走 app 级共享查看器（`src/lib/attachments/AttachmentPreview.tsx`）：图片对话框内等比显示，PDF 由 Mozilla PDF.js（`pdfjs-dist`，已声明依赖）渲染到 canvas（`src/lib/attachments/PdfPreview.tsx`，不改平台 inline 策略、不新增路由与权限），其它类型给出说明并保留「下载」。

## 验证

```bash
yarn generate && yarn typecheck
yarn test src/modules/cross_border
# 冒烟：两张采购单合并一张发运单 201 → 超发 422 → depart 后两张采购单转 shipped →
#       里程碑前进 201 / 回退 422 → receive 后 wms 余额与采购单行已收数量一致
# PL 台账冒烟（2026-09-29）：登记（选发运单 + 上传文件）201 → 列表即时出现该行（无需刷新）→ 编辑补签发日（日期选择器点「应用」）→
#       删除（二次确认）后行消失、空态回归；发运单详情的「添加单证」对话框在附件字段抽出后行为不变（类型下拉含「装箱单（PL）」、上传按钮直接可用）
# 附件预览冒烟（2026-09-24）：出口单证行「预览」→ 图片等比显示 / PDF 由 PDF.js 渲染到 canvas / 其它类型说明 + 下载（同一组件，见 purchasing README）
```

## 回滚

从 `src/modules.ts` 移除 `{ id: 'cross_border', from: '@app' }` 并 `yarn generate`；已应用的迁移
与既有数据保留（数据回滚需单独评估）。

## 相关知识（`.ai/lessons/`）

- `installed-inputs-have-no-component-override.md` — 详情页里复用安装组件时的边界。
