# 单据状态（status）在各业务板块的补齐与赋能（document status lifecycle）

**Date**: 2026-09-30
**Status**: Phase 1 Implemented（`feat/sales-status-lifecycle`）；Phase 2·A Implemented（`feat/shipment-close-lifecycle`）；Phase 2·C 实现中（`feat/export-finance-status-coherence`）；Phase 2·B 与 Phase 3–4 为草案
**Scope route**: `spec-pr`（本文件）；Phase 1 实现单元 `feat/sales-status-lifecycle`（`module-data` + `backend-ui`，含 `cross_border` 一处门禁）

## TLDR

给平台已有「状态」字段但目前**从不写入**、或**完全没有状态**的业务板块，按真实业务流程补一套可用状态：
每个状态值必须绑定**谁在哪个动作里写它**、**它能挡住什么动作**、**怎么作废/回退**、**跳变时发什么事件**。
**Phase 1（本文件详述）**只做销售链：对内/对外**报价** `draft → sent → confirmed → canceled`、
**销售订单** `draft → confirmed → canceled`，外加两条门禁（未确认报价不得下单、未确认订单不得进发运分摊）、
列表徽章/有效期/超期高亮，以及发出报价走平台现成的 `quotes/send`（有效期 + 接受链接 + 邮件）。

## Problem Statement

1. **销售单据状态全空**：`sales_quotes.status` / `sales_orders.status` 在本部署里从不被写入——dev 库实测 8 张单据
   （6 订单 + 2 报价）`status` 全部为 NULL，列表「状态」列每行都渲染「—」。而平台已经把这条链路做齐：
   - `POST /api/sales/quotes/send`（`{quoteId, validForDays}`）：置 `status='sent'`、写 `validUntil` / `sentAt`、
     生成接受令牌、发邮件；已 `canceled` 的报价拒绝发出；**买方邮箱缺失直接 400**。
   - `POST /api/sales/quotes/accept`（令牌公开接口）：过期拒绝、非 `sent` 拒绝，置 `confirmed` 后**就地转订单**并通知管理员。
   - `PUT /api/sales/{quotes,orders}` 带 `statusEntryId`（字典条目 id）即可写状态，引擎解析出值、写 `status_entry_id`、
     写变更留痕，并在订单状态跳变到 `confirmed`/`cancelled` 时发 `sales.order.confirmed` / `sales.order.cancelled`。
   - **报价一旦被编辑：平台自动把 `sent` 打回 `draft` 并作废接受令牌**（`commands/documents.js:3705-3730`）。
2. **没有状态就没有门禁**：报价是谈判文档，却**任何状态都能被拿去下单**（「转为订单」/「按此报价新建订单」都不看状态）；
   发运单的销售分摊选择器**不校验订单状态**（`cross_border` 只查存在/重复/目录桥接），任何订单都能被分摊进柜。
3. **看不出发出与时效**：列表只有创建时间，没有「有效至」，无法判断一张报价是否已发出、是否过期、是否被接受。

## Goals

- 销售单据的每次状态变化都由**动作**驱动，值为租户字典 `sales.order_status` 的条目（写 `statusEntryId`，不写裸字符串）。
- 两条门禁落地：**未 `sent|confirmed` 的报价不得下单**；**非 `confirmed` 的订单不得进发运分摊**（历史 NULL 放行并提示）。
- 列表可见：状态徽章（字典标签+颜色）、报价「有效至」列、超期高亮；历史未标记单据显示「—」。
- 发出报价走平台链路：有效期天数可填（默认 14 天，平台上限 365），成功后状态为 `sent`、出现「有效至」。

## Non-goals

- 不做审批流引擎（审批用 `workflows`；状态只是结果标签）。
- 不 eject / 不改 installed `sales` 的引擎与契约；不新建状态存储。
- Phase 1 不写 `in_fulfillment` / `fulfilled`（由 Phase 2 的发运/收货联动回写），不做逾期提醒与报表（Phase 4）。
- 不回填历史单据（Q-005：留空 = 启用前）。

## Resolved assumptions（owner 2026-09-30 指示「按照这个流程先实作」，按推荐默认执行）

