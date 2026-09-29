# 销售单据的贸易类型落到界面（menu / list / copy）

**Date**: 2026-09-29
**Slug**: sales-trade-type-ia
**Branch**: `feat/sales-trade-type-ia`
**Base**: `dev`
**Source doc**: [`.ai/specs/2026-09-29-sales-trade-type-and-line-reuse.md`](../../.ai/specs/2026-09-29-sales-trade-type-and-line-reuse.md)

## Goal

贸易类型（对内 / 对外）已经存在于单据与新建表单上，但界面还没跟上：菜单组与菜单项仍叫「内部销售」，
侧边栏里对外那组没有中文名（渲染出英文裸串「Cross-Border」）并掉在最后；列表默认看不到「类型」列；
首页描述仍写「总部对分公司」；另外几个页面把这类单据称作「内部销售」。

## Scope

`internal_sales`（菜单/列表/表单/报价载入）+ 三个消费方的文案（`cross_border`、`finance`、`trade_docs`）
+ `src/modules.ts` 的 `nav.groupOrder` + 模块 README / 架构文档 / 计划表 / 所属 spec。

## Non-goals

- 不改路由 URL、权限位、通道标记与数据（无迁移、无回填）。
- 不重命名已落库的两条系统通道行（`INTERNAL_SALES`/`EXTERNAL_SALES` 的显示名保持「内部销售/对外销售」）。
- 不动官方 `sales` 的引擎契约与列表 API。

## Implementation Plan

### Phase 1: 菜单与导航契约

- [x] 1.1 `cross_border.nav.group.internal` → `sales`、新增 `externalSales`，两键进 `nav.groupOrder`
- [x] 1.2 12 个 `page.meta.ts` 的标题/分组/面包屑与 zh/en 字典同步

### Phase 2: 列表口径

- [x] 2.1 销售入口不按类型过滤（两种类型同表），对外入口固定 `channelId`
- [x] 2.2 「类型」列常显；未标记历史单据两种提示

### Phase 3: 表单与报价载入

- [x] 3.1 类型标签/帮助文案改「对内 / 对外」；`salesEntryFromPathname`
- [x] 3.2 报价选择器按表单类型过滤；载入继承报价类型；删除无类型参数的 `documentEditHref`

### Phase 4: 其他页面文案

- [x] 4.1 `cross_border` / `finance` / `trade_docs` 的「内部销售」→「对内销售」、类型标签 →「对内 / 对外」

### Phase 5: 文档与验证

- [x] 5.1 模块 README、`docs/dev/business-architecture.md`、`docs/plans/cross-border-erp.md`、所属 spec
- [x] 5.2 门禁：generate / typecheck / lint / check-lessons / ds:check / test / build
- [x] 5.3 浏览器实测：菜单、两个列表、类型列、新建/编辑、报价选择器过滤、深色 + 窄屏

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: 菜单与导航契约

- [x] 1.1 `cross_border.nav.group.internal` → `sales`、新增 `externalSales`，两键进 `nav.groupOrder` — 23e17b1
- [x] 1.2 12 个 `page.meta.ts` 的标题/分组/面包屑与 zh/en 字典同步 — 23e17b1

### Phase 2: 列表口径

- [x] 2.1 销售入口不按类型过滤（两种类型同表），对外入口固定 `channelId` — 6f69940
- [x] 2.2 「类型」列常显；未标记历史单据两种提示 — 6f69940

### Phase 3: 表单与报价载入

- [x] 3.1 类型标签/帮助文案改「对内 / 对外」；`salesEntryFromPathname` — a1b2203
- [x] 3.2 报价选择器按表单类型过滤；载入继承报价类型；删除无类型参数的 `documentEditHref` — a1b2203

### Phase 4: 其他页面文案

- [x] 4.1 `cross_border` / `finance` / `trade_docs` 的「内部销售」→「对内销售」、类型标签 →「对内 / 对外」 — 94af03f

### Phase 5: 文档与验证

- [x] 5.1 模块 README、`docs/dev/business-architecture.md`、`docs/plans/cross-border-erp.md`、所属 spec
- [x] 5.2 门禁：generate / typecheck / lint / check-lessons / ds:check / test / build
- [x] 5.3 浏览器实测：菜单、两个列表、类型列、新建/编辑、报价选择器过滤、深色 + 窄屏

## Verification

| 项 | 结果 |
|---|---|
| `yarn generate` | ✓ |
| `yarn typecheck` | 0 错（先清掉 dev server 中途写坏的 `.mercato/next/dev/types/validator.ts`） |
| `yarn lint` | 0 error（8 warnings，全在既有 `example` 模块） |
| `node scripts/check-lessons.mjs` | ✓ |
| `yarn ds:check` | 951 files passed |
| `yarn test` | 61 suites / 512 passed |
| `yarn build` | ✓ |
| 浏览器（dev server 3002，中文字典） | 侧边栏四个入口就位；销售订单列表 6 张单据 / 类型列 1 对内 · 1 对外 · 4「—」+ 归类提示；对外入口仅 1 张对外 + 未归类提示；新建页类型下拉与锁定入口只读「对外」；编辑页类型回显；报价选择器随类型过滤（对内 2 / 对外 0）；深色 + 420px 无横向溢出 |

## Risks / Assumptions

- 老 group key 的侧边栏偏好失效一次（新增两键，不做数据迁移）——与既有「组 id 即用户偏好键」的取舍一致。
- 未标记的历史单据不再出现在对外入口（此前「有未标记单据就不过滤」会让对内单据混入对外列表）；销售入口照常列出并以「—」+ 提示兜底。
