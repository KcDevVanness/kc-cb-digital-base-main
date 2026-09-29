# RU PETKIT 对接实作前计划（RU-Ready 门控联调）

**Date**: 2026-09-28
**Status**: Draft
**Source docs**: `docs/ru-petkit/supply-sync-tech.md`（17 端点唯一冻结契约，§0–§23）· `docs/ru-petkit/field-mapping.md`（六域锚点）· `docs/ru-petkit/prd.md`（RU 功能 F-01…F-11）· `.ai/specs/2026-09-28-finance-ledger-and-cockpit-data.md`（既有 `finance` / `ru_sync` / `boss_cockpit` 实现，Phase 1–8）· `.ai/specs/2026-09-28-money-scale-2dp-unification.md`（金额 2 位 / 单价 4 位硬口径）· `src/modules/ru_sync/`（契约 schema、fixture、游标、SKU 映射、健康页已交付）
**Scope**: 只做实作前计划，不写任何代码。RU 业务把接口金额格式同步到位之前不进入实作；本 spec 冻结后等待开工门（Q3 决议）再执行。

> 用户门控决议（2026-09-28，本 spec Q1–Q5，已答复）：
> Q1 一 spec 三阶段（supply 先行 ads 随后，一份文档管到底）；
> Q2 新建模块承接实拉（老 `ru_sync` 只做契约 fixture，实拉另起模块）；
> Q3 token 到手即开工（先调通传输、格式边拉边对，口径问题隔离记 warning 入库，不拦传输）；
> Q4 ads 首拉先快照只读一阶段（核对无误再开直写）；
> Q5 连带消费侧（损益 / 驾驶舱消费快照的改动含在本 spec）。

## TLDR

等俄方 `/api/v1` 就绪后，中方用一个新模块把 17 端点从“契约 + 快照 fixture”接到“真实拉取 + 入库 + 对账”。传输点亮与业务写分离：token 到手即拉取，快照只读先行；金额口径不合的行进隔离区（quarantine）记 warning，不拦整批、不写业务表；口径门通过后才打开 `platform_ops` 直写与 finance / 驾驶舱消费。本 spec 只定方向、阶段与验收门，不含代码改动。

## Problem Statement

`supply-sync-tech.md` 已把 17 端点字段级契约冻结（含 §0.6 双标度 + 五禁 + §22 第 0 行口径门），`ru_sync` 已交付契约侧实现（`lib/endpoints/supply.ts` / `ads.ts` zod schema、`__tests__/fixtures`、游标、SKU 映射、健康页、四预警事件）；缺的是 RU 侧真实 `/api/v1`（token 未到、冒烟样本未过口径门，后端 JSON 因 401 未能验证）。没有这份实作前计划，RU 一旦宣布就绪，中方当场三个卡点：supply 与 ads 谁先拉、订单 / 结算直写 `platform_ops` 还是先快照、口径门谁判停。finance spec（REQ-011 / REQ-012）定了“写哪里”，本 spec 定“何时以何种顺序打开”。

## Overview and Success Measures

- **Primary outcome:** RU 就绪后三阶段可执行：传输点亮（快照只读）→ supply 闭环（含 PO 草稿）→ ads 直写 + 损益 / 驾驶舱消费；每阶段 exit gate 可独立验收。
- **Leading indicators:** 口径门 verdict 页可读；隔离区行数收敛到 0；游标连续 7 天无断。
- **Baseline:** `ru_sync` 33 用例（mock contract server + 内存投影）；真实拉取 0；`platform_ops` 无 RU 来源行；finance 损益 RU 输入为空态。
- **Market / product reference:** 复用本仓既有范式（`export_finance/lib/peerReads.ts` scoped Kysely 只读、`trade_docs/lib/money.ts` BigInt 量化）；拒绝 Odoo / 新图表库（finance spec Non-goals 已定）。

## Goals