| ID | 问题 | 采用 |
|---|---|---|
| Q-001 | 范围与顺序 | **只做 Phase 1**，验收后再开 Phase 2 |
| Q-002 | 状态值来源 | **租户字典**（`sales.order_status`，平台已播种 10 值）；代码只认 value，写入用条目 id |
| Q-003 | 中文标签 | 字典标签当前为英文（Draft/Sent/Confirmed/Canceled…）：**本 Phase 不改租户数据**；README 给出中文词表 + 字典维护页改法，改动可另行执行 |
| Q-004 | 门禁清单 | Phase 1 只挡两条（未确认报价不得下单、未确认订单不得进发运分摊）+ `canceled` 即锁（不可再发出/不可下单/不可分摊） |
| Q-005 | 历史单据 | **留空**（列表显示「—」），新单从 `draft` 起；历史 NULL 在门禁处**放行**并给提示 |
| Q-006 | 报价发出 | 启用平台 `quotes/send`；买方邮箱从报价的 `customerSnapshot.contact.email` 读（对外可选从 `parties.email` 预填）；无邮箱时前端先拦 + 平台兜底 400 |
| Q-007 | 订单 `fulfilled` | Phase 2 由发运/收货自动回写；Phase 1 不写该值 |

## Overview and Success Measures

| 指标 | 现状 | Phase 1 目标（可验证） |
|---|---|---|
| 新建单据带状态的比例 | 0%（8/8 NULL） | 100%（新建即 `draft`） |
| 未确认报价可下单 | 是（无门禁） | 否（`draft`/`canceled` 被挡，返回可执行文案） |
| 未确认订单可进发运分摊 | 是（无门禁） | 否（`draft`/`canceled` 不出现在选择器） |
| 报价时效可见 | 无 | 「有效至」列 + 过期高亮 |

## Design Decisions and Alternatives

| 决策 | 选择 | 理由 | 否决项 |
|---|---|---|---|
| 状态写入方式 | 引擎 `PUT /api/sales/{quotes,orders}` + `statusEntryId` | 复用引擎的字典解析、留痕与订单生命周期事件；不碰 installed 代码 | 自建状态路由/直接改表（重复实现 + 丢审计与事件） |
| 报价「发出」 | 平台 `POST /api/sales/quotes/send` | 有效期、令牌、邮件、状态一次到位 | 自己发邮件/造令牌（协议重复，令牌哈希口径会漂） |
| 买方邮箱载体 | 报价快照 `customerSnapshot.contact.email`（引擎 `resolveQuoteEmail` 的第一顺位） | 快照本来每次保存都整体重写，无合并风险 | `metadata.customerEmail`（更新路径需合并 metadata，易覆盖 `internalSales.sourceQuote`） |
| 状态值 | 字典 value 常量 + 条目 id 写入 | 租户可改标签/颜色/停用；代码只认 value | 代码内枚举裸字符串（与字典漂移） |
| 历史 NULL | 放行 + 提示 | 避免启用当天把存量单据锁死 | 一律要求 `confirmed`（存量订单立刻无法分摊） |
| 冻结语义 | `canceled` 为终态 | 与平台一致（`send` 拒绝 canceled；引擎按 canceled/cancelled 判定） | 允许回退（状态失去意义） |

## Domain Vocabulary and Business Rules

**字典**：`sales.order_status`（平台播种 10 值：`draft` `pending_approval` `approved` `rejected` `sent` `confirmed` `in_fulfillment` `fulfilled` `on_hold` `canceled`，每组织一份，带 label/color/icon）。

**报价（sales_quotes）**
- `draft` 草稿：新建即此值。可编辑、可发出、可作废、**不可下单**。
- `sent` 已发出：只能由 `POST /api/sales/quotes/send` 产生（写 `validUntil`/`sentAt`/令牌 + 邮件）。可下单、可作废，编辑页有「保存即退回草稿」横幅。
  **任何更新都会被打回 `draft` 并作废令牌**（平台行为，且发生在载荷应用之后）——所以「作废一张 sent 报价」实现为两次写入：先无字段更新触发引擎撤回，再把状态置 `canceled`；每次写入后回读核对落库值才报成功。
- `confirmed` 对方已接受（平台 `accept` 路径：接受即就地转订单）；列表按「已接受」展示。
- `canceled` 作废：终态。不可再发出（平台 400）、不可下单、不可编辑（本模块不给编辑入口）。
- 未标记（NULL，历史）：显示「—」，**下单放行**（不追溯）。

**销售订单（sales_orders）**
- `draft` 草稿：新建即此值。可确认、可作废、**不可进发运分摊**。
- `confirmed` 已确认：可进发运分摊。
- `canceled` 作废：终态，不可分摊。
- 未标记（NULL，历史）：显示「—」，分摊放行并在选择器行内标注「未标记状态」。

