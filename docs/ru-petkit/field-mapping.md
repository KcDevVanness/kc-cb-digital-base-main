# RU 字段与维度需求清单 + 中方映射 (2026-09-28)

回应俄方问题 2. 快照未到前未知格填 `待快照确认`, 缺失项标 `待俄方在 /api/v1 补充` — 不改中方表结构.
金额一律十进制字符串 (`numeric(18,2)`), 数量 `numeric(18,4)`, 价格 `numeric(18,4)` (单价 4 位).
分析见 `system-analysis.md`, 证据见 `evidence.md`.

## 1 中方锚点 (只读源码, 字段名照抄)

| 模块 | 实体 → 表 | 关键字段 | 幂等/编号规则 |
|---|---|---|---|
| `platform_ops` | `PlatformOpsChannel` → `platform_ops_channels` | `code`, `platform`, `externalAccountId`, `currencyCode` | 唯一 `(tenantId, organizationId, code)` |
| `platform_ops` | `PlatformOpsOrderMirror` → `platform_ops_order_mirrors` | `externalOrderId`, `status`, `currencyCode`, `grossAmount`, `feeAmount`, `netAmount`, `placedAt`, `shipmentId`, `shipmentNumber`, `raw`, `syncedAt` | 唯一 `(channel, externalOrderId)`; ingest 上限 500/批, 重复 externalId 整批 422; 命令 `platform_ops.orders.ingest` (compare-then-skip 计 `created/updated/unchanged`) |
| `platform_ops` | `PlatformOpsSettlement` → `platform_ops_settlements` | `externalSettlementId`, `periodStart`, `periodEnd`, `currencyCode`, `grossAmount`, `feeAmount`, `netAmount`, `receivedAt`, `status`, `raw` | 唯一 `(channel, externalSettlementId)`; import 上限 2000 行/单; 结算 upsert + 行整单替换; 无差异 → `reconciled` 否则 `imported` |
| `platform_ops` | `PlatformOpsSettlementLine` → `platform_ops_settlement_lines` | `externalOrderId`, `orderMirrorId`, `grossAmount`, `feeAmount`, `netAmount` | 随结算整单替换; 对账 kinds `missing_in_erp / amount_mismatch / duplicate_line` (同金额不重复建, 金额变了建新条) |
| `cross_border` | `CrossBorderShipment` → `cross_border_shipments` | `number` (depart 时发号), `status`, `carrierName`, `containerType`, `containerNumber`, `sealNumber`, `bookingNumber`, `destinationWarehouseId`, `destinationLocationId`, `currentMilestone`, `etd/eta/departedAt/receivedAt` | 唯一 `(tenantId, organizationId, number)`; 在途不进 `wms` 台账, `receive` 才动账 |
| `cross_border` | `CrossBorderShipmentAllocation` → `cross_border_shipment_allocations` | `purchaseOrderId`, `purchaseOrderLineId`, `purchaseOrderNumber`, `catalogProductId`, `productSnapshot` (含 `supplierSku`), `quantity` numeric(18,4), `receivedQuantity` | 唯一 `(shipment, purchaseOrderLineId)`; 无目录链接 422 拒绝分摊 |
| `cross_border` | `CrossBorderShipmentMilestone` → `cross_border_shipment_milestones` | `milestone` (6 阶段有序, 不许倒退), `occurredAt`, `note`, `recordedBy` | append-only; `currentMilestone` 回写发运单 |
| `cross_border` | `CrossBorderExportDocument` → `cross_border_export_documents` | `purchaseOrderId?`, `docType`, `documentNumber`, `issuedAt`, `attachmentId` | 挂发运单 (可兼挂订单) |
| `export_finance` | `ExportFinanceCollection` → `export_finance_collections` | `purchaseOrderId`, `purchaseOrderNumber`, `currencyCode` (默认 CNY), `collectionStatus` (`received/not_received/unknown`) | 唯一 `(tenantId, organizationId, purchaseOrderId)` (一单一档) |
| `export_finance` | `ExportFinanceRefund` → `export_finance_refunds` | `shipmentId` (+快照号), `taxRefundStatus`, `taxRefundAmount` numeric(18,2), `taxRefundNote` | 唯一 `(tenantId, organizationId, shipmentId)` (一柜一档); 分单金额读时按采购额分摊, 不存 |
| `purchasing` | `PurchasingSupplier` → `purchasing_suppliers` | `name`, `code` (`SUP-####`), `defaultCurrencyCode` (默认 CNY), `brandValue` | 组织内 `code` 唯一 |
| `purchasing` | `PurchasingPurchaseOrder` → `purchasing_purchase_orders` | `number` (`PO-<年>-<4位>`, place 时发号), `businessNumber` (业务纸面号, 与系统号分离), `supplierId` + `supplierSnapshot` | 唯一 `(tenantId, organizationId, number)` |
| `purchasing` | `PurchasingPurchaseOrderLine` → `purchasing_purchase_order_lines` | `lineNumber`, 三选一 `productId / supplierProductId / catalogProductId` (互斥) + `productSnapshot`, `quantity/receivedQuantity` numeric(18,4), `unitPrice` numeric(18,4), `priceIncludesTax/taxRate/netTotal/taxAmount/lineTotal` | 唯一 `(order, lineNumber)` |
| `purchasing` | `PurchasingPurchasePayment` → `purchasing_purchase_payments` | `stage` (定金/尾款), `amount` numeric(18,2), `attachmentId` | 订单付款状态由行派生, 无存储状态 |
| `sourcing` | 报价单 (见 `sourcing/README.md`) | `unit_cost/suggested_rsp` 十进制字符串直通; 提升走 `products.items.create\|update` + `products.prices.replace` + `purchasing.supplier-products.import-from-quote` | 报价行键 = 归一化派生 SKU; 已提升行冻结 (重解析 409) |
| `products` | `ProductsProduct` → `products_products` | `sku`, `name`, `brand`, `manufacturerModel`, `catalog_product_id?` (可选遗留桥) | 唯一 `(tenantId, organizationId, sku)` |
| `products` | `ProductsPrice` → `products_prices` | `priceTier` (`purchase/internal/export`, `lib/tiers.ts` 固定码), `currencyCode` (大写三字母), `minQuantity`, `unitPrice` numeric(18,4) | 唯一 `(tenantId, organizationId, product, priceTier, currencyCode, minQuantity)`; 整组 replace, 缺失行停用不删 |
| `products` | `ProductsVariant` → `products_variants` | `code`, `isDefault` (每产品唯一默认) | 唯一 `(tenantId, organizationId, code)` + 默认唯一索引 |
| `trade_docs` | `TradeDocsContract` → `trade_docs_contracts` | `number` (`PC-/SC-<年>-<4位>`, issue 发号), `direction` (purchase/sales), `priceTier`, `currencyCode`, `contractTotal/financeTotal/differenceTotal` numeric(18,2), `counterpartyId` +快照, `exchangeRate` numeric(18,8) 快照 | 唯一 `(tenantId, organizationId, number)`; 头合计同事务派生, 唯一写者 |
| `trade_docs` | `TradeDocsInvoice` → `trade_docs_invoices` | `number`, 状态机 (确认/作废), 附件绑定 | 同上 |
| `trade_docs` | 金额引擎 `trade_docs/lib/money.ts` | `quantity × unit_price` → financial 与 contract **同为 2 位**（金额与币种无关；financial 在行绑定已确认发票行时取发票金额）；BigInt HALF_UP, 存 `numeric(18,2)` | 全系统唯一舍入点 |

