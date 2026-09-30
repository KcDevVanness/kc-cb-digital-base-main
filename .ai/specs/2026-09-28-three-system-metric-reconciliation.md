# 老板驾驶舱与 RU 供应链同步 (PRD)

**Date**: 2026-09-28
**Status**: Draft（门禁已过 Q-001…Q-005；**supply 同步与驾驶舱部分的执行口径由 `.ai/specs/2026-09-28-finance-ledger-and-cockpit-data.md` 接管**——本文件保留 PRD 口径表/决策记录，实现以接管 spec 为准；Q-006…Q-010 仍开放）
**Source docs**: `docs/ru-petkit/prd.md`（RU 功能 F-01…F-11）· `docs/ru-petkit/field-mapping.md`（中方锚点 + 6 域）· `docs/ru-petkit/integration-brief.md`（架构 + 模块 + 接口）· `docs/ru-petkit/evidence.md`（取证）

> 用户决议（2026-09-28）：拆两个 spec（本 PRD + 技术文档另起）；老板面 = **本 ERP 新建只读驾驶舱**；账本 = **按域分**；第一阶段 = **supply 完整 8 端点（§1–§7 + §1.1；后按 `docs/ru-petkit/supply-sync-tech.md` §0 更正）**。

## TLDR

反向从老板 6 类数据出发做三方口径对账（老板驾驶舱 × RU BI × CN ERP），第一阶段只做 supply 域：RU 开 7 个 pull 快照端点，我方做 `DataSyncAdapter` 同步 + **只读老板驾驶舱**（本 ERP 新页 / 模块，只读 RU + CN 已有数据，不新建业务写路径）。可交付的最小闭环：老板每天看到缺货 / 在途 / 积压 / ДРР 四数，数字与 RU 页一致、与 CN 账本对得上。

## Problem Statement

三方口径从未书面统一：ДРР 双口径（живыми vs начислено）、两种 маржа（по продажам 事实 vs по заказам 预测）、Соинвест 算式待确认、SKU 大小写与 `склад/фабрика` 后缀混用、ФБО 只读、在途未识别 2 200 шт 不扣需求。后果：token / 联调进不去；老板 6 类数据（赚多少 / 货转不转 / 卖得好不好 / 花钱值不值 / 钱回不回来 / SKU 对齐）没有单一可验收定义；RU 页数字与 CN 账本各说各话。

## Overview and Success Measures

- **Primary outcome:** 老板驾驶舱 6 类数据全部有三方口径行（定义 / 算式 / 来源系统 / 频率 / 阈值），第一阶段 supply 5 数（缺口金额 / 在途金额 / 积压金额 / ДРР / 未识别在途）与 RU 页误差 ≤ 0.2 п.п. / ≤ 20 ₽。
- **Leading indicators:** 8 端点（§1–§7 + §1.1）联调通过；SKU 映射覆盖率（canonical 覆盖 supply 59 SKU）；游标连续 7 天无断点。
- **Baseline:** unknown — 测量计划：以 `evidence.md` 页数字为基线（ДРР 7,5%、Сен маржа 21,6%、ROI 102,6%/77,2%、supply 32,0 млн ₽ / 565 130 $）。
- **Market / product reference:** RU BI 自身即参考实现（11 路由 + 口径已验算）；采用其定义，拒绝其渲染方式（服务端直出 HTML + 无 key 内嵌 ROWS 不可复用，只取其接口契约）。

## Goals

- **REQ-001** — 三方口径表：老板 6 类每指标一行（定义 / 算式 / 来源系统 / 频率 / 阈值 / 账本归属）。
- **REQ-002** — supply 8 端点契约冻结（§1–§7 + §1.1）（字段 / 自然键 / `updated_at` + `as_of` / 游标 / 幂等），SKU 规范（canonical + 后缀 + 大小写）冻结。
- **REQ-003** — 只读老板驾驶舱：6 类数据一页可览，日级四数 + 周复盘 + 月 ОПИУ，只读 RU 同步 + CN 账本，无业务写路径。
- **REQ-004** — 供应同步落地：plan 缺口 → PO 草稿（S 级）、在途 ETA → 收货计划、超储 → 刹车信号、未识别在途独立清单（不扣需求）。
- **REQ-005** — 四预警可达老板：断货损失 / 超储冻结 / ДРР 破线 / 未识别在途（通知类型 + 阈值 + 频率）。

## Non-goals