- **REQ-001** — 传输点亮：token 到手后 17 端点可从真实 `/api/v1` 拉取，失败页游标不推进，同 `as_of` 重放 0 新增。
- **REQ-002** — 口径隔离：金额 2 位 / 单价 4 位不合的行进隔离区（带 endpoint、natural key、reason、payload、`as_of`），整批不拦，业务表不写。
- **REQ-003** — 口径门 verdict：每端点 pass / blocked 可读；冒烟样本含合同行 `700 × 341.2382 = 238866.74` 对平；blocked 端点禁开直写。
- **REQ-004** — supply 实拉闭环：8 端点快照 + 游标 + SKU 映射 + PO 草稿（已映射行），未映射行 422。
- **REQ-005** — ads 快照只读轮：9 端点先只进快照，订单 / 结算不调 `platform_ops` 命令；核对（≤0.2 п.п. / 20 ₽）通过后才开直写。
- **REQ-006** — ads 直写轮：订单 → `platform_ops.orders.ingest`（≤500/批）、结算 → `platform_ops.settlements.import`（≤2000 行/单）；`channel_not_configured` 可见不丢数。
- **REQ-007** — 消费侧点亮：finance 月损益 / SKU 毛利、驾驶舱六类数消费快照；超差行进对账队列；stale > 24h banner。

## Non-goals

- 不写俄方任何数据（无回写；`A.4` 未勾选前不动俄方）。
- 不新立金额语义：唯一口径源是 `trade_docs/lib/money.ts` + money-scale spec；本 spec 不定义第二套舍入。
- 不改 `ru_sync` 既有表 / 路由 / 事件语义；只做一处加法（`ru_sync.snapshots.ingest` 命令，见架构）。
- 不做 Odoo / 新图表库 / 俄文全文翻译（finance spec 已排除）。
- 不含 RU 就绪前的任何代码工作；Phase 1 的唯一前置是开工门。

## Proposed Solution

