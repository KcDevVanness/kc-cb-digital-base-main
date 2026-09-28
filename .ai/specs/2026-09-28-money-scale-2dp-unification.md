# 统一金额口径：金额 2 位、单价 4 位（系统级硬性口径）

**Date**: 2026-09-28
**Status**: Implemented & verified — Phase 1–5 全部交付（2026-09-28）：引擎/实体标度/迁移应用/写路径/展示/入口校验/文档同步；`yarn generate`、`typecheck`、`lint`(0 error)、`test`(54 suites/439 tests)、`ds:check`(891 files) 全绿；ephemeral 集成 76 passed，全部金额相关用例通过（trade_docs/purchasing/sourcing/products）；开发库 40 个金额/单价列核对 0 偏差，应用前备份于 `/tmp/kc-money-backup/kc-money-20260928.sql`。仅存两类与本变更无关的运行环境/并行在飞失败：`storage_ops` 4 例缺 `STORAGE_OPS_TEST_S3_CONFIG` 门控、`finance-flow` 新规格自身 ACL 接线（403）。本 PR 落地范围＝HEAD 上已存在的模块/表；finance、PI/CI 单证等未提交模块随各自 PR 适配。

## TLDR

把系统内**所有金额**统一为 2 位小数、HALF_UP（四舍五入、远离零），**所有单价**统一为 4 位小数；金额的唯一舍入点是「行金额 = HALF_UP(数量 × 单价, 2)」，合计 = 已舍入行金额的精确求和。存储列、API 出入站、导出/票面、对账、外部接口（ru-petkit）统一同一口径。复用既有 BigInt 金额引擎 `trade_docs/lib/money.ts` 与 `MoneyAmount` 展示组件；不新增模块与页面。

证据基准：2026-09-28 全模块审计（见本会话）＋ 业主采购合同样本（单价 4 位、金额 2 位，金额=round(数量×单价,2) 逐行成立），样本行：`700 × 341.2382 = 238,866.74`（恰好）、`180 × 65.5916 = 11,806.488 → 11,806.49`、`290 × 1345.5907 = 390,221.303 → 390,221.30`。

## Problem Statement

现状（审计实测）：

- 金额列 `numeric(18,4)`、单价列 `18,6`/`18,4` 混用（trade_docs/products/sourcing/cross_border 单价 6 位，purchasing 4 位）。
- purchasing、platform_ops 的金额写入是 JS 浮点 `Number(x).toFixed(4)`；内置 sales 用 `Math.round((v+Number.EPSILON)*1e4)/1e4` 且行→单头二次舍入。
- platform_ops 对账容差是绝对值 `1e-6` 浮点、且比较发生在写入舍入之后 ⇒ 0.0001 级差异结构上不可见。
- 外部接口（`docs/ru-petkit/*`）要求 2 位，内部为 4 位；同一金额在 6→4→2 处被多次舍入，三套账无法逐行对平。

业主判定：**金额 2 位、四舍五入为硬性要求**；合同样本进一步证明**单价必须保留 4 位**（若单价被压到 2 位，样本第一行将变成 238,868.00，与合同差 1.26）。

## Overview and Success Measures

- **Primary outcome:** DB/API/导出/票面金额一律 2 位小数、HALF_UP 且只舍入一次；跨模块与外部系统对账残差 = 0（同口径 HALF_UP + 已舍入值精确求和）。
- **Leading indicators:** 引擎边界用例通过（`1.005→1.01`、`0.005→0.01`、`-0.005→-0.01`、`0.3125→0.31`）；对账集成用例（合同/订单/台账三套账逐行与合计相等）通过。
- **Baseline:** 2026-09-28 审计：金额 4 位存储、单价 6/4 位混用、浮点舍入与 1e-6 容差。
- **Market / product reference:** 主流 ERP（用友/金蝶）与支付网关（Stripe/Adyen）均以最小货币单位（分）或固定 2 位存储金额、单价独立更高精度。采纳"金额固定 2 位 + 单价独立 4 位"；拒绝"按币种 `decimal_places` 量化金额"（JPY=0 会破坏硬性 2 位，且系统外契约无法感知）。

## Goals