- 不重建 RU 已有能力：广告归因、漏斗、品牌分析只存档引用（C 级）。
- 不做俄文全文翻译；不猜 `/api/v1` key（未知一律 `待快照确认`）。
- 第一阶段不开订单 / 结算 / ОПИУ 三域（第二阶段）。
- 驾驶舱不写任何业务表；plan 只生成 PO 草稿，不自动 place。

## Proposed Solution

最小平台原生方案：RU 侧只开 **pull 快照 REST**（8 端点（§1–§7 + §1.1）+ bearer + `updated_since` 游标 + 快照 `as_of`）；CN 侧用 `DataSyncAdapter` + queue workers + `ProgressJob` 做同步（cursor-after-success，失败页不推进），差异进对账队列；老板面用 installed `dashboards` 的 `DashboardWidgetModule` 做只读 widgets + 一个只读汇总页（`DataTable` 只读 + KPI 头），数据源 = RU 同步投影 + CN 账本投影。为什么不用爬虫 / CSV 主通道 / push：HTML 无 key 脆断、CSV 无游标、push 丢重难收敛（`integration-brief.md` §5 已论证）。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| RU pull 快照 + 我方游标 | 日级快照语义与对账天然匹配；失败可重跑 | 爬 HTML / CSV 主通道 / RU push | 脆断 / 无游标 / 丢重难收敛 |
| 按域分账本 | supply 需求侧 RU 算、商业侧 CN 算，各有源头 | 单一账本 | 两边都有对方没有的源（ФБО / PO / wms） |
| 只读驾驶舱（widgets + 只读页） | 老板只看不动；零业务写风险 | 可写驾驶舱 | 写路径增加幂等 / 并发面，第一阶段不需要 |
| 未识别在途独立端点 | 不扣需求，混入会算错账 | 合并进 in-transit | 已证伪：页明确“不扣减” |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| ДРР | расход / чистая выручка；живыми = 实付 / 净收入，начислено = 应计 / 净收入 | RU `/ads` 头 | 口径混用 → 驾驶舱双列并显示，禁单列 |
| Маржа по продажам / по заказам | 事实口径 / 预测口径（标 прогноз）；маржа = Продажи − Удержания − Себестоимость − Реклама | RU `marketplaces/summary` | 预测口径禁入关账列 |
| Соинвест % | 页显值；精确算式 `待快照确认` | RU `reprice/summary` | 只做定价信号，不做账 |
| 供应需求 | 需求 ×（57 + 30 + 10）−  остаток − 在途（ETA 前）；需求 = 30/60/90/120 天加权 50/30/20/0%，缺货日剔除 | RU `supply` params | 参数变更 → 版本号 + 生效日，旧快照保留 |
| Canonical SKU | `sku`（规范）+ `variant_suffix`（склад/фабрика 后缀）+ 大小写以快照为准 | RU `supply/skus`（待开） | 未映射 SKU 进异常清单，不静默合并 |
| 未识别在途 | 无采购卡 / 去 планируем flag / 工厂未知码；不扣减需求 | RU 独立端点（待开） | 缺失 → 整页标 stale，禁按全量算 |
| as_of / updated_at | 每快照数据日期 + 每行更新时间（游标用） | RU 各端点 | 缺 as_of → 拒绝入库并告警 |
| 按域分账本 | 需求量 / 在途 / ФБО = RU；PO / 收货 / 收汇退税 / 发票 = CN | 本表 | 冲突 → 对账队列，不静默覆盖 |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 老板 / 管理层 | 看驾驶舱全部 6 类 + 订阅四预警 | 全部组织（读） | `boss_cockpit.view`（新）+ `dashboards.view` |
| 供应计划 | 看 supply 域 + 从 plan 生成 PO 草稿 | 本组织写 PO，其余读 | `cross_border.shipments.view`、`purchasing.orders.manage`（既有） |
| 财务关账 | 看 ОПИУ / 结算对账结果 | 本组织 | `export_finance.orders.view`、`platform_ops.settlements.view`（既有） |
| 同步作业 | 读写同步投影 + 游标（tenant 域） | installed 同步契约的 tenant scope（含 `organizationId: null`），禁碰组织行 | 新模块 features（`supply_sync.*` 待定） |

