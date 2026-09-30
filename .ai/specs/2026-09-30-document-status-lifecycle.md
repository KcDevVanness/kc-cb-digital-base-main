# 单据状态（status）在各业务板块的补齐与赋能（document status lifecycle）

**Date**: 2026-09-30
**Status**: Draft — 骨架（Skeleton），Open Questions 未定，暂不进入设计定稿与实现
**Scope route**: `spec-pr`（本文件）；实现将按 phase 拆成 `module-data` + `backend-ui` 单元
**Decision source**: owner 2026-09-30——「报价的 draft → sent → confirmed → canceled 感觉就有意义了；把每个功能板块如果有缺失的状态，按照业务流程建议，赋予有价值」

> **本文件是骨架，不是最终规格。** 按 `om-spec-writing` 的交互式流程：先给 TLDR + 问题 + 板块盘点 + Open Questions，
> 待 owner 回答 Q1–Q7 后补全其余小节（Data Model / API / UI / Events / Traceability / Acceptance …）。

## TLDR

给平台已有「状态」字段但目前**从不写入**、或**完全没有状态**的业务板块，按真实业务流程补一套可用状态：
每个状态值都必须绑定**谁在哪个动作里写它**、**它能挡住什么动作**、**怎么作废/回退**、**跳变时发什么事件**。
先做**销售链**（对内/对外报价、销售订单）——这是当前唯一「引擎字段 + 平台完整接口都在、但一张单都没状态」的板块；
再做**履约与资金**（发运单归档、发运单证区、收款、退税），最后是**采购与平台运营**的对账收口与报表。

## Problem Statement

1. **销售单据状态全空**：`sales_quotes.status` / `sales_orders.status` 在本部署里从不被写入——dev 库实测
   8 张单据（6 订单 + 2 报价）`status` 全部为 NULL，列表「状态」列每行都渲染「—」。
   而平台其实已经把这条链路做齐了：`POST /api/sales/quotes/send`（置 `sent` + `validUntil` + `sentAt` + 接受链接 + 邮件）、
   `POST /api/sales/quotes/accept`（令牌公开接口：过期拒绝、非 `sent` 拒绝，置 `confirmed` 后**就地转订单**并通知管理员）、
   状态跳变发 `sales.order.confirmed` / `sales.order.cancelled`、变更留痕（谁改的）。
   → 能力在，业务没接上。
2. **缺状态带来的真实业务问题**（已逐条对到本仓流程）：
   - 报价看不出「发出去没有 / 对方接没接受 / 有效到哪天」；报价是谈判文档，却**任何状态都能被拿去下单**（转订单/引用加载都不看状态）。
   - 订单看不出处于哪一步；发运单的销售分摊选择器**不校验订单状态**（`cross_border` 只查存在/重复/目录桥接），任何订单都能被分摊进柜。
   - 履约与资金板块的状态要么没有（发运单证区、费用），要么有值域但从不下发或只做展示（收款 `unknown`、退税 `unknown`）。
3. **没有统一约定的代价**：同一件事（确认/作废/完成）在不同板块叫不同值、有的板块用状态机（采购单 `orders.ts:48-73`）、
   有的板块只有裸字符串（平台镜像/结算单 `status`），报表与提醒无法跨板块复用。

## Goals

- 每个「有状态机价值」的板块都有一套**可用状态**：有明确写入动作、有门禁、有回退语义、有徽章与筛选。
- 状态值进**租户字典**（可配、带颜色），代码只认值；跨板块共享一个**通用生命周期词表**，已有词表不重命名。
- 状态跳变**发事件 + 留痕**，为提醒（`scheduler` + `notifications`）与报表（转化率/时长/逾期）打底。
- 每个 phase 独立可交付：先销售链，后履约资金，再采购与平台运营。

## Non-goals

- 不做审批流引擎（审批是 `workflows` 的职责；状态是**结果标签**，不是审批步骤）。
- 不改 installed `sales` 的引擎契约（不 eject、不改 `node_modules`）；只用它的公开接口与事件。
- 不为状态建第二套单据链，不引入新的状态存储（沿用各表已有列/引擎字段）。
- 本期不做跨板块统一看板（Phase 4 才谈）。