**通用**
- R-1 状态只能由动作写入；界面不提供自由改状态的下拉。
- R-2 写入一律用字典条目 id；条目缺失 → 明确报错，不静默。
- R-3 状态跳变沿用引擎留痕与事件（订单 `confirmed`/`cancelled` → `sales.order.confirmed`/`sales.order.cancelled`）。
- R-4 终态不可回退（`canceled` 之后要重开就新建单据）。

## Users, Permissions, and Scope

| 角色 | 能做什么 | 门禁 |
|---|---|---|
| 总部业务员 | 新建/编辑对内报价与订单；发出报价；作废 | 现有 `sales.quotes.manage` / `sales.orders.manage`（动作按钮按 `grantedFeatures` 显示） |
| 分公司业务员 | 对外报价/订单同上；接受链接由对方点击（公开令牌接口） | 同上 + 组织可见性 fail-closed（不变） |
| 发运岗 | 只能把 `confirmed` 的订单分摊进柜 | `cross_border` 现有权限位不变 |

## Reuse and Ownership Map

| 复用 | 位置 | 说明 |
|---|---|---|
| 状态字典解析（value → label/color/id） | 本模块 `lib/salesStatus.ts` + `loadDictionaryEntriesByKey`（已有） | 新增 `value → entryId` 映射纯函数 |
| 状态写入 | installed `PUT /api/sales/{quotes,orders}`（`statusEntryId`） | 不新增引擎能力 |
| 报价发出 | installed `POST /api/sales/quotes/send` | 有效期/令牌/邮件由平台负责 |
| 报价→订单 | installed `POST /api/sales/quotes/convert`（就地）与本模块引用加载（`?fromQuote=`） | Phase 1 只加状态门禁 |
| 发运分摊来源 | `cross_border/lib/shipmentSalesReads.ts` | 加状态过滤 + 未标记提示 |
| 事件 | installed `sales.order.confirmed/cancelled` | Phase 1 只依赖，不新增订阅者 |

## Architecture and Data Flow

```text
新建报价/订单 → POST /api/sales/{quotes,orders}（statusEntryId=draft）→ 引擎落 status + status_entry_id
报价「发出」  → POST /api/sales/quotes/send {quoteId, validForDays} → status=sent（+validUntil/sentAt/token/邮件）
报价「作废」  → PUT /api/sales/quotes {id, statusEntryId=canceled}
订单「确认」  → PUT /api/sales/orders  {id, statusEntryId=confirmed} → 引擎发 sales.order.confirmed
订单「作废」  → PUT /api/sales/orders  {id, statusEntryId=canceled}  → 引擎发 sales.order.cancelled
下单门禁      → InternalSalesTable 行操作仅对 sent|confirmed 报价显示「转为订单 / 按此报价新建订单」
分摊门禁      → shipmentSalesReads 只取 status=confirmed（NULL 放行 + 提示）
```

## User Journeys

### Journey J-001 — 对外报价发出到被接受

1. 分公司业务员在 `/backend/external-sales/quotes/create` 填买方（外部客户，邮箱自动带出 `parties.email`）与行，保存 → 报价为 `draft`。
2. 列表行操作「发出报价」→ 输入有效期（默认 14 天）→ 平台置 `sent` 并发邮件（含接受链接）。
3. 客户点链接接受 → 平台置 `confirmed` 并**就地转订单**、通知管理员；报价列表不再出现该单（已转订单）。

### Journey J-002 — 对内报价发出（组织买方无邮箱）

1. 总部业务员建对内报价（买方=关联组织，组织没有邮箱）→ 保存为 `draft`。
2. 点「发出报价」→ 前端先拦：「请先填写买方邮箱」；填好后发出 → `sent`，列表出现「有效至」。
3. 修改行/价格 → 平台把状态打回 `draft` 并作废接受链接，页面提示需重新发出。

### Journey J-003 — 未确认报价被挡在下单之外

1. 业务员对一张 `draft` 报价点行操作 → 「转为订单」/「按此报价新建订单」不可用，提示「报价尚未发出/确认，不能下单」。
2. 发出并被接受（`sent`/`confirmed`）后两个动作恢复可用。

### Journey J-004 — 未确认订单被挡在发运分摊之外

1. 发运岗在发运单编辑页打开销售分摊选择器。
2. 只列出 `confirmed` 的销售订单；`draft`/`canceled` 不出现，历史未标记订单出现并标注「未标记状态」。

## UI and Interaction Contracts

参照页面：本模块自己的 `InternalSalesTable` / `InternalSalesForm`（`DataTable` / `CrudForm`）；对话框沿用平台 `Dialog` + `useConfirmDialog`。