## 2 字段需求 (按域 6 表; 俄文抄 RU 页面原文, 列头样本已闭环 `export-sample-pk44.csv`)

图例: 必填 `R` = 联调前必须有, `O` = 可选; 快照列 `✓` = 本次已见 (页面/样本/脚本), `待快照确认` = 需 `/api/v1` 快照.

### 域1 订单 (→ `platform_ops` 订单镜像; 幂等 `(channel_id, external_order_id)`)

| 字段 (中 / EN / RU 原文) | 类型 | 粒度 | 必填 | 映射到中方 | 快照 | 备注 |
|---|---|---|---|---|---|---|
| 订单号 / order id / `№` | string ≤200 | 订单行 | R | `order_mirrors.external_order_id` | ✓ (样本 `115236` 等) | 行明细主键; ingest 上限 500/批 |
| 渠道 / channel / `Способ доставки` + 来源 (Ozon/Маркет/Сайт) | enum | 订单 | R | `channels.code` (Ozon/Маркет/Сайт三分) | ✓ (`ПВЗ (OZON)`, `Курьер (MERCHANT_SHIP)`) | 渠道映射表需俄方确认全部取值 |
| SKU / sku / `Артикул` | string | 订单行 | R | `raw` + 商品匹配 (`products.sku`) | ✓ (`PK44`) | 大小写以快照为准 (`PK44` vs `pk44`/`pkl_3set` 混用) |
| 品名 / item name / `Наименование` | string | 订单行 | O | `raw` | ✓ | 展示用 |
| 下单时间 / placed at / `Дата создания` | datetime | 订单行 | R | `placedAt` | ✓ (`2026-09-27 18:15:58`) | 按建单日过滤; `Даты оплаты Кит по времени не отдаёт` — 付款时间无来源, 不做账期依据 |
| 数量 / qty / `Кол-во` | numeric(18,4) | 订单行 | R | `raw` (镜像无数量列, 进 `raw`) | ✓ (`1`) | 镜像表无数量列 — 数量只存 `raw`, 报表读快照 |
| 单价/金额 / price / `Цена;Сумма;Сумма с учётом скидок;Цена с учётом скидок` | decimal string | 订单行 | R | `grossAmount/feeAmount/netAmount` (以 `Сумма с учётом скидок` 为 net) | ✓ (69190.0/57658.0) | 样本: 原价 69190, 折后 57658; `fee` 语义待快照确认 |
| 整单运费/总额 / order totals / `Стоимость доставки;Общая стоимость товаров;Общая сумма заказа` | decimal string | 订单 (整单重复) | O | `raw` | ✓ (0.0/57658.0/57658.0) | 整单重复 — 禁止按列求和 (页注原文) |
| 状态 / status / `Статус` + `Статус оплаты` | enum | 订单行 | R | `status` (+`raw`) | ✓ (`Ожидает доставки/Оплачен`; 15 取值见证据包) | 状态机映射表待俄方确认 |
| 退货标记 / return flag / `Полный возврат/Частичный возврат` | enum | 订单行 | R | `status` | ✓ (取值在列) | 退货率口径源 |
| 行成本 / cost / `Себестоимость ед.;Себестоимость сумма` | decimal string | 订单行 | O | 不入镜像 (成本归 `products`/`trade_docs`) | ✓ (29149.0/29149.0; 5 SKU 为空黄色) | 缺成本名单 `PJ_EP1/PPM_1/PRCL10/PRCL10_1/pj_4uvc` |

