# 发俄方: 本系统架构 + 模块清单 + 对接接口规范 (2026-09-28, 中文先行)

`目标系统为本仓库自研 ERP, 接口走 HTTP, 不含 Odoo JSON-RPC.`
需求见 `system-analysis.md`, 字段见 `field-mapping.md`, 证据见 `evidence.md`.

## 1 本系统架构 (以本仓库为准)

- App 模块 `src/modules/<id>/` 为业务面, installed 数据层为引擎; 跨模块只用标量 id + 快照, 无 ORM 跨模块关联, 无跨模块写.
- 命令总线 (`registerCommand`) + `makeCrudRoute` (每路由每方法 `metadata` + `openApi`); 副作用只在提交后发事件 (post-commit).
- 租户/组织作用域可信派生, 缺失 fail-closed; 只有 installed 契约可用系统域.
- 金额十进制字符串（金额 `numeric(18,2)`、单价 `numeric(18,4)`）, 数量 `numeric(18,4)`; 幂等靠 DB 唯一键 + 命令端 compare-then-skip.
- 错误码按既有命令行为 (422 业务拒绝如分摊无目录链接/批次重 id, 409 版本冲突, 404 作用域内无行).

## 2 模块清单 (7 模块; 幂等键照抄源码)

| 模块 | 表前缀 | 对外路由 `/api/<module>/…` | 幂等键 |
|---|---|---|---|
| `platform_ops` | `platform_ops_*` | `/channels` (CRUD); `/orders` (GET 只读) + `/orders/ingest` (POST); `/settlements` + `/settlements/lines` (GET) + `/settlements/import` (POST); `/reconciliation` (GET) + `/reconciliation/{resolve,ignore}` (POST) | `(channel, external_order_id)`; `(channel, external_settlement_id)` |
| `cross_border` | `cross_border_*` | `/shipments` (CRUD) + `/shipments/{depart,receive,cancel}` + `/shipments/milestones` + `/shipments/allocations` (GET) + `/shipments/documents` | `(tenant, org, number)`; `(shipment, purchase_order_line_id)` |
| `export_finance` | `export_finance_*` | `/collections` (GET 读/PUT 存); `/refunds` (GET/PUT); `/collection-documents`, `/refund-documents` (CRUD); `/order-files`, `/container-files` (GET, `?format=csv` 导出) | `(tenant, org, purchase_order_id)`; `(tenant, org, shipment_id)` |
| `purchasing` | `purchasing_*` | `/suppliers`, `/purchase-orders` (+`/lines` GET, `/transitions` POST, `/documents`, `/payments`), `/supplier-products` (+`/import`, `/promote`, `/prices`) | `(tenant, org, code)`; `(tenant, org, number)`; `(order, line_number)`; `(tenant, org, supplier, sku)` |
| `sourcing` | `sourcing_*` | `/quotes` (+`/parse`, `/remap`, `/approve`, `/promote`, `/archive`, `/ai-mapping`), `/quote-lines`, `/quote-changes` (+`/versions`), `/item-timeline`, `/template` | 报价行键 = 归一化派生 SKU; 已提升行冻结 |
| `products` | `products_*` | `/items` (CRUD, 含变体) + `/items/{id}`; `/types`, `/categories`; `/prices` (GET/PUT/POST 整组替换); `/variants/options` | `(tenant, org, sku)`; `(tenant, org, product, tier, currency, minQty)` |
| `trade_docs` | `trade_docs_*` | `/contracts` (+`/lines` GET, `/transitions`, `/attach`, `[id]/document`), `/invoices` (同构), `/documents` (新 proforma 链路) | `(tenant, org, number)`; 双口径同事务派生 |

## 3 对接接口规范 (HTTP JSON)

- 传输: HTTPS + bearer token (token 由俄方签发, 中方只存服务端环境变量, 不进代码/文档).
- 编码: JSON; 金额十进制字符串 (`"57658.0000"`); 日期 ISO (`2026-09-27`, datetime 带时区); 百分比为数字 (ДРР `7.5` 即 7,5%).
- 幂等: 调用方重发同一 `external_*_id` 安全; 中方返回 `created/updated/unchanged` (订单) 或 `lines/raised/linked` (结算).
- 分页: `page/pageSize` (不确定时默认 50, 上限见第 2 节各路由 validators).
- 批量上限: 订单 ingest ≤ 500/批, 结算 import ≤ 2000 行/单 (超限分批).

### 3.1 订单 ingest `POST /api/platform_ops/orders/ingest`

| 字段 | 必填 | 说明 |
|---|---|---|
| `channelId` (uuid) | R | 中方渠道 id (Ozon/Маркет/Сайт三分, 建渠道时绑定) |
| `orders[].externalOrderId` (≤200) | R | RU `№` (如 `115236`) |
| `orders[].status` (≤80) | O | RU `Статус` 原文 (15 取值) |
| `orders[].currencyCode` | O | 缺省取渠道币种 (RUB) |
| `orders[].grossAmount/feeAmount/netAmount` | O | net 缺省 = gross − fee; `Сумма с учётом скидок` 进 net |
| `orders[].placedAt` | O | RU `Дата создания` |
| `orders[].shipmentId/shipmentNumber` | O | 履约关联 (有则填) |

### 3.2 结算 import `POST /api/platform_ops/settlements/import`

| 字段 | 必填 | 说明 |
|---|---|---|
| `channelId` | R | 同上 |
| `settlement.externalSettlementId` (≤200) | R | RU 结算单 id |
| `settlement.periodStart/periodEnd/receivedAt` | O | 周期与到账日 |
| `settlement.currencyCode` | O | 缺省取渠道币种 |
| `settlement.grossAmount/feeAmount/netAmount` | O | 头合计 |
| `lines[].externalOrderId` | R | 对应订单 `№` |
| `lines[].grossAmount/feeAmount/netAmount` | O | 行金额; 对不上进 `reconciliation` 队列 |

## 4 分工与待办

- 俄方负责: 现有看板说明 (模块、数据来源、指标口径、快照结构); 按 `field-mapping.md` 第 2 节调整 `/api/v1`; 发送仓库地址、API token、文档.
- 中方已交付: `system-analysis.md` (功能+决策+分级) + `field-mapping.md` (锚点+6 域清单) + 本 brief + 证据包 (11 截图 + 口径验算 + 样本列头).
- 待俄方发送仓库地址、API token、文档后联调; token 到手前所有 `unverified` 标记保留, 不强行闭环.
- 技术对接人单点: `待用户确认` (占位, 不填人名).