新建 app 模块 `ru_pull` 承接实拉运行时（live client、隔离区、live 游标、worker + ProgressJob、口径门 verdict），契约 schema 与 fixture 留在 `ru_sync`（`ru_pull` 以 lib import 复用其 zod，不复制第二套契约）；验收行经新加法命令 `ru_sync.snapshots.ingest` 写入 `ru_sync` 快照投影（表归属不变），游标各自持有（live 归 `ru_pull`，fixture 演练归 `ru_sync`）。ads 分两轮：只读轮 → 直写轮（组织级开关）。finance / 驾驶舱只消费快照，不直连 RU。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| 新建 `ru_pull` 而不扩 `ru_sync`（Q2） | 契约 fixture 与 live 运行时失败模式不同（mock 演练 vs token / 限流 /  quarantined 行）；分开可单独回滚（停 live worker ≠ 下线契约页） | 在 `ru_sync` 内加 live client | 回滚粒度丢失；fixture  schema 与 live 容错逻辑混在一个模块 |
| `ru_pull` 以 lib import 复用 `ru_sync` zod | 同一份契约，两个模块各写一套 schema 必然漂移（已有跨模块 lib import 先例：`ru_sync/lib/adsIngest.ts` 引 `trade_docs/lib/money`） | 各写一套 | 双契约漂移，fixture 与 live 判分歧 |
| 验收行走 `ru_sync.snapshots.ingest` 新命令 | 快照表归属留在 `ru_sync`，跨模块写经命令（audit / 事件同一路径），不直写 peer 表 | `ru_pull` 自建快照表 | 两份快照真相；cockpit / finance 要同时读两处 |
| token 到手即拉取 + 隔离（Q3） | 传输问题（认证 / 分页 / 限流）与口径问题（小数位）解耦；前者早暴露，后者不污染业务表 | 口径全过才拉 | token 问题延迟暴露；RU 改格式期间中方零可见性 |
| ads 先快照只读一轮（Q4） | 订单 / 结算直写不可逆（镜像 + 对账）；先对数（≤0.2 п.п. / 20 ₽）再开写 | 首拉即直写 | 错数进 `platform_ops`，对账噪音 + 人工核 |
| live 拉取用 worker + ProgressJob直调，不注册第二个 DataSyncAdapter | 同一 provider 两套 adapter 会有两个游标主；live 游标唯一主在 `ru_pull`，`ru_sync` 的 adapter 保留给 fixture 演练 | 注册 `ru_petkit_live` adapter | 双 adapter / 双游标，operator 分不清哪边是真相 |
| 隔离区只存行级拒绝，不存整页 raw | 页级 raw 与快照重复，存量翻倍；隔离区只回答“哪行因何被拦、怎么重试” | 存整页 raw JSONB | 存储翻倍且无独立消费者 |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| 开工门（Q3） | token 到手即开传输；业务写（直写 / 消费）另需口径门 | 本 spec Phase 1 | 无 token 不拉；有 token 只进快照 + 隔离区 |
| 口径门 | 端点级 pass / blocked；冒烟 `700 × 341.2382 = 238866.74` 对平 + 该端点最近整轮 money 字段隔离率为 0 | `supply-sync-tech.md` §22 第 0 行 + `ru_pull` verdict | blocked 端点禁开直写；偶发超标行走隔离 + warning（§0.6），不拦整轮 |
| 隔离（quarantine） | 金额小数位 ≠ 2 / 单价小数位 ≠ 4 / JSON number / 俄式逗号 的行，带 reason 进 `ru_pull_quarantine` | `ru_sync/lib/endpoints/envelope.ts`（`moneyAmount` / `priceAmount` 正则） | 行禁入快照与业务表；整批继续；可 `retry`（RU 修格式后重判） |
| 游标推进 | 仅当该页全部行已落定（快照或隔离区）且提交成功才推进 live 游标；失败页保持旧水位 | `ru_sync` 既有规则（adapter / projection） | 下轮重拉同一窗口，不跳过 |
| 快照幂等 | `(endpoint, natural_key, as_of)` 同键重放改写不增行 | `ru_sync/lib/projection.ts` | 同 `as_of` 重放 0 新增（exit gate 量化） |
| ads 两轮 | 只读轮：9 端点全进快照，`ads_write_enabled=false`；直写轮：开关打开后订单 / 结算走 `platform_ops` | Q4 决议 | 开关关闭时 adsIngest 不被调用（代码级守卫，非约定） |
| 单价 4 位字段 | `unit_price / price / price_discounted / buyer_price / payout_price / showcase_price / cost / unit_cost`（单件成本语义时） | `supply-sync-tech.md` §0.6 | 误判为金额对象即口径事故：fixture 负例覆盖 |
| 金额 2 位字段 | 行小计 / 合计 / 费用 / 毛利 / 运费 / 结算 `gross/fee/net` / `spend / revenue / order_amount / stock_value` | 同上 | 同上 |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 集成运维 | 配 token（复用 `ru_petkit` credentials）、跑 pull、看 health / verdict、重试隔离区 | tenant 级 credential；组织行按选中组织；失败 closed | `ru_pull.view`、`ru_pull.run`、`ru_pull.quarantine.manage` |
| 供应计划 | 看 supply 快照、SKU 映射、PO 草稿 | own organization；tenant 派生自登录上下文 | `ru_sync.view`（既有）、`purchasing.orders.manage`（草稿） |
| 财务 | 看损益 / SKU 毛利、对账队列 | own organization；成本毛利敏感列同 finance 既有门 | `finance.profit.view`（既有） |
| 老板 | 看驾驶舱六类数 + stale | own organization 只读 | `boss_cockpit.view`（既有） |

Scope 推导一律来自认证上下文，不信任 payload；token 经 installed integrations credential service 加密存取，永不进日志与列表响应。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 契约 schema / fixture / mock | reuse | `ru_sync`（`lib/endpoints/*`、`__tests__/fixtures`） | lib import（zod） | 单一契约源，不复制 |
| 快照投影 / SKU 映射 / 健康页 | reuse + 一处加法 | `ru_sync` + 新命令 `ru_sync.snapshots.ingest` | command（跨模块写的唯一路径） | 表归属不变，audit / 事件同路径 |
| live 传输 / 隔离 / 游标 / verdict | app-own | 新 `ru_pull` | 自有表 + worker | 失败模式与 fixture 不同，可单独回滚 |
| 订单 / 结算幂等入口 | reuse | `platform_ops`（`orders.ingest` / `settlements.import`） | peer command（既有 adsIngest 路径） | 对账 kinds 现成，不 дублировать |
| 损益 / 毛利 / 驾驶舱 | reuse | `finance` / `boss_cockpit` | 快照只读（scoped Kysely peerReads 范式） | 不直连 RU；RU 数据永以快照进聚合 |
| 凭证 / 通知 / 进度 | reuse | installed `integrations` / `notifications` / queue + ProgressJob | `ru_petkit` credential、2 新通知类型 | 不手写 crypto / 队列 |

## Architecture and Data Flow