| Surface / route | 变更 | 组件 | 状态覆盖 |
|---|---|---|---|
| `/backend/{internal,external}-sales/quotes` | 列表：状态徽章（已有）+「有效至」列 + 过期高亮；行操作「发出报价」「作废」；下单动作按状态禁用 | `DataTable` + `RowActions` + 发出对话框（有效期数字输入，默认 14，1–365） | loading/empty/error/权限/409/键盘（Cmd/Ctrl+Enter 提交、Esc 取消）/窄屏/深色 |
| `/backend/{internal,external}-sales/orders` | 列表：状态徽章；行操作「确认订单」「作废」 | 同上 | 同上 |
| `/backend/{internal,external}-sales/{quotes,orders}/create|edit` | 表单新增「买方邮箱」（写入快照 `contact.email`）；编辑已发出报价后提示需重新发出 | `CrudForm` | 校验错误保留输入、服务端错误展示 |
| `/backend/cross_border/shipments/{create,edit}` | 销售分摊选择器只列 `confirmed`（NULL 放行 + 标注） | 既有表单/选择器 | 空态/提示 |

## Data Models

**无新表、无新列、无迁移。**
- 读：`sales_quotes.status/status_entry_id/valid_until/sent_at`、`sales_orders.status/status_entry_id`（列表投影已含 `status`、`statusEntryId`、`validUntil`）。
- 写：`statusEntryId`（字典条目 id，经 `PUT`/`POST /api/sales/{quotes,orders}`）；报价快照新增可选 `contact.email`（`customerSnapshot` 为 passthrough，兼容旧快照）。
- 字典：沿用 `sales.order_status`（不新增字典键）。

## API, Command, and Error Contracts

| 调用 | 载荷 | 失败行为 |
|---|---|---|
| `POST /api/sales/{quotes,orders}` | 既有抬头 + 行 + `statusEntryId: <draft 条目 id>` | 条目缺失 → 400「Selected status could not be found.」（本模块改为先查字典，缺失即拦） |
| `PUT /api/sales/{quotes,orders}` | `{ id, statusEntryId, updatedAt }`（带乐观锁头） | 409 版本冲突 → 复用 `surfaceRecordConflict`；`canceled` 报价再发出 → 平台 400 |
| `POST /api/sales/quotes/send` | `{ quoteId, validForDays }` | 无买方邮箱 400；本机未配置发信 transport 时**状态已写、邮件失败**（见 Risks） |

错误文案（本模块新增 i18n）：未发出/已作废不得下单；已作废不得再发出；请先填写买方邮箱；状态动作失败。

## Events, Jobs, Notifications, and Cross-Module Flows

- 沿用引擎：订单 `confirmed`/`canceled` 跳变 → `sales.order.confirmed` / `sales.order.cancelled`；状态变更写单据留痕。
- Phase 1 不新增订阅者、不新增定时作业（提醒与报表见 Phase 4）。
- 邮件：报价发出邮件由平台 `QuoteSentEmail` 负责；本地开发用 `OM_DISABLE_EMAIL_DELIVERY=true` 关闭外发（见 Risks/文档）。

## Security, Privacy, and Compliance

- 买方邮箱属于 PII：只写进单据快照（引擎既有加密列 `customer_snapshot`），不在列表 API 里回显；不写日志。
- 动作沿用既有功能位（`sales.quotes.manage` / `sales.orders.manage`），服务端由 installed 路由门禁；前端隐藏≠授权。
- 组织作用域不变（fail-closed）；接受链接为平台令牌接口（自带限流 `sales_quotes_accept`）。

## Integration Coverage

| Test ID | Level | 场景 | 断言 |
|---|---|---|---|
| TEST-001 | unit | 状态动作策略（`lib/salesStatus.ts`） | `draft/sent/confirmed/canceled/NULL` 各自允许的动作矩阵；过期判定 |
| TEST-002 | unit | 快照邮箱编解码（`lib/buyer.ts`） | 邮箱进 `contact.email`、旧快照（无 contact）读回为 null、清除后不残留 |
| TEST-003 | integration (API) | 新建报价/订单 → 查列表 | `status='draft'`、`statusEntryId` 非空 |
| TEST-004 | integration (API) | 发出报价（有邮箱）→ 查详情 | `status='sent'`、`validUntil` 已写；无邮箱 → 400 且状态不变 |
| TEST-005 | integration (API) | 订单 `draft` → `confirmed` | 状态写入成功；发运分摊来源只含该单（`draft` 单被排除） |
| TEST-006 | 浏览器 | 报价列表动作与列、下单门禁、订单确认、分摊选择器 | 见 Acceptance AC-004…AC-007 |

