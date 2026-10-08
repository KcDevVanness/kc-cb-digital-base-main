# 销售入口固定到各自的贸易类型（对内 / 对外）+ 菜单改名

**Date**: 2026-09-30
**Slug**: internal-sales-entry-fixed-type
**Branch**: `fix/internal-sales-entry-fixed-type`
**Base**: `dev`
**Source doc**: [`.ai/specs/2026-09-29-sales-trade-type-and-line-reuse.md`](../../.ai/specs/2026-09-29-sales-trade-type-and-line-reuse.md)

## Goal

Owner 2026-09-30 反馈：`/backend/external-sales/quotes` 是**专门的对外**入口，`/backend/internal-sales/quotes`
**这个对内**的入口就该把贸易类型也固定为对内——包括菜单名称要跟着改。

现状（`.ai/runs/2026-09-29-sales-trade-type-ia.md` 的定稿口径）与反馈不符：`/backend/internal-sales/**`
被当成「销售入口」，**不按类型过滤**、两种类型同表、用常显的「类型」列区分；菜单组叫「出口业务-销售」，
菜单项叫「销售报价单」/「销售订单（PO）」——名字覆盖两种类型，列表却是唯一能创建两种类型的地方，
而对内对外本应是两个对称的入口。根因是上一轮为了「名字与范围一致」把**范围**做成了「两种类型」，
而不是把**名字**改回类型专属；owner 这次选定后者。

## Scope

`src/modules/internal_sales/**`（lib / 列表 / 表单 / 报价载入 / 12 个 `page.meta.ts` / zh+en 字典）、
`src/modules/cross_border/i18n/*.json`（组名 label）、模块 README、业务架构文档、计划表、所属 spec、lesson 记录。

## Non-goals

- 不改路由 URL、权限位、通道标记与数据（无迁移、无回填）；已落库的两条系统通道行显示名（「内部销售」/
  「对外销售」）不动。
- 不重命名菜单组的 **key**（`cross_border.nav.group.sales` 只改 label）：key 是用户侧边栏偏好的持久单元，
  改名会作废每个人的排布。
- 不动官方 `sales` 的引擎契约与列表 API；`cross_border` 的发运分摊只列对内订单的过滤保持不变。

## Implementation Plan

### Phase 1: 入口 = 单一贸易类型（读/写口径）

- 1.1 `lib/tradeType.ts`：`salesEntryFromPathname` → `tradeTypeFromPathname`（直接返回 `SalesTradeType`），
  删 `SalesEntry`；注释改成「一套实现，两个类型专属入口」
- 1.2 `InternalSalesTable`：服务端 `channelId` 按入口类型固定；入口通道未播种时不发列表请求、给出可执行提示；
  删「类型」列（每行都是入口的类型，列变成常量）与未标记单据的「—」提示
- 1.3 `InternalSalesForm` / `QuoteLoadPanel` / `lib/quoteLoad.ts`：类型控件恒为只读值（删 `tradeTypeHelp` 的
  可选分支）、删 `adoptQuoteType`；编辑页跨类型跳转与单据类型回退改按入口类型；`toInternalSalesFormValues`
  的未标记回退改为入口类型

### Phase 2: 菜单与字典

- 2.1 `cross_border.nav.group.sales` label →「出口业务-对内销售」/“Export operations — Internal sales”；
  6 个对内 `page.meta.ts` 的 `pageTitle` 兜底串、`pageGroup` 兜底串、面包屑同步
- 2.2 `internal_sales` 的 zh/en 字典：列表标题/描述/空态、表单标题、固定类型说明改「对内」口径；删
  `form.field.tradeTypeHelp`、`list.columns.tradeType`、`list.unmarkedHint`；对外描述里的对内落点改新组名

### Phase 3: 测试

- 3.1 单元测试更新（`tradeType` 的入口函数、`quoteLoad` 的 `adoptQuoteType` 删除）并跑 `npx jest src/modules/internal_sales`

### Phase 4: 文档

