# Product Alias on Rename（改码时登记旧码别名）

**Date**: 2026-10-10
**Status**: Draft — 一个能力：**已有商品的 SKU 被改掉时，把旧码登记为别名**。唯一的闸门问题标 ⚠，
owner 点头后转 `Ready for implementation`；未点头前不写代码。

> **前提**：本规格在**单一存储改造合入之后**实施（[`.ai/specs/2026-10-10-catalog-single-store.md`](2026-10-10-catalog-single-store.md)，
> PR #171）。正文引用的路径与行号按改造后的树标注——在 `dev` 上 `product_codes/{commands,api}` 仍存在。
>
> **它是从哪来的**：最初与「商品编码建议器」（[`.ai/specs/2026-10-10-sku-issuance-redo.md`](2026-10-10-sku-issuance-redo.md)）
> 写在同一份 spec 里，scope-cohesion 评审（2026-10-10）判定两者**没有共享契约、可各自独立上线**，
> 因此拆成两份、两个 PR。建议器读别名表（序号跳过旧码），但那是**只读**依赖——别名表为空时建议器照常工作，
> 所以两者没有先后依赖。
>
> **它补的是什么**：`docs/dev/business-conventions.md` C-37 与 cutover spec 的 AC-006 都承诺「旧码可搜」，
> 但改造后 `product_codes_aliases` **只有读没有写**（`product_codes/README.md`：「手写维护，**不重发**」）——
> 当前树里没有任何代码路径能创建一行别名，所以改一次 SKU，旧码就再也搜不到。本规格把这条承诺补上。

## TLDR

`products.items.update` 成功改变一个商品的 SKU 时，把**旧码**经同伴命令写进 `product_codes_aliases`
（`target_kind='product'`、`target_id` = catalog 商品 id）。写入是 **best-effort**：失败只留日志与界面提示，
绝不回滚改名、也不改变接口状态码。不做历史回填、不做反向解析、不把别名当第二唯一键。

## Problem Statement

1. **承诺与实现不符**：搜索兜底早已存在（`products/lib/store.ts` 的 `sku ilike / title ilike / id in (aliasIds)` union、
   `product_codes/lib/aliasLookup.ts`），但**没有任何写方**——C-37 的「旧码只登记别名、永不重编」在改码路径上落空。
2. **改码是常规动作**：手输 SKU 后收到 409（`products.items.update` 的 `findStoreProductBySku` 冲突）、
   或按新命名习惯重排（`P4108-UVC` → `PK-CL010`）都会改码；旧码此时还印在纸面单据、快照与供应商往来里
   （`trade_docs/lib/productSnapshots.ts`、`purchasing/commands/orders.ts` 的 `sku`/`supplierSku` 快照）。
3. **别名表是唯一能承载它的地方**：SKU 列本身是唯一键（改掉即释放），单据快照冻结在历史行上不可检索；
   别名表 `(tenant_id, organization_id, alias_code, target_kind, target_id)` 的唯一键正好允许同一旧码指向不同商品
   （同一旧码被两行登记时是数据问题，不是约束冲突——见下文的冲突处理）。

## Overview and Success Measures

- **Primary outcome:** 改码后按旧码搜索仍能命中该商品，且新旧码都能查到；不再出现「改个码就查不到」的工单。
- **Leading indicators:** 别名表新增行数 vs 改码次数（应 1:1）；搜索用旧码命中的查询占比。
- **Baseline:** `unknown — measurement plan`：先量一个迭代内的改码次数；改造后别名写入应与之相等（±并发失败）。
- **Market reference:** Odoo 的 `product.supplierinfo`/`product.code` 迁移与 SAP 的旧物料号映射都把「旧号→现记录」
  存成检索用别名而非第二主键——本规格采纳该形态，**拒绝**反向解析（从码推规则）与占码（别名不参与唯一性）。

## Goals

- **REQ-001** — 新增命令 `product_codes.aliases.register`（宿主模块 `product_codes`）：入参
  `{ targetKind: 'product', targetId: uuid, aliasCode: string, note?: string }`；幂等（同 alias+target 已存在 → `skipped`），
  同一 alias 指向**不同** target 时**不抛错**、返回 `conflict: { existingTargetId }` 并写一条 warn 日志。