## Implementation Phases

### Phase 1 — 销售链状态闭环（本文件详述，可独立交付）

- **Deliverables**：状态常量与条目映射（`lib/salesStatus.ts` + 单测）；新建写 `draft`；报价发出/作废动作与对话框；订单确认/作废动作；报价「有效至」列与过期高亮；下单门禁；发运分摊门禁；买方邮箱字段与快照承载；i18n zh/en；README 与中文词表说明。
- **Requirements closed**：REQ-001…REQ-008。
- **Tests**：TEST-001…TEST-006。
- **Exit gate**：新建单据 100% 带 `draft`；未确认报价无法下单（UI 禁用 + API 侧无写请求）；未确认订单不出现在分摊选择器；报价发出后 `sent` + 「有效至」；浏览器实测（zh/en、窄屏、深色）。

### Phase 2 — 履约与资金

**Phase 2 拆成三个切片，逐个交付。**

#### Phase 2·A — 发运单归档 `closed`（已实现，`feat/shipment-close-lifecycle`）

- **目标**：柜的生命周期有终点。现在 `received` 之后单据停在原地，柜档案/结算没有「收口」状态；归档后不允许再改、再取消。
- **状态机**（唯一权威：`lib/shipmentStatus.ts` 的 `SHIPMENT_TRANSITIONS`）：`draft → in_transit → received → closed`，旁路 `draft|in_transit → cancelled`；`closed` 与 `cancelled` 为终态。
- **Requirements**
  - REQ-201 发运单新增 `closed`（归档）状态，只能由 `received` 迁入（命令 `cross_border.shipments.close`）；其他状态一律 422 并给出当前状态。
  - REQ-202 归档是终态：`closed` 之后不可编辑、不可取消、不可记录里程碑（现有守卫按状态白名单天然拒绝，测试固定）。
  - REQ-203 归档发放域事件 `cross_border.shipment.closed`（`id/number/tenantId/organizationId`），供订阅者做结算/通知。
  - REQ-204 列表与详情显示 `closed` 徽章与标签（zh「已归档」/en“Closed”），列表筛选包含该状态。
- **Tests**：TEST-201 单元（`SHIPMENT_TRANSITIONS` 矩阵：只允许 `received → closed`、终态无出边、筛选顺序与 API 枚举一致）；TEST-202 集成（`__integration__/shipment-close.spec.ts`，自建临时库：`received → close` 2xx 且列表回读 `closed`；`draft` 与 `in_transit` 直接 close 均 422 且状态不变）；TEST-203 集成续（`closed` 后再 cancel → 422、状态仍 `closed`）。
- **验收（已达成）**
  - **AC-201** ✅ 一张 `received` 发运单执行 close → 2xx，`GET /api/cross_border/shipments?id=` 回读 `closed`（集成 TEST-201）。
  - **AC-202** ✅ `draft`/`in_transit` 调 close 均 422 且状态不变（集成 TEST-202）；UI 侧：详情页动作矩阵只在 `received` 给「归档」（`closed`/`cancelled` 无动作）。
  - **AC-203** ✅ 列表状态筛选与徽章含「已归档」（枚举 + `StatusMap` 穷尽类型；`export_finance` 的柜档案/柜列表/标签表由类型检查强制补齐）。
- **证据**：`JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral shipment-close` → 本 spec 3/3 通过（同轮全套 103 passed / 4 failed（均为 `storage_ops` 的 `STORAGE_OPS_TEST_S3_CONFIG` 环境门）/ 5 skipped）；单元 `lib/__tests__/shipmentStatus.test.ts`；`yarn typecheck`/`yarn lint`/`yarn test` 全绿。
- **不做**：`closedAt` 时间戳列（需要 DDL；状态变更审计已记录时间与操作者，等 Phase 3 的迁移一起加）；柜档案/结算页的「已归档」聚合（Phase 4 报表）。

#### Phase 2·B — 发运单证区状态（草案，需要迁移）

`cross_border_export_documents` 增 `status`（`draft/issued/void`，对齐 `trade_docs` 的 PI/CI 词表）+ 签发/作废动作 + 门禁（未签发 PI 不能作为收款依据）。**需要一张加列的迁移**，落地前单独批准。

#### Phase 2·C — 收款 / 退税状态：一致性门禁 + 逾期标记（本文件定稿，实现中）