- **REQ-001** — 所有金额字段（存储/计算/API 出入站/展示/对账）标度恒为 2，HALF_UP 远离零；全系统唯一金额舍入点为「行金额 = HALF_UP(数量 × 单价, 2)」；合计 = 已舍入行金额精确相加，不再二次舍入。
- **REQ-002** — 所有单价字段标度恒为 4（商品价/采购价/供应商报价/销售价），录入后不再舍入；票面按 4 位打印。
- **REQ-003** — 单一金额引擎：全部金额算术经 `trade_docs/lib/money.ts`（BigInt ExactDecimal）；app 代码金额禁 `Number`/`toFixed`/`Math.round`；舍入/除法（`divideHalfUp`）与 scaled-int 比较（`toScaledUnits`、`isAmountGreaterThan`）收敛到引擎；对账禁用浮点 epsilon。
- **REQ-004** — 校验：人工录入（后台表单/自有 API）金额 >2 位、单价 >4 位 → 400（拒绝而非静默舍入）；导入/外部集成数据 → 显式 HALF_UP 量化到 2/4 位并记结构化 warning。
- **REQ-005** — 出站契约：所有 API 响应、导出（CSV/XLSX）、票面模板金额固定 2 位、单价固定 4 位；`docs/ru-petkit/*` 接口文档同步（金额 2 位已定，补单价 4 位）。
- **REQ-006** — 内置 `sales`/`catalog`/`wms`（node_modules，不可改）采用边界适配：app 入口只写 2 位金额/4 位单价；全部展示与导出按 2 位；内核列 18,4 标注为实现细节（例外清单进文档）。
- **REQ-007** — 迁移：金额列 → `numeric(18,2)`、单价列 → `numeric(18,4)`，存量数据按 HALF_UP 转换；迁移由 `yarn db:generate` 生成、逐条审阅、**业主批准后**才应用。
- **REQ-008** — 规格/文档同步：新增本规格；更新受影响的 `.ai/specs/*`、`docs/dev/*`、`docs/prd/*`、`docs/plans/*`、各 `src/modules/<id>/README.md`。

## Non-goals

- 数量标度不变（trade_docs 18,6；purchasing/cross_border 18,4；内置 sales `normalized_quantity` 18,6）。
- 重量/体积/电池容量（16,4 / 16,0 / 10,2）、税率/比例（6,3、7,4）、汇率（18,8）不变。
- 不改 `node_modules` 内核，不 eject；不新增模块、页面、事件、ACL。
- 不做多币种金额位差异化（含 JPY 一律 2 位）。

## Proposed Solution

1. **引擎收敛**：`trade_docs/lib/money.ts` 导出 `AMOUNT_SCALE = 2`、`PRICE_SCALE = 4`；`computeLineAmounts` 两个口径都量化到 2（金融口径的币种差异取消，差异只保留"发票金额覆盖"语义）；`sumAmounts` 按 2 渲染；把 `divideHalfUp`、`toScaledUnits` 从 `export_finance/lib/fileRules.ts` 迁入引擎（消除 finance→export_finance 的反向依赖）；删除 `resolveCurrencyScale` 与 `lib/currencyScale.ts`（金额不再读 `Currency.decimal_places`；该列保留为展示元数据，由 currency_policy 维护）。
2. **Schema 收敛**：金额列 `18,2`、单价列 `18,4`（附录 A 全量清单），生成迁移；validator 与列同标度。
3. **写路径**：purchasing/platform_ops/cross_border/sourcing/currency_policy 去除浮点金额路径，全部改走引擎；`toFixed` 仅允许出现在非金额展示（数量/百分比）且需注释说明。
4. **对账**：platform_ops/finance/export_finance 用 `toScaledUnits(2)` 精确比较，差异入队；修复 `raiseItem` 去重与文档矛盾（改按 expected+actual 变化判断）。
5. **展示/契约**：`MoneyAmount` 强制 `minimumFractionDigits=2, maximumFractionDigits=2`（不再依赖 Intl 币种 CLDR 默认，JPY 也显示 2 位）；finance 裸 4 位表格改 2 位；票面/模板单价 4 位、金额 2 位。
6. **核心模块**：internal_sales 入口只发 2 位金额/4 位单价并加客户端+服务端校验；不新增 sales 命令拦截器（本部署 sales 写入面已被 internal_sales 收敛；如后续出现旁路写入口，再评估 UMES 拦截器）。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| 金额 2 位存储（18,2） | 库内无残差；财务/外部契约一致 | 保留 18,4、边界量化 2 位 | 绕过路径与旧数据仍产生 4 位值，对账不可控 |
| 单价 4 位（18,4） | 业主合同样本 4 位；保证票面自洽 | 单价压到 2 位 | `0.085→0.09` 改变价格，行金额差 6% |
| 单价从 6 位收到 4 位 | 票面 4 位；链路只保留一个精度 | 保留 6 位、票面只显示 4 位 | 票面金额与读者按 4 位验算会差 0.01 级；多口径 |
| 金额与币种无关、恒 2 位 | 硬性要求；外部契约统一 | 保留 `decimal_places` 驱动 | JPY=0/3 位币种破坏"全部 2 位"；对外不可见 |
| 引擎保持 `trade_docs/lib/money.ts` | 已有唯一入口，export_finance/finance 已依赖 | 迁到 `src/lib/money/` | 额外 13 处导入面变更，无功能收益；可作后续独立重构 |
| 人工录入拒绝超位、导入量化 | 沿用仓库"拒绝而非静默舍入"惯例 | 一律静默 HALF_UP | 手误被静默改数，对账追责困难 |
| 核心模块边界适配 | 规则禁止改 node_modules | eject sales | 越权且维护成本高 |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| 金额（Amount） | 一切货币价值字段：行金额/合计/收付款/定金/退税/分摊/成本/对账值。标度恒 2，写入前 HALF_UP（远离零） | `trade_docs/lib/money.ts` | 超位录入 400；导入记 warning 后量化 |
| 单价（Unit Price） | 商品价/采购价/报价/销售价。标度恒 4，不做二次舍入 | 同上 + 各模块实体 | 超位录入 400；导入量化到 4 |
| 行金额 | `HALF_UP(数量 × 单价, 2)`，全系统唯一金额舍入点 | `computeLineAmounts` | 不可解析输入抛错（不静默丢弃） |
| 合计 | 已舍入行金额的精确和；不重新量化 | `sumAmounts` | 同上 |
| 金融口径 / 合同口径 | 两者标度统一 2；差异仅来自"发票金额覆盖"（invoice-authoritative） | `computeContractTotals` | 差额列正常显示，负值允许 |
| 对账 | `toScaledUnits(v, 2)` 的 BigInt 精确相等；差异进入差异队列 | engine + `platform_ops` | 差异 ≥0.01 即入队；不再有 1e-6 容差 |
| 汇率 | 18,8，仅换算/展示，不参与金额标度 | finance/currency_policy | 反算利率量化为 8 位后使用 |