```text
RU /api/v1 --token--> ru_pull worker (live client, 分页/限流/重试)
  -> 行级判 (ru_sync zod: amount 2位 / price 4位 / string / 点号)
  -> accept: ru_sync.snapshots.ingest --> ru_sync_snapshots (+ SKU map refresh)
  -> reject: ru_pull_quarantine (reason + payload + as_of)
  -> 页落定 --> ru_pull_cursors 推进; verdict 页可读
ads 直写轮 (开关开): 快照行 --> ru_sync/lib/adsIngest --> platform_ops.orders.ingest (≤500/批)
  / platform_ops.settlements.import (≤2000行/单) --> reconciliation kinds
消费: finance (profit-loss / sku-margin) + boss_cockpit <-- 快照只读
```

- **Module boundaries:** `ru_pull` 拥有传输与隔离（可停）；`ru_sync` 拥有契约与快照（真相）；`platform_ops` 拥有镜像与对账；`finance` / `boss_cockpit` 拥有聚合与呈现。跨模块写只经命令，跨模块读只经标量 id + 快照只读。
- **Extension points:** 通知走 `notifications` 类型注册（2 新类型）；进度走 ProgressJob；不碰 installed 代码。
- **Alternatives considered:** 单模块方案与双 adapter 方案见上表（回滚粒度 / 双游标主因否决）。
- **Compatibility:** 全加法：新模块 + `ru_sync` 一个新命令 + 2 通知类型；不改既有路由 / schema / 事件语义（BACKWARD_COMPATIBILITY 允许类）。

## User Journeys

### Journey J-001 — token 到手点亮传输

1. 运维在 `ru_petkit` credential 配 baseUrl + token（加密存，从不回显），跑 `ru_pull.pull.run`（supply 先）。
2. 每端点逐页拉取；合规行进快照，不合规行进隔离区（reason 可读）；失败页游标不动。
3. 成功态：health 页每端点 lastAsOf / cursor / verdict 全绿或黄（blocked 标红但传输继续）；stale > 24h banner。
4. token 错 → 401 即停并 `ru_pull.pull_failed` 通知；429 按 `Retry-After` 退避；5xx transient 重试后仍败即停本轮。

### Journey J-002 — 隔离区清零与口径门通过

1. 运维打开 `/backend/ru-pull/quarantine`，按 endpoint / reason 过滤。
2. RU 修格式后点 retry（重判该行，不重拉整页）；通过行进快照，行从隔离区移除。
3. 成功态：某端点隔离率为 0 + 冒烟对平 → verdict 翻 pass，该端点可开直写 / 消费。

### Journey J-003 — ads 只读轮转直写轮

1. 只读轮：9 端点快照与 RU 页逐数核对（≤0.2 п.п. / 20 ₽）。
2. 核对通过后打开 `ads_write_enabled`，重跑 ads pull：订单 / 结算进 `platform_ops`，其余仍只进快照。
3. `channel_not_configured` 行快照已存、ingest 标记 failed 可见；配好 channel 后重跑补 ingest，不丢数。

## UI and Interaction Contracts

