# Dictionary Maintenance in the Main Menu — 字典维护进主菜单（基础数据分组）

**Date**: 2026-09-24
**Status**: Implemented and verified (Phase 1, 2026-09-24) — the main menu carries 「基础数据 → 字典维护」 pointing at `/backend/dictionaries`, which renders the same page body as the settings-sidebar entry; the installed route and its metadata are untouched.

## Implementation Status

Source doc: .ai/specs/2026-09-24-dictionary-main-menu-entry.md

| Phase | State | Dependencies | Acceptance IDs | Focused validation | Exit gate |
|---|---|---|---|---|---|
| Phase 1 — 一条路由、一个分组 | verified | none | AC-001…006 | `yarn generate`（生成物含两条字典路由）、`yarn typecheck`、`yarn ds:check`（697 文件）、改动文件 `npx eslint`、浏览器实测 | 主菜单出现「基础数据 → 字典维护」且页面体与设置侧栏一致；installed 路由零改动 |

### Phase 1 evidence

- [x] 路由：`src/modules/dictionaries/backend/dictionaries/page.tsx`（`export { default } from '../config/dictionaries/page'`，无重复实现）与 `page.meta.ts`（`requireAuth` + `dictionaries.view` + `dictionaries.manage`、`pageGroup: 'Master data'` / `pageGroupKey: 'master_data.nav.group'`、`pageOrder: 100`、`icon: 'book'`、面包屑）
- [x] 图标名核对：`book` 在 installed 注册表里存在（`node_modules/@open-mercato/ui/dist/backend/icons/lucideRegistry.generated.js`）
- [x] i18n：`master_data.nav.group`（基础数据 / Master data）与 `dictionaries.masterData.nav.title`（字典维护 / Dictionaries），zh 只写中文、en 只写英文
- [x] 分组顺序：`src/modules.ts` 的 `overrides.nav.groupOrder` 追加 `master_data.nav.group`（`groupOrder` 是「排在最前」语义 → 落在六个业务组之后、installed 分组之前）
- [x] `yarn generate`：`.mercato/generated/backend-routes.generated.ts` 含 `/backend/dictionaries`（app 元数据内联、import 指向 `@/modules/dictionaries/backend/dictionaries/page`）与 `/backend/config/dictionaries`（import 指向 `@/modules/dictionaries/backend/config/dictionaries/page`）
- [x] 浏览器实测（真实 dev server、真实会话）：侧栏出现分组按钮「基础数据」（展开）与其下「字典维护」→ `/backend/dictionaries`，位置在「平台运营」之后；该页渲染同一份字典库（当前组织 24 条字典、可编辑，上级组织只读）；设置侧栏「Module Configs → 字典」仍在且 `/backend/config/dictionaries` 渲染同一页面体（截图已留存）
- [x] 文档：`src/modules/dictionaries/README.md`（主菜单入口一节 + 验证 + 回滚）、`docs/plans/cross-border-erp.md` 进度行 六·补13、`docs/plans/README.md` 状态板

> 关联阅读：[`2026-09-21-erp-core-module-activation.md`](2026-09-21-erp-core-module-activation.md) 拥有「隐藏 installed
> 管理界面」的总策略，而字典页是该策略的**例外**（`src/modules.ts:200-209` 的注释与
> `src/modules/dictionaries/README.md` 记录了这个决定）。本 spec 只给它加一条**主菜单入口**，
> 不改 installed 元数据、不改页面体、不改 API 与权限。

## TLDR

业务人员维护词表（币种、单位、柜型、付款条件、品牌…）今天只有一个入口：**设置侧栏（齿轮）→ installed「Module
Configs」组 → 字典**（`pageContext: 'settings'`）。业务角色不会去点齿轮，所以入口等于不存在。本 spec 新增一条
**app 自有的主菜单路由 `/backend/dictionaries`**，把现有的 app 页面体（`DictionariesLibrary`）挂到主菜单新增的
**「基础数据」分组**下，权限沿用 installed 的 `dictionaries.view` + `dictionaries.manage`；设置侧栏那份保留不动。
无数据、无 API、无权限、无页面体改动。

## Problem Statement