- **REQ-002** — `products.items.update` 在 **SKU 真正变化且写成功之后**，以 best-effort 方式调用该命令：
  失败（命令总线异常、作用域拒绝）只记日志 + 在响应里带一个 `aliasWarning` 字段，HTTP 状态仍是 200。
- **REQ-003** — 只在**改码**时写（`sku` 变化）；新建、分发副本、供应商建档（promote）不写（它们的码是首次占用，
  没有"旧码"可言）。
- **REQ-004** — 权限：写别名沿用 `products.items.manage`（发起方）；命令自身不新增 feature；作用域 = 当前组织，
  跨组织目标 404（与 `products.items.update` 的既有语义一致）。
- **REQ-005** — 可观测：写入与冲突都留日志（`product_codes` 的 logger：商品 id、旧码、现持有者 id），
  列表页搜索继续按既有 union 命中，不需要新界面。

## Non-goals

- 不做历史回填（旧码在改造前就丢了的情况，需人工登记）。
- 不做反向解析/规则校验：别名不校验字符集以外的形状（旧码可能是不合现行 `SKU_PATTERN` 的历史值）。
- 不把别名纳入唯一性：别名不占码、不阻塞任何商品使用同名 SKU。
- 不改搜索实现（既有 union 已就绪）；不新增列表/管理页（需要人工登记时用既有 `GET /api/products/items?search=` 验证）。
- 不新增表、不写迁移；不引入新依赖。

## Proposed Solution

1. **同伴命令**（`product_codes/commands/aliases.ts` + 注册）：一个 insert-or-skip 命令，幂等、append-only、
   返回 `{ status: 'created' | 'skipped', conflict?: { existingTargetId } }`。
2. **调用点**（`products/commands/items.ts` 的 update 命令）：`skuChanged` 已知（`items.ts:233-256` 已有该判定），
   在 `updateStoreProduct` 成功之后调用，`try/catch` 包裹；命令总线不可用等任何异常只降级为 `aliasWarning`。
   走**命令总线**而不是直接写表：别名的宿主是 `product_codes`，跨模块写表被仓库规则禁止，而 store 对 catalog
   已经是同一种做法（`runPeer`）。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected |
|---|---|---|---|
| 写入走**同伴命令**（命令总线） | 别名的宿主是 `product_codes`；跨模块只走命令/事件/快照；调用点手里已有 before/after SKU | 订阅 `catalog.product.updated` 事件 | 事件载荷是否携带 before/after SKU 未经验证；押在未验证的载荷上不值得（若日后证实事件足够，可换成订阅者而不改契约） |
| 直接写表（Kysely insert） | 少一层 | 在 `products` 里直接 insert 别名表 | 跨模块写别人的表：仓库硬性禁止 |
| best-effort、不回滚改名 | 别名是**检索辅助**，不是账务事实；因它失败而拒绝一次合法改名本末倒置 | 与改名同一事务，失败即 409/500 | 把一个辅助行为变成改名的前置条件 |
| 冲突（旧码已指向别人）不报错 | 同一旧码属于两个商品在现实里会发生（历史手工登记、分销改名）；报错只会逼操作员绕过系统 | 抛 409 让操作员处理 | 会阻塞一次合法改名，且不解决数据问题 |
| 只在 update 路径写 | 应用里改 SKU 的唯一入口就是它（`promote`/`distribute` 不写 sku 字段，`sync-fields` 的 `changedProductFields` 不含 sku） | 全局扫描式对账作业 | 为一个低频动作引入定时作业不划算 |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| 旧码 / 别名 | 一个商品曾经用过的编码；登记后仍可被列表搜索命中，**不占**当前唯一键 | `product_codes_aliases` | 冲突 → 不阻塞改名，日志 + `aliasWarning` |
| 改码 | `products.items.update` 收到与当前不同的 `sku` 并通过校验（字符集/唯一性） | `products/commands/items.ts` | 校验失败按既有 400/409 |
| 幂等键 | `(alias_code, target_kind, target_id)`（表上已有唯一键） | 迁移 `Migration20260924034626_product_codes.ts:11` | 重复登记 → `skipped` |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 商品维护者 | 改码（并因此触发别名登记） | 当前组织（fail closed） | `products.items.manage` |
| 只读角色 | 看不到别名写入的任何入口 | 当前组织 | — |