- **目标**：这两张表的**状态与事实**必须自洽（否则台账只能猜哪一半可信），并且「钱还没到」的单据能一眼筛出来。
- **现状**：`export_finance_collections`（每个采购单一行的 `collection_status` + `amount` + `received_at`）与 `export_finance_refunds`（每个柜一行的 `tax_refund_status` + `tax_refund_amount`）**都能写**，但没有任何规则把状态和金额/日期绑起来——可以出现「已收款但没金额没日期」「未收款却有收款日期」；两个档案页已支持按 `collectionStatus` / `taxRefundStatus` 过滤，但没有「逾期」概念。
- **Requirements**
  - REQ-210 收款记录的状态与事实必须一致（写入时校验，422 并逐条列出问题）：`received` ⇒ 必须给出 `collectedAmount` 与 `collectedAt`；`not_received` ⇒ 不得带金额或收款日期；`unknown` ⇒ 两者都不带（「未知」是没答案）。
  - REQ-211 退税记录同理：`completed` ⇒ 必须给出 `taxRefundAmount`；`not_started` / `unknown` ⇒ 不得带金额；`applied` 允许带（已申报但未到账时常已知金额）。
  - REQ-212 逾期标记（派生，不加列）：柜已 `received`/`closed` 且 `receivedAt` 超过阈值天数（默认 45，常量可调）而退税仍未 `completed` ⇒ 柜档案行标「退税逾期」；订单已 `received`/`closed` 且 `receivedAt` 超过阈值而收款仍非 `received` ⇒ 订单档案行标「收款逾期」。缺失/无法解析的日期一律**不标**（宁可漏报不误报）。
  - REQ-213 两个标记进列表列与 CSV 导出（同一份派生逻辑，不在两处各写一遍）。
- **Tests**：TEST-210 单元（`lib/__tests__/statusCoherence.test.ts`：收款 3 状态 × 金额/日期组合、退税 4 状态 × 金额组合）；TEST-211 单元（`lib/__tests__/fileRules.test.ts`：逾期矩阵 + 边界日 + 缺失日期）；TEST-212 集成/冒烟（API：不合法组合 422、合法组合 200；档案页列出现「逾期」且 CSV 含该列）。
- **验收**
  - **AC-210** 提交「已收款但无金额/无日期」「未收款但带收款日期」「未知但带金额」→ 422，文案逐条说明缺什么/多什么；补齐后 200 且回读一致。
  - **AC-211** 退税同理（`completed` 无金额 → 422；`applied` 无金额 → 200）。
  - **AC-212** 一张「已收货 45 天以上且未完成退税」的柜在柜档案页出现「逾期」徽章、CSV 该列为真；未到阈值或已完成的行不出现。
  - **AC-213** 现有行不迁移、不校验（列本身可空，「没答案」是合法状态）——只在写入路径生效。
- **不做**：`appliedAt`/`completedAt` 时间戳与「已申报/已到账」日期列（需要 DDL，随 2·B 的迁移一起）；把「登记收款要求柜已收货」做成硬门禁（收款按采购单记，一张单可跨多柜，「全部到货才可收款」需要业务口径确认，先记为开放问题而非发明规则）。

### Phase 3 — 采购与平台运营（草案）

采购单状态 × 收货/应付门禁与事件；供应商产品库 `archived`；平台镜像/结算单状态收口；费用 `pending/paid`。

### Phase 4 — 报表与提醒（草案）

报价→订单转化率、状态停留时长、逾期清单、通知订阅（`scheduler` + `notifications`）。

## Requirement Traceability

| REQ | Journey | 实现 | Phase | Test | AC |
|---|---|---|---|---|---|
| REQ-001 新建报价/订单即 `draft`（字典条目 id） | J-001/J-002 | form 载荷 + 条目映射 | 1 | TEST-003 | AC-001 |
| REQ-002 报价发出走平台 `send`（有效期 + 令牌 + 邮件） | J-001/J-002 | 列表行操作 + 对话框 | 1 | TEST-004 | AC-002 |
| REQ-003 报价作废（终态，不可再发出/下单） | J-003 | 行操作 + 平台校验 | 1 | TEST-004 | AC-003 |
| REQ-004 未确认报价不得下单 | J-003 | 列表动作门禁 | 1 | TEST-001/006 | AC-004 |
| REQ-005 订单确认/作废 | J-004 | 列表行操作 | 1 | TEST-005 | AC-005 |
| REQ-006 未确认订单不得进发运分摊（NULL 放行 + 提示） | J-004 | `shipmentSalesReads` | 1 | TEST-005 | AC-006 |
| REQ-007 状态可见：徽章 + 有效至 + 过期高亮 + 「—」历史 | J-002 | `InternalSalesTable` 列 | 1 | TEST-006 | AC-007 |
| REQ-008 买方邮箱承载（快照 `contact.email`，对外预填 `parties.email`） | J-001/J-002 | 表单字段 + 快照 | 1 | TEST-002 | AC-008 |