需要档: 日 (新单+状态) / 周 (复盘) / 月 (关账) — 三档全要.

### 域2 结算 (→ `platform_ops` 结算 + 对账; 幂等 `(channel, externalSettlementId)`, 行整单替换)

| 字段 (中 / EN / RU 原文) | 类型 | 粒度 | 必填 | 映射到中方 | 快照 | 备注 |
|---|---|---|---|---|---|---|
| 结算单 id / settlement id / 待快照确认 | string ≤200 | 结算单 | R | `settlements.external_settlement_id` | 待快照确认 | `待俄方在 /api/v1 补充` |
| 结算行 (订单引用) / line order ref / 待快照确认 | string | 结算行 | R | `settlement_lines.external_order_id` (+`orderMirrorId` 回填) | 待快照确认 | 对不上触发 `missing_in_erp` |
| 费用类型 / fee type / `удержания/реклама/логистика` | enum | 结算行 | R | `gross/fee/net` 拆分 + `raw` | 部分 ✓ (页显三类, key 待定) | `待俄方在 /api/v1 补充` 行级 key |
| 金额 / amount / `Удержания площадки;Себестоимость;Маржа` | decimal string | 结算单/行 | R | `grossAmount/feeAmount/netAmount` | ✓ (汇总值见 `/summary`; 行级待快照) | 金额不符 → `amount_mismatch`; 同单重行 → `duplicate_line` |
| 币种/周期 / currency & period | string/date | 结算单 | R | `currencyCode/periodStart/periodEnd/receivedAt` | 待快照确认 | 默认 RUB; import 上限 2000 行 |