Scope 由 session 派生，fail-closed；同步投影表自带 `tenant_id` + `organization_id`（组织行）/ tenant 游标行走 tenant scope。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 供应同步（provider） | app-own 新模块 | `supply_sync`（新，需 `src/modules.ts` 注册） | `DataSyncAdapter` + queue workers + `ProgressJob` | RU 是外部 provider，provider 代码归 provider 模块（integrations guide） |
| 老板驾驶舱 widgets | app-own（widgets）+ 复用 installed dashboards 宿主 | `boss_cockpit`（新）或并入 `supply_sync`（二选一，Q-006） | `DashboardWidgetModule` + 只读页 | 只读投影，不碰业务表 |
| PO 草稿生成 | reuse | `purchasing`（`purchase-orders.create`，draft） | command 调用（同事务复用既有校验） | 不新写下单路径 |
| 收货计划 | reuse | `cross_border`（allocations 只读 + milestones） | 只读投影 + 事件 | 在途 ETA 只做计划信号 |
| 对账队列 | reuse | `platform_ops.reconciliation`（kinds 复用）+ 供应差异 kinds 新增 | 事件 + enrichers | 差异不覆盖账面 |
| 通知四预警 | reuse | `notifications`（新类型 IDs） | typed events → notification types | 阈值触发，有审计 |
| 加密/token | reuse | integrations credential service + encryption maps | DI sender/health | token 只存服务端，不进代码/文档/日志 |

## Architecture and Data Flow

```text
RU BI (/api/v1/supply/*, pull+cursor) -> supply_sync DataSyncAdapter -> RU同步投影(自有表, as_of+快照)
                                                              -> cursor commit (成功页后)
CN账本 (purchasing/cross_border/wms/export_finance/trade_docs) -> 只读投影/事件
RU投影 + CN投影 -> boss_cockpit widgets/只读页 -> 老板
plan缺口 -> purchasing draft PO (仅草稿) ; 差异 -> platform_ops对账队列 ; 阈值 -> notifications四预警
```

- **Module boundaries:** `supply_sync` 拥有同步 + 投影 + 游标；`boss_cockpit`（或合入）只拥有只读聚合；业务写永远走既有模块命令。
- **Extension points:** dashboards widgets（宿主复用）、notifications 新类型、reconciliation 新 kinds（加法）。
- **Alternatives considered:** 直写业务表（否：破坏幂等与审计）；爬虫（否：脆断）。
- **Compatibility:** 既有 7 模块 API / 事件 / 表结构零变更；新增全为加法（新模块 + 新 features + 新通知类型）。

## User Journeys

### Journey J-001 — 老板早会看四数

1. 老板打开驾驶舱（≤3 点击：登录 → 驾驶舱）。
2. 看到日四数：缺口金额 / 在途金额 / 积压金额 / ДРР + 未识别在途 badge；每数带 `as_of` 与来源。
3. 点击下钻到 SKU 行（DataTable 只读：Остаток / дней / ETA / Заказать до）。
4. 数据 stale（游标断 > 24h）整页 banner + 禁按旧数下决策；无权限 403。

### Journey J-002 — 计划员把缺口变 PO 草稿

1. 计划员看 supply plan 页（推荐量 + Заказать до + Сумма）。
2. 勾选行 → 生成 PO 草稿（`PO-<年>-<4位>`，draft 状态，行走既有校验）。
3. 草稿不自动 place；place 走既有审批 / 流转。
4. RU SKU 未映射 → 行置灰 + 进异常清单，不生成。

### Journey J-003 — 财务月关账对 ОПИУ

1. 财务打开月 ОПИУ视图（Показатели / ОПИУ 双列：事实 vs 预测）。
2. `Косвенные` 空行标注口径待确认，不计入合计。
3. 差异 → 对账队列；解决 / 忽略走既有 `resolve/ignore`。

## UI and Interaction Contracts