别名目标必须是**同组织**的商品（命令内校验，跨组织 → 404，与 `products.items.update` 一致）。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 别名的宿主与写入 | app-own（新增命令） | `product_codes` | `POST /api/product_codes/aliases`? **否** —— 只注册命令，不开新路由（无界面需求） | 别名的宿主是 `product_codes` |
| 触发点 | app-own（调用） | `products` | 同伴命令（命令总线） | 调用点已知 before/after SKU |
| 检索兜底 | reuse（已实现） | `products/lib/store.ts` + `product_codes/lib/aliasLookup.ts` | 既有读 | 不动 |
| 审计 | reuse | 命令总线的 action log | — | 不为别名做第二套审计 |

## Architecture and Data Flow

```text
操作员 --PUT /api/products/items--> products.items.update（既有）
                                      |-- 校验 + catalog.products.update（既有）
                                      '-- SKU 变化且写成功 → product_codes.aliases.register（同伴命令，best-effort）
                                                                '-- insert 一行 product_codes_aliases
                                                                    （冲突 → skipped + warn + aliasWarning）
读侧（既有，不改）：列表搜索 union alias_code → 命中商品
```

## User Journeys

### Journey J-001 — 改码后旧码仍可搜

1. 商品 `PK-CL004` 的编辑页把 SKU 改成 `PK-CL010` → 保存。
2. `products.items.update` 成功；随后登记别名 `PK-CL004 → 该商品`。
3. 任何人在商品列表搜索 `PK-CL004` → 命中该商品（显示当前 SKU `PK-CL010`）。
4. 失败：登记命令抛错 → 列表照常显示、改名照常生效，响应带 `aliasWarning`，日志留痕；重试路径 = 手工登记（下一迭代才做界面）。

### Journey J-002 — 旧码已被别人登记

1. `PK-CL004` 已指向商品 B（历史手工登记），现在商品 A 也被改成离开 `PK-CL004`。
2. 命令返回 `skipped` + `conflict: { existingTargetId: B }`，不写入、不报错。
3. 搜索 `PK-CL004` 命中 B（既有 union 的语义：别名指向谁就命中谁）；A 的改名不受影响。

## UI and Interaction Contracts

无新页面、无新控件。唯一可见反馈是保存响应里的 `aliasWarning`（表单沿用既有保存失败/警告通道；
若既有 `CrudForm` 无警告位，则这一轮只记日志并在 spec 的 Phase 1 验收里注明——**不给表单加新交互**）。

## Data Models

不新增表。复用 `product_codes_aliases`（`target_kind='product'`），其唯一键与 append-only 语义不变；
迁移无改动。

## API, Command, and Error Contracts

```text
command: product_codes.aliases.register        （无 HTTP 路由）
  input:  { targetKind: 'product', targetId: uuid, aliasCode: string, note?: string | null }
  result: { status: 'created' | 'skipped', conflict?: { existingTargetId: string } }
  校验：aliasCode 1..120 字符（历史码可能不合现行 SKU_PATTERN，故只做长度与非空）；
       目标商品必须在调用组织内（跨组织 → 404 语义的 CrudHttpError）

products.items.update（既有）响应增量：
  { … , aliasWarning?: string }   // 仅在别名写入失败时出现；HTTP 状态不变
```

## Events, Jobs, Notifications, and Cross-Module Flows

- 不新增事件（写入是同步命令调用）。
- 不新增作业；若日后需要「全量对账」，另开 spec。

## Security, Privacy, and Compliance

- 无 PII、无加密字段。作用域 fail closed（当前组织）。
- 日志只记 id 与码，不记自由文本。

## Integration Coverage

| 用例 | 类型 | 断言 |
|---|---|---|
| TEST-001 | unit | 命令幂等：同 alias+target 第二次 → `skipped`；不同 target → `skipped` + `conflict`；跨组织目标 → 404 语义 |
| TEST-002 | integration | 改码 → 别名表新增一行；`GET /api/products/items?search=<旧码>` 命中该商品且显示当前 SKU |
| TEST-003 | integration | 别名冲突：旧码已属另一商品时改名仍 200、无新行、搜索仍命中原持有者 |
| TEST-004 | unit | best-effort：命令总线抛错时 `products.items.update` 返回 200 + `aliasWarning`（不改状态码、不回滚） |