需要档: 月 (关账对账)为主, 日/周可选.

### 域3 库存供应 (→ `cross_border` 收货 + `purchasing` 采购单)

| 字段 (中 / EN / RU 原文) | 类型 | 粒度 | 必填 | 映射到中方 | 快照 | 备注 |
|---|---|---|---|---|---|---|
| SKU / sku / артикул (含 `склад/фабрика` 后缀变体) | string | SKU | R | `products.sku` → 采购行 `productId` | ✓ (`PK39_2PK39склад` 等) | 后缀变体映射规则需俄方确认 |
| 在途量+ETA / in-transit / `В пути · ETA` | qty + date | SKU | R | `allocations.quantity` (在途) + 里程碑 ETA | ✓ (如 PK65 20 шт приход 05.10) | 未识别 2 200 шт ×8 (无卡/去 flag/未知码) 需单独清单 |
|  склад остаток / stock / `Свой склад/ФБО/Всего;Остаток/дней до OOS` | qty | SKU×仓库 | R | 收货后 `wms` (在途不进账); 需求侧读快照 | ✓ (总数 19 846 = 自有 13 529 + ФБО 6 318) | ФБО 由俄方专人维护, 只读 |
| 需求/日均 / demand / `Спрос/дн;30/60/90/120 дн` | qty | SKU | R | 采购计划输入 (不存, 读时算) | ✓ (权重 50/30/20/0%, 缺货日剔除) | 口径见证据包 |
| 计划采购量 / plan qty / `Рекоменд./Заказ, шт;Сумма, ₽;Заказать до` | qty + date + money | SKU | R | → `purchasing` PO 草稿 (`PO-<年>-<4位>`) | ✓ (17 SKU 2 300 шт 3 358 091 ₽) | 缺口→自动 PO 草稿 (S 级) |
| 供应单 / shipment / инвойс号或 KC-номер; `PO-2026-00x` | string | 供应单 | R | `shipments.number/bookingNumber` + 里程碑 | ✓ (6 在途单, 565 130 $) | 建单规则: XLS 按 `Model` 解析 |
| 参数 / params / цикл 57=30+25+2; окно 30+保险 10; horizon 97 | numbers | 全局 | O | 本地配置对照 (不覆盖) | ✓ (标签值; 输入框值待快照) | 季节性全 1,0 = 关闭 |

需要档: 日 (缺口+ETA) / 周 (例会) / 月 (计划) — 三档全要.

### 域4 价格成本 (→ `products` 三档价 + `trade_docs` 双口径)

