# `cross_border` — 发运单、在途里程碑、出口单证

app 自有模块。把多张采购单**拼柜**成一张发运单，跟踪在途节点与出口单证，收货时把数量回写
`purchasing`（采购单行）与 `wms`（库存）。需求见 [`docs/prd/cross-border-erp.md`](../../../docs/prd/cross-border-erp.md)。

## 表面

| 层 | 内容 |
|---|---|
| 实体（`data/entities.ts`） | `CrossBorderShipment` / `CrossBorderShipmentAllocation` / `CrossBorderShipmentMilestone` / `CrossBorderExportDocument` → 表 `cross_border_shipments` / `cross_border_shipment_allocations` / `cross_border_shipment_milestones` / `cross_border_export_documents`；**2026-09-28（Phase 2）** 新增 `CrossBorderShipmentSalesAllocation` → `cross_border_shipment_sales_allocations`（发运单 ↔ 销售订单（对内 / 对外两个贸易类型，2026-09-30 起）**分摊到行**：`sales_order_id`/`sales_order_line_id`/`sales_order_number` 快照、`catalog_product_id`、`product_snapshot`、`quantity`、`unit_price`/`currency_code` 快照；唯一键 `(shipment_id, sales_order_line_id)`）；**2026-09-29（合同关联）** 新增 `CrossBorderShipmentContract` → `cross_border_shipment_contracts`（发运单 ↔ 购销合同 **M:N**：`contract_id` 标量 + `contract_number`/`contract_direction` 冻结快照；唯一键 `(shipment_id, contract_id)`、按 `(org, tenant, contract_id)` 建索引供合同侧反查）与 `CrossBorderExportDocumentLine` → `cross_border_export_document_lines`（装箱单明细：`line_number` + 商品快照 + 数量/箱数/毛重/净重/体积/备注，唯一键 `(document_id, line_number)`） |
| API | `GET|POST|PUT|DELETE /api/cross_border/shipments`、`/shipments/documents`；`GET /shipments/allocations`（只读：分摊只经发运单 create/update 写入，超发校验在那里）；`GET /shipments/sales-allocations?shipmentId=`（只读，同样只经发运单命令写入）；`GET|POST /shipments/milestones`（POST = 前进里程碑）；动作路由 `POST /shipments/{depart,receive,cancel}`（同路径的 GET 列表只为 CRUD 工厂解析作用域，不是 UI 契约）；**新增（2026-09-29）** `GET /shipments/contracts?shipmentId=|contractId=`（只读：关联只经发运单命令写入）与 `GET /shipments/documents/lines?documentId=`（只读：明细只经单证命令写入）；列表新增 `?contractId=` 过滤（发运单按关联表、单证按关联发运单） |
| 命令 | `cross_border.shipments.{create,update,delete,depart,receive,cancel,advance-milestone}`、`cross_border.documents.{create,update,delete}`（`salesAllocations`/`allocations` 与 **`contracts[]`** 都是**整体替换**语义；`documents` 的载荷新增可选 **`lines[]`**，同样整体替换，仅 `packing_list` 允许；销售行必须能经商品主数据的 `catalog_product_id` 桥接到官方目录，否则 422） |
| 后台页面 | `/backend/cross_border/shipments`（列表/新建/详情：**关联合同**、采购分摊、**销售分摊**、节点时间线、单证）；**`/backend/cross_border/packing-lists`（装箱单（PL）台账，2026-09-29）** 跨发运单列出全部 `packing_list` 单证（单号/发运单/签发日/文件/备注），另有 **`/…/packing-lists/{create,[id],[id]/edit}` 三个页面**（2026-09-29 起：登记/详情/编辑，明细行编辑器 + 「从合同引用商品行」；原登记对话框已退役）；发运单表单的「关联合同」行编辑器与详情区块（`components/{ShipmentForm,ShipmentDetail}.tsx`），**两个分摊编辑器与装箱单明细编辑器都带「从合同引用商品」**（`components/{ShipmentForm,PackingListForm}.tsx`） |
| 读缝（跨模块） | `lib/shipmentSalesReads.ts`：`readShipmentSalesAllocations` / `readShipmentPurchaseAllocations` / `loadSalesOrderLines`（其他模块读分摊只走这里，不直接碰本模块实体）；`lib/contractReads.ts`：`loadContractRefs`（写入前解析合同号/方向快照）与 `loadShipmentIdsForContract`（`?contractId=` 过滤） |
| 事件 | `cross_border.shipment.{created,updated,departed,received,cancelled,deleted,milestone_recorded}`、`cross_border.export_document.{created,updated,deleted}` |
| 权限 | `cross_border.shipments.view|manage`、`cross_border.shipments.receive`、`cross_border.documents.manage` |
| 迁移 | `migrations/Migration20260921092726_cross_border.ts`（发运单 / 分摊 / 里程碑 / 出口单证四表）、`Migration20260922082558_cross_border.ts`（发运单头 `container_type` / `container_number` / `seal_number` / `booking_number`）、`Migration20260928030727_cross_border.ts`（销售分摊表 `cross_border_shipment_sales_allocations` + 作用域索引 + 唯一键 `(shipment_id, sales_order_line_id)`）、`Migration20260928073630_cross_border.ts`（销售分摊 `unit_price` 收窄为 `numeric(18,4)`）、`Migration20260929073318_cross_border.ts`（合同关联表 + 装箱单明细表，只增） |