## Users, Permissions, and Scope

N/A — 不新增权限与角色；所有受影响读写沿用各模块既有 feature gates 与租户/组织过滤，迁移脚本不改变数据归属。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 金额引擎/舍入 | reuse | `trade_docs/lib/money.ts` | 直接 import（既有跨模块先例） | 已是唯一实现，避免第二套 |
| 精确十进制原语 | reuse | `@open-mercato/core` dashboards `exactDecimal` | 包导出 | 不改内核 |
| 展示 | reuse | `src/lib/money/MoneyAmount` | 组件 | 全 app 已收敛于此 |
| Schema/迁移 | app-own | 各模块 `data/entities.ts` + migrations | `yarn db:generate` | 每模块自持迁移链 |
| 核心模块标度例外 | 边界适配 | `internal_sales` + 文档 | 入口校验 | 不改 node_modules |

## Architecture and Data Flow

```text
录入(UI / 导入 / 外部 API)
  -> validator(金额≤2位；单价≤4位；导入路径显式量化)
  -> command(金额算术全走 money.ts: HALF_UP)
  -> DB numeric(18,2) / numeric(18,4)

读取: DB 字符串 -> API(原样 2 位/4 位) -> MoneyAmount(固定 2 位) / 票面模板(单价 4 位、金额 2 位)
对账: toScaledUnits(v, 2) -> BigInt 相等比较 -> 差异入队(platform_ops) / 分摊(export_finance、finance)
```

- **Module boundaries:** 不改模块归属；引擎位置不变；被删的 `currencyScale.ts` 能力并入常量。
- **Extension points:** 无新扩展面；沿用既有命令/校验/展示。
- **Compatibility:** 金额/单价 API 字段仍是十进制字符串，仅标度变化；超位请求从"静默入库"变为 400（对外部直连方是行为收紧，需公告）。
- **Alternatives considered:** 见设计决策表。

## User Journeys

### Journey J-001 — 采购下单（purchasing）

1. 采购员在采购订单表单录入 4 位单价（如 `341.2382`）与数量。
2. 命令层用引擎计算行净/税/总额（2 位），单头合计 = Σ 行值；超位输入被 400 拒绝。
3. 保存后详情/列表展示 2 位金额；合同/单据从同一行值派生，无二次舍入。
4. 失败：税率非法、数量超收、并发 409 走既有 UI 状态；金额永不因浮点产生 0.0001 偏差。

### Journey J-002 — 合同票面验算（trade_docs）

