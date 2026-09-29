# 财务模块完善 · 数据打通 · 老板驾驶舱 (Finance Ledger, RU Data Sync and Boss Cockpit)

**Date**: 2026-09-28
**Status**: Ready for implementation — **Phase 1–8 全部交付**；Phase 1–5 已在 dev 实测，Phase 8 的 FLOW-G1 端到端链路已在**全新一次性库**上绿（见 `TEST-FLOW-G1`），Phase 3 的 ads 实拉 / Phase 4 / 6 / 7 的页面实测待本机 dev 服务重启后补（细节见 Changelog）
**Source docs**: `.ai/specs/2026-09-28-three-system-metric-reconciliation.md`（承接其 supply 同步 + 驾驶舱范围）· `docs/ru-petkit/supply-sync-tech.md`（16 端点唯一契约）· `docs/ru-petkit/field-mapping.md`（六域锚点）· `docs/ru-petkit/prd.md`（RU 功能 F-01…F-11）· `docs/plans/cross-border-erp.md`（既有链路现状）

> **用户决议（2026-09-28，硬约束）**：交付范围 = 需求 + 一路做到驾驶舱可看（多阶段）；成本口径 = 采购价 + 到岸成本**双口径**；RU 对接顺序 = **先 supply 7 端点，后 ads 9 端点**；账本深度 = 业务台账 + 派生损益，**不做**凭证/科目/总账/账期/账龄。

## TLDR

在既有跨境 ERP 的采购（`purchasing`）、外贸（`cross_border`/`trade_docs`）、收汇退税（`export_finance`）三条链之上，补一层**钱**：柜级费用台账、到岸成本（读时派生）、期间费用、应付/应收/库存资金占用/损益只读台账；补一层**数据**：RU petkit 16 端点（先 supply 7）的 `DataSyncAdapter` 同步、快照投影、游标、SKU 映射；补一层**看**：只读老板驾驶舱（六类数一页 + 四预警 + 下钻）。全部复用平台一方机制：`makeCrudRoute`/`CrudForm`/`DataTable`、命令 + 事件 + 订阅者、`data_sync` 的 `DataSyncAdapter`、`dashboards` 的 `DashboardWidgetModule`、`notifications` 的类型注册、`platform_ops.reconciliation` 的对账队列。最小闭环：老板每天看到缺货/在途/积压/ДРР 四数，数字与 RU 页一致、与 CN 账本对得上；且柜费用→到岸成本→应付/应收→损益每一步可复算。

## Problem Statement

现状与痛点（证据均可复核）：

- **钱只到采购单为止**。`purchasing` 有供应商、供应商产品库、采购单与行（`net_total`/`tax_amount`/`line_total` 落库）、阶段付款（带付款凭证 `attachment_id`）；付款状态是派生值，唯一实现 `src/modules/purchasing/lib/orderTotals.ts:93 derivePaymentState(total, payments)` 在全仓**零引用**——采购单详情页在客户端另算一套（`.ai/lessons` 未记录，本轮检索确认）。台账没有统一出口。
- **外贸侧没有金额**。`cross_border_shipments` 零金额列（无运费/关税/货值）；该模块唯一的钱是 `cross_border_shipment_sales_allocations.unit_price + currency_code`（内部销售价快照）。收货只动数量：`src/modules/cross_border/commands/shipments.ts:703-726` → `wms.inventory.receive` + `purchasing.purchase-orders.apply-receipt`，**不传任何成本**；`wms` 无成本层 ⇒ 库存资金占用今天算不出来。运费/关税只有两个单证类型枚举 `domestic_freight_receipt`/`booking_charges_receipt`（`src/modules/cross_border/data/validators.ts:15-26`），**金额化**的柜费用不存在。
- **收汇只有状态没有金额**。`export_finance_collections`（`src/modules/export_finance/data/entities.ts:44-45` 起）只有 `collection_status`；`export_finance_refunds` 有 `tax_refund_amount`。应收台账无来源。
- **没有损益**。全仓无任何 P&L / SKU 毛利代码；无期间费用（广告/平台费/物流/管理）实体。
- **RU 16 端点未接**。`docs/ru-petkit/supply-sync-tech.md` 契约已冻结（§1–§7 supply、§10–§18 ads），但 `A.4 四项敏感确认`全部未勾选；SKU 大小写与 `склад`/`фабрика` 后缀的映射没有落点。既有 spec `.ai/specs/2026-09-28-three-system-metric-reconciliation.md` 是 Draft、`Blocked`（Q-005…Q-010），只覆盖 supply 同步 + 只读驾驶舱，不含财务模块。
- **驾驶舱不存在**。全仓无 cockpit 代码；链路未端到端验收、到期提醒未做（`docs/prd/cross-border-erp.md` 验收清单 + PRD Q6）。

为什么现有行为不足：老板六类数据（赚多少 / 货转不转 / 卖得好不好 / 花钱值不值 / 钱回不回来 / SKU 对齐）没有任何单一可验收定义；采购价与到岸成本两个口径各自缺一半；D-资料（收汇/退税）有锚点无金额；RU 侧数字与 CN 账本各说各话。

## Overview and Success Measures

- **Primary outcome:** 驾驶舱六类数与 RU 页一致（误差 ≤ 0.2 п.п. / ≤ 20 ₽），且 CN 侧三数（应付未付 / 应收未收 / 库存资金占用）可逐单复算；柜级费用折算 CNY 后**分摊总和 == 费用总和**（金额 2 位）。
- **Leading indicators:** 7 端点 mock 全量拉取行数一致、同 `as_of` 重放 0 新增、失败页游标不推进；SKU 映射覆盖率（canonical 命中 supply SKU 集合）；采购单行 `received_quantity` 与 `wms` 余额一致。
- **Baseline:** 驾驶舱不存在；应付/应收无台账出口（本轮检索证据见 Problem Statement）；RU 页基线取 `docs/ru-petkit/evidence.md`（ДРР 7,5%、Сен маржа 21,6%、ROI 102,6%/77,2%、supply 32,0 млн ₽ / 565 130 $）。
- **Market / product reference:** RU BI 自身 11 路由（口径已验算）取定义；拒绝其渲染方式（服务端直出 HTML、无 key 内嵌 ROWS，不可复用）。ERP 侧近邻参考 = 本仓 `export_finance` 的档案 + 只读投影范式（`src/modules/export_finance/lib/peerReads.ts` 的 scoped Kysely 只读）。

## Goals

- **REQ-001** — 柜级费用台账：一行一笔实际发生的柜费用（海运/空运/铁路/内陆/报关/保险/关税/仓储/其他），带币种、汇率、发生日、往来方快照、附件；跨组织/已取消柜拒写。
- **REQ-002** — 到岸成本读时派生：按 `amount`（采购行不含税金额）或 `quantity` 分摊到采购行与 SKU，折算 CNY；全链唯一实现，与退税分摊同一条四舍五入规则。
- **REQ-003** — 库存资金占用 + 双口径：`wms` 余额 ⋈ 成本解析（最近到岸单价 → `purchase` 价格档 → missing），输出采购价与到岸价两列、缺成本清单。金额列 2 位；单价类输出（到岸单价 `landedUnitCost`）按 4 位。
- **REQ-004** — 期间费用单：类型/期间（含首含尾）/金额/币种/渠道或往来方/附件，CRUD 完整。
- **REQ-005** — 应付台账：每采购单一行（含两列金额与派生状态），复用 `derivePaymentState`；按供应商 + 币种分组，跨币种不顺加。
- **REQ-006** — 应收台账：三类来源统一行形（出口收汇 / 平台结算 / 内部销售），未收判定只看是否收到。
- **REQ-007** — 收汇金额补齐：`export_finance_collections` 加法两列（`amount`/`received_at`），投影与 CSV 同步，旧记录 null 可读。
- **REQ-008** — 月损益（ОПИУ 行项）：sales / coinvest / platformFees / adSpend / cost / marginalProfit / roi，事实与预测口径分列不混。
- **REQ-009** — SKU 毛利：RU 销售快照 × CN 到岸成本 → 毛利额/毛利%；超差行进对账队列。
- **REQ-010** — SKU 映射：RU SKU 归一化 + 自动建议 + 手工绑定/忽略 + 未映射派生清单。
- **REQ-011** — supply 端点同步（契约口径：`supply-sync-tech.md` §1–§7 **+ §1.1 `/api/v1/supply/sku-mappings`** = 8 条，`§19`/`§22` 自称「一（supply，1–7 + 1.1）」/「第一阶段 8 端点先冻结」；用户决议的「7 端点」即除 §1.1 外的编号端点，本 spec 按冻结文档的 8 条建）：每端点 zod schema、快照投影（`as_of` 缺失拒绝入库）、游标（提交成功才推进）、幂等重放。**响应无 `_label`**（契约 §0.5 已废除该机制），枚举码/状态值/单位一律英文。
- **REQ-012** — ads 9 端点同步：订单 → `platform_ops.orders.ingest`（≤500/批）、结算 → `settlements.import`（≤2000 行/单）、其余入快照。
- **REQ-013** — 同步健康与 stale：每端点 `lastAsOf`/`lastRunAt`/`cursor`/`status`；stale 阈值 24h；拉取失败发通知。
- **REQ-014** — 驾驶舱六类数一页览：日级四数 + 未识别在途 + 周复盘 + 月 ОПИУ + CN 资金三数 + SKU 覆盖率；每数带 `as_of` 与来源标签。
- **REQ-015** — 四预警：断货损失 / 超储冻结 / ДРР 破线 / 未识别在途 → `notifications` 四类型，阈值 + 去重窗口 + 审计。
- **REQ-016** — 下钻与 stale：KPI 下钻 SKU 行；游标断 > 24h 整页 banner（不隐藏数字、不假装新鲜）。
- **REQ-017** — 端到端链路验收：建供应商 → 采购单 → 定金 → 发运 → 收货 → 尾款 → 关闭 → 收汇 → 退税全链脚本化断言。
- **REQ-018** — 到期提醒：逾期未付款 / 逾期未发运 / 库存低于阈值三条规则 → `notifications`。