只读驾驶舱 + supply 域两页；全部 `DataTable` 只读 + KPI 头；`CrudForm` 仅出现在 PO 草稿确认（复用既有，不新写）。

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/boss-cockpit`（暂名） | 6 类一页览：KPI 头 + 四预警 + 下钻表（只读） | RU 投影 + CN 投影 GET；无 mutations | dashboards 宿主 + example `TodosTable`（表形态参考） | `Page`/`PageBody`/`DataTable`/KPI 头组件族 | loading, empty, error, stale（游标断）, permission denied | REQ-001/003/005 |
| `/backend/supply-sync/plan`（暂名） | plan 缺口表 + 生成 PO 草稿（唯一写口） | RU plan 投影 GET；`purchasing.purchase-orders.create`（draft） | `export_finance` OrderFilesTable（投影表参考） | 同上 + guarded mutation | loading, empty, error, conflict, partial（部分 SKU 未映射） | REQ-002/004 |
| dashboards widgets ×4 | 缺口 / 在途 / 积压 / ДРР 四 widget | 同驾驶舱聚合 GET | example `widgets/dashboard/todos`（widget 形态） | `DashboardWidgetModule` + lazy client | loading, empty, error, stale | REQ-003/005 |

UI 细节（mockup / 空 / 冲突 / 键盘 / a11y / 响应式 / 明暗 / 翻译键）在实现阶段按 `om-backend-ui-design` + `backend-ui.md` 展开；本 PRD 只冻结契约。

## Data Models

新增表全在新模块下；既有 7 模块零 schema 变更（BACKWARD_COMPATIBILITY additive-only）。

### `supply_sync_ru_snapshots`（RU 投影，按端点分行，禁当账本写）

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | UUID, required | primary key | no | immutable |
| `tenant_id` / `organization_id` | UUID, required | composite scope index | no | trusted context only |
| `endpoint` | text, required（skus/stock/in-transit/unrecognized/plan/shipments/params） | scope + endpoint + `as_of` index | no | enum |
| `natural_key` | text, required（sku / 单号 / (单号,model)） | unique（scope + endpoint + natural_key + as_of） | no | 幂等 upsert 键 |
| `payload` | jsonb, required | no | no | RU 原样快照（含币种自带） |
| `as_of` | date, required | 见上 | no | 缺失拒绝入库 |
| `updated_at` | timestamp, required | optimistic-lock version | no | 同步写 |

### `supply_sync_cursors`（游标，tenant 域）

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | UUID | primary key | no | immutable |
| `tenant_id` | UUID, required | unique（tenant + endpoint） | no | cursor-after-success 才推进 |
| `endpoint` | text, required | 见上 | no | 同上 |
| `cursor` | text（updated_since） | no | no | 失败页不推进 |
| `updated_at` | timestamp, required | version | no | 同步写 |

Credential（RU bearer）走 integrations credential service + encryption maps，不建业务列。

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET` | `/api/boss-cockpit/summary`（暂名） | auth + `boss_cockpit.view` | `?as_of`（缺省最新） | KPI + `as_of` + `stale` flag | 400/401/403 | REQ-001/003 |
| `GET` | `/api/supply-sync/plan`（暂名） | auth + `supply_sync.view` | 分页 + `only_mapped` | plan 行 + 映射状态 | 400/401/403 | REQ-002/004 |
| `POST` | `/api/supply-sync/plan/draft-pos`（暂名） | auth + `purchasing.orders.manage` | `sku[]`（已映射） | PO 草稿号 + `purchasing.purchase_order.created` | 400/403/409/422（未映射行） | REQ-004 |
| worker | `supply_sync.pull` | tenant scope | endpoint + cursor | cursor 推进 + `supply_sync.pulled` | transient 重试 + 熔断；失败不推进 | REQ-002 |

RU 8 端点（§1–§7 + §1.1）契约（字段 / 自然键 / 游标 / 8 条规则）见 `docs/ru-petkit/integration-brief.md` §5 + `field-mapping.md` 域3（快照到手后逐字段打勾）。

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `supply_sync.pulled` | `supply_sync` | cursor + 投影 upsert | 快照入库 | cursor-after-success；重放 upsert 幂等 |
| `supply_sync.plan_gap` | `supply_sync` | `purchasing` draft | PO 草稿 | 仅草稿；place 走既有路径 |
| `supply_sync.stockout_risk` 等 4 阈值 | `supply_sync` | `notifications` | 老板四预警 | 阈值 + 去重窗口；审计 |
| `supply_sync.sku_unmapped` | `supply_sync` | 异常清单 | 行置灰 + 待映射 | 人工映射后重跑 |

## Security, Privacy, and Compliance