1. 生成合同：单价按 4 位、金额按 2 位输出。
2. 读者用票面单价 × 数量 HALF_UP 到 2 位，与票面金额逐行相等（样本 9 行全部成立）。
3. 合计 = 9 行金额之和，分位精确。
4. 失败：币种位不再影响金额；发票覆盖金额时差额列显式可见。

### Journey J-003 — 平台对账（platform_ops）

1. 导入平台账单（金额量化到 2 位，记 warning）。
2. 与 ERP 镜像值做 scaled-int 精确比较（2 位）。
3. 差异 → 对账队列（按 expected+actual 变化重新入队）；一致 → 跳过。
4. 失败：缺失行/多行仍入队；不再出现"0.0001 差异测不到"。

## UI and Interaction Contracts

无新增页面；仅金额/单价的显示与录入约束变化。受影响面沿用现有组件与页面（`MoneyAmount`、各模块 `DataTable`/`CrudForm`、finance 的裸串表格、合同/单据模板）。

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| 全后台金额列/摘要 | 展示金额 | 既有 API（字符串） | `src/lib/money/MoneyAmount.tsx` | `MoneyAmount` | 既有 loading/empty/error 不变 | REQ-001, REQ-005 |
| `finance` 到岸成本/库存值表 | 展示金额 | 既有 API | `LandedCostView.tsx` 现有列 | `DataTable` + 2 位格式化 | 既有状态不变 | REQ-005 |
| 采购/销售/报价录入表单 | 录入金额/单价 | 既有命令 | 各模块 `CrudForm` 字段 | `CrudForm`（`inputMode="decimal"`） | 字段级 400 提示（超位） | REQ-004 |
| 合同/单据/Excel 模板 | 打印/导出 | 既有模板 | `trade_docs/lib/contractTemplate.ts` | XLSX 模板 | — | REQ-002, REQ-005 |

- **Behavior:** 金额显示固定 2 位（`minimumFractionDigits=2, maximumFractionDigits=2`），单价显示 4 位；键盘/焦点/校验行为沿用现有表单。
- **Responsive and accessibility:** 无变化（仅数字格式）。
- **Localization:** 现有 i18n 键不变；新增错误消息走各模块既有 namespace（zh/en 同步）。
- **Design-system and theming:** 无新增样式；沿用语义 token。

## Data Models

附录 A 为逐字段变更清单（模块/文件/现标度→新标度）。迁移语义：

```sql
alter table "x" alter column "amount" type numeric(18,2) using round("amount"::numeric(18,2));
alter table "x" alter column "unit_price" type numeric(18,4) using round("unit_price"::numeric(18,4));
```

- PostgreSQL 的 `numeric` 转换按"四舍五入远离零"，与引擎 HALF_UP 同语义（**Phase 1 在 ephemeral 库验证后**才生成最终迁移注释）。
- 存量金额的 0.001–0.005 级分位将被舍入（不可逆）；单价 5–6 位将被舍入到 4 位。备份/回滚见 Rollout 节。
- 实体/校验/列三处标度必须一致；软删除、`updated_at`、作用域列不变。
- 无新实体、无新关系、无加密面。

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| 既有全部金额读写路由 | 不变 | 不变 | 金额 ≤2 位字符串（超过→400）；单价 ≤4 位 | 金额恒 2 位、单价恒 4 位字符串 | 400 报"最多 N 位小数"（zh/en） | REQ-004, REQ-005 |
| platform_ops 导入命令 | 不变 | 不变 | 任意位（集成数据） | HALF_UP 量化后入库，记 warning | 幂等/去重按新口径 | REQ-003, REQ-004 |

- 全部沿用 `makeCrudRoute` 与既有命令 ID；不新增路由。
- OpenAPI：金额字段描述与示例改为 2 位、单价 4 位。

## Events, Jobs, Notifications, and Cross-Module Flows

N/A — 无新增事件/作业/通知；既有事件负载中金额字段的**值**按新标度输出（不做兼容双发，见 Rollout）。

## Security, Privacy, and Compliance