## Non-goals

- **不做凭证/科目/总账/账期/账龄**（用户决议）：无 journal、无 chart of accounts、无 AR/AP aging buckets、无期间关账锁。
- 不写任何 peer 模块的表：`finance`/`ru_sync`/`boss_cockpit` 全部只读 peer 数据（唯一例外：Phase 5 的 PO 草稿走 `purchasing` 既有命令）。
- 不复制 RU 已有能力：广告归因、漏斗、品牌分析只存档引用。
- 不把 RU 广告费/平台费复制成 `finance_expenses` 行（同一事实两处口径；RU 数据永远以快照形式进损益聚合）。
- 不做 RU 成本回写（`A.4` 未勾选前不动俄方数据）。
- 不引入图表库；趋势用 `@open-mercato/ui` 的一方 SVG 组件，确需新依赖先问。
- 不做俄文全文翻译；不猜 `/api/v1` key（未知一律 `待快照确认`）。

## Proposed Solution

三个新 app 自有模块 + 一处加法列，全部在 `src/modules.ts` 注册：

| 归属 | 模块 id | 拥有 | 不拥有 |
|---|---|---|---|
| 钱 | **`finance`**（新） | 柜级费用、到岸成本（读时派生）、期间费用、应付/应收/库存资金占用/损益只读投影 | 不写 peer 表；不建凭证/科目/总账；不建账期/账龄 |
| 数据 | **`ru_sync`**（新） | RU provider 适配器、16 端点快照投影、游标、SKU 映射、同步健康 | 不做业务写（唯一例外 Phase 5 的 PO 草稿走 `purchasing` 命令） |
| 看 | **`boss_cockpit`**（新） | 只读驾驶舱页 + widgets + 四预警触发 | 无 mutations |
| 加列 | `export_finance`（既有） | `collections` 加 `amount`/`received_at` | 不动收汇/退税锚点与唯一键 |

跨模块只走**标量 id + 快照 + 事件**；读 peer 表一律 scoped Kysely 只读投影（既有范式 `src/modules/export_finance/lib/peerReads.ts`）。金额量化只用 `src/modules/trade_docs/lib/money.ts` 的 BigInt 半进位（**禁 `toFixed`**；金额恒 2 位、与币种无关，`AMOUNT_SCALE=2`）。汇率读 `src/modules/currency_policy/lib/rateLookup.ts`（`loadRateRows` / `resolveCnyRate` / `CNY_DISPLAY_CURRENCY`）。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| 新建 `finance` 而不塞进 `export_finance` | `export_finance` 的契约是「收汇/退税档案」（两锚点 + 两投影）；费用/成本/损益生命周期与权限面（成本毛利敏感）不同；与 `products`/`product_codes` 的既有分法一致 | 并入 `export_finance` | 权限面被拉宽（看收汇的人必然看到成本毛利）；模块 README 契约失焦 |
| 拆 `ru_sync`（数据面）与 `boss_cockpit`（呈现面） | 回答既有 spec Q-005：同步是 provider/游标/worker/失败重跑，驾驶舱是只读聚合/权限/布局；生命周期与失败模式不同，可单独回滚（停 worker ≠ 下线页） | 合一 | 回滚粒度丢失；provider 代码归 provider 模块（integrations guide） |
| 到岸成本**读时派生不落库** | 费用或分摊权重一改，落库分摊立刻过期；读时派生永远与费用行一致，且无第二份真相 | 物化 `landed_cost_allocations` 表 | 需要失效机制、重算作业、一致性 bug 面 |
| 费用分摊与退税分摊**同一条规则** | `allocateTaxRefund`（`src/modules/export_finance/lib/fileRules.ts:321`）已经把「HALF_UP 4/2 位 + 余差落占比最大行 + 平手取 `lineNumber` 最小者」验证过；两条分摊规则必然漂移 | 各写一套 | 两个口径的分摊和会不相等，财务对不上账 |
| 无汇率**剔除**而非按 1 摊 | 按 1 折算是**伪造数字**；剔除并标红是唯一诚实行为（既有 policy：`resolveCnyRate` 返回 null 时「render nothing rather than invent a rate」） | 按 1:1 摊 | 假数进驾驶舱比空值更糟 |
| 跨币种分组不顺加 | 应付/应收多币种合计需要汇率与日期口径，静默相加得出错误总额 | 直接相加 | 错账 |
| 期间费用**不建 `source` 列** | RU 广告费/平台费以快照进损益，不复制成费用行；复制即两处口径（既有 spec 明确拒绝） | `source='ru'` 行 | 数据双写、对账噪音 |
| 驾驶舱不加图表库 | 仓库无任何图表库（recharts/echarts/chart.js 均无）；一方 SVG 组件够画趋势 | 装 recharts | 依赖面与包体；先问再定 |
| 损益行项**与 RU ОПИУ 同名同序** | 老板对照两页时行序一致才可读；`Косвенные расходы и налоги` 口径未定 → 不建行不计合计 | 自定义行项 | 无法与 RU 页对齐验收 |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| 采购价 | 采购单行不含税金额 `net_total` 折算 CNY（或原币） | `purchasing` 采购行 | 缺汇率 → 该行 `rateMissing=true`、`landedUnitCostCny=null`，原币金额照常输出 |
| 到岸成本 | 采购价 + 该行分摊的柜费用（折 CNY）；`landedUnitCostCny = (purchaseAmount + allocatedCost) / quantity` | `finance/lib/landedCost.ts`（唯一实现） | 汇率缺失的费用行 `unconvertible`，从分摊**剔除**；绝不按 1 摊 |
| 分摊规则 | `share_i = HALF_UP(fee × w_i / Σw, 4)`；余差落占比最大行；平手取 `lineNumber` 最小者 | 同 `allocateTaxRefund`（`fileRules.ts:321`） | 权重全 0 → 退化另一维度；两者全 0 → 不产生分摊（返回空数组） |
| 费用权重 | `allocation_basis='amount'` → 采购行 `net_total`；`'quantity'` → 分摊行 `quantity` | 费用行字段 | 未知值按 `amount` 处理并告警 |
| 库存资金占用 | `wms` 余额数量 × 单位成本；单位成本解析顺序：① SKU 最近一次已收货柜的到岸单价 ② `products_prices` 的 `purchase` 档（CNY 优先，缺 CNY 用最新汇率折）③ missing | `finance/lib/costResolver.ts`（唯一实现） | `missing` → 计价 0 并单列「未计价数量」；计入 `totals.unconvertible` |
| 应付 | 每采购单一行：`orderTotal/paidAmount/outstandingAmount/paymentStatus` | `purchasing/lib/orderTotals.ts:93 derivePaymentState`（import 复用） | `outstanding` 已钳 ≥ 0；不写第二套口径 |
| 应收·出口收汇 | `export_finance_collections.amount/received_at` | `export_finance`（加法列） | 旧记录两列 null 照常可读；null ≠ 0 |
| 应收·平台结算 | `platform_ops_settlements.net_amount`；已收 = `received_at is null ? 0 : net_amount` | `platform_ops` | **未收判定只看 `received_at`，不看 `status`** |
| 应收·内部销售 | 安装 `sales` 订单总额 vs `sales_payments` 已收（订单币种） | `sales` | 同上 |
| ДРР | `расход / чистая выручка`；живыми = 实付口径，начислено = 应计口径 | RU `/ads` 头（快照） | 双口径**两列并显**，禁单列；预测口径禁入关账列 |
| Маржа по продажам / по заказам | 事实 / 预测（标 прогноз）；`маржа = Продажи − Удержания − Себестоимость − Реклама` | RU `marketplaces/summary` | 每行带 `caliber`，禁混列 |
| Canonical SKU | 去空白 + 剥 `склад`/`фабрика` 后缀 + 转大写；`matchKey` = 只留字母数字并大写 | `ru_sync/lib/skuNormalize.ts` | 零/多命中 → 留 `unmapped`；未映射不静默合并 |
| 未识别在途 | 无采购卡 / 去 планируем flag / 工厂未知码；**不扣减需求** | RU 独立端点（§5） | 缺失 → 该数标 stale，禁按全量算 |
| as_of / updated_at | 每快照的数据日期 + 每行更新时间（游标用） | RU 各端点 | 缺 `as_of` → 拒绝入库并告警 |
| 按域分账本 | 需求量/在途/ФБО = RU；PO/收货/收汇退税/发票 = CN | 本 spec | 冲突 → 对账队列，不静默覆盖 |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 财务 | 记柜费用、记期间费用、看应付/应收/库存资金占用/损益 | 本组织读写；上级组织只读下级的汇总由既有 scope 展开承接 | `finance.costs.view\|manage`、`finance.expenses.view\|manage`、`finance.ledger.view`、`finance.profit.view` |
| 采购/业务 | 看到岸成本与缺成本清单 | 本组织读 | `finance.costs.view`、`finance.ledger.view` |
| 供应计划 | 看 supply 域 + 从 plan 生成 PO 草稿 | 本组织写 PO，其余读 | `ru_sync.view`、`ru_sync.map.manage`、`purchasing.orders.manage`（既有） |
| 同步作业 | 读写同步投影 + 游标 | 组织行双 scope；游标行走 tenant scope（见下） | `ru_sync.run`（系统作业专用；不授予常规角色） |
| 老板/管理层 | 看驾驶舱全部 + 订阅四预警 | 全部组织（读） | `boss_cockpit.view`（新）+ `dashboards.view`（既有） |