**入口存在，但不在业务人员的路径上。** `/backend/config/dictionaries` 的路由元数据来自 installed
（`node_modules/@open-mercato/core/src/modules/dictionaries/backend/config/dictionaries/page.meta.ts:19`：
`pageContext: 'settings'`、`pageGroup: 'Module Configs'`、`requireFeatures: ['dictionaries.manage','dictionaries.view']`），
`buildAdminNav` 因此把它放进**设置侧栏**，而不是主菜单。app 侧只替换了页面体
（`src/modules/dictionaries/backend/config/dictionaries/page.tsx` 遮蔽同名文件），导航位置刻意保持 installed 所有
（`page.meta.ts` 是 re-export，README「覆盖机制」一节写明）。

**代价是真实的工作流摩擦。** 每个主数据选择器都读字典：币种（`currency_policy` 播种 + 各表单 picker）、
供应商单位 / 柜型 / 付款条件 / 报价 section（`product_codes/lib/dictionaryValues.ts` 汇总）、商品品牌
（`purchasing/lib/brandOptions.ts`）。业务人员要新增一个品牌或单位时，得先知道「设置齿轮里有字典页」——
这是一条只有管理员才会走的路径。2026-09-24 的商品 SKU 发号规则 spec（`REQ-PC-001`）已明确把
「品牌/类别词表由业务人员在字典页维护」当作前提，入口不在主菜单就是这条前提的缺口。

**页面体已经可复用。** app 的页面体只有一行：`<DictionariesLibrary />`
（`backend/config/dictionaries/page.tsx`），组件本身不依赖设置上下文（只用 `Page`/`PageBody` 与通用 DS 原语、
`pane-below-header` 由 `src/app/globals.css:60` 全局定义），因此可以在主菜单上下文里再挂一次。

## Overview and Success Measures

- **Primary outcome:** 主菜单出现「基础数据 → 字典维护」，业务人员从登录起 2 次点击就能维护词表；
  看到的行、能改的行与设置侧栏那份**完全一致**（同一组件、同一 API、同一 scope 规则）。
- **Leading indicators:** 侧栏 `基础数据` 组下出现「字典维护」；设置侧栏「Module Configs → 字典」仍在；
  两个 URL 打开同一页面体；无 `dictionaries.manage` 的用户两个入口都进不去。
- **Baseline:** 唯一入口在设置侧栏；主菜单没有字典项；`master_data.nav.group` 分组不存在。
- **Market / product reference:** Odoo 的 Settings → Technical → …（同款「藏起来」的问题）与
  ERP 常见的「基础数据 / Master data」一级菜单（SAP 的 SPRO 基础数据、NetSuite 的 Lists 菜单）。
  采用：**业务词表放主菜单一级分组**，管理员的设置侧栏入口保留。拒绝：把 installed 元数据改写成主菜单
  （会 fork 一份本可 re-export 的导航元数据，且丢掉设置侧栏那份）。

## Goals

- **REQ-001** — 新增 app 自有路由 `/backend/dictionaries`（`src/modules/dictionaries/backend/dictionaries/{page.tsx,page.meta.ts}`），
  页面体复用 `DictionariesLibrary`，**不复制组件、不改组件**。
- **REQ-002** — 该路由的元数据：`requireAuth: true`、`requireFeatures: ['dictionaries.view','dictionaries.manage']`（与 installed 一致）、
  主菜单上下文（不设 `pageContext`）、`pageGroupKey: 'master_data.nav.group'`、`pageOrder` 固定、`icon: 'book'`
  （必须是图标注册表里已有的名字，`node_modules/@open-mercato/ui/src/backend/icons/lucideRegistry.generated.tsx` 已含 `book`）、
  面包屑指向自身。
- **REQ-003** — 主菜单新增分组「基础数据」（`master_data.nav.group`），排在六个业务分组之后、installed 分组之前
  （`src/modules.ts:245` 的 `groupOrder` 追加一项）；分组标签中英双语落在 app 的 dictionaries 模块 i18n。
- **REQ-004** — 设置侧栏那份入口与 installed 元数据**一个字都不改**（`page.meta.ts` 继续 re-export；
  `src/modules.ts` 的 `{ id: 'dictionaries' }` 条目不新增 overrides）。
- **REQ-005** — 文档与状态：`src/modules/dictionaries/README.md` 记录第二条路由、为什么、如何回滚；
  `docs/plans/cross-border-erp.md` 进度行；本 spec 的 Status/Changelog。