## Implementation Phases

### Phase 1 — 命令 + 调用点

- **Depends on:** 单一存储改造已合入
- **Outcome:** 改码后旧码可搜；冲突与失败都有明确、非阻塞的语义
- **Deliverables:** `product_codes/commands/aliases.ts`（+ 注册）、`products/commands/items.ts` 的 best-effort 调用、
  `product_codes/README.md` 一行（别名现在有写方），单测与两条集成用例
- **Requirements closed:** REQ-001…REQ-005（本规格全部）
- **Validation:** `yarn typecheck && yarn lint && yarn test src/modules/products src/modules/product_codes`（TEST-001/004）；
  TEST-002/003 走 `yarn test:integration:ephemeral`
- **Exit gate:** 上述四类用例绿；命令总线故障时改名仍 200（TEST-004）；README 的「手写维护」表述已更正

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001/J-002 | `product_codes.aliases.register` | 1 | TEST-001 | AC-001 |
| REQ-002 | J-001 | `products.items.update` 的 best-effort 调用 + `aliasWarning` | 1 | TEST-004 | AC-002 |
| REQ-003 | J-001 | 只有 update 路径写 | 1 | TEST-002（新建不写由 TEST-001 的调用点断言覆盖） | AC-003 |
| REQ-004 | 全局 | 作用域校验 | 1 | TEST-001 | AC-004 |
| REQ-005 | J-001 | 日志 + 既有搜索 union | 1 | TEST-002 | AC-005 |

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 别名表被当作"第二事实" | 有人以为旧码仍可下单 | 文档与文案写明它只用于**搜索兜底**；不参与任何 SELECT 的 join/校验 | 认知风险 |
| 冲突被静默吞掉 | 数据问题无人处理 | 命令返回 `conflict` + warn 日志（可配告警） | 需要人工看日志 |
| 依赖命令总线可用性 | 总线故障时别名不写 | best-effort + `aliasWarning`；改名不受影响 | 少量漏登记，可重试 |
| 历史码不合现行字符集 | 若校验字符集会拒绝 | 命令只校验长度（1..120），不校验 `SKU_PATTERN` | 宽松带来的脏别名 |

## Acceptance Criteria

- [ ] **AC-001** — 改码后 `product_codes_aliases` 多一行（alias = 旧码、target = 该商品），重放同一改码不再新增。
- [ ] **AC-002** — 别名写入失败（模拟命令总线异常）时改名仍 200 且响应带 `aliasWarning`。
- [ ] **AC-003** — 新建商品、分发副本、promote 建档都不写别名。
- [ ] **AC-004** — 跨组织目标 → 命令拒绝（404 语义）；未选组织 → 400 `organization_scope_required`。
- [ ] **AC-005** — `GET /api/products/items?search=<旧码>` 命中该商品；冲突场景命中原持有者。

## Resolved assumptions (autonomous defaults)

| # | Question | Chosen default | Rationale | Marker |
|---|---|---|---|---|
| 1 | 要不要这条能力 | **要**——它是 C-37/AC-006 的既有承诺，当前无实现 | 承诺已在文档与验收里，补实现比重写承诺便宜 | ⚠ NEEDS HUMAN CONFIRMATION |
| 2 | 冲突怎么处理 | `skipped` + warn，不报错 | 不阻塞合法改名；数据问题留痕 | — |
| 3 | 写入失败怎么表现 | 200 + `aliasWarning`（best-effort） | 辅助行为不应成为改名前置条件 | — |
| 4 | 是否开 HTTP 路由/界面 | 不开（无界面需求） | 最小面；需要人工登记时先手工 SQL/后续 spec | — |

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q1 | 是否要这条能力（默认：要） | owner | **yes** | 待答（⚠ 默认见上表） |
| Q2 | 冲突时是否需要界面提示（默认：只记日志，本轮不加控件） | owner | no | 待答 |
| Q3 | 历史别名是否需要一次性登记入口（默认：不做，另开 spec） | owner | no | 待答 |

## Changelog

| Date | Change |
|---|---|
| 2026-10-10 | Initial spec — 从「商品编码建议器」拆出（scope-cohesion 评审 2026-10-10 判 `split needed`）；状态 Draft 等 owner 回答 Q1 |