**Scope 派生**：`tenantId` / `organizationId` 只从 session 派生（`ensureScope` 范式，`src/modules/export_finance/lib/scope.ts` 同形），缺失 fail-closed（400 + `organization_scope_required`）。**唯一允许 tenant 域的行**：`ru_sync_cursors`（游标）——reason：RU token 是租户级 provider 凭证，游标跟着凭证走；该表的读写由 `ru_sync.run` 门禁的同步作业完成，**永不**因为有 tenant 行而让请求路径读到组织外数据（投影表 `ru_sync_snapshots` 仍是组织行双 scope）。这是本 spec 唯一的 tenant-scope 例外，理由记录于此。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 柜级费用 / 期间费用 | app-own | `finance`（新） | — | 全仓无费用实体 |
| 到岸成本 / 库存资金占用 / 损益 | app-own 读时派生 | `finance` | peer 只读 SQL 投影（`peerReads` 范式） | 不落第二份真相 |
| 应付状态口径 | reuse | `purchasing/lib/orderTotals.ts` | 直接 import 纯函数 | 一份口径，`derivePaymentState` 已全仓零引用 |
| 收汇金额 | extend（加法列） | `export_finance`（既有） | 既有命令 + 投影 | 不动锚点与唯一键 |
| 平台结算来源 | reuse | `platform_ops` 只读 | SQL 投影 | 结算已有 `net_amount`/`received_at` |
| 内部销售来源 | reuse | 安装 `sales` 只读 | SQL 投影 | 引擎已存在 |
| RU 同步传输 | app-own provider | `ru_sync`（新） | `DataSyncAdapter` + `data_sync` worker + 游标 | provider 代码归 provider 模块（integrations guide）；参考 `@open-mercato/sync-akeneo` |
| 凭证存储 | reuse | `integrations` credential service + 加密映射 | DI sender/health | 不新建密钥面 |
| 订单/结算落点 | reuse | `platform_ops.orders.ingest` / `settlements.import` 既有命令 | 命令调用 | 不新写幂等入口 |
| 对账队列 | reuse + append | `platform_ops.reconciliation` 既有权 kinds | 事件/命令 | 差异不覆盖账面 |
| 通知 | reuse | `notifications` 新类型 IDs | typed events → notification types | 阈值触发有审计 |
| 驾驶舱宿主 | reuse | 安装 `dashboards`（widget 文件约定 + 布局 + ACL） | `DashboardWidgetModule`（`example/widgets/dashboard/todos/widget.ts` 形态） | 不重建宿主 |
| PO 草稿 | reuse | `purchasing.purchase-orders.create`（draft） | 命令调用 | 不新写下单路径 |

## Architecture and Data Flow

```text
用户 → /backend/finance/*（DataTable/CrudForm）→ /api/finance/*（makeCrudRoute 或 guarded route）
                                    → finance_shipment_costs / finance_expenses（唯一两张写表）
                                    → 读时派生：landedCost.ts / costResolver.ts / ledger.ts / profitLoss.ts
                                       （scoped Kysely 只读 purchasing/cross_border/wms/products/trade_docs/sales/platform_ops）

RU BI (/api/v1/supply/*, pull + bearer + updated_since)
   → ru_sync/lib/client.ts（SSRF 校验 + 重试）→ ru_sync/lib/adapter.ts（DataSyncAdapter）
   → ru_sync_snapshots（组织行，as_of + 自然键幂等 upsert）
   → ru_sync_cursors（tenant 行，成功页后推进）
   → 4 阈值事件 → notifications（四预警）

boss_cockpit/lib/summary.ts（只读聚合：RU 快照 + CN 派生）
   → GET /api/boss-cockpit/summary → /backend/boss-cockpit + widgets/dashboard/{supply-gap,in-transit,overstock,drr}
```

- **Module boundaries:** `finance` 拥有费用与派生账本（两张写表，其余只读）；`ru_sync` 拥有同步与投影（含游标）；`boss_cockpit` 拥有只读聚合与预警触发（零写表）。三者互不 import 实体，只 import 纯函数/类型或读 SQL。
- **Extension points:** `dashboards` widget 文件约定；`notifications` 类型注册；`platform_ops.reconciliation` kinds 追加；`payables` 复用 `purchasing` 纯函数。不改任何 installed 代码。
- **Alternatives considered:** 直写业务表（破坏幂等与审计）；爬 HTML / CSV 主通道（脆断 / 无游标）；物化分摊（需失效机制）。
- **Compatibility:** 既有 7+ 模块 API/事件/表结构零变更；`export_finance_collections` 只加两列（null 可读）；新增全为加法（新模块 + 新 features + 新通知类型 + 新字典）。

## User Journeys

### Journey J-001 — 财务记一笔柜费用并看到到岸成本

1. 财务在 `/backend/finance/shipment-costs` 新建：选柜（选项源 = `cross_border` 发运单，显示柜号）、类型（字典）、金额 + 币种（可留空汇率）。
2. 保存 201；事件 `finance.shipment_cost.created` 提交后发出。
3. 打开 `/backend/finance/landed-costs?shipmentId=…`：每采购行一行（采购价 CNY + 分摊 CNY + 到岸合计 + 到岸单价），按 SKU 汇总同形。
4. 跨组织柜 / 已取消柜 → **409** 且不落库；金额 ≤0 或币种不在字典 → 400；汇率取不到 → 该费用行标红 `unconvertible` 且不进分摊和。

### Journey J-002 — 老板早会看四数

1. 老板打开 `/backend/boss-cockpit`（≤3 点击）。
2. 日级四数（缺口金额 / 在途金额 / 积压金额 / ДРР 双口径）+ 未识别在途 badge；每数带 `as_of` 与来源标签。
3. 点 KPI → 下钻 `DataTable`（Остаток / дней до OOS / ETA / Заказать до）。
4. 游标断 > 24h → 整页 banner 标 stale；无 `boss_cockpit.view` → 403。

### Journey J-003 — 计划员把缺口变 PO 草稿

1. 计划员在 `/backend/ru-sync/...`（plan 区块）勾选行。
2. 生成 PO 草稿（**只建 draft，不自动 place**）。
3. 未映射 SKU 行 **422** 且不生成任何行；其余行走既有 `purchasing.purchase-orders.create` 校验。

### Journey J-004 — 财务月关账对 ОПИУ

1. 财务打开 `/backend/finance/profit-loss`，选期间与 `basis=fact`。
2. 行项与 RU ОПИУ 同名同序；`Косвенные расходы и налоги` 无行不合计。
3. 事实/预测分列（`caliber`），超差 SKU 进对账队列。

### Journey J-005 — 映射 SKU

1. 计划员打开 `/backend/ru-sync/sku-map`：未映射 `ru_sku` 清单（自动建议已跑）。
2. 手动绑定 → `mapped`；忽略 → `ignored`；清单为派生（快照出现但无 `mapped` 行）。
3. 映射后重跑同步与 plan 视图。

## UI and Interaction Contracts