- **Authorization:** 不变（既有 feature gates）。
- **Tenant isolation:** 不变（迁移仅改数值类型）。
- **Sensitive data:** N/A — 无新增 PII/凭证字段。
- **Abuse and failure modes:** 迁移为一次性 DDL；对账逻辑收紧不产生新暴露面。

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | unit | 引擎 | quantize 边界（1.005/0.005/-0.005/0.3125）、2 位渲染、Σ 精确 | 输出与规则逐项相等 | REQ-001, REQ-003 |
| TEST-002 | unit | purchasing 行/单头 | 4 位单价 × 数量 → 2 位行金额；合计 = Σ | 与合同样本同值；无浮点残差 | REQ-001, REQ-002 |
| TEST-003 | unit | platform_ops 对账 | 0.0001 级差异、相等值、缺行 | scaled-int 精确判决；差异入队 | REQ-003 |
| TEST-004 | api | 采购/单据路由 | 金额 3 位、单价 5 位请求 | 400；合法 2/4 位通过 | REQ-004 |
| TEST-005 | unit | 合同模板 | 样本 9 行 | 票面单价 4 位、金额 2 位，逐行 `HALF_UP(数量×单价,2)` 成立 | REQ-002, REQ-005 |
| TEST-006 | integration | ephemeral DB | 迁移 18,4→18,2、18,6→18,4 | 列类型正确；抽样值 HALF_UP 转换 | REQ-007 |

## Implementation Phases

### Phase 1 — 引擎与标度（含迁移生成）

- **Depends on:** none
- **Outcome:** 引擎/HALF_UP 口径生效，全部金额列 18,2、单价列 18,4；应用可运行（写路径尚未全部接引擎，但结果已被统一到 2 位）。
- **Why this order / value delivered:** 标度是所有后续工作的接口；先冻结契约与 Schema。
- **Deliverables:** `trade_docs/lib/money.ts`（`AMOUNT_SCALE=2`、`PRICE_SCALE=4`、`divideHalfUp`、`toScaledUnits`，删 `resolveCurrencyScale`/`currencyScale.ts`）；
  entities 标度（附录 A）；`yarn db:generate` 生成的迁移与快照（逐条审阅）；引擎及相关单测更新。validator 标度随 Phase 2 与写路径同批修改（避免"生产方 6 位 / 消费方 4 位"的中间态）。
- **Independent slices / estimated commits:** (a) 引擎与调用点（trade_docs/export_finance/finance）；(b) entities+validators 标度（8 模块）；(c) 迁移生成与审阅。
- **Requirements closed:** REQ-001（计算面）、REQ-007（生成面）
- **Tests:** TEST-001, TEST-006（生成与审阅）
- **Validation:** `yarn generate`、`yarn typecheck`、受影响单测、迁移 SQL 逐条 review
- **Exit gate:** typecheck 全绿；`db:generate` 输出与附录 A 完全一致；引擎边界用例通过；无 `resolveCurrencyScale` 残留。

### Phase 2 — 写路径与对账精确化

- **Depends on:** Phase 1
- **Outcome:** 所有金额写入经引擎、对账精确；浮点金额路径归零。
- **Deliverables:** purchasing（validators 2/4 位、`orderTotals.ts` 引擎化、命令、守卫、死代码清理）、platform_ops（校验/命令/对账 scaled-int、去重修复）、cross_border（validators、数量双路径精确化、超发守卫）、sourcing（validators 4 位、导入量化 4 位、变更检测精确、promotion）、products（价格 validator 4 位）、currency_policy（利率反算量化 8 位、折算金额 2 位）、trade_docs/export_finance/finance 的 validator 标度与列对齐。
- **Independent slices / estimated commits:** 每模块一个 slice，5–8 个 commit。
- **Requirements closed:** REQ-001（写入面）、REQ-002（单价面）、REQ-003、REQ-004（导入面）
- **Tests:** TEST-002, TEST-003
- **Validation:** 模块单测 + `yarn typecheck`
- **Exit gate:** `grep` 证明金额路径无 `toFixed/Number(`（展示除外且有注释）；对账用例通过。

### Phase 3 — 展示 / API / 票面

- **Depends on:** Phase 2
- **Outcome:** 金额处处 2 位、单价 4 位（含 JPY）；票面可验算。
- **Deliverables:** `MoneyAmount` 固定 2 位；finance/export_finance 展示；模板（XLSX/CSV）；API OpenAPI 描述与示例。
- **Independent slices / estimated commits:** 展示组件、模板、API 文档 3 个 slice。
- **Requirements closed:** REQ-005
- **Tests:** TEST-005
- **Validation:** 页面/模板抽查 + 单测
- **Exit gate:** 合同样本 9 行在系统内复算一致；列表/详情/导出金额全部 2 位。

### Phase 4 — 内置模块边界与外部接口

- **Depends on:** Phase 3
- **Outcome:** internal_sales 入口只发 2 位金额/4 位单价；核心例外被文档化；ru-petkit 契约同步。
- **Deliverables:** internal_sales 表单校验与提示；`docs/dev/*` 例外清单；`docs/ru-petkit/*` 更新。
- **Requirements closed:** REQ-006
- **Tests:** 入口校验单测
- **Validation:** `yarn typecheck` + 文档 review
- **Exit gate:** sales 入口无法写入 >2 位金额；文档明确核心列 18,4 为细节。