新页仅一页，其余复用既有页（`ru-sync/health`、`ru-sync/sku-map`、`boss-cockpit`、finance 各页）。最近 installed 参考：`ru_sync/backend/ru-sync/health/page.tsx`（DataTable + StatusBadge 同族）。

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/ru-pull/quarantine` | 隔离区列表（endpoint / reason 过滤）+ 单行 retry + 顶部口径门 verdict 头 | `GET /api/ru-pull/quarantine`、`POST /api/ru-pull/quarantine/retry`、`GET /api/ru-pull/health` | `ru_sync/backend/ru-sync/health/page.tsx` | `Page`、`PageBody`、`DataTable`、`StatusBadge` | loading, empty（零隔离 празнуем）, error, retry 中 / 409（行已转正）, permission denied | REQ-002, REQ-003 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| 运维 | RU 对接 → 隔离区 / 健康 | health 页 verdict 头（不新增 widget） | 登录 → 隔离区 → retry → verdict 翻绿（≤3 点击） |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| quarantine | “零隔离：口径全合规” + 去 health 页 CTA | 窄宽表格横滚，reason 列 tooltip | 表格行聚焦、retry 需 confirm、Esc 取消 |

## Data Models

### `RuPullCursor`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | UUID, required | primary key | no | immutable |
| `tenant_id` | UUID, required | unique `(tenant_id, endpoint)` | no | trusted context only |
| `endpoint` | text, required | 同上 | no | 17 端点码（`RU_ENDPOINTS` 并集） |
| `cursor` | text, nullable | — | no | `updated_at` 水位；仅整页落定后推进 |
| `updated_at` | timestamp, required | optimistic-lock version | no | updated on every edit |

### `RuPullQuarantine`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | UUID, required | primary key | no | immutable |
| `tenant_id` / `organization_id` | UUID, required | composite scope index | no | trusted context only |
| `endpoint` | text, required | scope + endpoint index | no | 17 端点码 |
| `natural_key` | text, required | — | no | 沿用该端点 natural key（`supplyNaturalKey` / `adsNaturalKey`） |
| `reason` | text, required | — | no | `amount_scale` / `price_scale` / `json_number` / `comma_decimal` / `unknown_key`（_label 等） |
| `payload` | jsonb, required | — | no | 原行 verbatim；永不进业务表 |
| `as_of` | date, required | — | no | 页快照日 |
| `updated_at` | timestamp, required | optimistic-lock version | no | retry 转正即删除本行 |

`ru_sync` 侧无表变更（快照 / 游标 / SKU map 复用）；`ru_pull` 两表迁移全新，加法，无 narrowing。

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| worker | `ru_pull.pull.run` | `ru_pull.run`（作业） | endpoint 集、`fullSync?` | 快照 upsert + 隔离写入 + live 游标 + `ru_pull.pull.*` | transient 重试；失败页不推进；同 `as_of` 幂等 | REQ-001, REQ-002 |
| `GET` | `/api/ru-pull/health` | auth + `ru_pull.view` | — | `{ endpoints[]: { endpoint, lastAsOf, cursor, verdict, quarantineCount } }` | 403 | REQ-001, REQ-003 |
| `GET` | `/api/ru-pull/quarantine` | auth + `ru_pull.view` | `endpoint?`、`reason?`（zod） | `{ items, totalCount }`（含 `updatedAt`） | 400/403 | REQ-002 |
| `POST` | `/api/ru-pull/quarantine/retry` | auth + `ru_pull.quarantine.manage` | `ids[]` + `updatedAt`（乐观锁） | 转正计数 + `ru_pull.quarantine.retried` | 400/403/409（行已转正） | REQ-002 |
| command | `ru_sync.snapshots.ingest`（`ru_sync` 加法） | 内部（`ru_pull` worker 调用，scope 透传） | 已验收行 + `as_of` | 快照 upsert + SKU codes refresh | 同既有 projection 幂等 | REQ-001, REQ-004 |
| switch | `ru_pull.ads_write.enabled`（组织级配置 + 命令翻转） | `ru_pull.run` | `enabled` | 开关状态 + `ru_pull.ads_write.changed` | 关闭时 adsIngest 代码级不可达 | REQ-005, REQ-006 |

路由一律 `makeCrudRoute` 或受守卫 custom 路由；每方法 `metadata` + `openApi`；命令走注册 mutation 守卫（compensating 行为见回滚节）。

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `ru_pull.pull.failed` | `ru_pull` | 通知订阅者 | `ru_pull.pull_failed` 通知 | 持久幂等；同 run 不重复建 |
| `ru_pull.money_gate.changed` | `ru_pull`（verdict 翻转） | 通知订阅者 | `ru_pull.money_gate` 通知（pass/blocked + endpoint） | 去重窗口 24h，同 verdict 不重发 |
| `ru_sync.snapshots.ingest` | `ru_pull` worker | `ru_sync` | 快照 upsert | 同键幂等；审计走命令路径 |
| ads 直写 | `ru_pull` worker（开关开） | `platform_ops` ingest/import | 镜像 + 对账 kinds | ≤500/≤2000 切批；`channel_not_configured` 标记 failed 可见 |

调度：worker 经 queue + ProgressJob；同 scope + endpoint 禁并发重叠跑。缓存：health 读直查表，不加缓存层。

## Security, Privacy, and Compliance

- **Authorization:** feature 门（`ru_pull.view/run/quarantine.manage`），`setup.ts` 默认角色授予 + `sync-role-acls`；永不 role-name 检查。
- **Tenant isolation:** credential tenant 级；组织行双 scope 过滤；fail-closed；第二 tenant 读隔离区 / health 不可见（TEST-RP-005）。
- **Sensitive data:** token 加密存（复用 `ru_petkit` credential），永不返回 / 日志；隔离区 payload 为业务数非 PII，按既有快照同等保管。
- **Abuse and failure modes:** baseUrl SSRF 校验（`allowPrivate` 仅本地 mock）；401 即停；429 退避；重放与并发收敛；destructive 动作只有开关翻转（可逆）。

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-RP-001 | integration | mock contract server（复用 `ru_sync` fixtures + 负例：3 位金额、number 金额、逗号金额、`_label` 行） | 跑 supply 全量 → 同 `as_of` 重放 → 中途 500 | 投影行数 == mock 合规行数；重放 0 新增；失败游标不推进；4 类负例全进隔离区（reason 一一对应） | REQ-001, REQ-002 |
| TEST-RP-002 | integration | 隔离区 4 行 + RU 修格式后重判 | `POST retry` | 转正行进快照并离区；已转正行 409；verdict 翻 pass | REQ-002, REQ-003 |
| TEST-RP-003 | integration | 冒烟样本（含 `700 × 341.2382` 行） | verdict 计算 | `238866.74` 对平 → pass；改样本为 `"341.24"` → blocked（含差 1.26 说明字段） | REQ-003 |
| TEST-RP-004 | integration | ads fixtures；开关关 → 开 | 关时拉 ads → 对数 → 开后重拉 | 关时零 `platform_ops` 写；开后按 500/2000 切批；重复 externalId 幂等；`channel_not_configured` 可见 | REQ-005, REQ-006 |
| TEST-RP-005 | security | 第二 tenant / 无 feature | 读 quarantine / health / 跑 pull | fail closed，无泄漏 | REQ-002 |
| TEST-RP-006 | UI | 隔离 3 行 / 空隔离 / stale 游标 | 开 quarantine 三态 | 空态指引、reason 过滤、retry confirm、stale 高亮 | REQ-002, REQ-003 |

## Implementation Phases

### Phase 1 — 传输点亮与隔离（RU-Ready 第一棒）

- **Depends on:** 开工门（RU token 到手；§22 第 0 行冒烟样本可取）。
- **Outcome:** 17 端点真实可拉；合规进快照，不合规进隔离；verdict 页可读；零业务表写。
- **Why this order / value delivered:** 先回答“传不传得动”，口径争议不拦传输；隔离区是 RU 改格式的证据页。
- **Deliverables:** `ru_pull` 模块骨架（`index/integration/di/acl/setup/events/notifications`）+ `data/entities + validators`（两表）+ `lib/client + moneyGate + cursor`（复用 `ru_sync` zod）+ worker + `ru_sync.snapshots.ingest`（加法命令）+ health / quarantine 两路由 + quarantine 一页 + 迁移 + `src/modules.ts` 注册 + `yarn generate`。
- **Independent slices / estimated commits:** 实体 + 命令 + 路由；client + moneyGate + 单测；worker + health；quarantine 页。
- **Requirements closed:** REQ-001, REQ-002, REQ-003
- **Tests:** TEST-RP-001, TEST-RP-002, TEST-RP-003, TEST-RP-005, TEST-RP-006
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build`；`yarn test src/modules/ru_pull`；mock 全量 + 重放 + 中途失败。
- **Exit gate:** 真实首轮：快照行数 == RU 页数可解释（差异逐端点有 reason）；同 `as_of` 重放 0 新增；失败页游标不动；verdict 每端点可读。

