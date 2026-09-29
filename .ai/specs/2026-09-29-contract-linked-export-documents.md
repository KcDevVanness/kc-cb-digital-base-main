# 合同为主体的出口单据关联（发运单 / 装箱单（PL）/ PI / CI）

**Date**: 2026-09-29
**Status**: Draft

> 业务口径（2026-09-29，业务确认）：出口业务以**购销合同**为主体——发运单、装箱单（PL）、形式发票（PI）、
> 商业发票（CI）都关联购销合同；一张主合同可产生**多张发运单、多张装箱单**；四类单据在编辑明细时都支持
> 「选择关联合同 → 自动带出合同商品列表快速关联」，且带出的明细**可编辑、留弹性**。
> 关联基线：发运单 ↔ 合同 = **多对多**（拼柜可能混多张合同）。

## TLDR

给四类出口单据补上对购销合同的关联，并把**合同行的商品列表**变成各单据明细的快速引用来源：
发运单 ↔ 合同用 M:N 关联表；PI/CI 增加「所属合同」引用（保留现有来源锚点与 CI 的发运单汇总）；
装箱单从「单号 + 附件」升级为**带可编辑明细**的单据；合同详情成为枢纽（关联单据区块 + 带 `?contractId=`
的新建入口）；「购销合同」排到出口业务组第一位。四类单据的明细编辑器统一加「从合同引用商品行」。
复用既有能力：`GET /api/trade_docs/contracts/lines`、发运单分摊与单证命令、`DataTable`/`CrudForm`/共享 API helper。

## Problem Statement

现状（代码级证据）：

| # | 事实 | 证据 |
|---|---|---|
| P-1 | 合同是一张**基本孤立的台账**：`source_kind/source_id` 是单值「合同 → 订单」，且**界面没有入口**；唯一消费方是订单档案只读投影 | `trade_docs/data/entities.ts:72-79`、`data/validators.ts:149`、`components/ContractForm.tsx`（无 source 字段）、`export_finance/lib/fileRules.ts:387` |
| P-2 | 发运单**没有合同列**：只有采购分摊（采购单行）与销售分摊（内部销售订单行） | `cross_border/data/entities.ts:15-103`；全模块 grep `contract` 无业务命中 |
| P-3 | 装箱单（PL）是发运单的一类出口单证，**只有单号/签发日/附件/备注，没有商品明细** | `cross_border/data/entities.ts:252-303`、`/backend/cross_border/packing-lists` |
| P-4 | PI/CI 的来源枚举 `{sales_order, purchase_order, shipment, manual}` **没有 contract**；行编辑只有「从订单复制行」 | `trade_docs/data/validators.ts:121`、`components/DocumentsForm.tsx:365-367` |
| P-5 | 合同详情只有金额/行/税务发票/附件区，**看不到也创建不了发运单/PL/PI/CI** | `components/ContractDetail.tsx:687-722` |

结论：业务口径的「1 张主合同 → N 张发运单 / N 张装箱单」在当前数据模型里**表达不出来**，
单据之间也没有任何可导航的关联；明细录入一遍遍重搜商品。

## Proposed Solution（轮廓）

1. **合同 ↔ 发运单（M:N）**：新关联表（随发运单命令整体替换，冻结合同号/方向快照）；发运单表单与
   列表显示合同，合同详情按关联表列全部发运单。
2. **PI/CI ↔ 合同**：`trade_docs_documents` 增 `contract_id` + 快照列（**独立于** `source_kind/source_id`，
   不替换现有锚点；CI 仍可用发运单汇总行）。
3. **装箱单升级为带明细的单据**：出口单证明细行表（先只由 `packing_list` 使用）+ 自己的 create/detail/edit
   页面；明细可编辑（箱子、重量、体积类字段按 Q-001 定档）。
4. **快速引用（四类单据）**：明细编辑器加「从合同引用商品行」——选合同 → 读合同行 → 生成可编辑明细/分摊行；
   发运单侧按订单行映射（规则按 Q-002 定），全部留手工增删改的弹性。