参考页：`src/modules/example/backend/todos/page.tsx` + `components/TodosTable.tsx`（列表/表格）、`src/modules/example/backend/todos/create/page.tsx` 与 `[id]/edit/page.tsx` + `components/TodoForm.tsx`（表单）——`src/modules/example` 是 source-present、runtime-disabled 的参考模块，只读单行、重命名所有标识符。

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/finance/shipment-costs` | 柜费用列表 / 新建 / 编辑 / 删除 | `GET\|POST\|PUT\|DELETE /api/finance/shipment-costs`；字典 `shipment_cost_type`；柜选项源 `cross_border` 发运单 | `example/backend/todos/page.tsx` + `components/TodosTable.tsx` | `Page`/`PageHeader`/`PageBody`、`DataTable`、`CrudForm`、`RowActions` | loading, empty, error, 409 冲突, success, permission denied | REQ-001 |
| `/backend/finance/shipment-costs/create`、`/backend/finance/shipment-costs/[id]/edit` | 新建 / 编辑费用行 | 同上 | `example/backend/todos/create/page.tsx`、`[id]/edit/page.tsx` | `CrudForm`、`FormField`、flash | 校验错误、409（`updatedAt`）、clearable 清空、返回导航 | REQ-001 |
| `/backend/finance/expenses`（+ create/edit） | 期间费用列表 / CRUD | `GET\|POST\|PUT\|DELETE /api/finance/expenses`；字典 `finance_expense_type` | 同上 | 同上 | 同上 | REQ-004 |
| `/backend/finance/landed-costs` | 只读：柜 → 行/SKU 到岸成本 | `GET /api/finance/landed-costs?shipmentId=\|sku=` | `example/components/TodosTable.tsx`（只读表） | `DataTable`（只读、无 RowActions 写）、KPI 头 | loading, empty（无费用/无行）, error, `rateMissing` 标红行 | REQ-002, REQ-003 |
| `/backend/finance/inventory-value` | 只读：库存资金占用 + 双口径 + 缺成本清单 | `GET /api/finance/inventory-value?warehouseId=&asOf=` | 同上 | 同上 + CSV 导出 | loading, empty, error, `missing` 行与「未计价数量」单列 | REQ-003 |
| `/backend/finance/payables` | 只读：应付台账（按供应商+币种分组） | `GET /api/finance/payables` | 同上 | `DataTable` + 分组头 | loading, empty, error, 多币种分组不顺加提示 | REQ-005 |
| `/backend/finance/receivables` | 只读：应收台账（三类来源） | `GET /api/finance/receivables?kind=` | 同上 | 同上 | loading, empty, error | REQ-006 |
| `/backend/finance/profit-loss` | 只读：月损益行项（事实/预测分列） | `GET /api/finance/profit-loss?periodStart=&periodEnd=&basis=` | 同上 | `DataTable` + KPI 头 | loading, empty（未接入 RU）, error, `caliber` 列 | REQ-008 |
| `/backend/finance/sku-margin` | 只读：SKU 毛利 + 对账差异 | `GET /api/finance/sku-margin?periodStart=&periodEnd=` | 同上 | 同上 | loading, empty, error, 超差标记 | REQ-009 |
| `/backend/ru-sync/sku-map` | 映射列表 + 手工绑定 + 忽略 | `GET /api/ru-sync/sku-map`、`PUT /api/ru-sync/sku-map`（绑定/忽略） | 同上 | `DataTable` + `RowActions`（绑定对话框 `useConfirmDialog`） | loading, empty, error, 冲突 | REQ-010 |
| `/backend/ru-sync/health` | 只读：每端点 lastAsOf/lastRunAt/cursor/status | `GET /api/ru-sync/health` | 同上 | `DataTable` + `StatusBadge` | loading, empty, error, stale 高亮 | REQ-013 |
| `/backend/boss-cockpit` | 六类数一页览 + 下钻 | `GET /api/boss-cockpit/summary?asOf=` | `example/components/TodosTable.tsx` + dashboards 宿主 | `Page`/`PageBody`、KPI 头组件族、`DataTable`（下钻）、`Alert`（stale banner） | loading, empty, error, stale banner, permission denied | REQ-014, REQ-016 |
| dashboards widgets ×4（`supply-gap`/`in-transit`/`overstock`/`drr`） | 四数 widget | 同 `/api/boss-cockpit/summary` | `example/widgets/dashboard/todos/widget.ts` | `DashboardWidgetModule` + lazy client；`metadata.features = ['boss_cockpit.view']` | loading, empty, error, stale；ДРР 在 Phase 6 前显示「未接入」空态 | REQ-014, REQ-016 |
| `/backend/finance/**`、`/backend/ru-sync/**`、`/backend/boss-cockpit` 导航 | 三组（2026-09-28 按受众拆分）：财务作业与台账（柜费用 / 到岸成本 / 期间费用 / 应付 / 应收）沿用 `pageGroupKey: 'export_finance.nav.group'`（组名「财务」）；老板结果页（驾驶舱 / 月损益 / SKU 毛利 / 库存资金占用）用 `executive_overview.nav.group`（「经营概览」，label 在 `boss_cockpit/i18n`）；RU 管道运维页（映射 / 健康）用 `ru_sync.nav.group`（「数据同步」，label 在 `ru_sync/i18n`）；`src/modules.ts` 的 `groupOrder` 声明三个 id 的顺序 | `page.meta.ts` | `example/backend/todos/page.meta.ts` | `icon` 必须是 installed 图标注册表内的名字 | — | REQ-014 |

**Cross-record references:** 柜（费用表单）→ `cross_border` 发运单选项源（显示柜号）；往来方 → `parties` 选项源（显示名称）；渠道 → `platform_ops` 渠道选项源；币种 → installed `currencies` / 字典。每个引用字段写明选项源路由；表格渲染显示名或快照，UUID 只出现在 payload。

**Design-system and theming:** 语义 token + `StatusBadge`；禁硬编码状态色与任意 Tailwind 值；明/暗、窄宽、键盘（Cmd/Ctrl+Enter 提交、Esc 取消）、a11y（标签/公告/焦点序）在实现阶段逐页实测。

## Data Models

### `FinanceShipmentCost`（`finance_shipment_costs`）

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | uuid PK | primary key | no | immutable |
| `tenant_id` / `organization_id` | uuid NOT NULL | `(organization_id, tenant_id)`、`(tenant_id, organization_id, shipment_id)` 索引 | no | trusted context only |
| `shipment_id` | uuid NOT NULL | 见上 | no | 写入时校验：本组织存在且 `status != 'cancelled'`，否则 409 |
| `shipment_number` | text NULL | — | no | 写入时快照 |
| `cost_type` | text NOT NULL | — | no | 字典 `shipment_cost_type` 成员，否则 400 |
| `allocation_basis` | text NOT NULL DEFAULT `'amount'` | — | no | `amount\|quantity` |
| `amount` | numeric(18,2) NOT NULL | — | no | > 0，否则 400 |
| `currency_code` | text NOT NULL DEFAULT `'CNY'` | — | no | 字典成员或 ISO 校验 |
| `exchange_rate` | numeric(18,8) NULL | — | no | 空 → 读时 `resolveCnyRate` 现取 |
| `incurred_at` | date NULL | — | no | — |
| `party_id` / `party_snapshot` | uuid NULL / jsonb NULL | — | no | 货代/报关行；快照 |
| `attachment_id` | uuid NULL | — | no | installed `attachments` |
| `note` | text NULL | — | no | — |
| `created_at` / `updated_at` / `deleted_at` | timestamp | `updated_at` = optimistic lock | no | 软删 |

命令 `finance.shipment-costs.{create,update,delete}`；事件 `finance.shipment_cost.{created,updated,deleted}`。

### `FinanceExpense`（`finance_expenses`）

`id, tenant_id, organization_id, expense_type`（字典 `finance_expense_type`：`advertising|platform_fee|logistics|warehousing|bank_charge|office|payroll|other`）、`period_start date NOT NULL`、`period_end date NOT NULL`（含首含尾；`period_end < period_start` → 400）、`amount numeric(18,2) NOT NULL`（>0）、`currency_code`、`exchange_rate numeric(18,8) NULL`、`channel_id uuid NULL` + `channel_snapshot`（给值时空组织校验 404）、`party_id uuid NULL` + `party_snapshot`、`attachment_id uuid NULL`、`note`、`created_at/updated_at/deleted_at` + scope 索引。命令 `finance.expenses.{create,update,delete}`；事件 `finance.expense.{created,updated,deleted}`。**不建 `source` 列**。

### `RuSyncSkuMap`（`ru_sync_sku_map`）

`id, tenant_id, organization_id, ru_sku text NOT NULL, product_id uuid NULL, status text NOT NULL DEFAULT 'unmapped' ('mapped'|'ignored'|'unmapped'), note text NULL, created_at, updated_at`；唯一 `(tenant_id, organization_id, ru_sku)`。

### `RuSyncSnapshot`（`ru_sync_snapshots`）

`id, tenant_id, organization_id, endpoint text NOT NULL（endpoint 键，取值 = `skus`/`sku_mappings`/`stock`/`in_transit`/`unrecognized_inbound`/`plan`/`shipments`/`params`/ads 9 键）, natural_key text NOT NULL, payload jsonb NOT NULL, as_of date NOT NULL, updated_at`；唯一 `(tenant_id, organization_id, endpoint, natural_key, as_of)`。**缺 `as_of` 的响应拒绝入库并告警**；同 `as_of` 重放 upsert 幂等。自然键取契约声明：§1/§2/§3/§5 `(sku)`、§1.1 `(ru_code)`、§6 单 `(number)`/行 `(number, model)`、§7 `(version)`；**§4 `unrecognized-inbound` 契约未声明自然键** → 用返回行 `sku` 原值并在端点 schema 注释注明「契约未声明，以实现为准」。

### `RuSyncCursor`（`ru_sync_cursors`）

`id, tenant_id, endpoint text NOT NULL, cursor text NULL, updated_at`；唯一 `(tenant_id, endpoint)`。**tenant 域行**（理由见 Users/Permissions）：游标跟租户级 provider 凭证走；本页全部 upsert 提交成功后才推进，失败页不推进。

### `ExportFinanceCollection`（既有表，加法两列）

`amount numeric(18,2) NULL`、`received_at date NULL`。既有列零改动；旧记录两列为 null 必须照常可读。`collections.save` 载荷与校验（`>0`、最多 2 位小数，与 `tax_refund_amount` 同规则）。

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET`/`POST`/`PUT`/`DELETE` | `/api/finance/shipment-costs` | auth + `finance.costs.view` / `finance.costs.manage` | CRUD 载荷（zod：`shipmentId`、`costType`、`amount`、`currencyCode`、`exchangeRate`、`incurredAt`、`partyId`、`attachmentId`、`note`、`updatedAt`） | 200/201 + `finance.shipment_cost.*` | 400（金额/字典）、403、404（peer 不存在）、409（跨组织/已取消柜、optimistic lock） | REQ-001 |
| `GET` | `/api/finance/landed-costs` | auth + `finance.costs.view` | `shipmentId` 或 `sku` 必填其一 | `{ rows, skuRows, unconvertible[] }` | 400（两者皆缺）、403 | REQ-002, REQ-003 |
| `GET` | `/api/finance/inventory-value` | auth + `finance.ledger.view` | `warehouseId?`、`asOf?` | `{ rows, totals{value, missingQuantity, unconvertible[]} }` | 400/403 | REQ-003 |
| `GET`/`POST`/`PUT`/`DELETE` | `/api/finance/expenses` | auth + `finance.expenses.view` / `finance.expenses.manage` | CRUD 载荷 | 200/201 + `finance.expense.*` | 400（期间倒置/金额）、403、404（渠道跨组织）、409 | REQ-004 |
| `GET` | `/api/finance/payables` | auth + `finance.ledger.view` | `supplierId?`、`paymentStatus?` | `{ groups[], rows[] }` | 400/403 | REQ-005 |
| `GET` | `/api/finance/receivables` | auth + `finance.ledger.view` | `kind?=export_collection\|platform_settlement\|internal_sales` | `{ rows[], totalsByCurrency[] }` | 400/403 | REQ-006 |
| `PUT`（既有 `export_finance.collections.save`） | `/api/export_finance/collections` | auth + `export_finance.manage` | 既有载荷 + `amount`/`receivedAt` | 200 + `export_finance.collections.updated` | 400（金额格式）、409 | REQ-007 |
| `GET` | `/api/finance/profit-loss` | auth + `finance.profit.view` | `periodStart`、`periodEnd`、`channelId?`、`basis=fact\|forecast` | `{ rows[], totals, asOf }` | 400/403 | REQ-008 |
| `GET` | `/api/finance/sku-margin` | auth + `finance.profit.view` | `periodStart`、`periodEnd` | `{ rows[] }` | 400/403 | REQ-009 |
| `GET`/`PUT` | `/api/ru-sync/sku-map` | auth + `ru_sync.view` / `ru_sync.map.manage` | `ruSku`、`productId` 或 `status` | 200 | 400/403/404/409 | REQ-010 |
| worker | `ru_sync.pull`（`data_sync` run + 游标） | `ru_sync.run`（作业） | endpoint 集、`fullSync?` | 投影 upsert + 游标推进 + 事件 | transient 重试；失败页不推进；同 `as_of` 幂等 | REQ-011, REQ-012 |
| `GET` | `/api/ru-sync/health` | auth + `ru_sync.view` | — | `{ endpoints[] }` | 403 | REQ-013 |
| `POST` | `/api/ru-sync/plan/draft-pos` | auth + `purchasing.orders.manage` | `sku[]`（已映射） | PO 草稿号 + `purchasing.purchase_order.created` | 400/403/422（未映射）、409 | REQ-017（Phase 5） |
| `GET` | `/api/boss-cockpit/summary` | auth + `boss_cockpit.view` | `asOf?` | `{ kpis[], asOf, stale }` | 400/401/403 | REQ-014, REQ-016 |

写入路由一律走 `makeCrudRoute`（既有 `export_finance/api/collections/route.ts` 的 PUT 形态）或带门禁的命令路由；每方法 `metadata` + `openApi`。`finance` 只读派生路由用自定义 guarded route（`example/api/organizations/route.ts` 形态的 auth + scope 读取）。`ru_sync` 适配器按 `@open-mercato/sync-akeneo` 的 `integration.ts`/`di.ts` 注册形态接入 `data_sync` 的 run API。

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `finance.shipment_cost.created/updated/deleted` | `finance` 命令 | 订阅者/审计 | 提交后发出 | 命令审计 + `action_logs` |
| `finance.expense.created/updated/deleted` | `finance` 命令 | — | 同上 | 同上 |
| `export_finance.collections.updated` | 既有命令 | 投影/驾驶舱缓存 | 金额变更 | 既有合同不变 |
| `ru_sync.pull.completed` / `ru_sync.pull.failed` | `ru_sync` worker | 健康表 / `notifications`（`ru_sync.pull_failed`） | 游标推进 / 告警 | 失败页不推进；重放幂等 |
| `ru_sync.alert.stockout` / `overstock` / `drr_threshold` / `unrecognized_in_transit` | `ru_sync` 拉取作业（阈值穿越） | `notifications` 四类型 | 老板四预警 | 去重窗口 + 审计；阈值取 supply 参数页值 |
| `boss_cockpit.summary.viewed` | 不产生（只读） | — | — | — |
| FLOW-G2 三条到期规则 | `finance`/`purchasing`/`cross_border` 读 + 计划任务 | `notifications` | 逾期未付款 / 逾期未发运 / 库存低于阈值 | 去重窗口 + 审计（`module.setup-scheduler-target` 形态） |

## Security, Privacy, and Compliance

- **Authorization:** 新 features（`finance.costs.view|manage`、`finance.expenses.view|manage`、`finance.ledger.view`、`finance.profit.view`、`ru_sync.view|map.manage|run`、`boss_cockpit.view`）+ 既有复用；禁角色名检查；`setup.ts` 授 superadmin/admin（`export_finance/setup.ts` 同形），既有租户跑 `yarn mercato auth sync-role-acls`。
- **Tenant isolation:** 组织行双 scope 过滤 fail-closed；`ru_sync_cursors` 的 tenant 域例外只限游标表，理由与边界记录于本 spec；投影表仍组织行。
- **Sensitive data:** RU token 走 `integrations` credential service + 加密映射；**token 永不进代码/文档/日志/响应**；base URL 做 SSRF 校验；成本毛利页按 `finance.profit.view` 单独门禁。
- **Abuse and failure modes:** 无汇率必须剔除/标红而非按 1；枚举与注入（zod + Kysely 参数化）；重放（自然键 + `as_of` 唯一）；并发（`updated_at` optimistic lock → 409）；软删 → 读路径 `deleted_at is null`。

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | unit | 分摊：行 `net_total`、权重全 0、无汇率、USD→CNY | 调 `finance/lib/landedCost.ts` | 余差落占比最大行、平手取最小 `lineNumber`、Σ分摊 == 费用×汇率、`unconvertible` 剔除、`rateMissing` 置空 | REQ-002 |
| TEST-002 | integration | 新柜 + 采购行 | `POST /api/finance/shipment-costs`（USD 1000 + 汇率）→ `GET /api/finance/landed-costs?shipmentId=…` | Σ分摊 == 1000×汇率；逐行 `landedUnitCost = (purchaseAmount + allocatedCost) / quantity` | REQ-001, REQ-002 |
| TEST-003 | integration | 采购单 + 付款行；三类应收各一条 | `GET /api/finance/payables`、`/receivables`；`PUT /api/export_finance/collections` 带 `amount` | 应付四值与手算一致；三类来源各一行；旧记录 `amount=null` 不报错；回读一致 | REQ-005, REQ-006, REQ-007 |
| TEST-004 | integration | mock 7 端点（含未映射 SKU 与未识别在途） | 全量拉取 → 同 `as_of` 重放 → 中途 500 | 投影行数 == mock 行数；重放 0 新增；`cursor` 不推进；未映射进清单 | REQ-010, REQ-011 |
| TEST-005 | security | 第二 tenant / 无 feature | 读驾驶舱 / 调同步 / 读成本 | fail closed，无泄漏 | REQ-014, REQ-003 |
| TEST-006 | UI | stale 游标 / 空 plan / 未映射 | 打开驾驶舱三态与下钻 | stale banner、空态、置灰行、widget 可见并尊重布局 | REQ-014, REQ-016 |
| TEST-007 | integration | 全链夹具（供应商→PO→定金→发运→收货→尾款→关闭→收汇→退税） | **已实现**：`src/modules/finance/__integration__/finance-flow.spec.ts`，`yarn mercato test:integration finance-flow` | **通过**（2026-09-28，全新一次性库）：采购行 `received_quantity` == `wms` 余额（10 == 10）；Σ到岸分摊 == Σ柜费用（1400 == 200 USD × 7）；应付结清 1000/1000；收汇 1200 入应收台账、余额 0；退税 130 按柜分摊回采购单 | REQ-017 |
| TEST-008 | integration | ads fixture（订单/结算/销售/汇总/成本/价格） | ads 拉取 → ingest/import/snapshot | 按 500/2000 切批；重复 externalId 幂等；损益行与 RU 页 ≤0.2 п.п./20 ₽ | REQ-012, REQ-008 |

## Implementation Phases

### Phase 0 — 规格落地

- **Depends on:** none
- **Outcome:** 本 spec 成为执行口径；既有 reconciliation spec 交接口径（Q-005 决议）。
- **Deliverables:** 本文件；`.ai/specs/2026-09-28-three-system-metric-reconciliation.md` 的 Status/Q-005 更新；`docs/prd/finance-and-cockpit.md`、`docs/plans/finance-and-cockpit.md`、`docs/plans/README.md` 一行。
- **Requirements closed:** —
- **Tests:** —
- **Validation:** 文档内链可点、`docs/plans/finance-and-cockpit.md` 进度表可续写。
- **Exit gate:** 三份文档存在且互相链到本 spec。

### Phase 1 — `finance` 成本底座（FIN-A）

- **Depends on:** Phase 0
- **Outcome:** 柜费用可记；到岸成本可算；库存资金占用可看三源解析。
- **Why this order / value delivered:** 财务侧第一批真实价值（柜费用→到岸成本），且是损益 `cost` 行的输入。
- **Deliverables:** `finance` 模块骨架（`index.ts`/`acl.ts`/`setup.ts`/`events.ts`/`data/*`/`commands/shipmentCosts.ts`/`api/*`/`lib/{landedCost,costResolver,peerReads}.ts`/`backend/finance/**`/`i18n/*`/`README.md`）；字典种子 `shipment_cost_type`；`src/modules.ts` 注册；迁移。
- **Independent slices / estimated commits:** 实体+命令+路由；`landedCost.ts`+单测；`costResolver.ts`+路由；三页 UI。
- **Requirements closed:** REQ-001, REQ-002, REQ-003
- **Tests:** TEST-001, TEST-002, TEST-005
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build`；`yarn test src/modules/finance`。
- **Exit gate:** Σ分摊 == 费用×汇率（2 位）逐柜成立；三页明/暗 + 空态 + `rateMissing` 标红实测；迁移经批准已应用。

### Phase 2 — 费用与台账（FIN-B/C）

- **Depends on:** Phase 1
- **Outcome:** 期间费用可记；应付/应收/收汇金额三处台账可查。
- **Why this order / value delivered:** CN 资金三数中两数（应付未收）可算，驾驶舱 CN 侧输入就位。
- **Deliverables:** `FinanceExpense` + 命令 + 路由 + 三页 + 字典种子；`export_finance` 加法两列（实体/校验/命令/投影/CSV/屏幕列/i18n/README）；`finance/lib/ledger.ts` 两路由 + 两页；ACL 授予 + `sync-role-acls`。
- **Independent slices / estimated commits:** 费用切片；收汇加列切片；应付/应收切片。
- **Requirements closed:** REQ-004, REQ-005, REQ-006, REQ-007
- **Tests:** TEST-003
- **Validation:** 同上 + 浏览器三页。
- **Exit gate:** 应付四值与采购单详情手算逐单一致；三类应收各一行；`collections.amount` 回读一致、旧记录不报错；迁移经批准已应用。

### Phase 3 — `ru_sync` supply 7 端点（SYN-E）

- **Depends on:** Phase 0（契约冻结于 `supply-sync-tech.md`）
- **Outcome:** 7 端点可拉、投影可查、游标连续；映射页可用；健康页可读。
- **Deliverables:** `ru_sync` 模块骨架 + `lib/skuNormalize.ts` + `ru_sync_sku_map` + 映射页；`ru_sync_snapshots`/`ru_sync_cursors` + `lib/client.ts` + `lib/endpoints/*.ts`（7 zod schema）+ `lib/adapter.ts` + `integration.ts`/`di.ts`；拉取作业 + health 路由/页 + `ru_sync.pull_failed` 通知类型；mock 夹具（含未映射 SKU 与未识别在途）。
- **Independent slices / estimated commits:** 映射切片；客户端+端点 schema 切片（逐端点）；作业+健康切片。
- **Requirements closed:** REQ-010, REQ-011, REQ-013
- **Tests:** TEST-004
- **Validation:** `yarn test src/modules/ru_sync`；mock 全量 + 重放 + 中途失败。
- **Exit gate:** 投影行数 == mock 行数；重放 0 新增；失败游标不推进；健康页 stale 演示（游标改到 25h 前）。

### Phase 4 — `boss_cockpit` v1（CPK-F1/F3 子集）

- **Depends on:** Phase 1/2/3
- **Outcome:** 驾驶舱可看：供应三数 + 未识别在途 + CN 资金三数 + SKU 覆盖率；下钻与 stale。
- **Deliverables:** `boss_cockpit` 模块 + `lib/summary.ts` + `GET /api/boss-cockpit/summary` + 页 + stale banner + 4 widgets + `yarn generate` + `boss_cockpit.view`。
- **Independent slices / estimated commits:** 聚合 API；页；widgets 注册。
- **Requirements closed:** REQ-014, REQ-016
- **Tests:** TEST-005, TEST-006
- **Validation:** 每 KPI 与其来源 API 逐一核对；无权限 403。
- **Exit gate:** 六类数（可得子集）各带 `as_of` 与来源；widget 在宿主仪表盘可见并尊重用户布局；stale banner 实测。

### Phase 5 — 供应计划闭环

- **Depends on:** Phase 3
- **Outcome:** 缺口一键变 draft PO；未映射异常清单可见。
- **Deliverables:** `POST /api/ru-sync/plan/draft-pos`（只建 draft）；异常清单区块/页；`platform_ops.reconciliation` 供应差异 kinds。
- **Requirements closed:** REQ-017（草稿部分）
- **Tests:** TEST-004（扩展未映射 422）
- **Validation:** 端到端 draft + 409/422 路径。
- **Exit gate:** 未映射行禁生成；place 仍走既有路径。

### Phase 6 — ads 9 端点 + 损益（SYN-E3、FIN-D）

- **Depends on:** Phase 3（adapter 追加）
- **Outcome:** 订单/结算进既有幂等入口；损益与 SKU 毛利可算。
- **Deliverables:** 适配器追加 9 entity（订单 → `platform_ops.orders.ingest` 按 500 切批、结算 → `settlements.import` 按 2000 行切单、销售/汇总/成本/价格 → 快照）；`finance/lib/profitLoss.ts` + `finance/lib/skuMargin.ts` + 两路由 + 两页；对账差异 kinds 追加。
- **Requirements closed:** REQ-008, REQ-009, REQ-012
- **Tests:** TEST-008
- **Validation:** `GET /api/finance/profit-loss` 与 RU `/ads/summary` 数字对齐（≤0.2 п.п./20 ₽）。
- **Exit gate:** 事实/预测不混列；成本行取到岸成本并带 `as_of`；超差行进对账队列。

### Phase 7 — 驾驶舱 v2 + 四预警

- **Depends on:** Phase 4 + Phase 6
- **Outcome:** 六类数齐全（含周复盘与月 ОПИУ）；四预警可达老板。
- **Deliverables:** 每周/月视图；ДРР 双口径两列；SKU 毛利下钻；四预警 typed events → `notifications`（阈值/去重窗口/审计）。
- **Requirements closed:** REQ-014（完整）、REQ-015
- **Tests:** TEST-006, TEST-008
- **Validation:** 明暗 + 窄宽 + 键盘实测；阈值穿越实测。
- **Exit gate:** 六类数全部就位；四预警各自触发一次且去重生效。

### Phase 8 — 流程收尾（FLOW-G）

- **Depends on:**全部
- **Outcome:** 端到端链路脚本化验收；三条到期提醒上线；`docs/prd/cross-border-erp.md` 验收清单按实测闭环。
- **Deliverables:** FLOW-G1 集成 spec（纳入 `yarn test:integration:ephemeral`）；FLOW-G2 三条提醒；文档状态收口。
- **Requirements closed:** REQ-017, REQ-018
- **Tests:** TEST-007
- **Validation:** `yarn test:integration:ephemeral`（全新库）。
- **Exit gate:** 全链脚本通过；提醒三条各触发一次；验收清单无未解释的空格。

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001, `/backend/finance/shipment-costs` | `finance_shipment_costs`；`/api/finance/shipment-costs`；`finance.shipment_cost.*` | Phase 1 | TEST-002 | AC-001 |
| REQ-002 | J-001, `/backend/finance/landed-costs` | `lib/landedCost.ts`；`GET /api/finance/landed-costs` | Phase 1 | TEST-001, TEST-002 | AC-002 |
| REQ-003 | `/backend/finance/inventory-value` | `lib/costResolver.ts`；`GET /api/finance/inventory-value` | Phase 1 | TEST-001, TEST-005 | AC-003 |
| REQ-004 | `/backend/finance/expenses` | `finance_expenses`；`/api/finance/expenses`；`finance.expense.*` | Phase 2 | TEST-003 | AC-004 |
| REQ-005 | `/backend/finance/payables` | `lib/ledger.ts` + `derivePaymentState`；`GET /api/finance/payables` | Phase 2 | TEST-003 | AC-005 |
| REQ-006 | `/backend/finance/receivables` | `lib/ledger.ts`；`GET /api/finance/receivables` | Phase 2 | TEST-003 | AC-006 |
| REQ-007 | 订单档案财务视图 | `export_finance_collections.amount/received_at`；`collections.save` | Phase 2 | TEST-003 | AC-007 |
| REQ-008 | J-004, `/backend/finance/profit-loss` | `lib/profitLoss.ts`；`GET /api/finance/profit-loss` | Phase 6 | TEST-008 | AC-008 |
| REQ-009 | `/backend/finance/sku-margin` | `lib/skuMargin.ts`；`GET /api/finance/sku-margin` | Phase 6 | TEST-008 | AC-009 |
| REQ-010 | J-005, `/backend/ru-sync/sku-map` | `ru_sync_sku_map`；`lib/skuNormalize.ts`；`/api/ru-sync/sku-map` | Phase 3 | TEST-004 | AC-010 |
| REQ-011 | worker | `ru_sync_snapshots`/`ru_sync_cursors`；`lib/adapter.ts`；`lib/endpoints/*` | Phase 3 | TEST-004 | AC-011 |
| REQ-012 | worker | 适配器 9 entity；`platform_ops.orders.ingest`/`settlements.import` | Phase 6 | TEST-008 | AC-012 |
| REQ-013 | `/backend/ru-sync/health` | `GET /api/ru-sync/health`；`ru_sync.pull_failed` | Phase 3 | TEST-004 | AC-013 |
| REQ-014 | J-002, `/backend/boss-cockpit` + widgets ×4 | `lib/summary.ts`；`GET /api/boss-cockpit/summary` | Phase 4, Phase 7 | TEST-005, TEST-006 | AC-014 |
| REQ-015 | 通知四类型 | typed events → `notifications` | Phase 7 | TEST-006 | AC-015 |
| REQ-016 | J-002, 下钻 + banner | 同 summary；`stale` 语义 | Phase 4 | TEST-006 | AC-016 |
| REQ-017 | J-003 + 全链 | `plan/draft-pos`；FLOW-G1 spec | Phase 5, Phase 8 | TEST-007 | AC-017 |
| REQ-018 | 三条提醒 | `notifications` + 调度 | Phase 8 | TEST-007 | AC-018 |

### 扩展面专项追踪（每条全新运行时/发现面一行）

| Surface | Requirement | 参考 capability / 适配文件 | Phase | 自包含集成测试 | Mechanism |
|---|---|---|---|---|---|
| 三个新模块注册 | REQ-001…016 | `module.metadata` / `src/modules/example/index.ts` | Phase 1/3/4 | TEST-002 | emitted-example |
| 三模块 ACL features | REQ-001…016 | `module.acl-features` / `src/modules/example/acl.ts` | Phase 1/3/4 | TEST-005 | emitted-example |
| 三模块 role 默认授予 + 字典种子 | REQ-001, REQ-004 | `module.setup-role-features` / `src/modules/example/setup.ts` | Phase 1/2 | TEST-002 | emitted-example |
| `finance` 实体 + 校验 | REQ-001, REQ-004 | `data.entities` / `src/modules/example/data/entities.ts`；`data.validators` / `src/modules/example/data/validators.ts` | Phase 1/2 | TEST-002 | emitted-example |
| `finance` 命令 + CRUD 事件/indexer | REQ-001, REQ-004 | `commands.write` / `src/modules/example/commands/todos.ts`；`events.crud-indexer-bridge` / 同文件 | Phase 1/2 | TEST-002 | emitted-example |
| `finance` CRUD 路由 | REQ-001, REQ-004 | `api.crud-factory` / `src/modules/example/api/customer-priorities/route.ts` | Phase 1/2 | TEST-002 | emitted-example |
| `finance` 只读派生路由 | REQ-002, REQ-003, REQ-005, REQ-006, REQ-008, REQ-009 | `api.custom-route` / `src/modules/example/api/organizations/route.ts` | Phase 1/2/6 | TEST-002, TEST-003 | emitted-example |
| `finance` OpenAPI | REQ-001…009 | `api.openapi` / `src/modules/example/api/openapi.ts` | Phase 1/2/6 | TEST-002 | emitted-example |
| 模块事件表 | REQ-001, REQ-004, REQ-013 | `events.typed-definitions` / `src/modules/example/events.ts` | Phase 1/2/3 | TEST-002 | emitted-example |
| 后端页 + `page.meta.ts`（清单/新建/编辑/只读） | REQ-001…016 | `ui.page-shell` / `src/modules/example/backend/todos/page.tsx`、`page.meta.ts`；`ui.form-create` / `src/modules/example/backend/todos/create/page.tsx`；`ui.form-edit` / `src/modules/example/backend/todos/[id]/edit/page.tsx` | Phase 1/2/3/4/6 | TEST-006 | emitted-example |
| `DataTable` 列表与导出 | REQ-001…016 | `ui.datatable` / `src/modules/example/components/TodosTable.tsx` | Phase 1/2/3/4/6 | TEST-006 | emitted-example |
| 驾驶舱 4 widgets | REQ-014, REQ-016 | `ui.dashboard-widget` / `src/modules/example/widgets/dashboard/todos/widget.ts` | Phase 4 | TEST-006 | emitted-example |
| 通知类型（`ru_sync.pull_failed` + 四预警） | REQ-013, REQ-015 | `notifications.type` / `src/modules/example/notifications.ts` | Phase 3/7 | TEST-006 | emitted-example |
| `ru_sync` 拉取 worker | REQ-011, REQ-012 | `runtime.bulk-operation-progress`（worker 形态） / `src/modules/example/workers/todos-bulk-complete.ts` | Phase 3/6 | TEST-004 | emitted-example |
| 到期提醒调度目标 | REQ-018 | `module.setup-scheduler-target` / `src/modules/example/setup.ts` | Phase 8 | TEST-007 | emitted-example |
| i18n 词典 | REQ-001…016 | `module.i18n-catalogs` / `src/modules/example/i18n/en.json` | Phase 1/2/3/4/6 | TEST-006 | emitted-example |
| 模块 README | — | 文档约定（`src/modules/export_finance/README.md` 同形） | Phase 1/2/3/4 | — | framework-only |
| `DataSyncAdapter` 提供者注册 | REQ-011, REQ-012 | 参考实现 `@open-mercato/sync-akeneo`（`integration.ts`/`di.ts`）；本仓无 example 对应能力 | Phase 3/6 | TEST-004 | catalog-only |
| RU 凭证接入 `integrations` | REQ-011 | `integrations.local-bundle` / `src/modules/example/integration.ts` 的 DI 注册形态 + 既有 `currency_policy/di.ts` provider 注册 | Phase 3 | TEST-004 | emitted-example |

## Rollout, Migration, and Rollback

- **迁移边界**：每 Phase 一次 `yarn db:generate` → 审 SQL（只允许建表/加列/索引/外键，确认无 drop）→ **用户批准** → `yarn db:migrate`。Phase 1 建 `finance_shipment_costs`；Phase 2 建 `finance_expenses` + `export_finance_collections` 两列；Phase 3 建三张 `ru_sync_*` 表。`ru_sync` 与 `boss_cockpit` 无其它 schema。
- **种子**：`shipment_cost_type`、`finance_expense_type` 字典 insert-only（`cross_border/setup.ts` 写法）；`ru_sync` 无需种子；`boss_cockpit` 无需种子。
- **授权**：新 features 由 `setup.ts` 默认授予 superadmin/admin；既有租户 `yarn mercato auth sync-role-acls`。
- **兼容**：`export_finance_collections` 只加可空列（旧记录可读）；新路由/新页/新事件/新通知类型全为加法；不改既有事件 id 与载荷。
- **回滚**：停 `ru_sync` worker（游标保留可续跑）→ 下线驾驶舱页/widgets（dashboard 宿主不受影响）→ 删投影表（CN 账本零触碰）；`finance` 停用即隐藏费用面，`export_finance` 两列保留（可空，不影响旧路径）。
- **可观测**：`ru_sync` 健康端点 + 失败通知 + `action_logs` 审计。

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| RU 快照迟到 / 字段漂移 | 全线 block / 口径错 | Phase 3 用 mock 夹具先行；schema 做加法兼容并记差异；不改已定表结构；drift 检测告警 | 首周需人工逐字段打勾 |
| A.4 成本毛利未勾选 | 损益 `cost` 行缺 RU 侧输入 | `cost` 行改由 CN 到岸成本单边提供并标 `source: cn_ledger`，其余行不受影响 | 毛利与 RU 页可能对不齐（明示来源） |
| `wms` 无可读余额表 | 库存资金占用不可算 | 退回「SKU 最新到岸单价 × 已收货数量」并标注口径来源；不建第二份库存账 | 与 wms 实际余额可能有差 |
| 汇率缺失 | CNY 合计不完整 | 行标 `unconvertible`/`rateMissing`，不进合计、页面标红；**永不按 1 摊、永不填 0** | 需要人工补汇率 |
| SKU 映射覆盖不满 | PO 草稿漏行 / 毛利缺 SKU | 未映射禁生成 + 派生异常清单 + 页上可见覆盖率 | 需人工补映射 |
| 跨币种不顺加 | 老板看不到单一合计 | 分组展示 + 明确标注；需要 CNY 合计时才折算（缺汇率整格留空） | 阅读成本上升 |
| 分摊余差规则被改 | Σ分摊 ≠ Σ费用 | 单测钉死「余差落占比最大行 + 平手取最小 `lineNumber`」；断言 Σ 相等 | 无 |
| 驾驶舱数字与 RU 页不一致 | 信任崩塌 | 每数带 `as_of` 与来源标签；误差 ≤0.2 п.п./20 ₽ 验收；stale banner | 依赖 RU 端点稳定性 |

## Acceptance Criteria

- [ ] **AC-001** — 建柜 → `POST /api/finance/shipment-costs`（USD 1000 + 汇率）→ `GET /api/finance/landed-costs?shipmentId=…` 断言 **Σ分摊 == 1000 × 汇率**（2 位）且逐行 `landedUnitCost = (purchaseAmount + allocatedCost) / quantity`。
- [ ] **AC-002** — 权重全 0 退化另一维度；两者全 0 返回空数组；无汇率行 `unconvertible` 且被剔除分摊和；`rateMissing` 行 `landedUnitCostCny=null` 而原币金额照常。
- [ ] **AC-003** — 库存三源解析（landed → price_tier → missing）逐 SKU 可用；`missing` 计 0 并单列未计价数量；双口径两列并列且带 `source`。
- [ ] **AC-004** — 期间费用 CRUD 完整；`period_end < period_start` → 400；渠道跨组织 → 404。
- [ ] **AC-005** — `GET /api/finance/payables` 的 `orderTotal/paidAmount/outstandingAmount/paymentStatus` 与采购单详情手算逐单一致；按供应商+币种分组，跨币种不顺加。
- [ ] **AC-006** — 三类应收各返回一行，行形统一；未收判定只看 `received_at`（不看 status）。
- [ ] **AC-007** — `PUT /api/export_finance/collections` 带 `amount` 后回读一致；旧记录 `amount=null` 不报错；投影与 CSV 两列同步。
- [ ] **AC-008** — `GET /api/finance/profit-loss` 行项与 RU `/ads/summary` 页数字对齐（误差 ≤ 0.2 п.п. / 20 ₽）；`Косвенные…` 无行不计合计；事实/预测不混列。
- [ ] **AC-009** — SKU 毛利 = 到岸成本 × 数量 与 RU 页差值 >0.2 п.п./20 ₽ 的行进对账队列。
- [ ] **AC-010** — `canonicalize`/`matchKey` 单测覆盖大小写与 `склад`/`фабрика` 后缀；唯一命中自动 `mapped`；零/多命中留 `unmapped`；未映射清单为派生。
- [ ] **AC-011** — mock 7 端点全量拉取投影行数 == mock 行数；同 `as_of` 重放 0 新增；中途 500 → `cursor` 不推进；缺 `as_of` 响应拒绝入库。
- [ ] **AC-012** — ads 订单按 500 切批、结算按 2000 行切单；重复 externalId 幂等（按批切分重试）。
- [ ] **AC-013** — `/api/ru-sync/health` 每端点四值；游标改到 25h 前 → `stale`；失败发 `ru_sync.pull_failed`。
- [ ] **AC-014** — 驾驶舱每 KPI 与其来源 API 逐一核对一致；每数带 `as_of` 与来源标签；无 `boss_cockpit.view` → 403。
- [ ] **AC-015** — 四预警各自触发一次且去重窗口生效，有审计。
- [ ] **AC-016** — 下钻行含 Остаток / дней до OOS / ETA / Заказать до；游标断 > 24h → 整页 banner（数字不隐藏）。
- [ ] **AC-017** — FLOW-G1 脚本在全链夹具上通过：采购行 `received_quantity` == `wms` 余额；Σ到岸分摊 == Σ柜费用（CNY）；未映射 SKU → 422 且不生成 PO。
- [ ] **AC-018** — 三条到期提醒（逾期未付款 / 逾期未发运 / 库存低于阈值）各触发一次。
- [ ] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light-mode, and dark-mode states.
- [ ] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes (`yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build`；集成 `yarn test:integration:ephemeral`)。

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | root AGENTS.md；`.ai/guides/{contracts,backend-ui,integrations,ai-workflows,testing-debugging}.md`；`.agents/skills/om-spec-writing`、`om-module-scaffold`、`om-backend-ui-design`、`om-data-model-design`、`om-integration-builder`、`om-system-extension`；`.ai/guides/upstream/BACKWARD_COMPATIBILITY.md` |
| Data models, APIs, events, UI, and tests are internally consistent | pass | 18 条 REQ 全映射 Phase + Test + AC；扩展面专项表逐行给出 example 参考文件 |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001…J-005 分属 Phase 1/4/5/6/3；Phase 8 只承载 FLOW-G 验收与提醒，不含未交付行为 |
| Platform-native reuse and extension points were chosen before custom code | pass | `makeCrudRoute`/`CrudForm`/`DataTable`、`DataSyncAdapter`、`DashboardWidgetModule`、`notifications` 类型、`reconciliation` kinds、既有命令与纯函数复用 |
| UI contracts identify references, canonical components, and theme/state coverage | pass | UI 契约表 13 行，参考页 + 组件 + 状态逐行；明暗/窄宽/键盘在 Phase exit gate |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phase 0…8 |

Verdict: `Ready for implementation`

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | 一个 spec 还是拆两个？（承 2026-09-28 既有） | 用户 | no | 2026-09-28：拆两个（PRD + 技术）；本 spec 承接技术面 |
| Q-002 | 老板面形态 | 用户 | no | 2026-09-28：本 ERP 新建只读驾驶舱 |
| Q-003 | 谁是账本 | 用户 | no | 2026-09-28：按域分账本 |
| Q-004 | supply 范围 | 用户 | no | 2026-09-28：完整 7 端点 |
| Q-005 | 新模块一分为二还是合一？ | 用户 | no | **本 spec 决议：拆 `ru_sync`（数据面）+ `boss_cockpit`（呈现面）**；理由见 Design Decisions |
| Q-006 | 7 端点 `updated_since` 粒度与全量回填策略 | 俄方 | no（Phase 3 用 mock 先行） | pending（快照到手定；schema 加法兼容） |
| Q-007 | 四预警阈值与接收人（ДРР 20% 外，其余三线定多少/发给谁/频率） | 老板 | no（默认取 supply 参数页值） | pending |
| Q-008 | ФБО 延迟容忍（stale 阈值 24h 是否合适） | 用户 | no | 默认 24h（既有 spec 默认） |
| Q-009 | 第二阶段三域是否沿用同一 8 条契约 | 用户 | no | 默认沿用 |
| Q-010 | 技术对接人单点 | 用户 | no | pending（占位 `待用户确认`） |
| Q-011 | 驾驶舱确需图表时的依赖选择 | 用户 | no | 默认一方 SVG；确需新依赖先问 |

## Changelog

| Date | Change |
|---|---|
| 2026-09-28 | **菜单按受众拆组**：「财务」组只留财务人员作业与台账（订单档案 / 柜档案 / 税务发票台账 / 柜费用 / 到岸成本 / 期间费用 / 应付 / 应收），老板结果页（老板驾驶舱 / 月损益 / SKU 毛利 / 库存资金占用）移入新组「经营概览」/ "Executive overview"（`executive_overview.nav.group`，label 在 `boss_cockpit/i18n`），RU 管道运维页（RU SKU 映射 / RU 同步健康）移入新组「数据同步」/ "Data sync"（`ru_sync.nav.group`，label 在 `ru_sync/i18n`）；`export_finance.nav.group` 键名与「财务」label 不动（侧边栏偏好不失效），`src/modules.ts` 的 `groupOrder` 增加两个 id。dev 实测：侧边栏三组顺序与成员如预期，驾驶舱 / 库存资金占用 / RU SKU 映射 / 应付台账逐页点开正常；门禁 generate / typecheck 0 / lint 0 error / ds:check 900 files / test 439 passed。 |
| 2026-09-28 | 金额口径统一：金额 2 位/单价 4 位，HALF_UP，引擎单点；金额列 numeric(18,2)、单价列 numeric(18,4)（见 [`.ai/specs/2026-09-28-money-scale-2dp-unification.md`](2026-09-28-money-scale-2dp-unification.md)）。本 spec：柜费用/期间费用/收汇金额列 18,4→18,2；REQ-003 补「金额 2 位、单价类（到岸单价）4 位」；分摊之和断言由「4 位」改「2 位」；REQ-002/跨模块量化说明去掉 `lib/currencyScale.ts`（金额与币种无关）。 |
| 2026-09-28 | 初稿：承接 three-system-metric-reconciliation 的 supply+驾驶舱范围，加入财务模块（A 成本 / B 费用 / C 台账 / D 损益）、数据打通（E）、驾驶舱（F）与流程闭环（G）；Q-005 决议拆两模块 |
| 2026-09-28 | **实测（dev，17 端点全量实拉）**：9 个 ads 端点逐个 `completed` 且同 `as_of` 重放 `created=0`（21 行快照：8 supply + 9 ads 端点）；四预警全部触发并各留一条通知（同条件重放数量不变）；`finance due-reminders` 三条规则各触发一次（逾期未付款 PO-2026-0002、逾期未发运 PO-2026-0003、库存低于起订量 3 个 SKU），通知按 `(recipient, type, groupKey)` 去重；驾驶舱页与 4 个 widget、损益/SKU 毛利/应付/应收/期间费用/柜费用/到岸成本/库存资金占用/RU 健康/RU 映射共 11 个页面全部渲染真实数据。**实测查出并修掉四个真实缺陷**：① `ru_sync`/`finance` 的通知把 SKU 或端点名塞进 `source_entity_id`（uuid 列）→ 插入失败，改为只用 `groupKey` 标识，并在 `notify-pull-failed` 同理修正；② `cross_border.shipments.depart`/`.receive` 走过命令总线写别的模块的集合（订单状态、行已收数量、wms 余额）却不清它们的 CRUD 列表缓存（`ENABLE_CRUD_API_CACHE=true` 时读回旧值），新增 `PEER_CACHE_RESOURCES` + `invalidatePeerCaches()`；③ 驾驶舱的金额卡把金额放在 `footer`、`value` 传 `null`，而 `KpiCard` 在 `value === null` 时会丢掉 footer，页面上 缺口/积压/周销售/周广告实付/应付/应收 全部显示 `--`；④ `CockpitKpiWidget` 的 ДРР 卡是「未接入」占位符，其余三张同样把金额放进 footer 而显示 `--`。三、四两处按「金额是卡片的 value，footer 只列币种明细」重写，ДРР 卡改为读应计/实付/目标线。 |
| 2026-09-28 | **FLOW-G1 绿（全新一次性库）**：`yarn mercato test:integration finance-flow` → 1 passed（`JWT_SECRET=$(openssl rand -hex 32) …`，见 [pitfalls/ephemeral-integration-needs-a-real-jwt-secret.md](../../docs/pitfalls/ephemeral-integration-needs-a-real-jwt-secret.md)）。串起 供应商→采购单→定金→发运→柜费用→收货→到岸成本→尾款→收汇→退税 并对账（行已收 == wms 余额、Σ分摊 == Σ费用×汇率、收汇入应收台账、退税按柜分摊回单）。**该链路查出并修掉两个真实缺陷**：`cross_border.shipments.depart` / `.receive` 走过命令总线写别的模块的集合（订单状态、行已收数量、wms 余额）却不清它们的 CRUD 列表缓存，`ENABLE_CRUD_API_CACHE=true`（一次性环境的配置）下读回旧值——新增 `lib/cacheInvalidation.ts` 的 `PEER_CACHE_RESOURCES` + `invalidatePeerCaches()` 并在两处调用。 |
| 2026-09-28 | **Phase 7–8 交付**：驾驶舱 v2（ДРР 双口径 + 周复盘 + 月损益入口）、四预警（`ru_sync.alert.{stockout,overstock,drr_threshold,unrecognized_in_transit}` 事件 + 四通知类型 + 订阅者 + 拉取收尾评估、按 `groupKey` 刷新去重）、到期提醒命令（`yarn mercato finance due-reminders`，三条规则 → `finance.reminder.*` 事件 + 三通知类型/订阅者）、FLOW-G1 端到端集成 spec（`src/modules/finance/__integration__/finance-flow.spec.ts`）。门禁：typecheck 0 / lint 0 error / ds:check 900 files / test 全绿（本模块 43+13 例）。 |
| 2026-09-28 | **Phase 3–6 交付**：`ru_sync`（17 端点：supply 8 + ads 9；快照投影、每端点游标、SKU 映射、健康页、`ru_sync.pull_failed` 通知类型）与 `boss_cockpit`（只读驾驶舱 v1 + 4 widgets）落地；`finance` 追加月损益（ОПИУ 行项）与 SKU 毛利两页；广告 9 端点的 schema/落点（订单→`platform_ops.orders.ingest`、结算→`settlements.import`、其余入快照）。迁移 `Migration20260928073630_ru_sync` 经批准已应用（三表）；`progress` 模块启用并应用其自带迁移两笔（`data_sync` run 需要 `progressService`，之前任何同步运行都起不来）。实测：8 个 supply 端点全量拉取投影行数与 fixture 逐一相等（skus 3 / sku_mappings 2 / stock 2 / in_transit 1 / unrecognized_inbound 2 / plan 1 / shipments 1 / params 1）、8 条游标推进、重放同 as_of 0 新增、失败页游标不推进（plan 保持原值）、健康页演示 `failing`（fetch failed）与 `stale`（游标改 25h 前）、SKU 映射派生清单 6 条（含 `РК56`）并完成绑定/忽略/400/404 四路；缺口→PO 草稿 201（draft、RUB 11988.00）且未映射行整单 422 不落单。门禁：generate / lint 0 error / ds:check 884 files / test 433 passed（含 ru_sync 43 例）/ typecheck 与 build 被并行会话在 `products`/`platform_ops` 的在途改动挡住（错误均在对方文件，本模块 0 error）。待办：服务重启后跑 ads 9 端点实拉 + 驾驶舱页面验收 |
| 2026-09-28 | **Phase 2 交付并验证**：期间费用（`finance_expenses` + CRUD + 字典 `finance_expense_type`）与两本只读台账（应付复用 `purchasing` 的 `derivePaymentState`、按供应商×币种分组；应收三类来源统一行形、是否已收只看收款日期）；`export_finance_collections` 加法两列 `amount`/`received_at` 并接入订单档案财务视图与 CSV。迁移 `Migration20260928071448_{finance,export_finance}` 经批准已应用。门禁全绿（generate/typecheck 0/lint 0 error/ds:check 805 files/test 322 passed/build ✓）。接口实测：应付 2 单 unpaid 2000/0/2000 → 加定金 500 后 500/1500/`deposit_paid` → 删付款回 `unpaid`；应收三类各出证（出口收汇 1200 已收 1200；平台结算带收款日 950 已收 vs 不带收款日 475 全未收；内部销售 2 单 USD 125 未收）；跨币种只按币种分组（CNY/USD 两行合计）；`collectedAmount: null` 回读 null 不报错；费用 CRUD + 期间倒置 400 + 未知类型 400 + 跨组织渠道 404；浏览器实测三页（应付分组/明细、应收多币种提示、期间费用字典显示名）与订单档案财务页新增「已收金额/收款日期」输入。过程中修掉两个真实 bug：结算表无 `deleted_at` 列、`sales_orders.status` 为 NULL 时被 `not in` 过滤掉 |
| 2026-09-28 | **Phase 1 交付并验证**：`finance` 模块（`finance_shipment_costs` + 到岸成本派生 + 库存资金占用 + 三页 + 字典种子 `shipment_cost_type`）；迁移 `Migration20260928064025_finance` 经批准已应用；门禁全绿（generate/typecheck 0/lint 0 error/ds:check 783 files/test 320 passed/build ✓）；接口实测 Σ分摊 == 费用×汇率（USD 1000 @7 → 7000.0000）、无汇率费用剔除并报 `unconvertible`、逐行 `landedUnitCost = (采购价+分摊)/数量`、cancelled 柜 409、未知类型 400、跨组织 404；浏览器实测三页（明/暗、空态、缺汇率标红、窄屏）。遗留：库存三源解析未跑端到端（本库无 wms 余额/仓库，归 Phase 8 FLOW-G1） |