## 规则（有意为之）

- **分摊不可超发**：`allocations` 累计数量不得超过采购单行的订购数量，超出返回 **422**；同一采购单**行**重复分摊同样拒绝（载荷内重复，或该发运单已占用该行，唯一约束 `(shipment_id, purchase_order_line_id)`）。
- **合同关联是 M:N 且只读快照（2026-09-29）**：一张柜可挂多张购销合同（拼柜混货），一张合同也可被多张发运单引用；写入只经 `cross_border.shipments.create/update` 的 `contracts[]`（整体替换，缺省=不动、`[]`=清空），服务端用 `lib/contractReads.ts` 的 scoped 读解析合同号与方向并**冻结在关联行**（合同改名/换向不回写），**已作废（cancelled）合同拒绝关联（422）**，跨组织合同 404/422；关联只允许在**草稿**发运单上改（`update` 本身的规则），详情页因此只在 draft 状态给出「编辑关联」。
- **装箱单明细只在 `packing_list` 上（2026-09-29）**：`lines[]` 随单证命令整体替换（缺省=不动、`[]`=清空），行号由命令按 1..n 分配（唯一键 `(document_id, line_number)`），数量/毛重/净重最多 4 位小数（与分摊同口径）、箱数与体积是整数（cm³，与商品主数据同口径）、**全部可空**（先登记后补），其它单证类型带 `lines` 一律 **422**；删除单证会把明细一并软删，`GET /shipments/documents/lines` 不再返回。
- **「从合同引用商品」是一次性复制、不是活绑定（2026-09-29）**：四个入口（发运单采购分摊、销售分摊、装箱单明细、以及 Phase 2 的 PI/CI 行）都按「选合同 → 读 `GET /api/trade_docs/contracts/lines` → 生成可编辑行/分摊」实现；发运单分摊侧按**本柜已选订单行**用商品主数据 id 匹配（匹配到才可一键添加，匹配不到给出原因并把用户引到下方的订单选择器——分摊的锚点仍是订单行，超发校验与收货回写不动）；装箱单侧把合同行原样带成可编辑明细并逐行记 `source_snapshot`（`{kind:'contract_line', contractId, lineId, copiedAt}`）。合同之后再改，不会自动同步到已生成的单据。
- **销售分摊是「一柜多单」的另一半（2026-09-28；方向口径 2026-09-30 修订）**：采购分摊记录货从哪些采购单来，销售分摊记录同一批货卖给了哪些销售订单（同一柜可跨多张订单，唯一键 `(shipment_id, sales_order_line_id)`）；单价/币种取自销售行的当时值作为**快照**（单价 4 位；事后改价不改已开单据），CI 的明细按它汇总。**对内与对外两个方向的订单都列（2026-09-30）**：选择器先解析本组织的两条贸易类型通道（`GET /api/internal_sales/trade-type-channels/orders`），把 `channelIds=<internal>,<external>` 与「无通道」一并传给 `sales/orders`（两个桶：打过贸易类型通道的 + 一条通道都没有的历史单据，后者等回填命令分类，回填前也必须在分摊里可选），每个选项的**方向词放在标签最前**（`对内 · ORDER-… — 买方` / `对外 · …`，方向取自通道标记，其次取冻结的买方快照；两者都解析不出的历史行只显示单号与买方），买方名从行上的 `customerName` 取、缺失时回落到 `customerSnapshot.name`；通道解析不到时那一桶**不带通道过滤**（退化为作用域内全部订单，标记请求本身失败才报错），组织还没播种通道也能分摊。
- **分摊选择器的选项加载器必须引用稳定（2026-09-30）**：`ComboboxInput` 把 `loadSuggestions` 放进自己的加载 effect 依赖里，而发运单表单的编辑器在加载器返回时把选项写进 `useState` —— 每次返回都重渲染编辑器、重新生成内联箭头、effect 再次起跑，形成**每 ~300ms 一次的无限重载**：下拉在「选项」与「加载中」之间闪、点击落在被卸载的选项上（表现为「无法选中」）。修法是把选项缓存放进 `useRef` 并把加载器包进 `React.useCallback`（`ShipmentForm.tsx` 的两个分摊编辑器、目的地两个选择器与合同行选择器），不给组件传递每次都换身份的 prop。规则记录：[`combobox-loader-must-be-referentially-stable.md`](../../../.ai/lessons/combobox-loader-must-be-referentially-stable.md)。
- **出口单证的「商业发票」槽位已停用（不删枚举）**：`commercial_invoice` 仍是合法枚举值（既有行继续显示/可读），但新建单证的下拉不再提供它，单证区与对话框都给出「已改为结构化单据」提示并链接 `/backend/trade-docs/commercial-invoices`——系统里商业发票只有一个真相源（`trade_docs_documents(kind='commercial')`）。
- **写后列表即新（2026-09-28）**：平台的 CRUD 列表缓存在 `ENABLE_CRUD_API_CACHE=true` 时生效，而工厂只失效本路由自己的资源；发运单命令因此显式失效本模块的全部集合（`lib/cacheInvalidation.ts`：`cross_border.shipment` + `.allocation` + `.sales.allocation` + `.milestone` + `.contract` + `cross_border.document`，单证写入另清 `cross_border.export.document.line`——装箱单明细走独立只读路由；这些按实体名推导，因为对应的读取路由没有命令可推导）。回归口径见 trade_docs 的 `__integration__/crud-cache-freshness.spec.ts` 与 [lesson](../../../.ai/lessons/crud-cache-invalidation-spans-resources.md)。
- **里程碑单调**：`advance-milestone` 只允许前进，回退返回 **422**；历史节点保留可查。
- **收货幂等**：`receive` 写 `wms` 余额并回写采购单行已收数量，重复收货不重复计数（按采购单行累加）。
- **单证是弱类型集合**：类型枚举校验（`customs_declaration` / `packing_list` / `commercial_invoice` / `bill_of_lading` / `so` / `telex_release` / `domestic_freight_receipt` / `booking_charges_receipt` / `other`），非法类型返回 **400**；`so` 与 `telex_release` 的单号落在单头 `booking_number`、不写单证行，两种 receipt 一类收多份就是多行；单证文件走 `attachments`，行里只存 `attachment_id`。
- **PL 是单证、发运单不是 PL（2026-09-29）**：外贸口径的 **PL（装箱单）在本模块是一类出口单证**（`packing_list`），自 2026-09-29 起它同时是**带明细行的单据**：`/backend/cross_border/packing-lists` 是跨发运单的**台账**，登记/详情/编辑走 `/…/packing-lists/{create,[id],[id]/edit}` 三个页面（原登记对话框已退役，能力并入页面）。发运单是**这批货的承运批次**（拼柜来源 + 销售分摊 + 柜型/箱号/封签 + 里程碑 + 单证区）；PL 挂在发运单上、**不允许改挂**（改挂会把附件留在旧发运单上），合同关联经发运单推导。CI（商业发票）不走单证槽位（`commercial_invoice` 枚举只读保留，见下条）。
- **货柜型号读字典**：单头 `container_type` 的选项来自本模块播种的 `container_type` 字典（`setup.ts` 幂等写入七种型号），字典里没有的型号存不进单据；字典缺失或不可读时选择器给空列表（字段可空，不挡发运）。柜号 / 封签号 / 订舱号是自由文本。
- **港口与承运人读字典、允许例外**：单头 `departurePort` / `carrierName` 的选项来自本模块播种的 `port` / `carrier`
  字典（`setup.ts` 幂等写入，`yarn mercato seed:defaults --module cross_border`），界面是带建议的下拉——
  字典没收录的港口/承运人仍可直接输入，订舱不会被词表缺口卡住。`trade_docs` 合同头的「目的地」读同一份 `port` 字典。