### Phase 5 — 全量验证与迁移应用

- **Depends on:** Phase 4
- **Outcome:** 全量门禁通过；迁移经业主批准应用；规格/计划/README 状态同步。
- **Deliverables:** `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build` 结果；`yarn test:integration:ephemeral`；迁移 apply（批准后）；specs/plan/docs/README 更新。
- **Requirements closed:** REQ-007（应用面）、REQ-008
- **Tests:** TEST-001…006 全量
- **Validation:** 上述命令
- **Exit gate:** 门禁全绿；迁移已应用且抽样对账通过；状态板更新。

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001/J-002/J-003 | 金额列 18,2；`money.ts` | 1–2 | TEST-001/002 | AC-001 |
| REQ-002 | J-002；表单/模板 | 单价列 18,4 | 1–3 | TEST-002/005 | AC-002 |
| REQ-003 | J-003 | 引擎 API；platform_ops 对账 | 2 | TEST-003 | AC-003 |
| REQ-004 | 表单/API | validator 契约 | 1–2 | TEST-004 | AC-004 |
| REQ-005 | API/导出/票面 | OpenAPI/模板 | 3 | TEST-005 | AC-005 |
| REQ-006 | internal_sales 入口 | 边界校验 | 4 | 入口校验单测 | AC-006 |
| REQ-007 | 迁移 | migrations | 1/5 | TEST-006 | AC-007 |
| REQ-008 | 文档/规格 | docs/specs | 5 | review | AC-008 |

## Rollout, Migration, and Rollback

- 生成：Phase 1 `yarn db:generate`；逐条审阅；快照随迁移更新；**应用需业主批准**（`yarn db:migrate`）。
- 顺序：先应用迁移，再部署代码（或同批）；`using round(...)` 使旧值在新列合法。
- 回滚：代码回滚到上一版本可直接运行（读列宽自动截断到代码所需位数）；DB 回滚用反向迁移把列改回 18,4/18,6，**但已舍入的分位不可恢复**（需备份）。
- 对外公告：直连 API 方发送 >2 位金额将由"入库被 DB 舍入"变为 400；ru-petkit 接口契约同批更新。
- 观测：导入量化路径记 warning（模块 logger，含字段/原始值/量化值，不含敏感数据）。

### Migration & Backward Compatibility

- **受影响面**：app 自有模块（`src/modules/*`）的数据库列、validator 值域、API 值域；不含任何 `@open-mercato` 公共 schema（`node_modules` 只读且不引用这些表）。
- **DB narrowing（18,4→18,2、18,6→18,4）是有意决策**：依据 BACKWARD_COMPATIBILITY.md 第 8 节（禁止 narrowing 针对公共 schema 契约；本部署为单实例 app 自有表，无第三方模块消费），迁移 + 备份 + 业主批准执行。
- **API**：路由、方法、字段名全部不变；金额字段值域收窄（>2 位请求 400）、响应值改为 2 位。`trade_docs` 合同/单据响应中的"币种位提示"字段（`configured`/`fallback` 类）在 Phase 1 删除——仅本 app UI 消费，实施时以 grep 复核无其他消费方；如需保留字段名可改为常量 `2`（实现时择优，须在 PR 记录）。
- **validator narrowing**：`data/validators.ts` 金额/单价 schema 收紧（文档化决策，非意外）。
- **引擎导出**：`trade_docs/lib/money.ts` 是 app 内部模块（非发布包），常量改名/删除属 clean cutover，已迁移全部调用点；无 deprecated 桥。
- **对外集成方**：入站金额 >2 位由"入库被 DB 舍入"变为 400；以 `docs/ru-petkit/*` 契约文档先行公告（本仓无 `UPGRADE_NOTES.md`；若引入则同步登记）。

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 存量金额 0.001–0.005 被舍入、单价 5–6 位被收到 4 位 | 旧单据分位/价格变化 | 迁移前备份；抽样比对；变更公告 | 不可逆的历史分位丢失 |
| 外部直连方仍发 4 位金额 | 由静默入库变 400，集成中断 | ru-petkit 文档先行；错误消息明确 | 第三方改造滞后 |
| platform_ops 浮点路径删除后回归 | 对账回归 | TEST-003 + 集成对账用例 | 低 |
| 核心 sales 内核仍 18,4 | 核心页/报表可能显示 4 位值 | 展示统一 2 位 + 文档例外 | 依赖内核的行为无法根治 |
| `resolveCurrencyScale` 删除遗漏调用点 | 编译/运行错误 | typecheck + grep 全仓 | 低 |
| 迁移 DDL 锁表 | 大表锁 | 本部署数据量小；低峰执行 | 低 |