- **Authorization:** 新 features（`boss_cockpit.view`、`supply_sync.view/run`）+ 既有复用；禁 role-name 检查；通配符 matcher。
- **Tenant isolation:** 组织行双 scope 过滤 fail-closed；游标走 tenant scope，禁碰组织行。
- **Sensitive data:** RU token 经 credential service + encryption maps；日志/错误/响应禁回 token 与 payload secrets；SSRF 校验 RU base URL。
- **Abuse and failure modes:** 游标断 stale 整页标；RU 5xx transient 重试 + 熔断 + health；签名 webhook（第二阶段）验签 + replay 窗口 + atomic inbox。

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | integration | mock RU 8 端点（含未识别 + 未映射 SKU） | pull 全量 → 增量 | 投影行 + 自然键去重 + cursor 推进 | REQ-002 |
| TEST-002 | integration | 断页 / 500 / 重放 | 重跑 pull | cursor 未推进；无重复行 | REQ-002 |
| TEST-003 | integration | plan 缺口 fixture | 生成 PO 草稿 | draft 状态 + 行校验通过；未映射行 422 | REQ-004 |
| TEST-004 | security | 第二 tenant / 无 feature | 读驾驶舱 / 调同步 | fail closed，无泄漏 | REQ-001/003 |
| TEST-005 | UI | stale 游标 / 空 plan / 未映射 | 打开驾驶舱三态 | stale banner / 空态 / 置灰行 | REQ-003 |

## Implementation Phases

### Phase 1 — RU 8 端点（§1–§7 + §1.1）联调 + 投影 + 游标（无 UI）

- **Depends on:** RU 快照字段打勾（`field-mapping.md` 域3）+ token 到手
- **Outcome:** 8 端点（§1–§7 + §1.1）可拉、投影可查、cursor 连续 7 天
- **Why this order / value delivered:** 一切上层（驾驶舱/PO/预警）的前置；先证明数拿得到、对得上
- **Deliverables:** `supply_sync` 模块骨架 + `DataSyncAdapter` + 投影表 + 游标 + mock contract server
- **Independent slices / estimated commits:** 端点逐个并行（skus/stock/in-transit/unrecognized/plan/shipments/params）
- **Requirements closed:** REQ-002
- **Tests:** TEST-001, TEST-002
- **Validation:** `yarn generate` + 模块 tests + mock 联调
- **Exit gate:** 连续 7 天 cursor 无断 + 投影数与 RU 页误差内

### Phase 2 — 只读驾驶舱 + 四预警

- **Depends on:** Phase 1 exit gate
- **Outcome:** 老板一页览 + widgets + 阈值通知
- **Why this order / value delivered:** 老板价值最早可见；只读零写风险
- **Deliverables:** 只读页 + 4 widgets + 通知类型 + stale 语义
- **Independent slices / estimated commits:** 页 / widgets / 通知三片并行
- **Requirements closed:** REQ-001, REQ-003, REQ-005
- **Tests:** TEST-004, TEST-005
- **Validation:** 明暗 + 窄宽 + 键盘 + 空/错/stale 三态实测
- **Exit gate:** 老板 6 类数与 RU 页一致；stale > 24h 标出

### Phase 3 — plan → PO 草稿 + 对账

- **Depends on:** Phase 2 exit gate
- **Outcome:** 缺口一键变 draft PO；差异进队列
- **Why this order / value delivered:** S 级闭环（不断流）
- **Deliverables:** draft-pos 路由 + 异常清单 + reconciliation kinds
- **Independent slices / estimated commits:** 草稿 / 异常 / 对账三片
- **Requirements closed:** REQ-004
- **Tests:** TEST-003
- **Validation:** 端到端 draft + 409/422 路径
- **Exit gate:** 未映射行禁生成；place 仍走既有路径

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001, `/backend/boss-cockpit` | 口径表 + `GET summary` | Phase 2 | TEST-004 | AC-001 |
| REQ-002 | worker + 投影 | 8 端点（§1–§7 + §1.1）+ cursor | Phase 1 | TEST-001/002 | AC-002 |
| REQ-003 | J-001 + widgets | 只读聚合 | Phase 2 | TEST-005 | AC-001 |
| REQ-004 | J-002, plan 页 | draft-pos + PO created | Phase 3 | TEST-003 | AC-003 |
| REQ-005 | 通知 | 4 阈值事件 | Phase 2 | TEST-005 | AC-004 |

## Rollout, Migration, and Rollback