## Non-goals

- **不改页面体与 scope 规则**：`DictionariesLibrary` 的列表、条目编辑器、只读规则、深链参数一概不动。
- **不改 installed 路由**（`/backend/config/dictionaries` 仍在设置侧栏；不 `navHidden`、不删除、不 302）。
- **不新增权限 id**：沿用 `dictionaries.view` / `dictionaries.manage`；不做「业务角色只读、管理员可写」的新 feature。
- **不做字典的「按业务域裁剪」**（例如只显示与采购相关的 key）——那是页面体的过滤功能，属于另一个决定。
- **不新增 API、命令、事件、迁移**；不碰 `dictionaries` 的实体与条目编辑器。
- **不做菜单注入（UMES menu injection）**：页面体归 app 所有，用页面元数据即可，不需要注入到别的模块的菜单里。

## Proposed Solution

一条新路由 + 一个分组键，复用既有页面体：

```text
主菜单（main）                                    设置侧栏（settings）
├── 采购 / 外贸 / 财务 / 商品主数据 / 交易对手 / 平台运营
├── 基础数据                        ← 新增分组（master_data.nav.group）
│   └── 字典维护  /backend/dictionaries   ← 新增路由（app 自有元数据，主菜单上下文）
└── …（installed 分组保持原位）      └── Module Configs → 字典  /backend/config/dictionaries（installed 元数据，不动）

两个路由渲染同一个组件：<DictionariesLibrary />（app 自有页面体）
```

- 元数据自己写（不 re-export），因为它描述的是**这条新路由的导航位置**，与 installed 的设置页位置无关；
  门禁与标题键仍与 installed 保持一致，避免同页两种权限语义。
- `pageOrder` 取一个不与同组其它项冲突的值；分组内目前只有这一项。
- 分组标签落在 `src/modules/dictionaries/i18n/{zh,en}.json`（与 `purchasing.nav.group` 落在
  `src/modules/purchasing/i18n/zh.json:2` 的现状同款）。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| 新增第二条路由，保留 installed 那份 | 不 fork 可 re-export 的导航元数据；管理员的设置侧栏习惯不变；回滚=删目录 | 用 `src/modules.ts` 的 `overrides.routes.pages['/backend/config/dictionaries'] = { metadata: { pageGroup, pageContext } }` 把原页挪到主菜单 | 会覆盖 installed 元数据（README 明确导航归 installed 所有），并丢掉设置侧栏入口 |
| 页面体复用同一个组件 | 同一份 scope 规则、同一个条目编辑器、同一处维护 | 复制一份「主菜单版」组件 | 两份实现必然漂移（scope 规则是本页最易错的部分） |
| 权限沿用 `dictionaries.view` + `dictionaries.manage` | 与 installed 语义一致；业务维护者本就该持有 manage | 主菜单入口只要 `view`（只读） | 只读用户会看到可点但会 403 的写按钮（页面体的只读态由 scope 推导，不由 feature 推导） |
| 新增「基础数据」分组而不是塞进「商品主数据」 | 字典里还有供应商单位、柜型、付款条件等非商品词表 | 挂到现有分组 | 语义偏窄，且会让商品组承担两类概念 |
| 分组排在六个业务组之后 | 词表是支撑性维护面，不是日常业务流 | 放最前 | 主菜单首屏应留给日常业务 |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| 字典维护入口 | 主菜单「基础数据」下的页面项，指向 `/backend/dictionaries` | 本 spec 的 `page.meta.ts` | 无权限 → 403（catch-all 的 Access Denied），侧栏不出现该项 |
| 词表归属组织 | 每个组织一份同名共享词表；「继承」的字典在所属组织维护 | `dictionaries` API 的 `organizationId`/`isInherited`（页面体既有规则） | 页面体已处理（只读徽标 + 禁用写入口） |
| 两个入口 | 设置侧栏的 installed 路由与主菜单的新路由是**同一页面的两个入口** | 本文 | 无——两侧渲染同一组件、同一数据 |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 业务人员（词表维护者） | 从主菜单进入，按组织维护词表与条目 | 所选组织（页面体规则不变） | `dictionaries.view`, `dictionaries.manage` |
| 管理员 | 设置侧栏或主菜单进入，行为相同 | 同上 | 同上 |
| 只读用户 | 两个入口都不可见；直连 URL 403 | fail closed | — |