## Proposed Solution（骨架）

### 统一设计原则（待 Q 确认）

1. **一个状态值 = 一个业务事实**，不是「编辑进度」；同一事实跨板块同名同义（`draft` 草稿 / `sent` 已发出 /
   `confirmed` 已确认 / `in_progress` 履行中 / `completed` 完成 / `cancelled` 作废 或该板块既有同构词表）。
2. **只由动作写**：状态永远由命令/动作改写（发出、确认、作废、收货、结算…），界面不给「自由改状态」的下拉。
3. **写侧门禁、读侧展示**：门禁一律在写路径返回 422 + 可执行文案；列表只做徽章/筛选/计数与超期高亮。
4. **已有的词表不动**：合同 `draft/issued/signed/closed/cancelled`、税务发票 `draft/confirmed/void`、
   PI/CI `draft/issued/void`、采购单 `draft/placed/shipped/received/closed/cancelled`、发运单
   `draft/in_transit/received/cancelled`、供应商报价 `draft/confirmed/archived` 保持原值，只在缺门禁/缺事件/缺提醒处补。
5. **终态不可回退**：`cancelled` / `void` / `closed` 之后不允许回到进行中；需要重开就新建单据。
6. **可见性**：状态进列表徽章（字典色点）、筛选、顶部计数；关键节点写审计（谁改、何时、从什么到什么）。

### 板块盘点与建议（现状来自代码与 dev 库）

| # | 板块 / 表 | 现状（证据） | 建议状态（缺什么补什么） | 赋能点 | 期 |
|---|---|---|---|---|---|
| 1 | 销售报价（对内/对外，引擎 `sales_quotes`） | 字段与接口齐全，**从不写入**（8/8 NULL） | `draft` → `sent`（有效期内）→ `confirmed`（平台接受会就地转单）→ `cancelled` | 发出/接受链接、有效期与超期高亮、**未确认不得下单**、转化率与回复时长 | 1 |
| 2 | 销售订单（对内/对外，引擎 `sales_orders`） | 同上，且全链路不看状态 | `draft` → `confirmed` → `in_fulfillment` → `fulfilled`；旁路 `cancelled` | 新建写 `draft`；**只有 `confirmed` 才能进发运单分摊/收款计划**；`fulfilled` 由发运/收货回写；取消回退已生成分摊 | 1 |
| 3 | 发运单 `cross_border_shipments` | 有 `draft/in_transit/received/cancelled`（命令写入） | 补 `closed`（结算/归档完成）；补状态跳变事件 | 柜档案以 `closed` 收口；未 `closed` 的柜出现在「在途/待结算」清单 | 2 |
| 4 | 发运单证区 `cross_border_export_documents` | **无 status**（只有 `doc_type`） | `draft` / `issued` / `void`（对齐同模块 PI/CI 台账的词表） | 未签发 PI 不能作为收款依据；作废留痕 | 2 |
| 5 | 收款 `export_finance_collections` | 有 `received/not_received/unknown`，默认 `unknown`，无门禁 | 保持词表；补「由收款日期派生 + 显式确认」与逾期判定 | 未 `received` 的柜进逾期清单；登记收款要求柜已 `received` | 2 |
| 6 | 退税 `export_finance_refunds` | 有 `not_started/applied/completed/unknown` | 保持词表；补「已申报/已到账」时间戳 | 退税进度提醒；超期未到账清单 | 2 |
| 7 | 采购单 `purchasing_purchase_orders` | **已有状态机**（`orders.ts:48-73`，含时间戳） | 不动状态机；补「状态 × 收货/应付」的门禁与事件 | 只有 `placed` 可收货（已实现？待核）；`received` 才能进应付台账 | 3 |
| 8 | 采购付款 `purchasing_purchase_payments` | 无状态（有阶段/日期） | 不新增状态；用日期派生「未付/已付/部分」标签 | 应付台账与对账口径 | 3 |
| 9 | 供应商产品库行 `purchasing_supplier_products` | `active` 单一值 | 补 `archived`（停用/不再报价） | 列表默认隐藏归档行；报价选择器不再带出 | 3 |
| 10 | 平台运营 `platform_ops`（订单镜像 / 结算单 / 对账项） | 镜像与结算单是**自由字符串**（`imported`…），对账项有 `open/resolved/ignored` | 镜像：`imported → reconciled`；结算单：`imported → confirmed → paid`；对账项保持 | 对账收口：未对账/未结算计数与提醒 | 3 |
| 11 | 费用（`finance_shipment_costs` / `finance_expenses`） | **无 status** | `pending` / `paid`（或按付款日期派生） | 费用台账「已付/未付」筛选；月损益口径 | 3 |
| 12 | 主数据（商品 / 交易对手 / 供应商） | `active` | 补 `archived`（按需，低优先） | 选择器默认只列启用项 | 4 |
| 13 | RU 同步映射 | 已有（`unmapped`…） | 不动 | — | — |

