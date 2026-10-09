# 2026-10-09 — order-workbench-own-fields（第八轮：工作台行改显根单自身字段）

**Source doc:** `.ai/specs/2026-10-09-company-order-root.md` 的「第八轮」节（REQ-028 / TEST-021–022 / AC-025）
**Base:** `dev`（d867630，含第五/六/七轮）
**PR:** #156（draft → ready → 合并到 `dev`）

> 轮次说明：本单元最初写成「第七轮」，但并行单元 `#157`（字段级附件槽位）先以「第七轮」合入 `dev`；本单元 rebase 到
> `d867630` 后整体改为**第八轮**（REQ-028 / TEST-021–022 / AC-025 / 计划表 六·补58），避免同一规格里两个「第七轮」。
> 同时发现并修复：`#157` 的合并把本规格的「第六轮」节与 REQ-020/021 行丢掉了（代码与模块 README 未受影响），本 PR
> 已按 `aa361d5` 的原文恢复该节。

## Goal

owner 2026-10-09 看 `/backend/orders` 的表格后反馈（原话要点）：`对方` 这一列看不出是什么，「感觉还是有采购单的影子
数据」，「正常表格字段应该显示跟订单详情对应的字段，对的上才正确」。

根因：`子单号` 与 `对方` 两列读的是**关联子单**的冻结事实（`order_hub_company_order_links.ref_number` /
`ref_counterparty`，由 `lib/orderStages.ts` 汇总；`对方` 优先取销售子单买方、否则取采购子单供应商）——不是公司订单
自己的字段，所以一张只有采购子单的根单会把采购单号与供应商显示在一张「公司订单」的表里。详情页抬头卡显示的才是根单
自己的字段。

## Scope

- `order_hub`：新增 `components/companyOrderDisplay.ts`（`toOrderWorkbenchRow` + `snapshotDisplayName`），
  `components/OrderWorkbench.tsx`（列集合与行解析）、`components/OrderDetail.tsx`（改用共享的 `snapshotDisplayName`）、
  `components/__tests__/companyOrderDisplay.test.ts`（新）、模块 i18n（zh/en）。
- 文档：本 run record、spec 第七轮节 + Changelog + J-001/UI mock/风险表/Q-003 的口径同步、模块 README。

## Non-goals

- 不改 API：`stages` 仍返回 `counterparty`/`childNumbers`（只做追加的契约，响应形状不动），只是工作台不再渲染它们。
- 不动「全字段」抽屉、四个阶段列的口径、金额列（第五轮）与筛选/搜索行为。
- `是否已收款` 一列：本单元**包含**它。原计划按 `dev` 当时的状态（第六轮未合入）先不加，owner 指示「合并到 dev」后先落第六轮（PR #152 → `dev` aa361d5），再在本分支 rebase 后补上该列——行集合因此与详情页抬头卡完全一致。

## Implementation Plan

### Phase 1: 行解析与列集合

1. 1.1 `companyOrderDisplay.ts`（纯解析：只读根单字段；非空字符串以外一律 `null`）+ 工作台列集合重排 + i18n 键增删。
1. 1.2 单测（`toOrderWorkbenchRow` / `snapshotDisplayName` 的边界：缺席、空白、非字符串、快照形状、协作旗标）。

### Phase 2: 收口

2. 2.1 浏览器实测（工作台列 vs 详情页抬头卡：字段同序同值；子单影子不再出现在表里）。
2. 2.2 文档（spec / README / run record）+ 宽门禁。
2. 2.3 PR draft → ready。

## Risks

- 去掉子单号列后「按单号找根单」只能靠搜索（服务端 `search` 覆盖子单号）→ README/spec 写明，详情页关联区块仍并列
  显示冻结单号。
- 与在飞的第六轮（PR #152，`order_hub` 同模块）在 `OrderWorkbench.tsx`/`OrderDetail.tsx`/i18n 有文件交集 → 本单元
  改动刻意小：列集合一处、解析抽成新文件；合并时按「列集合取本单元、状态词表与收款字段取第六轮」的口径取并集。

## Evidence