## Rollout, Migration, and Rollback

- **部署**：无 DDL、无迁移；`yarn generate` 后即可用。本地开发需 `OM_DISABLE_EMAIL_DELIVERY=true`（否则本机无发信 transport，报价发出会「状态已写、邮件报错」，见 Risks）。
- **回滚**：revert 本 Phase 的 squash 提交；已写入的 status/validUntil 无副作用（读路径按值降级显示「—」或英文标签）。
- **不动的**：installed `sales` 契约、路由 URL、权限位、组织作用域、既有通道标记。

## Risks and Tradeoffs

| 风险 | 影响 | 缓解 | 残余 |
|---|---|---|---|
| 本机无发信 transport | `send` 事务已提交但邮件报错 → 界面看到失败而状态已变 | 本地 `OM_DISABLE_EMAIL_DELIVERY=true`；失败时前端**重读单据**并如实提示「已标记已发出，邮件未发出」 | 生产需真实 provider（既有运维事项） |
| 历史 NULL 放行分摊 | 未标记订单仍可进柜 | 选择器行内标注「未标记状态」+ Phase 2 回填/提醒 | 过渡期语义 |
| 字典标签为英文 | 中文界面显示 Draft/Sent/… | README 给中文词表与字典维护改法；本 Phase 不改租户数据 | 视觉不一致 |
| 编辑已发出报价被打回 `draft` | 业务员以为仍有效 | 表单保存后提示 + 列表徽章变化 | 平台行为，不改 |
| 状态与合同/发运/收款权威重叠 | 两套状态机打架 | Phase 1 只在销售链内写状态；跨板块门禁只读 | Phase 2 需定权威 |

## Acceptance Criteria

- [x] **AC-001** — 新建报价与订单在库里 `status='draft'` 且 `status_entry_id` 指向本组织字典条目（API + DB 证据）。
- [x] **AC-002** — 有买方邮箱的报价执行「发出报价」后 `status='sent'`、`valid_until` 已写、列表出现「有效至」；无邮箱时前端拦截且**不发送请求**。
- [x] **AC-003** — `canceled` 报价：不再显示「发出/下单」动作；直接调 API 也被平台 400 拒绝。
- [x] **AC-004** — `draft` 报价的「转为订单 / 按此报价新建订单」不可用并给出原因；`sent|confirmed` 恢复可用。
- [x] **AC-005** — 订单 `draft → confirmed`、`→ canceled` 可执行且库内值正确；`canceled` 后不再出现「确认」动作。
- [x] **AC-006** — 发运分摊选择器只含 `confirmed` 订单；`draft`/`canceled` 不出现；历史 NULL 出现并标注。
- [x] **AC-007** — 列表状态徽章按字典标签/颜色渲染；过期报价高亮；历史 NULL 显示「—」。
- [x] **AC-008** — 买方邮箱写入快照 `contact.email`，编辑往返保留；对外报价从所选 customer 的 `parties.email` 预填。

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Phase 1 acceptance criteria | pass（AC-001…AC-008） | 真机（dev server + 本工作树 `.env`，`OM_DISABLE_EMAIL_DELIVERY=true`）：新建报价/订单落 `draft` + `statusEntryId`；draft 报价无下单动作、发出后动作随状态打开；`sent` 写 `valid_until`；订单确认/作废落库；发运分摊选择器只含 confirmed + 历史未标记项、作废项消失；探针单据已删。逐条见 `src/modules/internal_sales/README.md` 的「验证」段 |
| Unit tests | pass | `salesStatus.test.ts`（策略矩阵/过期/条目解析）、`buyer.test.ts`（快照邮箱两种键）、`shipmentFormOptions.test.ts`（状态门禁 + 未标记标注）；模块 7 suites / 67 tests |
| Independent review pass | pass（修订后） | 只读评审提出 4 条 must-fix（sent 报价作废被引擎复位、sent 报价转换出的订单不可确认、载入选择器缺门禁、编辑页缺提示）——全部修复并在真机复验（见模块 README 验证段 ⑥–⑩）；另有 8 条 nice-to-have，其中 6 条一并修复（有效至只对 sent 显示、邮箱格式与 `metadata.customerEmail` 兜底、分摊标签解析不走门禁、字典读失败与缺值区分、派对预填竞态、常量替换裸字面量），2 条记录为文档措辞修正 |
| Gate | pass | 本单元门禁见 PR（generate / typecheck / lint / check-lessons / ds:check / test / build）与 CI `validate` + `guard-tree` |
| Compatibility | pass | 无 DDL；旧快照、旧单据（status NULL）行为不变；i18n 只增键（`list.columns.lines` 改文案）、菜单名走字典 |
| Security | pass | 状态写入沿用引擎（组织作用域 + 功能位），邮箱只在加密快照列；无新端点、无新密钥 |