> 说明：表中「已实现/待核」的门禁在补全阶段会逐条用代码证据落实；`[INFERENCE]` 标记表示仅从本轮阅读推断，尚未实测。

### 关键交互（草案）

- **报价**：列表新增「发出报价」（有效期天数）与「复制接受链接」行操作；有效至列 + 超期高亮；
  「转为订单 / 按此报价新建订单」在 `sent|confirmed` 之外禁用并给出原因文案。
- **订单**：新建即 `draft`；列表徽章/筛选；发运分摊选择器只列 `confirmed`（并给出「有 N 张未确认订单不在列表」提示）。
- **跨板块**：状态跳变写入审计（沿用引擎已有 `status_change` 文案族）；新板块按需发 `<module>.<entity>.<status>` 事件。

## Phasing（草案）

- **Phase 1 — 销售链闭环（最高价值）**：报价 `draft/sent/confirmed/cancelled` + 订单 `draft/confirmed/in_fulfillment/fulfilled/cancelled`；
  写入初值、发出/接受链路、（未确认）下单与分摊门禁、列表徽章/筛选/计数、超期高亮。
- **Phase 2 — 履约与资金**：发运 `closed` + 单证区 `draft/issued/void` + 收款/退税状态与提醒。
- **Phase 3 — 采购与平台运营**：采购单门禁/事件、产品库归档、平台镜像/结算单状态收口、费用已付/未付。
- **Phase 4 — 报表与提醒统一**：转化率、状态停留时长、逾期清单、通知订阅。

## Open Questions

| ID | 问题（每个都给了推荐默认，可直接回「按推荐」） | Owner | Blocking? |
|---|---|---|---|
| Q-001 | **范围与顺序**：按上面 Phase 1→4 推进，还是只做 Phase 1（销售链）先看效果？*推荐：先 Phase 1，验收后再开 Phase 2。* | owner | yes |
| Q-002 | **状态值来源**：新词表放**租户字典**（可配、带颜色，沿用 `sales.order_status` 的做法）还是代码内常量（像采购单 `ORDER_STATUSES`）？*推荐：字典（配置化 + 复用官方渲染）。* | owner | yes |
| Q-003 | **中文标签**：现有字典标签是英文（Draft/Sent/Confirmed…）。改租户字典数据为中文（单语言数据，需你给词表）还是先沿用英文？*推荐：给中文词表（草稿/已发出/已接受/已履行/已作废），英文保留为 en 环境数据。* | owner | yes |
| Q-004 | **门禁清单（Phase 1）**：只挡「未确认报价不得下单 + 未确认订单不得进发运分摊」，还是同时挡「已作废报价不得编辑/再发出」「已履行订单不得再改行」？*推荐：先挡前两条 + 作废即锁。* | owner | yes |
| Q-005 | **历史单据**：现有 8 张单据 `status` 全空——留空（列表显示「—」，新单从 `draft` 起）还是回填（统一 `confirmed`）？*推荐：留空 + 列表「—」，不动历史。* | owner | yes |
| Q-006 | **报价发出链路**：启用平台 `send`（需要买方收件邮箱：对内组织没有邮箱，需先在报价上写 `metadata.customerEmail`，或从 `parties` 带出）还是只给「复制接受链接」不发邮件？*推荐：先写 metadata 邮箱 + 发信；无邮箱时降级为可复制链接。* | owner | yes |
| Q-007 | **订单 `fulfilled` 的判定权**：由发运/收货自动回写，还是人工标记？*推荐：自动回写（发运单 `closed`/海外仓收货完成后），人工只在例外时标记。* | owner | yes |