## Acceptance Criteria

- [x] **AC-001** — 任意模块写入金额后，DB 值与 API 响应均为 2 位 HALF_UP 值；合计 = Σ 行金额（分位精确）。证据：引擎与各模块命令测试（`money.test.ts`、`orderTotals.test.ts`、`fileRules`/`landedCost` 测试）。
- [x] **AC-002** — 合同样本 9 行在系统内复算：票面单价 4 位、金额 2 位、逐行相等。证据：`contractTemplate.test.ts`（单价 4 位/金额 2 位定长）、引擎边界用例（`290 × 1345.5907 → 390,221.30`）。
- [x] **AC-003** — platform_ops 对账能识别 0.01 级差异；相等值不误报；差异按 expected+actual 变化重新入队。证据：`platform_ops/lib/__tests__/money.test.ts`。
- [x] **AC-004** — 金额 3 位、单价 5 位的人工录入被 400 拒绝；导入/集成路径显式 HALF_UP 量化并记 warning。证据：各模块 validators 测试 + platform_ops/sourcing 量化的 warning 断言。
- [x] **AC-005** — 全部导出/票面金额 2 位、单价 4 位。证据：合同/单据模板测试；OpenAPI 由 zod 契约自动生成（描述文本未逐条人工校对，列为残余）。
- [x] **AC-006** — internal_sales 入口无法写入 >2 位金额/ >4 位单价。证据：`lineScaleViolation`（create/edit 两处提交校验）+ i18n 键 zh/en。
- [x] **AC-007** — 迁移列类型与附录 A 一致；抽样转换值符合 HALF_UP。证据：8 个模块标度迁移已应用到开发库（`purchasing/products/sourcing/cross_border/platform_ops/export_finance/finance/trade_docs`，2026-09-28 生效）；唯一未在首批内的 `purchasing_supplier_product_prices.unit_price` 已由 `Migration20260928082000_sourcing` 以事务方式应用并登记账本（该表当时 0 行）；全库 40 个金额/单价列核对 **0 处偏差**；应用前备份在 `/tmp/kc-money-backup/kc-money-20260928.sql`（21 张表）。遗留：并行会话自己的 `products/Migration20260928080916_products`（`source_product_id`，非金额）仍待其应用。
- [x] **AC-008** — 受影响 specs/docs/README 同步更新。已完成：11 份 spec + 9 份 docs（含 `docs/ru-petkit/*` 外部契约）+ 7 份模块 README + 状态板条目（DocsSlice 逐条按代码现状核对）。
- [x] 每个受影响面沿用既有 canonical 组件与状态；无新增页面/权限面。
- [x] 全量验证门禁（2026-09-28 终态）：`yarn generate` 通过；`yarn typecheck` 通过；`yarn lint` 0 error（8 个既有 warning）；`yarn test` **54 suites / 439 tests 全绿**；`yarn ds:check` 891 文件通过；ephemeral 集成（空库迁移 + 生产构建 + Playwright）**76 passed**，其中**全部金额相关用例通过**：trade_docs（commercial-invoices / crud-cache-freshness / document-copy-flow / pi-documents / tax-invoice-ledger）、purchasing（supplier-products 等 4 套）、sourcing（quote-changes）、products（distribution / sku-grandfathering）；旧 4 位期望已按新口径更新（trade_docs 5 处、finance-flow 金额 7 处）。剩余两类失败与本变更无关：① `finance/__integration__/finance-flow.spec.ts` 403（缺 `purchasing.suppliers.manage`，并行会话在写的新规格自身角色 ACL 接线；同套 fixture 在 purchasing 规格通过）；② `storage_ops` ×4 因本机未配置 `STORAGE_OPS_TEST_S3_CONFIG` 而按门控抛错。