新增模块 + 加法迁移（投影/游标表）+ seed（features 授权 + provider 配置）；`yarn db:generate` 审 SQL，只留本模块语句。回滚：停 worker（cursor 保留，可续跑）→ 下线页/widgets（dashboard 宿主不受影响）→ 删投影（CN 账本零触碰）。RU 侧无写，无需 RU 回滚。

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| RU 快照迟到 / 字段漂移 | 全线 block / 口径错 | 未知标 `待快照确认`；版本 + 加法字段；漂移检测告警 | 首周需人工逐字段打勾 |
| SKU 映射覆盖不满 | PO 草稿漏行 | 未映射禁生成 + 异常清单 | 需人工补映射（产品SKU对接页） |
| Соинвест算式未定 | 定价信号弱 | 只做参考不做账；快照到后升级 | 接受 |
| ФБО只读延迟 | 需求算偏 | as_of 标注 + stale 语义 | 接受，页已声明 |
| 新模块 vs 合并 | 过度拆分 | Q-006 定（见下） | 拆分可逆（widgets 可搬） |

## Acceptance Criteria

- [ ] **AC-001** — 老板 6 类数与 RU 页一致（误差 ≤ 0.2 п.п. / ≤ 20 ₽），stale > 24h 整页标出。
- [ ] **AC-002** — 8 端点（§1–§7 + §1.1）连续 7 天 cursor 无断；重放无重复行；失败页 cursor 不推进。
- [ ] **AC-003** — plan 缺口可生成 draft PO；未映射 SKU 禁生成并进异常清单；无自动 place。
- [ ] **AC-004** — 四预警（断货 / 超储 / ДРР / 未识别在途）阈值触发可达，有去重与审计。
- [ ] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light-mode, and dark-mode states.
- [ ] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | root AGENTS.md + architecture/contracts/integrations/backend-ui + dashboards/notifications facts + BACKWARD_COMPATIBILITY |
| Data models, APIs, events, UI, and tests are internally consistent | pass | traceability 5 行全映射 |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001…J-003 分属 Phase 2/3/2 |
| Platform-native reuse and extension points were chosen before custom code | pass | DataSyncAdapter/dashboards/notifications/reconciliation/command 复用 |
| UI contracts identify references, canonical components, and theme/state coverage | pass | 三表面 + example 参考行 |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phase 1…3 |

Verdict: `Blocked — Q-005…Q-010 开放问题待决`.

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | 一个 spec 还是拆两个？ | 用户 | ~~yes~~ no | 2026-09-28 决议：拆两个（PRD + 技术另起） |
| Q-002 | 老板面形态 | 用户 | ~~yes~~ no | 2026-09-28 决议：本 ERP 新建只读驾驶舱 |
| Q-003 | 谁是账本 | 用户 | ~~yes~~ no | 2026-09-28 决议：按域分账本 |
| Q-004 | supply 范围 | 用户 | ~~yes~~ no | 2026-09-28 决议：完整 7 端点；后按 `docs/ru-petkit/supply-sync-tech.md` §0 更正为 8 端点（§1–§7 + §1.1） |
| Q-005 | 新模块一分为二（`supply_sync` + `boss_cockpit`）还是合一？ | 用户 | ~~yes~~ no | 2026-09-28 决议：**拆**——`ru_sync`（数据面：provider/游标/worker/失败重跑）+ `boss_cockpit`（呈现面：只读聚合/权限/布局）；理由：生命周期与失败模式不同，可单独回滚（停 worker ≠ 下线页）。执行细节见 `.ai/specs/2026-09-28-finance-ledger-and-cockpit-data.md` |
| Q-006 | 8 端点 `updated_since` 粒度与全量回填策略（RU 是否支持） | 俄方 | yes | pending（快照到手定） |
| Q-007 | 四预警阈值与接收人（ДРР 20% 外，其余三线定多少、发给谁、什么频率） | 老板 | yes | pending |
| Q-008 | ФБО延迟容忍（stale 阈值 24h 是否合适） | 用户 | no | pending（默认 24h） |
| Q-009 | 第二阶段三域（订单/结算/ОПИУ）是否沿用同一 8 条契约 | 用户 | no | pending（默认沿用） |
| Q-010 | 技术对接人单点 | 用户 | yes | pending（占位 `待用户确认`） |

## Changelog

| Date | Change |
|---|---|
| 2026-09-28 | Skeleton + Q-001…Q-004 门禁 |
| 2026-09-28 | 门禁决议落地（拆分/只读舱/分账本/7端点）；定稿 PRD 全文；Blocked 于 Q-005…Q-010 |
| 2026-09-28 | Q-005 决议：拆 `ru_sync` + `boss_cockpit`；supply 同步与驾驶舱的执行口径移交 `.ai/specs/2026-09-28-finance-ledger-and-cockpit-data.md`（含 8 端点口径 = §1–§7 + §1.1） |