## Overview and Success Measures

（待 Q-001/Q-002 答定后补：可量化指标——例如「报价发出→接受的平均时长」「未确认订单误入发运分摊 = 0」「逾期报价数」）

## Design Decisions and Alternatives

（待补：字典 vs 常量、动作驱动 vs 自由下拉、状态与审批流边界、跨板块统一词表 vs 各自词表）

## Domain Vocabulary and Business Rules

（待补：每个板块的状态机定义、允许跳转表、终态与回退规则——参照 `purchasing/commands/orders.ts` 的 `ORDER_TRANSITIONS` 形状）

## Users, Permissions, and Scope

（待补：谁能发报价/确认订单/作废；门禁沿用各板块现有功能位，如 `sales.quotes.manage`；跨组织可见性按现有 fail-closed 规则）

## Reuse and Ownership Map

（待补：引擎 `sales` 的 send/accept/convert 与状态事件；本模块 `internal_sales` 的列表/表单；`cross_border` 分摊与单证；`export_finance` 收款/退税；`platform_ops` 结算）

## Architecture and Data Flow

（待补：状态写入点 → 事件 → 订阅者（通知/回退/报表）链路图）

## User Journeys

（待补：J-001 对内报价发出→分公司接受→自动转单；J-002 对外报价被客户接受；J-003 未确认订单被挡在发运分摊外；J-004 报价超期提醒与作废）

## UI and Interaction Contracts

（待补：每个受影响路由的 `DataTable`/`CrudForm` 契约、徽章与筛选、加载/空/错误/冲突/键盘/窄屏/深色状态）

## Data Models

（待补：新增字典键与条目、需要补列的板块（如发运单证区 `status`）、时间戳字段）

## API, Command, and Error Contracts

（待补：新命令与 422 文案、`metadata.customerEmail` 的写入约定、事件载荷）

## Events, Jobs, Notifications, and Cross-Module Flows

（待补：`sales.order.confirmed/cancelled` 已有，需补哪些；`scheduler` 扫描超期；通知收件人）

## Security, Privacy, and Compliance

（待补：接受链接的令牌与限流（平台已有 `sales_quotes_accept` 限流）、邮箱属于 PII 的处理、作废留痕）

## Integration Coverage

（待补：每个 phase 的自包含集成用例：状态写入、门禁 422、列表过滤、事件触发、回退路径）

## Implementation Phases

（待补：Phase 1–4 的 deliverables / requirements closed / tests / exit gate；格式对齐既有 spec）

## Requirement Traceability

（待补：REQ ↔ journey ↔ phase ↔ TEST 矩阵）

## Rollout, Migration, and Rollback

（待补：无 DDL 的板块（销售链）直接上线；需加列的板块走 `yarn db:generate` 审阅 + owner 批准；回滚＝撤动作与文案，数据保留）

## Risks and Tradeoffs

（待补：状态与合同/发运/收款谁是权威；并发（乐观锁）；历史空状态；字典标签语言；自动化过度（自动作废）风险）

## Acceptance Criteria

（待补：每个 REQ 的可验证断言，含浏览器与 API 证据）

## Final Compliance Report

（待补）

## Changelog

| Date | Change |
|---|---|
| 2026-09-30 | Initial skeleton（owner 2026-09-30：把各板块缺失的状态按业务流程补齐；先销售链）。含 Q-001…Q-007 待答 |