- **分摊快照带供应商货号**：分摊行引用采购单行并把该行的 `product_snapshot` 原样冻结，快照里的 `supplierSku`（= 供应商产品库的 `item_no ?? supplier_sku`）随 `GET /api/cross_border/shipments/allocations` 的 `supplierSku` 输出，界面在商品名后显示"货号"；历史快照没有该键，读侧按 null。**分摊载荷本身不变**（仍是 `{ purchaseOrderLineId, quantity }`）。
- **合同枢纽的入口带 `?contractId=`（2026-09-29）**：合同详情的关联区块把用户直接送进新建页——发运单新建页读 `?contractId=` 并**预填一张已关联合同**（点它进来的人已经选过合同了），装箱单新建页读 `?contractId=` 把**发运单选择器收窄到该合同的发运单**，且只有一个候选时直接选中（多个候选/读取失败则交回完整选择器，猜柜号只会把箱单挂到错的柜上）。预填只发生在**新建**页；编辑页仍按记录原值。
- **没有目录链接就不能收货**：采购单行没有官方目录链接时拒绝分摊（**422**），报错直接点明要"先把供应商产品同步成商品并补目录链接"——收货是变体级（`wms.inventory.receive`），而变体只能经官方目录解析。收货时若该目录商品没有变体，同样 **422**。外贸侧**不另建产品清单**，出货依据就是采购单行来源 + 快照。
- **不跨模块 ORM 关联**：对 `purchasing`、`wms`、`attachments` 只存 ID，靠命令与事件联动。