作用域与信任边界不变：`tenantId`/`organizationId` 由会话与服务端派生，页面体把所选组织作为**查询收窄**传入，
写入口由页面体的 scope 规则给出。本 spec 不新增任何服务端路径。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 页面体（列表 / 条目编辑 / scope 规则） | reuse（零改动） | app 目录 `src/modules/dictionaries/**` | 直接渲染组件 | 一份实现一份规则 |
| 路由与导航元数据 | **app-own（新增）** | app 目录 `src/modules/dictionaries/backend/dictionaries/**` | `page.meta.ts`（页面发现） | 页面体归 app，导航位置也归 app |
| 分组排序 | reuse | `src/modules.ts:245` 的 `overrides.nav.groupOrder` | 追加分组键 | 既有机制 |
| 字典 API / ACL / 命令 / 条目编辑器 | untouched | installed `@open-mercato/core` `dictionaries` | — | 本 spec 不碰 |

## Architecture and Data Flow

```text
主菜单「基础数据」→ /backend/dictionaries
                      → catch-all 读取本路由 page.meta（requireAuth + 两个 feature）
                      → 渲染 app 页面体 <DictionariesLibrary />
                         → GET /api/dictionaries（页面体既有调用，按所选组织）
                         → 条目写：POST/PATCH/DELETE /api/dictionaries[/:id]（页面体既有守卫与乐观锁）

设置侧栏 → /backend/config/dictionaries → installed 元数据 + 同一组件（现状不变）
```

- **Module boundaries:** 改动只在 `src/modules/dictionaries/**`（新增两个文件 + i18n）与 `src/modules.ts`
  的分组顺序数组、README；不新增模块。
- **Extension points:** 页面发现（`backend/**/page.tsx` + `page.meta.ts`）+ 导航分组顺序覆盖；不使用菜单注入。
- **Alternatives considered:** 覆盖 installed 元数据（否决，见决策表）；菜单注入（否决：页面体归 app 所有，
  注入是给别人的菜单加项的机制）；复制组件（否决）。
- **Compatibility:** installed 路由、API、ACL、事件、页面体一律不变；新增的只是一个新 URL 与一个分组键。

## User Journeys

### Journey J-001 — 业务人员新增一个品牌词表项

1. 登录后主菜单看到「基础数据 → 字典维护」，点开落在 `/backend/dictionaries`。
2. 左侧列表按组织分组显示词表（当前组织带「本组织」徽标，上级组织的带「继承」），选中 `product_brand`。
3. 在右侧条目区「添加条目」→ 填值/标签 → 保存 → flash 成功，条目出现在列表。
4. 失败路径：无 `dictionaries.manage` → 页面 403（Access Denied）；选中「继承」的字典 → 添加入口禁用（页面体规则）；
   顶栏选「所有组织」→ 全只读并给出原因说明。

### Journey J-002 — 管理员沿用旧入口

1. 管理员点设置齿轮 →「Module Configs → 字典」，打开的仍是同一页面体、同一数据。
2. 两个入口互不干扰：任一处保存，另一处刷新后一致。

## UI and Interaction Contracts