### Phase 2 — supply 实拉闭环

- **Depends on:** Phase 1 exit gate（supply 端点 verdict pass）。
- **Outcome:** supply 缺口 → draft PO；驾驶舱供应数 + CN 资金数可看；stale / 四预警不断。
- **Why this order / value delivered:** S 级价值（断流即停摆）先落地；ads 未就绪不影响。
- **Deliverables:** SKU 映射投产（沿用 `ru-sync/sku-map` 页）+ PO 草稿链路（沿用 `ru_sync` draft-pos 命令语义，未映射 422）+ cockpit supply 消费 + 游标断 24h banner 实测。
- **Independent slices / estimated commits:** 映射投产切片；草稿链路切片；cockpit 消费切片。
- **Requirements closed:** REQ-004, REQ-007（supply 部分）
- **Tests:** finance 既有 TEST-004 语义复用（mock→真实断言迁移）+ TEST-RP-005
- **Validation:** 同 Phase 1 门；draft PO 端到端 + 422 路径。
- **Exit gate:** 未映射行禁生成；place 仍走既有路径；驾驶舱 supply 数带 `as_of` 与来源。

### Phase 3 — ads 两轮 + 消费侧点亮

- **Depends on:** Phase 1（ads verdict 可读）→ 只读轮；只读轮对数通过 → 直写轮。
- **Outcome:** 订单 / 结算进 `platform_ops`；finance 损益 + SKU 毛利；驾驶舱六类数齐；四预警可达。
- **Why this order / value delivered:** A 级价值（算钱 / 省钱）收尾；直写前有只读轮对数兜底。
- **Deliverables:** `ads_write_enabled` 开关 + 只读轮核对报告（≤0.2 п.п. / 20 ₽）+ 直写轮（ingest / import 切批）+ `finance` profit-loss / sku-margin RU 输入接通 + cockpit v2 + 对账差异 kinds 消费。
- **Independent slices / estimated commits:** 开关 + 只读轮；直写轮；消费侧（finance 双页 + cockpit）。
- **Requirements closed:** REQ-005, REQ-006, REQ-007（完整）
- **Tests:** TEST-RP-004 + finance 既有 TEST-008 语义（ads fixture → 真实）
- **Validation:** `GET /api/finance/profit-loss` 与 RU `/ads/summary` 对齐（≤0.2 п.п. / 20 ₽）；明暗 + 窄宽 + 键盘。
- **Exit gate:** 事实 / 预测不混列；成本行取到岸成本带 `as_of`；超差行进对账队列；四预警各触发一次且去重生效。

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001, health | `ru_pull.pull.run`、`GET /api/ru-pull/health` | Phase 1 | TEST-RP-001 | AC-001 |
| REQ-002 | J-002, `/backend/ru-pull/quarantine` | `ru_pull_quarantine`、`GET /api/ru-pull/quarantine`、retry | Phase 1 | TEST-RP-001, TEST-RP-002, TEST-RP-006 | AC-002 |
| REQ-003 | J-002, verdict 头 | verdict 计算 + `ru_pull.money_gate.changed` | Phase 1 | TEST-RP-003 | AC-003 |
| REQ-004 | sku-map + draft-pos | `ru_sync.snapshots.ingest` 下游既有链 | Phase 2 | 既有 TEST-004 语义 | AC-004 |
| REQ-005 | J-003 只读轮 | 快照 + 核对报告 | Phase 3 | TEST-RP-004 | AC-005 |
| REQ-006 | J-003 直写轮 | ingest / import + 开关 | Phase 3 | TEST-RP-004 | AC-006 |
| REQ-007 | finance / cockpit | profit-loss / sku-margin / summary | Phase 2–3 | 既有 TEST-008 语义 | AC-007 |