- 4.1 模块 README、`docs/dev/business-architecture.md`、`docs/plans/cross-border-erp.md`（新行）、
  `docs/plans/README.md`、所属 spec（REQ-003 / AC-003 / Changelog）、lesson 记录 + `.ai/lessons.md` 行

### Phase 5: 验证

- 5.1 门禁：`yarn generate` / `typecheck` / `lint` / `node scripts/check-lessons.mjs` / `ds:check` / `test` / `build`
- 5.2 浏览器实测（本工作树 dev server，端口块 +1000）：zh/en 侧边栏组名与菜单项、两个列表各自只列自己的类型、
  新建/编辑页类型只读且买方来源单一、未标记单据计数提示、深色 + 窄屏
- 5.3 PR：标签、代码评审一遍、总结评论、draft → ready

## Progress

PR: #61

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: 入口 = 单一贸易类型（读/写口径）

- [x] 1.1 `tradeTypeFromPathname` 取代 `salesEntryFromPathname` — 5457922
- [x] 1.2 列表按入口类型过滤、删「类型」列、通道缺失态 — 5457922
- [x] 1.3 表单锁定类型、删 `adoptQuoteType`、编辑页跳转与回退按入口类型 — 5457922

### Phase 2: 菜单与字典

- [x] 2.1 组名与 6 个对内 `page.meta.ts` 同步 — 9041a3f
- [x] 2.2 zh/en 字典改「对内」口径、删三个废弃 key — 9041a3f

### Phase 3: 测试

- [x] 3.1 单元测试更新 + 模块套件通过 — 5457922

### Phase 4: 文档

- [x] 4.1 README / 架构 / 计划表 / spec / lesson — 1abd562

### Phase 5: 验证

- [x] 5.1 门禁全绿（generate / typecheck 0 错 / lint 0 error（8 个既有 warning，全在 example）/ check-lessons / ds:check 956 files / test 61 suites·517 / build）
- [x] 5.2 浏览器实测（zh/en + 两个列表 + 锁定表单）
- [x] 5.3 PR 标签 / 评审 / 总结 / ready

## Risks / Assumptions

- 未标记的历史单据（`channel_id` 为空）从此**两个入口都不列**：对内入口此前会列出它们并显示「—」。
  计数提示改为通用文案（「不在本列表中」），回填命令仍是唯一归类路径；这是「入口 = 类型」的必然结果，
  与对外入口现状一致。
- 直接输入 URL 打开**其它类型**单据的编辑页仍会跳到它的入口（保持既有行为）；未标记单据按**你所在的入口**
  归类（保存时打该入口的通道），不再静默当作对内。
- 组名 label 改了、key 没改：已保存的侧边栏偏好不受影响。

## Verification

| 项 | 结果 |
|---|---|
| `yarn generate` | ✓ |
| `yarn typecheck` | 0 错 |
| `yarn lint` | 0 error（8 warnings，全在既有 `example` 模块） |
| `node scripts/check-lessons.mjs` | ✓ |
| `yarn ds:check` | 956 files passed |
| `yarn test` | 61 suites / 517 passed |
| `yarn build` | ✓ |
| 浏览器（dev server 4100，本工作树 `.env` 端口块 +1000；中文字典 + 切 en） | 侧边栏「出口业务-对内销售」/「出口业务-对外销售」两组四个菜单项就位，en 为 "EXPORT OPERATIONS — INTERNAL SALES"；对内报价列表 2 行（= API `channelId=<internal>` 的 2 张）、订单列表 1 行 + 「4 张无标记、两个入口都不列出」提示（= `channelIdsEmpty` total 4）、对外订单列表 1 行 + 同一条提示，两侧互不出现对方单据；类型控件只读「对内」/「对外」+ 新说明文案，买方选择器只列该类型来源（关联组织 / 外部客户），报价载入选择器只列 2 张对内报价；跨入口编辑页双向跳转正确；420px + 深色无横向溢出。截图见 PR #61 的验证评论 |
| `yarn mercato internal_sales backfill-trade-type`（dry-run，只读） | 8 单扫描 → 0 可分类 · 4 已标记 · 4 无买家链接（证实「命令清不掉无链接那部分」的文案修正） |