- **单证可预览（2026-09-24）**：单证列的「预览」与单证表单字段的「预览」走 app 级共享查看器（`src/lib/attachments/AttachmentPreview.tsx`）：图片对话框内等比显示，PDF 由 Mozilla PDF.js（`pdfjs-dist`，已声明依赖）渲染到 canvas（`src/lib/attachments/PdfPreview.tsx`，不改平台 inline 策略、不新增路由与权限），其它类型给出说明并保留「下载」。

## 验证

```bash
yarn generate && yarn typecheck
yarn test src/modules/cross_border
yarn mercato test:integration shipment-contracts   # __integration__/shipment-contracts.spec.ts（TEST-101/102/103）
# 冒烟：两张采购单合并一张发运单 201 → 超发 422 → depart 后两张采购单转 shipped →
#       里程碑前进 201 / 回退 422 → receive 后 wms 余额与采购单行已收数量一致
# 合同关联冒烟（2026-09-29）：带合同建发运单 201 → GET …/shipments/contracts 读回冻结快照 →
#       ?contractId= 命中 → 重复合同 422 / 未知合同 422 → contracts: [] 清空 200
# PL 明细冒烟（2026-09-29）：建带 2 行的 PL 201 → 明细读回（行号 1/2、数量 12.0000、箱数 3、空值 null）→
#       非 packing 单证带明细 422 → 整组替换 200 → 清空 200 → 删单证后明细读不到
# PL 页面冒烟（2026-09-29）：台账“登记装箱单”→ 新建页（选发运单 + 明细行 + 「从合同引用商品行」导入合同行）→ 保存 →
#       详情页显示明细 → 编辑页「从合同引用商品行」对话框（合同下拉 + 匹配状态 + 添加/全部添加）
# 分摊引用冒烟（2026-09-29）：发运单新建页两个分摊区都出现「从合同引用商品」；对话框预选表单里的关联合同、
#       读回合同商品行，未匹配行给出原因且「添加」置灰
# 枢纽入口冒烟（2026-09-29）：/backend/cross_border/shipments/create?contractId=<id> 打开时「关联合同」已带一行该合同；
#       /backend/cross_border/packing-lists/create?contractId=<id> 的发运单选择器只列该合同的柜，唯一柜时已选中
# 分摊选择器冒烟（2026-09-30）：采购单与销售订单两个下拉打开后选项常驻可点（同一操作 3 秒窗口内采购单 2 次请求、
#       销售 2 次；修复前 20 次）→ 销售下拉列出 对内 / 对外 / 无通道历史单且方向词在标签最前 →
#       选对外订单保存 201，分摊行落库并在详情页可见
# 附件预览冒烟（2026-09-24）：出口单证行「预览」→ 图片等比显示 / PDF 由 PDF.js 渲染到 canvas / 其它类型说明 + 下载（同一组件，见 purchasing README）
```

## 回滚

从 `src/modules.ts` 移除 `{ id: 'cross_border', from: '@app' }` 并 `yarn generate`；已应用的迁移
与既有数据保留（数据回滚需单独评估）。

## 相关知识（`.ai/lessons/`）

- `installed-inputs-have-no-component-override.md` — 详情页里复用安装组件时的边界。