## Rollout, Migration, and Rollback

- 迁移：`ru_pull` 两表全新（`yarn db:generate` 探针 + 评审 + 快照，批准后应用；本 spec 阶段不代申请）。
- 发布序：Phase 1（只读，无业务影响）→ Phase 2（草稿，不含 place）→ Phase 3 只读轮 → 直写轮（开关默认关，显式打开）。
- 回滚：停 worker（`ru_pull.pull.run` 禁用）→ 关 `ads_write_enabled` → 快照 / 隔离区保留备查；无需 schema 回滚（加法表；模块下线才需 drop 迁移，另案）。
- 可观测：health verdict + stale banner + 2 通知类型；隔离率突增即告警（RU 改格式的早期信号）。

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| RU 迟迟不给 token（开工门空转） | Phase 1 无法启动 | fixture 演练保持（`ru_sync` 既有 33 用例）；本 spec 不写代码零成本等待 | 等待期零进展（已接受：Q3 只开传输，不预写业务） |
| RU 金额格式长期不合规 | 隔离区积压，直写 / 消费不开 | verdict + 隔离率告警作为对 RU 的证据页；偶发超标按 §0.6 量化记 warning | 业务价值延迟（supply 先行部分缓解） |
| 双模块契约漂移（`ru_sync` 改 zod 忘同步） | live 判与 fixture 判分歧 | 单一源（lib import）；TEST-RP-001 负例与 `ru_sync` 负例同源 | import 路径变更需两模块同改（接受：同仓原子提交） |
| 双游标困惑（live vs fixture） | operator 看错水位 | 命名隔离（`ru_pull_cursors` vs `ru_sync_cursors`）；health 页只展 live | 接受：文档级约束 |
| ads 直写错数进 `platform_ops` | 对账噪音 | 只读轮对数门 + 开关默认关 + 切批幂等 + channel 缺配可见 | 首轮仍需人工核对（接受：显式 exit gate） |
| 隔离区无限增长 | 存储与噪音 | 按 `(endpoint, as_of)` 保留窗口（默认 90 天，配置化，Phase 1 定值）+ 告警 | 接受：窗口值待 Phase 1 定 |
| token 泄漏 / 越权拉取 | 供应链数据泄漏 | 加密存、永不回显 / 日志、fail-closed、TEST-RP-005 | 接受：标准 credential 面 |