交付说明（2026-09-28）：Phase 1–5 已落地。迁移：8 个模块标度迁移 + `Migration20260928082000_sourcing` 均已应用到开发库（应用前已经 `pg_dump` 备份 21 张表到 `/tmp/kc-money-backup/kc-money-20260928.sql`；应用后全库列标度核对 0 偏差）。实现期发现的连带修正已并入：`currencyScale.ts` 拆分（productSnapshots）、platform_ops 去重规则、export_finance 正数约束、finance 单位成本 4 位、trade_docs/ finance 集成规格的 2 位期望、`ru_sync` 草稿单金额与 `finance` 毛利率的残余浮点路径收口到引擎。

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | 本文件依 `om-spec-writing` + `spec-delivery` + `contracts` + `architecture` 编写 |
| Data models, APIs, events, UI, and tests are internally consistent | pass | 附录 A ↔ 迁移 ↔ validator ↔ 引擎一致 |
| Every workflow completes end to end without a catch-all integration phase | pass | Phase 1–5 均为垂直切片 |
| Platform-native reuse and extension points were chosen before custom code | pass | 复用既有引擎与组件，无新扩展面 |
| UI contracts identify references, canonical components, and theme/state coverage | pass | 仅格式变化，沿用 `MoneyAmount`/`DataTable`/`CrudForm` |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | 见 Phases |

Verdict: **Ready for implementation**

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | 单价 4 位 vs 保留 6 位 | 业主 | no（已按建议决策，可否决） | 2026-09-28：取 4 位，依据合同样本；若改 6 位仅需回退单价相关改动 |
| Q-002 | 外部入站超位：拒绝 or 量化 | 业主 | no | 2026-09-28：人工入口 400；导入/集成量化 + warning |
| Q-003 | 是否给核心 sales 加命令拦截器 | 业主 | no | 2026-09-28：本期不加以避免越权，边界+展示统一；旁路写入口出现时再评估 |

## Changelog

| Date | Change |
|---|---|
| 2026-09-28 | Initial draft |
| 2026-09-28 | 依业主合同样本判定：金额 2 位、单价 4 位；Status → Ready for implementation |
| 2026-09-28 | Phase 1–4 交付：引擎 2 位化（AMOUNT_SCALE/PRICE_SCALE、divideHalfUp/toScaledUnits 迁入、删币种位机制）、8 模块金额列 18,2/单价列 18,4 与迁移生成（未应用）、purchasing/platform_ops/cross_border/sourcing/products/currency_policy 写路径引擎化、展示统一（MoneyAmount 2 位、单价 4 位）、internal_sales 入口校验；验证：typecheck 通过、417 tests、lint 0 error、ds:check 通过 |

## 附录 A — 受影响字段清单（现状 → 目标）

### 金额列（→ numeric(18,2)）

| 模块 | 文件 | 字段（当前） |
|---|---|---|
| trade_docs | `data/entities.ts` | contracts.contract_total/finance_total/difference_total (18,4)；contract_lines.contract_amount/finance_amount (18,4)；invoices.subtotal/total/tax_total/gross_total (18,4)；invoice_lines.amount/tax_amount (18,4)；documents.subtotal/total (18,4)；document_lines.amount (18,4) |
| purchasing | `data/entities.ts` | orders.subtotal/tax_total/total/deposit_amount (18,4)；lines.net_total/tax_amount/line_total (18,4)；payments.amount (18,4) |
| platform_ops | `data/entities.ts` | orders.gross/fee/net_amount (18,4)；settlements.gross/fee/net (18,4)；settlement_lines.gross/fee/net (18,4)；reconciliation.expected/actual_amount (18,4) |
| export_finance | `data/entities.ts` | refunds.tax_refund_amount (18,4) |
| finance | `data/entities.ts` | shipment_costs.amount (18,4) |

### 单价列（→ numeric(18,4)）

| 模块 | 文件 | 字段（当前） |
|---|---|---|
| trade_docs | `data/entities.ts` | contract_lines.unit_price (18,6)；invoice_lines.unit_price (18,6)；document_lines.unit_price (18,6) |
| purchasing | `data/entities.ts` | supplier_products.unit_price (18,6)；订单行 unit_price 已是 18,4 |
| products | `data/entities.ts` | products_prices.unit_price (18,6) |
| sourcing | `data/entities.ts` | quote_lines.unit_cost/suggested_rsp (18,6) |
| cross_border | `data/entities.ts` | sales_allocations.unit_price (18,6) |

### Validator 标度（Phase 2，与写路径同批）

trade_docs（unitPrice 6→4；amount 4→2）｜purchasing（金额 4→2；供应商单价 6→4）｜products（价格 6→4）｜sourcing（6→4）｜cross_border（unitPrice 6→4）｜finance（amount 4→2）｜export_finance（已 ≤2，列改 2）｜platform_ops（Phase 2 改为显式字符串+量化）。

### 保持不变

数量、重量/体积、税率/比例、汇率（18,8）、`Currency.decimal_places`（仅元数据）、软删除/`updated_at`/作用域列。