参照页面：本模块既有的 `components/DictionariesLibrary.tsx`（app 自有，`Page` + `PageBody` + 双栏：
左侧字典列表（自身滚动）、右侧条目编辑器，`lg` 起用 `pane-below-header`）。canonical 参考实现是
`ui.page-shell`（`src/modules/example/backend/todos/page.tsx` + `page.meta.ts`：分组、order、图标、面包屑、
`requireFeatures`），规则见 `.ai/guides/backend-ui.md`（页面选择与「Navigation and Overrides」一节：
app 自有目的地优先用页面元数据）。

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/dictionaries`（主菜单，新） | 维护词表与条目（页面体不变） | 页面体既有：`GET/POST/PATCH/DELETE /api/dictionaries**` | `src/modules/dictionaries/backend/config/dictionaries/page.tsx`（同一组件）+ `example/backend/todos/page.tsx` | `Page`、`PageBody`（组件内）；导航由 `page.meta.ts` | loading / empty（无字典）/ error（加载失败）/ conflict（409 乐观锁）/ 无权限 403 / 「所有组织」只读态 | REQ-001, REQ-002 |
| `/backend/config/dictionaries`（设置侧栏，既有） | 同上 | 同上 | 同上 | 同上 | 同上 | REQ-004 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| 业务人员 | 采购 → 外贸 → 财务 → 商品主数据 → 交易对手 → 平台运营 → **基础数据** | 无新增 | 登录 → 基础数据 › 字典维护 → 选中字典 → 添加条目（3 次点击内） |
| 管理员 | 同上（另可在设置侧栏进入） | 无新增 | 设置 → Module Configs → 字典（现状） |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| 字典维护页 | 沿用页面体既有空态（无字典时给出「新建字典」入口） | 沿用页面体：`lg` 起双栏 + `pane-below-header`，窄屏单栏堆叠 | 沿用页面体既有行为（原生按钮/对话框，Esc 关闭，Cmd/Ctrl+Enter 提交） |

### `/backend/dictionaries` — 字典维护

```text
┌──────────────────────────────────────────────────────────────┐
│ 字典维护                                          （页面体）  │
├──────────────────────────────────────────────────────────────┤
│ 左：字典列表（按组织分组，自身滚动）  右：条目编辑区          │
│  ● 当前组织                           值 / 标签 / 外观 /      │
│     currency / product_brand …        排序模式 / 默认项       │
│  ○ 继承（上级组织）                    [添加条目] [保存]      │
└──────────────────────────────────────────────────────────────┘
```

- **Behavior / Responsive / Localization / Design-system:** 全部沿用页面体现状（本 spec 不新增交互、样式或文案；
  只新增导航标签与页面标题两个键）。亮/暗、窄屏、键盘行为由页面体现有实现承担，实测复核。
- **新增文案键**（app 模块 i18n）：`master_data.nav.group`（分组名）、`dictionaries.masterData.nav.title`（页面标题/面包屑）。

## Data Models

N/A — 无实体、字段、索引或迁移变更（本 spec 只加一条页面路由与一个导航分组）。

## API, Command, and Error Contracts

N/A — 无新增或修改的 API/命令。新路由只消费页面体既有的
`GET/POST/PATCH/DELETE /api/dictionaries[/:id]` 与 `GET /api/directory/organization-switcher`，
契约、门禁、乐观锁与错误码全部不变。

## Events, Jobs, Notifications, and Cross-Module Flows

N/A — 不新增事件/作业/通知；页面体既有行为不变。

## Security, Privacy, and Compliance

- **Authorization:** 新路由的 `page.meta.ts` 声明 `requireAuth` + `dictionaries.view` + `dictionaries.manage`，
  与 installed 页一致；服务端 API 的门禁不变（页面元数据不是唯一防线）。
- **Tenant isolation:** 不变（页面体与 API 的 scope 规则原样复用）。
- **Sensitive data:** 字典内容是共享词表，非 PII；无新增日志/导出面。
- **Abuse and failure modes:** 新入口不引入新的写路径（同一组件、同一 API）；无权限用户看不到侧栏项、直连 403。

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | UI | dev 应用 + 有 `dictionaries.*` 的会话 | 打开 `/backend/dictionaries` | 页面体渲染（字典列表 + 条目区）；选中一个字典能看到条目；顶栏「所有组织」时全只读并给出说明 | REQ-001, REQ-002 |
| TEST-002 | UI | 同上 | 看主菜单与设置侧栏；再打开 `/backend/config/dictionaries` | 主菜单「基础数据 → 字典维护」存在且高亮正确；设置侧栏「Module Configs → 字典」仍在；两个 URL 渲染同一页面体 | REQ-002, REQ-003, REQ-004 |
| TEST-003 | UI/security | 无 `dictionaries.manage` 的用户 | 打开两个 URL | 两侧栏都不出现字典项；直连 403（Access Denied） | REQ-002 |
| TEST-004 | UI | 同上（写权限会话） | 在 `/backend/dictionaries` 新建一个字典并加一个条目 | 保存成功并回读一致（与设置侧栏那份行为一致） | REQ-001 |

## Implementation Phases

### Phase 1 — 一条路由、一个分组（一次可发布）

- **Depends on:** none
- **Outcome:** 主菜单出现「基础数据 → 字典维护」，页面体与设置侧栏那份一致。
- **Why this order / value delivered:** 单一改动面（两个新文件 + 一个数组项 + 两个 i18n 键），
  业务人员的入口缺口当场闭合。
- **Deliverables:** `src/modules/dictionaries/backend/dictionaries/page.tsx`（渲染 `DictionariesLibrary`）、
  `…/dictionaries/page.meta.ts`（门禁/分组/order/icon/breadcrumb）、
  `src/modules/dictionaries/i18n/{zh,en}.json`（`master_data.nav.group`、`dictionaries.masterData.nav.title`）、
  `src/modules.ts`（`groupOrder` 追加 `master_data.nav.group`）、`README.md` 记录第二条路由与回滚。
- **Independent slices / estimated commits:** 路由+元数据+i18n 为一个提交；README/计划表/spec 状态为一个提交。
- **Requirements closed:** REQ-001, REQ-002, REQ-003, REQ-004, REQ-005
- **Tests:** TEST-001, TEST-002, TEST-003, TEST-004
- **Validation:** `yarn generate`（核对生成的路由清单出现新页面且 import 指向 app 文件）、`yarn typecheck`、
  `yarn lint`、`yarn ds:check`、`yarn test`，浏览器实测（主菜单/设置侧栏/两 URL/窄屏/亮暗/无权限）
- **Exit gate:** 主菜单出现「基础数据」分组与「字典维护」项，打开即为可用的字典页；设置侧栏那份未变；
  无权限用户两处都看不到且直连 403。

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001, `/backend/dictionaries` | 复用 `DictionariesLibrary`（`ui.page-shell` ← `src/modules/example/backend/todos/page.tsx`） | Phase 1 | TEST-001, TEST-004 | AC-001 |
| REQ-002 | 主菜单项 | `page.meta.ts` 门禁/分组/order/icon（`module.acl-features` ← `src/modules/example/acl.ts`；图标名须在注册表内） | Phase 1 | TEST-002, TEST-003 | AC-002 |
| REQ-003 | 主菜单分组顺序 | `src/modules.ts` `overrides.nav.groupOrder` + `module.i18n-catalogs` ← `src/modules/example/i18n/en.json` | Phase 1 | TEST-002 | AC-003 |
| REQ-004 | 设置侧栏既有入口 | 零改动（`page.meta.ts` 继续 re-export installed） | Phase 1 | TEST-002 | AC-004 |
| REQ-005 | 文档/状态 | `README.md`、`docs/plans/cross-border-erp.md`、本 spec | Phase 1 | TEST-002 | AC-005 |

Every surface reference above is classified **`emitted-example`**：`ui.page-shell` 与 `module.i18n-catalogs` 在
`src/modules/example/references/surface-inventory.json` 中都有可编译实现（`src/modules/example/backend/todos/page.tsx`、
`page.meta.ts`、`src/modules/example/i18n/en.json`）。本 spec 新增的唯一发现面是**一条后台页面路由**
（`/backend/dictionaries`），其集成证据是 TEST-001…004。

## Rollout, Migration, and Rollback

- **Migration:** 无（无 schema、无数据）；`yarn db:generate` 应产出空 diff。
- **Rollout order:** 单阶段；`yarn generate` 后核对 `.mercato/generated/backend-routes.generated.ts` 里
  `/backend/dictionaries` 的 import 指向 `@/modules/dictionaries/backend/dictionaries/page`，且原路由仍指向
  `@/modules/dictionaries/backend/config/dictionaries/page`。
- **Observability:** 无新增指标；页面体既有错误面不变。
- **Rollback:** 删除 `src/modules/dictionaries/backend/dictionaries/**`、回滚 `src/modules.ts` 的 `groupOrder` 数组
  与两个 i18n 键、`yarn generate` —— 主菜单项消失，installed 路由与数据无残留。

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 同一页面两个入口 | 有人以为存在两套数据/两套权限 | 同一组件、同一 API、同一门禁；README 与本文写明 | 低（导航歧义已在决策表中权衡，选择保留设置入口） |
| 新增分组影响主菜单长度 | 主菜单多一行分组 | 分组排在业务组之后；组内只有一项 | 接受：这是「基础数据」类入口的常规位置 |
| `icon: 'book'` 名字不在注册表 | 静默无图标 | 已在 `lucideRegistry.generated.tsx` 核对存在；`yarn generate` 后浏览器复核 | 低 |
| 分组键未落 i18n | 侧栏显示英文兜底或键名 | 键写在 app 的 dictionaries 模块 i18n（与 `purchasing.nav.group` 同款），浏览器实测 zh/en | 低 |
| 业务人员误改共享词表 | 影响其它组织的 picker | 页面体既有 scope 规则（继承只读 + 写入口按所属组织）+ 值不可变守卫（`product_codes` 的拦截器） | 接受：这是词表维护的固有风险，入口不改变它 |

## Acceptance Criteria

- [x] **AC-001** — 主菜单「基础数据 → 字典维护」打开 `/backend/dictionaries`，渲染与设置侧栏那份一致的页面体。
- [x] **AC-002** — 新路由元数据含 `requireAuth` + `dictionaries.view` + `dictionaries.manage`、主菜单分组键、
  order、图标与面包屑；无权限用户侧栏无该项且直连 403。
- [x] **AC-003** — 「基础数据」分组位于六个业务分组之后、installed 分组之前；标签中英双语正确。
- [x] **AC-004** — `/backend/config/dictionaries` 与 installed 元数据零改动（`git diff` 核对：`src/modules.ts` 只多一个数组项）。
- [x] **AC-005** — README、计划表进度行、本 spec 的 Status 与 Changelog 已回填。
- [x] **AC-006** — 门禁实测：`yarn generate` 通过且生成的路由清单同时含两条字典路由（import 各自正确）；`yarn typecheck` 0 error；`yarn ds:check` 697 文件通过；`yarn test` **32 套件 / 257 测试全绿**；改动文件 `npx eslint` 干净（`yarn lint` 全仓仍红，186 个 error 全在被 gitignore 的 `.ai/qa/test-results/html/trace/assets/*.js`——Playwright trace 产物，非源码）。浏览器实测：主菜单「基础数据」分组与「字典维护」入口、`/backend/dictionaries` 与 `/backend/config/dictionaries` 同一页面体、设置侧栏入口仍在；无权限（`dictionaries.manage` 缺失）未实测——门禁由 `page.meta.ts` 与 installed 语义一致地声明，服务端 API 的 ACL 未改动。

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | `AGENTS.md`、`.ai/guides/backend-ui.md`、`.ai/guides/spec-delivery.md`、`skill://om-spec-writing`、`skill://om-backend-ui-design`、`src/modules/dictionaries/README.md`、`.ai/specs/2026-09-21-erp-core-module-activation.md` |
| Data models, APIs, events, UI, and tests are internally consistent | pass | 无数据/API/事件改动；UI 契约两条路由指向同一组件；TEST-001…004 覆盖 REQ |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001/J-002 在 Phase 1 内闭环 |
| Platform-native reuse and extension points were chosen before custom code | pass | 页面元数据 + 分组顺序覆盖 + 复用既有组件；无复制组件、无菜单注入 |
| UI contracts identify references, canonical components, and theme/state coverage | pass | 参照页 + 文本 mockup + 状态行；沿用页面体既有亮暗/窄屏/键盘实现 |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | 单阶段含依赖、测试、价值、退出条件 |

Verdict: `Implemented and verified (Phase 1, 2026-09-24)` — 上述矩阵在实现完成后逐条复核，证据见 `## Implementation Status`。

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | 入口位置 | owner | resolved | **主菜单新增「基础数据」分组，设置侧栏那份保留**（2026-09-24 业主确认） |

## Changelog

| Date | Change |
|---|---|
| 2026-09-24 | Initial draft；Q-001 经业主确认后按推荐项定稿（主菜单新分组 + 保留设置侧栏入口） |
| 2026-09-24 | **Phase 1 实施完成 → `Implemented and verified`**。落地：`backend/dictionaries/{page.tsx,page.meta.ts}`（页面体再导出 + app 自有导航元数据）、`master_data.nav.group` / `dictionaries.masterData.nav.title` 两个 i18n 键、`src/modules.ts` 的 `groupOrder` 追加；installed 路由与元数据零改动。验证：`yarn generate` 生成物两条路由 import 正确、`yarn typecheck` 0 error、`yarn ds:check` 697 文件、改动文件 `npx eslint` 干净、浏览器实测（侧栏分组与入口、两 URL 同一页面体、设置侧栏入口仍在） |