## Open Questions

（无——Q-001…Q-007 已按上表 Resolved assumptions 执行；若 owner 要改默认，改后同步本表与实现）

## Changelog

| Date | Change |
|---|---|
| 2026-09-30 | Initial skeleton（owner：把各板块缺失的状态按业务流程补齐；先销售链），含 Q-001…Q-007 |
| 2026-09-30 | **Phase 1 定稿并进入实现**（owner「按照这个流程先实作」）：Q-001…Q-007 按推荐默认落定；补齐 Domain Vocabulary / Journeys / UI / API / Tests / Traceability / Acceptance；Phase 2–4 仍为草案 |
| 2026-09-30 | **Phase 1 实现完成**（`feat/sales-status-lifecycle`）：新建写 `draft`（字典条目 id）、报价发出（`quotes/send` + 有效期 + 买方邮箱字段与 parties 预填）/作废、订单确认/作废、列表状态徽章 + 「有效至」+ 过期高亮、下单门禁、发运分摊只列 confirmed（历史 NULL 标注）、对外订单补「（PO）」、行数列改名「明细行数」；单测 3 套新增/更新，真机 5 条链路验证，AC-001…AC-008 全部通过 |
| 2026-09-30 | **Phase 2·A 实现完成**（`feat/shipment-close-lifecycle`）：发运单新增终态 `closed`（归档）——迁移表 `SHIPMENT_TRANSITIONS` 成为 depart/receive/close/cancel 四个守卫与详情页动作矩阵的唯一权威；新增 `cross_border.shipments.close` 命令/路由与 `cross_border.shipment.closed` 事件；徽章/筛选/标签与 `export_finance` 穷尽表同步。**独立评审后补齐**：`finance` 的落地成本扫描、`trade_docs` 合同详情、`export_finance` 柜档案三处「只认 received」的读路径都补 `closed`；终态单证写入（create/update/delete）被新守卫拒绝且详情页隐藏入口；迁移表查找对未知状态 fail-closed（不再 500）；状态列表单一来源（组件 re-export API 枚举）。证据：单元 `shipmentStatus.test.ts` + 集成 `shipment-close.spec.ts` 3/3（临时库）。 |

## Appendix — Phase 2–4 板块盘点（保留自骨架，待各自定稿）

| # | 板块 / 表 | 现状 | 建议状态 | 赋能点 | 期 |
|---|---|---|---|---|---|
| 3 | 发运单 `cross_border_shipments` | 有 `draft/in_transit/received/cancelled` | 补 `closed`；补状态事件 | 柜档案以 `closed` 收口 | 2 |
| 4 | 发运单证区 `cross_border_export_documents` | 无 status | `draft/issued/void` | 未签发 PI 不能作收款依据 | 2 |
| 5 | 收款 `export_finance_collections` | 有 `received/not_received/unknown`，默认 unknown | 保持词表 + 逾期判定 | 逾期未收清单 | 2 |
| 6 | 退税 `export_finance_refunds` | 有 `not_started/applied/completed/unknown` | 保持 + 时间戳 | 退税进度提醒 | 2 |
| 7 | 采购单 `purchasing_purchase_orders` | 已有状态机（`orders.ts:48-73`） | 补门禁/事件 | 状态 × 收货/应付 | 3 |
| 8 | 采购付款 `purchasing_purchase_payments` | 无状态 | 日期派生标签 | 应付台账口径 | 3 |
| 9 | 供应商产品库行 | 只有 `active` | 补 `archived` | 默认隐藏归档 | 3 |
| 10 | 平台运营 | 自由字符串 / `open/resolved/ignored` | 镜像 `imported→reconciled`、结算单 `imported→confirmed→paid` | 对账收口 | 3 |
| 11 | 费用 `finance_shipment_costs` / `finance_expenses` | 无 status | `pending/paid` 或日期派生 | 费用台账筛选 | 3 |
| 12 | 主数据（商品/交易对手/供应商） | `active` | 补 `archived`（低优先） | 选择器默认只列启用 | 4 |