| 字段 (中 / EN / RU 原文) | 类型 | 粒度 | 必填 | 映射到中方 | 快照 | 备注 |
|---|---|---|---|---|---|---|
| SKU / sku / артикул | string | SKU | R | `products.sku` | ✓ | 同域1 |
| 各平台买家价 / buyer price / `Цена покупателю` (Кит/Озон/ЯМ/WB) | decimal string | SKU×平台 | R | `products_prices` (`export` 档分币种, 整组 replace) | ✓ (如 PK44 Кит 57 658/Озон 63 388/ЯМ 82 529/WB 140 000) | WB 0 ₽ = 未上架, 非零价 |
| 共投比 / coinvest / `Соинвест, %` | percent | SKU×平台 | O | `raw`/定价参考 (不入总账) | ✓ (ср. Озон 47,8%) | 算式 `unverified — confirm first` |
| 可得价 / payout / `Цена к получению` | decimal string | SKU×平台 | O | 定价参考 | ✓ | 同上 |
| 平台费率 / fee rate / `Расходы площадки, %` | percent | SKU×平台 | R | 对账参考 | ✓ (如 52,9%) | 行级费率 |
| ДРР / drr / `ДРР, %` | percent | SKU×平台 | O | 参考 | ✓ (`~` = 近似) | SKU ДРР在总览页明确不算 (`ДРР по товару не считаем`) |
| 成本 / cost / `Себестоимость` | decimal string | SKU | R | `products_prices` (`purchase` 档) + `trade_docs` 双口径输入 | ✓ (PK44 29 149 ₽; 站内费率 факт 4,41%/2,42%) | 手工源; 缺 5 SKU 先补 |
| 毛利 / margin / `Маржа, %` | percent + money | SKU×平台 | R | `trade_docs` 双口径输出对照 | ✓ (ср. 31,6%) | `~` 近似值不做账, 只做定价信号 |

需要档: 日 (调价信号) / 周 (复盘) / 月 (定版) — 三档全要.

### 域5 广告 (暂只存档, 不入业务表 — Директ расход不分 SKU, 页面原注)

| 字段 (中 / EN / RU 原文) | 类型 | 粒度 | 必填 | 去向 | 快照 | 备注 |
|---|---|---|---|---|---|---|
| campaign/类型 / campaign type / `РСЯ/РЕТАРГЕТ/ПОИСК/Смарт-баннеры/Бренд/МЕДИЙНАЯ` (+подт.数) | string | 类型 | O | 存档 (调参依据) | ✓ (Total 1 658 512 ₽) | 不建业务表的原因: `расход Директа не делится на SKU` |
| 展示/点击/花费/购买 / `Показы/Клики/Расход/Покупки` | numbers | 类型×周期 | O | 存档 | ✓ | 同上 |
| CPO/CPC/CTR/CPM / `CPO/CPC/CTR/CPM` | numbers | 类型 | O | 存档 | ✓ | CPM 仅 Медийная |
| ДРР / drr / `ДРР` (+`нач.`) | percent | 类型×周期 | O | 存档 | ✓ (Total 30,3%) | живыми vs начислено 双口径 |

需要档: 日 (ДРР>20% 报警) / 周 (类型复盘) — 月可无.

### 域6 财务汇总 (→ `export_finance` + `trade_docs` 发票; 月 ОПИУ行项)

| 字段 (中 / EN / RU 原文) | 类型 | 粒度 | 必填 | 映射到中方 | 快照 | 备注 |
|---|---|---|---|---|---|---|
| 月行项 / opiu line / `Продажи;Соинвест площадки;Расходы площадки;Реклама;в т.ч. бонусами;Себестоимость;Маржинальная прибыль;ROI` | money/percent | 月×渠道 | R | `export_finance` 订单/柜档案 + `trade_docs` 发票 (双口径) | ✓ (7 个月 + Total, ROI 95,2%) | `Косвенные расходы и налоги` 全空 — 口径待确认 |
| Заказы/Продажи/Возвраты / orders/sales/returns | money + qty | 月×渠道 | R | 同上 | ✓ | Заказы (预测) vs Продажи (事实) 双列 |
| Средний чек / avg check / `Средний чек` | money | 月 | O | 参考 | ✓ (7 302 ₽ Total) | 同上 |

需要档: 月 (关账) — 日/周不需要.

## 3 样本列头闭环

`export-sample-pk44.csv` 17 列全部落入域1表, 无孤儿列; 缺成本 5 SKU 名单与 `/export` 页原文一致 (`PJ_EP1/PPM_1/PRCL10/PRCL10_1/pj_4uvc`).
各页客户端 CSV 列头 (证据包) 对应域: products/marketplaces → 域1+域4; types → 域5; reprice → 域4; summary → 域6.