5. **枢纽与导航**：合同详情加「关联单据」区块（发运单/PL/PI/CI 列表 + `?contractId=` 新建入口，
   与现有税务发票区同构）；「购销合同」在出口业务组内置顶；不加菜单层级（平台不支持组嵌套，见下）。

### 已定口径（来自本轮业务问答，不阻塞）

- 发运单 ↔ 合同基数：**M:N**（拼柜可能混多张合同）——用户 2026-09-29 答复。
- 四类单据都要「关联合同 → 带出合同商品列表 → 可编辑」，不是只做 PI/CI。
- 单据上的合同关联：**可空、先不强制**（不破坏既有草稿流程；稳定后可再收紧）。
- 菜单：平台主侧边栏只有「组 → 条目 → 条目子项（一层，URL 前缀推导）」；**不能新增菜单组层级**
  （组 id = 角色边界 + 用户偏好键；跨模块搬 URL 会断已存链接）。因此用「合同置顶 + 合同详情枢纽」替代。

## Open Questions（阻塞，等待答复）

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | 装箱单明细行的字段口径：① 商品+数量+箱数；② 商品+数量+箱数+毛重+净重+体积+备注（可空、从合同行/商品主数据预填）？ | 业务 | yes | pending |
| Q-002 | 发运单「引用合同商品」如何落到分摊（分摊必须锚采购单行/销售订单行）：① 从本次发运单已选订单行按商品匹配；② 从合同自身关联的订单行匹配（需先补合同↔订单关联）；③ 只做对照参考？ | 业务 | yes | pending |
| Q-003 | 合同 ↔ 订单（采购单/内部销售订单）的既有半成品（单值 `source`、界面无入口）这次要不要一并补：① 不动；② 把 source 选择器接到合同表单；③ 扩成 1 合同 → N 订单？ | 业务 + 技术 | yes | pending |

## Overview and Success Measures

TODO — 待 Open Questions 关闭后填写。

## Goals

TODO — 待 Open Questions 关闭后填写（REQ-001…）。

## Non-goals

TODO。已知方向：不改发运单的分摊锚点（超发校验/收货回写不动）、不做菜单组层级、不迁移既有数据。

## Design Decisions and Alternatives

TODO — 待 Open Questions 关闭后填写。

## Domain Vocabulary and Business Rules

TODO。

## Users, Permissions, and Scope

TODO。已知：沿用 `trade_docs.contracts.*` / `trade_docs.documents.*` / `cross_border.shipments.*` / `cross_border.documents.*` 既有功能位；新增表不引入新角色名判断。

## Reuse and Ownership Map

TODO。

## Architecture and Data Flow

TODO。

## User Journeys

TODO。

## UI and Interaction Contracts

TODO。

## Data Models

TODO。

## API, Command, and Error Contracts

TODO。

## Events, Jobs, Notifications, and Cross-Module Flows

TODO。

## Security, Privacy, and Compliance

TODO。

## Integration Coverage

TODO。

## Implementation Phases

TODO — 已知依赖顺序：`cross_border` 半边（合同关联 + PL 明细 + 快速引用）可先行；
`trade_docs` 半边（PI/CI 关联 + 合同枢纽）与在飞的 `feat/counterparty-linkage` 单元（正在改 trade_docs）冲突，需等其合并。

## Requirement Traceability

TODO。

## Rollout, Migration, and Rollback

TODO。

## Risks and Tradeoffs

TODO — 已知：与并行单元 `feat/counterparty-linkage` 的 trade_docs 文件冲突（等待其合并再动该模块）。

## Acceptance Criteria

TODO。

## Final Compliance Report

TODO。

## Changelog

| Date | Change |
|---|---|
| 2026-09-29 | 骨架：问题陈述 + 方案轮廓 + 3 个阻塞 Open Questions（等业务/技术答复后填全）。 |