## Acceptance Criteria

- [ ] **AC-001** — 真实首轮 17 端点可拉；同 `as_of` 重放 0 新增；失败页游标不动；health 每端点可读。
- [ ] **AC-002** — 4 类负例（3 位金额 / number 金额 / 逗号金额 / `_label`）全进隔离区且 reason 一一对应；整批继续；retry 转正离区。
- [ ] **AC-003** — 冒烟 `700 × 341.2382 = 238866.74` 对平 → pass；`"341.24"` 反例 → blocked（含差 1.26）；blocked 端点直写开关不可开。
- [ ] **AC-004** — supply 缺口 → draft PO（已映射）；未映射行 422；place 仍走既有路径。
- [ ] **AC-005** — ads 只读轮 9 端点快照与 RU 页逐数对齐（≤0.2 п.п. / 20 ₽），零 `platform_ops` 写。
- [ ] **AC-006** — 直写轮按 500 / 2000 切批；重复 externalId 幂等；`channel_not_configured` 可见且补跑可 ingest。
- [ ] **AC-007** — finance 损益 / SKU 毛利、驾驶舱六类数消费快照；超差进对账；stale > 24h banner；四预警去重生效。
- [ ] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light-mode, and dark-mode states.
- [ ] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | 根 AGENTS.md；`.ai/guides/architecture.md`、`contracts.md`、`integrations.md`、`spec-delivery.md`、`upstream/BACKWARD_COMPATIBILITY.md`；`om-spec-writing`（skeleton + Q1–Q5 门控，用户已答复） |
| Data models, APIs, events, UI, and tests are internally consistent | pass | 追踪表 7 行全映射到 phase + test + AC；无 catch-all 集成阶段 |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001–J-003 各有成功 / 失败 / 重试闭环 |
| Platform-native reuse and extension points were chosen before custom code | pass | 复用表：zod / 投影 / ingest / credential / notifications / ProgressJob；唯一新表 2 张 + 命令 1 条 |
| UI contracts identify references, canonical components, and theme/state coverage | pass | 唯一新页对标 `ru-sync/health`，DataTable + StatusBadge + 全状态 |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phase 1–3 各有依赖 / 切片 / 测试 / exit gate |
| Lessons scanned | pass | `.ai/lessons.md`：`no-decimals-means-narrow-the-column-scale`（列 scale 即契约，本 spec 口径门语义一致） |

Verdict must be exactly `Ready for implementation` or `Blocked — {unresolved items}`. The document status may change to ready only when every row passes.

**Verdict: Blocked — 等用户批准进入实作（RU token 未到，属外部前置，非 spec 内问题）**

## Open Questions

无（Q1–Q5 已由用户 2026-09-28 答复，见文件头决议；新疑问出现时再开门）。

## Changelog

| Date | Change |
|---|---|
| 2026-09-28 | Skeleton + Q1–Q5 门控；用户答复（一 spec 三阶段 / 新建模块 / token 即开工 / ads 先只读 / 连带消费侧） |
| 2026-09-28 | Full spec：三阶段 + 追踪表 + TEST-RP-001–006 + AC-001–007；关系声明：本 spec 为 finance spec REQ-011/012 的 RU-Ready 执行编排，不改其 REQ |