- 单测：`yarn jest --config jest.config.cjs src/modules/order_hub` → **6 suites · 38 tests passed**（新增
  `components/__tests__/companyOrderDisplay.test.ts`：缺席/空白/非字符串 → `null`、`{name,code}` 快照形状、
  协作旗标仅严格 `true`、子单键不进入行）。
- 宽门禁（本工作树，2026-10-09）：`yarn generate && yarn typecheck && yarn lint && node scripts/check-lessons.mjs &&
  yarn ds:check && yarn test && yarn build` → 全绿（jest **83 suites · 667 tests**；lint 0 errors / 11 既有 warnings；
  build 编译成功）。
- 浏览器实测（本工作树 dev `:3001`，共享 dev 库）：造根单 `CO-2026-0003`（标题/预计交货 2026-11-30/默认客户
  RU-AB/默认供应商 PetKit + 关联采购单 `PO-2026-0010`）→ 行 `标题 | 2026-11-30 | 草稿 | 俄罗斯 AB 有限公司 | PetKit |
  ¥2,000.00 | 采购=1`，与 `/backend/orders/CO-2026-0003` 抬头卡同值；表内不出现 `PO-2026-0010`（子单影子消失）。
  复核后已软删该冒烟根单。
- 主目录 review 树（本地 `dev`，含第六轮）：合并 `fix/order-workbench-own-fields` → `:3000` 表格与抬头卡一致
  （`CO-2026-0003` 行同值）；合并冲突 3 处（README/spec/OrderWorkbench）按「第六轮节 + 第七轮节并存、解析函数取本单元」
  解决。
- **rebase 到含第六轮的 `dev` 之后（2026-10-09）**：模块单测 `yarn jest src/modules/order_hub` → **7 suites · 42 tests**；
  宽门禁 `yarn generate && yarn typecheck && yarn lint && node scripts/check-lessons.mjs && yarn ds:check && yarn test &&
  yarn build` → 全绿（jest **84 suites · 671 tests**；build compiled successfully）。浏览器复测（本工作树 dev `:3001`）：
  表头 `编号/标题/下单日期/预计交货/状态/是否已收款/默认客户/默认供应商/金额/…`；`CO-2026-0002` 行「是否已收款=已收全款」
  与 `/backend/orders/d060a61e…` 抬头卡同值；`CO-2026-0004`（第六轮后新建）「未收款」。
- **rebase 到 `d867630`（#157 字段级附件槽位合入后）**：模块单测复跑通过；本单元文档整体改为**第八轮**（见上「轮次说明」）；
  规格里被 #157 合并丢掉的「第六轮」节与 REQ-020/021 行按 `aa361d5` 原文恢复（代码与模块 README 未受影响）。

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: 行解析与列集合

- [x] 1.1 Row parser + column set + i18n — 2a440ed
- [x] 1.2 Unit test — 2a440ed

### Phase 2: 收口

- [x] 2.1 Browser smoke — 2a440ed（见 Evidence）
- [x] 2.2 Docs + broad gate — 2a440ed（宽门禁全绿；docs 随同）
- [x] 2.3 PR draft → ready — 8e7ad70

### Phase 3: 第六轮落地后的收尾（owner 指示「合并到 dev」）

- [x] 3.1 落第六轮进 `dev`（PR #152 squash → aa361d5；rebase 与合并树门禁由该单元完成）
- [x] 3.2 本分支 rebase 到含第六轮的 `dev`（文档冲突按「两轮节并存」取并集；`OrderWorkbench` 的本地解析函数取本单元删除）
- [x] 3.3 行集合补上「是否已收款」列（`companyOrderDisplay` + 工作台列 + i18n + 单测）
- [x] 3.4 复跑宽门禁 + 浏览器复测（含 `CO-2026-0002` 的「已收全款」）— 366311f
- [x] 3.5 PR #156 推送 → ready → 合并到 `dev` — 366311f
- [x] 3.6 rebase 到 `d867630`（#157 的「第七轮」）→ 本单元改为第八轮（REQ-028 / TEST-021–022 / AC-025 / 计划表 六·补58）；恢复被 #157 合并丢掉的规格「第六轮」节（按 `aa361d5` 原文）
