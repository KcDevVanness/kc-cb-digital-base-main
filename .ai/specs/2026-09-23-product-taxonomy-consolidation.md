# Product Taxonomy Consolidation — one page, one tree, one vocabulary

**Date**: 2026-09-23
**Status**: Implemented (Phases 0–3)

> 本文与实装代码一致（2026-09-23 复核）：所有机制描述都以 `src/modules/products/**` 的当前实现为口径，
> 历史方案（`DataTable` 自带 `getSubRows` 展开、旧 URL 服务端 302）只作为"已考虑并否决的替代方案"保留在决策表中。
> 骨架阶段用 `om-spec-writing`（交互模式）产出，Q-001…Q-003 由业主确认后按推荐项实施。

## TLDR

`products` 模块对同一批商品维护两套分类——平铺的 `products_types`（**产品线**）与树形的 `products_categories`
（**产品品类**）。此前它们是两个分不清的导航入口。本轮的最终形态：**一个页面（产品分类）两个页签**
（`/backend/products/taxonomy`，页签状态进 URL）；旧入口仍可解析并**挂载时规范化**到该页；**层级只保留产品品类树**
（产品线保持平铺，数据模型不动）；品类从"缩进平表"升级为**可展开/折叠的真树 + 行内新增子类**；两个页签的列表都
**收窄到当前所选组织**，页面不再出现只能看不能改的行。复用平台原语：`Page`/`PageBody`、`DataTable`（表格骨架：搜索/分页/
导出/列控制/行动作/空态）、`CrudForm`、DS `Tabs` 与 `IconButton`、`RowActions`、`StatusBadge`；层级与展开由本模块的
`lib/categoryRows.ts` 纯函数驱动。

## Problem Statement

证据采集于 2026-09-23（运行中的应用 + 开发库），Phase 0 之后仍然成立的缺陷：

1. **两个导航入口回答同一个问题。** `/backend/products/types`（order 310，icon `tag`）与
   `/backend/products/categories`（order 320，icon `layers`）同属 `products.nav.group`；运营分不清点哪个。
2. **两页都是平表。** 产品线：`编码 / 名称 / 英文名 / 排序 / 状态`；产品品类：`编码 / 层级路径 / 名称 / 上级品类 / 状态`
   ——"树"只是 `TreeIndent` 缩进 spacer，没有展开/折叠、没有行内新增子类
   （改造前 `src/modules/products/components/ProductCategoriesTable.tsx`）。
3. **两套词表重叠、只有一套在用。** 种子产品线是产品族（智能饮水机/喂食器/猫砂盆/摄像头/配件耗材）；线上品类树是
   宠物 → 饮水机 → 无线饮水机。20 个在售商品：挂产品线 **1 个**、挂品类 **5 个**；供应商报价工作簿的 section 横幅
   （CLEANING 267 / ACCESSORY 56 / FEEDING 48 / SPORT 32 / GROOMING 24 / FUN 16 / DRINKING 6）由
   `sourcing/lib/promotion.ts:212-236` 自动建为顶级品类——没有任何代码建产品线。
4. **产品线无下游读者。** `typeId` 只出现在 `src/modules/products/**`；`categoryId` 还被 `sourcing`、`purchasing`
   的读投影读；`products.types.*` 命令在模块外无人调用；合同行快照不含产品线；全仓没有按产品线分支的规则。
5. **权限拆分随意。** 两个列表页都要 `products.items.view`，写操作拆成 `products.types.manage` /
   `products.categories.manage`（`acl.ts`）——一个运营概念两个 feature。
6. **create 页漏进侧栏。** `items/types/categories` 三个 `create` 页都没写 `navHidden`，`buildAdminNav` 按 href 前缀
   把它们挂成列表页子项，`CollapsibleNavSection` 只在父项激活时渲染——机制与规则见
   [`.ai/lessons/create-page-under-list-becomes-sidebar-child.md`](../lessons/create-page-under-list-becomes-sidebar-child.md)。
7. **维护页显示不可维护的行。** 读展开到下级组织，而写只作用于所选组织（`.ai/lessons/read-expands-writes-are-selected-org.md`）：
   产品线列表把两个组织的行混在一起（fountain / feeder / litter_box 各出现两次），HQ 运营点开下级组织的行去保存，
   命令按所选组织查不到该记录 → 失败。品类列表同理。

**业主两个问题的结论**：产品线**不做树**（该轴无行为、无下游读者，层级只在品类树）；两个页面**合并**（同一问题、
重叠词表、同一导航组、两个 ACL feature，采用率 1/20 vs 5/20 指向品类树）。

## Overview and Success Measures

- **Primary outcome:** 运营在**一个**导航入口（产品分类）里维护两种分类；品类的层级用可展开的树呈现；页面上出现的每一行都能被当前用户编辑。
- **Leading indicators:** 侧栏 `商品主数据` 组下只剩一个分类入口；两个旧 URL 仍可打开并落到对应页签、URL 随即规范化到 `/taxonomy`；
  品类树默认展开且可折叠；行内「新增子类」一次点击即带出父级。
- **Baseline:** 两个入口、两张平表、HQ 列表混入下级组织的行（产品线 5+6 行、品类 2+3 行两个组织合看）。
- **Market / product reference:** Odoo `product.category`（树 + 行内新增子类）、SAP 物料组（层级 + 汇总）、Akeneo Taxonomy
  （"taxonomy" 作为页面名统称多种分类）。采用：单一分类页 + 页签、树形展开、行内新增子类。拒绝：拖拽排序（与 `sort_order`
  语义冲突）、多级分类的第二棵树、把产品线并入品类树（Q-001 选 (a)）。

## Goals

- **REQ-001** — 新增唯一分类页 `/backend/products/taxonomy`（界面名 产品分类 / Product taxonomy），在同一页以 DS `Tabs`
  呈现 `产品品类`（默认页签）与 `产品线` 两个页签；页签状态进 URL（`?tab=lines`）。
- **REQ-002** — 旧入口 `/backend/products/types`、`/backend/products/categories` 保持可解析：两个路由的 `page.meta.ts`
  标记 `navHidden: true`，页面**直接渲染同一组件并锁定页签**（`ProductTaxonomyPage defaultTab`），挂载后把 URL
  **规范化**为 `/backend/products/taxonomy[?tab=lines]` 且保留其余查询参数（含共享保存跳转的 `?flash=`/`?type=`）；
  不做 `null` 删路由，也不用服务端 302（302 会丢 flash 参数）。
- **REQ-003** — 侧栏只出现一个分类入口；`items/types/categories` 的 `create` 与 `[id]/edit` 页全部 `navHidden: true`，
  其面包屑指回分类页；分类页取 order 310、icon `layers`、`pageGroupKey` 保持 `products.nav.group`。
- **REQ-004** — 产品品类页签渲染**真树**：`lib/categoryRows.ts` 的 `buildCategoryTree`（扁平 `tree_path` 列表 → 根 + 子桶；
  父级缺失或成环的行留在根，避免行模型无限递归）与 `flattenCategoryTree`（深度优先展开、折叠隐藏整枝）产出 `DataTable` 的行，
  **展开状态由页面持有**（只存折叠集合）；折叠箭头是 DS `IconButton`，带 `aria-expanded` 与 `ui.dataTable.expand.*` 标签；
  缩进用 `w-3` 设计令牌 spacer；默认全部展开；顺序仍按存储的 `tree_path`。
- **REQ-005** — 品类行提供「新增子类」动作，跳到 `/backend/products/categories/create?parentId=<id>`，创建表单把该 id
  作为「上级品类」初值（父级可改、可清空），保存后回到分类页。
- **REQ-006** — 两个页签的列表都收窄到**当前所选组织**（`organizationId` 查询参数，schema 已支持），并把 scope version
  纳入查询键；顶栏为「所有组织」时列表退化为**带组织列的只读总览**（不发写、不显示行动作与新增、行不可点，表头一句
  `products.taxonomy.scope.allOrganizationsReadOnly` 说明为什么不能改）——命令在"没有具体组织"时无处可写
  （`organization_scope_required`），摆出可编辑的样子就是缺陷；不再混入下级组织的行，也不再把只能看不能改的行摆出来。
- **REQ-007** — 两页描述（定义）随页签显示，文案沿用 Phase 0 定稿（产品线＝平铺标签不参与层级；产品品类＝可多级）；
  新增文案同时落 `i18n/{zh,en}.json`。
- **REQ-008** — 保持契约面不变：表 / 命令 / API 路径 / feature id / 事件 id / `code` 值 / create-edit 路由路径一律不动；
  数据模型不变（Q-001 (a)）。

## Non-goals

- 把产品线并入品类树、或退役 `products_types`（Q-001 选 (a)；属契约面变更，需单独一轮 + BC 评审）。
- 品类树的拖拽排序、批量移动、层级规则继承（Q-003 明确不做拖拽；`sort_order` 仍是唯一排序手段）。
- 品类/产品线的 `code` 重命名或合并（`sourcing` 按 code 查品类）。
- 改动产品列表、产品表单的分步、变体、价格等其它 `products` 表面。
- 改产品列表本身的"读展开到下级组织"行为（本轮只收窄分类维护页）。
- 新实体、新命令、新 API 路由、新事件、新 feature。

## Proposed Solution

一个页面 + 两个页签 + 由纯函数驱动的树：

```text
/backend/products/taxonomy                     (产品分类 / Product taxonomy, order 310, icon layers)
├── Tabs(underline): [产品品类] [产品线]          ← 状态进 URL: ?tab=lines
│   ├── 产品品类页签 → ProductCategoriesTable    ← DataTable 行 + categoryRows 纯函数（真树、默认展开、可折叠）
│   │                   行动作: 新增子类 / 编辑 / 删除
│   └── 产品线页签   → ProductTypesTable         ← 平表（行为不变）
├── 别名（navHidden；直接渲染同一组件 + 锁定页签，挂载后 URL 规范化为上面这一条）
│   /backend/products/categories?…  → defaultTab=categories
│   /backend/products/types?…       → defaultTab=lines
└── create/edit（navHidden，路径不变）
    /backend/products/categories/create?parentId=<id> | /{id}/edit
    /backend/products/types/create | /{id}/edit
```

- **合并成一个页面**：两套分类是同一件运营工作的两种分类方式，合并后由页签 + 每个页签自己的一句话定义承担边界说明；
  页签状态进 URL 是别名能定位到页签的前提（`ProductTaxonomyPage` 的 `PRODUCT_TAXONOMY_HREF` 是规范化目标）。
- **旧 URL 直接渲染 + 挂载规范化**：服务端 302 会丢掉共享保存跳转带的 `?flash=`/`?type=`，所以别名自己渲染并锁页签，
  随后 `router.replace` 到规范 URL（保留查询参数）——历史链接一次点击到位，侧栏高亮回到唯一入口。
- **树由纯函数驱动、展开状态归页面**：`buildCategoryTree` + `flattenCategoryTree` 都是可单测的纯函数；表格仍是 `DataTable`
  （搜索/分页/导出/列控制/行动作/空态全保留），缩进与折叠箭头由名称列的 cell 渲染（`w-3` 令牌 + DS `IconButton` + `aria-expanded`）。
  不采用 `DataTable` 自带的 `getSubRows`/`expanded`：实测其展开状态在行模型变化时被重置，默认全开不生效，且会收回运营刚展开的枝。
- **收窄到所选组织**：维护页的写命令只作用于所选组织，展示下级组织的行等于展示不可保存的行；收窄后"重复行"与
  "点开就 404"两个问题一起消失。跨组织查看仍走组织切换器（应用既有机制）。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| 一个页面 + 两个页签（Q-002 (a)） | 一个概念一个入口；两套分类仍在，但边界由页签与描述讲清 | 只保留品类树一页（把产品线降级为表单字段） | 运营将无法批量维护产品线；且 Q-001 选 (a) 要保留该轴 |
| 产品线保持平铺（Q-001 (a)） | 该轴无行为、无下游读者；建树只增加维护成本 | 并入品类树 / 停用该概念 | 前者是破坏性契约变更，后者丢一个筛选维度；两者都留待业主后续单独决定 |
| 树 = `DataTable` 行 + 自持展开状态 + 纯函数（Q-003 (a)） | 表格能力（搜索/分页/导出/列控制/行动作/空态）全部保留；层级与展开可单测、可默认全开 | `DataTable` 自带的 `getSubRows` + `expanded`/`onExpandedChange` | 实测其展开状态在行模型变化时被框架重置：`expanded={true}` 与"按行集派生的对象"两种写法都在数据到达后被关掉，还会收回运营刚展开的枝 |
| 默认全部展开 | 与改造前的"全量平表"可见性一致，收起是显式动作 | 默认折叠 | 树浅（3 级）时折叠只会增加点击 |
| 折叠集合（而不是展开集合）作为唯一状态 | 新结果集（搜索/切组织/翻页）默认全开，不继承上一批行的折叠 | 存展开集合 | 新行会以"未展开"身份出现，需要额外规则补齐 |
| 保留 `层级路径` 列、去掉 `上级品类` 列 | 树里"上级"就是上一行；服务端搜索可能返回缺祖先的命中行，路径列仍能说明归属 | 两列都留 / 两列都删 | 都留是冗余；都删会在搜索结果里丢失归属 |
| 行内「新增子类」用 `?parentId=` 预填而非新路由 | 复用既有 create 页与 `CrudForm`，无新契约面 | 新增 `/taxonomy/categories/create` 等路由 | 多 4 个路由 + 4 个别名页，收益只是路径好看 |
| 旧 URL 直接渲染 + 挂载规范化（不 302） | 保留 `?flash=`/`?type=`；历史链接一次点击到位 | 服务端 `redirect()` | 会丢掉共享保存跳转的 flash 参数，且多一跳 |
| 维护页收窄到所选组织 | 写作用域就是所选组织；展示不可写行是缺陷 | 加组织列（保留展开读） | 行仍不可保存；且需要组织名解析（新依赖） |
| 页签状态进 URL 而非纯本地 state | 别名必须能定位到页签；链接可分享 | 纯 `useState` | 别名无法定位到页签 |

## Domain Vocabulary and Business Rules

**定名（2026-09-23 业主确认，Phase 0 已落地，只改显示名）**

| 界面名 | 实体 / 表 | 定义 | 英文名 |
|---|---|---|---|
| **产品分类** | —（页面） | 维护两种分类方式的页面（页签容器） | Product taxonomy |
| **产品线** | `ProductsType` / `products_types` | 平铺的产品族标签（智能饮水机 / 智能喂食器 / …），用于筛选与统计；**不含层级、不接行为** | Product line |
| **产品品类** | `ProductsCategory` / `products_categories` | 可多级分类树（宠物 → 饮水机 → 无线饮水机）；产品按它归类，本模块**唯一**的层级 | Product category |

- 表名 / API 路径 / 命令 id / feature id / 事件 id 仍是 `types` / `categories`，**未改名**（契约面，见 REQ-008）。
- **判定任何新维度的三条测试**（本次定名的依据）：① 改变系统行为吗？→ 行为轴（小闭集）；② 需要继承或汇总吗？→ 品类树；
  ③ 都不是 → 普通属性字段。已过一遍：饮水机/喂食器/猫砂盆/摄像头/配件耗材、供应商 section → 品类树；外购/自产/委托加工、
  品牌/型号/HS/CN/原产国/锂电/认证 → 属性字段。

### Phase 0 — 术语定名（已交付，2026-09-23）

只改显示名与描述：`产品类型 → 产品线`、`产品类别 → 产品品类`，两页描述改为写清各自定义；顺带纠正品类页原来那句
「合同与报表按类别分组」（代码里没有任何报表或合同按品类分组）。同时把"产品线保持平铺、层级只在品类"写进实体注释与
模块 README，并拒绝顺带修为"类型也建树"。

- **改了**：`i18n/zh.json`（43 键）、`i18n/en.json`（35 键）、3 个 `types/**/page.meta.ts` 的标题/面包屑字面量、
  `acl.ts` feature 标题、`events.ts` 事件标签、`index.ts` 模块描述、`setup.ts` 与 `data/entities.ts` 注释、
  `README.md`、`docs/dev/business-architecture.md`、`docs/prd/cross-border-erp.md` E-1、`docs/plans/README.md` 状态板、
  本 spec 与 `2026-09-22-products-and-trade-docs.md` 的 Changelog。
- **未改**：表结构与 `code`、`/api/products/types|categories`、`products.types.manage` / `products.categories.manage`、
  `products.type.*` / `products.category.*` 事件 id、页面路由。
- **实测**：`yarn generate`（生成物含新标题）、typecheck、lint（0 error）、ds:check、`yarn test`、`yarn i18n:check-hardcoded`
  全通过；浏览器 zh/en 两轮核对标题、描述、侧栏、产品表单字段。

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 商品运营（HQ） | 查看分类页、增改删产品品类与产品线 | 只作用于**所选组织**；列表也收窄到所选组织（REQ-006） | `products.items.view`（读）、`products.categories.manage` / `products.types.manage`（写） |
| 分公司运营 | 同上，仅本组织 | 同上（组织切换器选中本组织） | 同上 |
| 无 `products.items.view` 的用户 | 侧栏不出现入口；直接访问 403 | fail closed | — |

- 路由权限沿用页面 `page.meta.ts` 的 `requireAuth` + `requireFeatures`（分类页与两个别名都是 `products.items.view`），
  写权限仍在命令与 API 的 `products.categories.manage` / `products.types.manage`；本轮不新增、不改 feature。
- `tenantId` / `organizationId` 仍由会话与服务端 scope 派生，客户端只把所选组织作为**查询收窄**传入（API 已支持且校验）。
- 别名路由保留原 `requireFeatures`，且只渲染同一组件，不构成绕过权限的入口。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 分类维护页 | app-own | `products` | 模块内页面 + `page.meta.ts` | 主数据归 `products` |
| 页签容器 | reuse | `@open-mercato/ui` `primitives/tabs` | 直接 import | 已有可访问实现（tablist/tab/tabpanel + 方向键 + 未选页签不挂载） |
| 表格 | reuse | `@open-mercato/ui` `backend/DataTable` | `columns` / `data` / `rowActions` / `pagination` / `emptyState` | 搜索、分页、导出、列控制、行动作、空态全部由它提供 |
| 折叠箭头 / 状态 / 行菜单 | reuse | DS `IconButton`、`StatusBadge`、`RowActions` | 直接 import | 沿用 DS 尺寸与 `aria-*` 约定 |
| 层级与展开 | **app-own** | `products` `lib/categoryRows.ts` | 纯函数（单测覆盖） | 平台没有"默认全开的树表"原语；`getSubRows` 展开会被框架重置（见决策表） |
| 表单 | reuse | `@open-mercato/ui` `backend/CrudForm` | create/edit 页原样复用 | 不新增表单 |
| 品类/产品线数据 | reuse | `products` API `/api/products/types|categories` | `fetchCrudList` + `organizationId` 收窄 | 无契约变更 |
| 供应商报价提升建品类 | untouched | `sourcing` | 仍调 `products.categories.create` 命令 | 按 code 查品类，路径与 code 不变 |

## Architecture and Data Flow

```text
运营 → /backend/products/taxonomy
        → ProductTaxonomyPage(Tabs, ?tab=)
          ├── 产品品类 → ProductCategoriesTable → buildCategoryTree/flattenCategoryTree
          │                → GET /api/products/categories?organizationId=…
          │                └── 新增子类 → /backend/products/categories/create?parentId=<id>
          │                                → products.categories.create（组织取自会话）
          └── 产品线   → ProductTypesTable    → GET /api/products/types?organizationId=…
/backend/products/{types,categories}  → 同一组件 + defaultTab → 挂载后 replace 到 /taxonomy[?tab=lines]（保留查询参数）
```

- **Module boundaries:** 全部改动在 `src/modules/products/**`（页面、组件、lib、i18n）与文档；不新增模块、不跨模块耦合。
- **Extension points:** 页面仍按 `backend/**/page.tsx` + `page.meta.ts` 自动发现，UMES 的页面替换/注入点不变
  （`data-component-handle` 由 catch-all 挂上）。
- **Alternatives considered:** 单一树页面（拒绝，见决策表）；纯本地页签状态（拒绝，别名无法定位）；
  服务端 302 别名（拒绝，丢 flash 参数）。
- **Compatibility:** 旧 URL 可解析且挂载后规范化；API/命令/feature/事件/code 全不变；`products_types` 数据不动。

## User Journeys

### Journey J-001 — 维护产品品类（含新增子类）

1. 运营在侧栏 `商品主数据` 点**产品分类**（唯一入口），落在 `产品品类` 页签，看到 宠物 → 饮水机 → 无线饮水机 的嵌套树（默认展开）。
2. 在 `饮水机` 行点 `⋯ → 新增子类`，跳到创建表单且「上级品类」已预填 `饮水机`；改成别处或清空为顶级都允许。
3. 保存 → 回到分类页并提示成功；新节点出现在父级之下（`tree_path` 由命令重算）。
4. 失败路径：`code` 重复 → 409 并把服务端文案挂到字段；无写权限 → 403 且页面提示无权限；陈旧 `updatedAt` → 409 冲突对话框；
   把节点挂到自身/后代 → 422 且数据不变（表单的父级下拉已排除自身与后代）。

### Journey J-002 — 从历史链接进入旧页面

1. 运营点开一条旧通知/收藏：`/backend/products/types`（或 `/backend/products/categories`）。
2. 页面直接渲染分类页并锁定对应页签（产品线 / 产品品类），没有中间跳转；
   挂载后 URL 被替换为 `/backend/products/taxonomy[?tab=lines]`，其余查询参数原样保留，侧栏高亮回到**产品分类**。
3. 无权限 → catch-all 渲染 Access Denied（与其它页面一致）。

### Journey J-003 — 切换组织维护另一套分类

1. HQ 运营在头部组织切换器选中分公司。
2. 分类页两个页签的列表随之只显示该组织的行（查询键含 scope version，缓存不串）。
3. 在其中新增/编辑品类，命令按所选组织写入；切回 HQ 看到的是 HQ 自己的行。
4. 未选中具体组织（"所有组织"）→ 两个页签显示"请先在顶栏选择一个具体组织"，且不发列表请求。

## UI and Interaction Contracts

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/products/taxonomy`（产品分类） | 页签容器；`产品品类` 页签：树、搜索、分页、新增子类/编辑/删除；`产品线` 页签：平表、搜索、排序、编辑/删除 | `GET /api/products/categories|types`（`organizationId` 收窄）；删除 `DELETE`（带乐观锁版本） | 本模块 `components/ProductsTable.tsx`（列表骨架）+ `@open-mercato/ui/src/primitives/tabs.tsx`（页签） | `Page`、`PageBody`、`Tabs/TabsList/TabsTrigger/TabsContent`、`DataTable`、`RowActions`、`StatusBadge`、`IconButton`、`Button`、`Alert` | loading / empty / error（含 403 文案）/ "未选组织"提示 / conflict（409 对话框）/ success flash / permission denied / 状态徽标 | REQ-001, REQ-004, REQ-006, REQ-007 |
| `/backend/products/categories`（别名） | 渲染分类页并锁 `产品品类` 页签，随后 URL 规范化 | 同分类页 | catch-all + `ProductTaxonomyPage` | 同一个 `ProductTaxonomyPage`（`defaultTab="categories"`） | 同上 | REQ-002 |
| `/backend/products/types`（别名） | 渲染分类页并锁 `产品线` 页签，随后 URL 规范化 | 同分类页 | 同上 | 同上（`defaultTab="lines"`） | 同上 | REQ-002 |
| `/backend/products/categories/create?parentId=` | 新建品类，父级可预填 | `POST /api/products/categories` | 本模块 `ProductCategoryForm.tsx` | `CrudForm`（不改结构） | 校验错误 / 409 重复 code / 权限 / 键盘提交（Cmd/Ctrl+Enter） | REQ-005 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| 商品运营 | `商品主数据`（product master）→ 产品 / **产品分类** | 无新增 | 登录 → 商品主数据 › 产品分类 → 新增子类（2 次点击） |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| 产品品类页签 | 「还没有产品品类。」+ 新增按钮（既有 `ListEmptyState`）；未选具体组织时表格上方改显 `products.taxonomy.scope.allOrganizationsReadOnly`，无新增按钮与行动作 | 窄屏按列 `priority` 降级、无横向滚动；页签条可横向滚动 | 页签：←/→ 切换、`role="tablist"` + `aria-selected`；树：折叠箭头 `aria-expanded`，Enter/Space 切换 |
| 产品线页签 | 「还没有产品线。」+ 新增按钮；未选具体组织时同上 | 同上 | 同上 |

### `/backend/products/taxonomy` — 产品分类

```text
┌──────────────────────────────────────────────────────────────────┐
│ 产品分类                                                          │
│ 维护产品品类（多级树）与产品线（平铺标签）两种分类方式。            │
│ [ 产品品类 ] [ 产品线 ]                        ← DS Tabs(underline)│
│ 产品品类：可多级（如 宠物 → 饮水机 → 无线饮水机）；产品按它归类…   │
├──────────────────────────────────────────────────────────────────┤
│ DataTable（产品品类页签）                                         │
│  v 名称            编码        层级路径              状态   操作   │
│  v 宠物            pet_…       宠物                  启用   ⋯      │
│    v 饮水机        water_…     宠物 / 饮水机         启用   ⋯      │
│       无线饮水机   wireless_…  宠物 / 饮水机 / 无线… 启用   ⋯      │
│  [搜索] [分页] [导出/列控制]                                      │
└──────────────────────────────────────────────────────────────────┘
```

- **Behavior:** 页签切换与别名规范化都走 `router.replace(..., { scroll: false })`，只改 URL 不重挂载数据；品类树按
  `tree_path` 顺序、默认全展开，折叠集合由页面持有（新结果集回到全开）；搜索为服务端搜索（结果里缺祖先的行按根渲染，
  路径列仍显示完整归属）；删除前 `useConfirmDialog` 二次确认，带行版本（409 走冲突对话框）；行点击进编辑页；
  未激活的页签不挂载（`TabsContent` 未选中返回 `null`，因此首屏只发一次列表请求）。
- **Responsive and accessibility:** 列按 `meta.priority` 降级，窄屏不横向滚动；页签为原生 tablist 语义 + 方向键；
  折叠箭头有 `aria-label`（`ui.dataTable.expand.*`）与 `aria-expanded`；缩进用 `w-3` 令牌 spacer（非内联样式）；
  状态用 `StatusBadge`（语义色，不硬编码）。
- **Localization:** 新增键 `products.taxonomy.page.title|description`、`products.taxonomy.tab.categories|lines`、
  `products.taxonomy.scope.allOrganizationsReadOnly`、`products.categories.actions.createChild`、
  `products.{categories,types}.list.columns.organization`；zh/en 同步；
  页签定义行复用既有 `products.{categories,types}.page.description`。
- **Design-system and theming:** 全部语义 token（`text-muted-foreground` 等）；无自定义色值；亮/暗两态沿用 DS；无 `dark:` 补丁。

## Data Models

N/A — 本轮不改任何实体、字段、索引或迁移（Q-001 (a)：产品线保持平铺，`type_id` / `category_id` 不动）。

## API, Command, and Error Contracts

N/A — 无新增或修改的路由与命令。本轮只以既有契约的新参数组合调用它们：

| Method | Path | Change | Note |
|---|---|---|---|
| `GET` | `/api/products/categories` | 新增**调用方式**（传 `organizationId`） | 参数早已存在（`productCategoryListSchema`），本轮开始由页面传 |
| `GET` | `/api/products/types` | 同上 | `productTypeListSchema` 同样早已支持 |
| `POST` / `PUT` / `DELETE` | 同上两条 | 不变 | 仍由命令执行，带乐观锁与 scope 校验；跨组织写返回具名原因（`notInOrganization`），不是裸 404 |

## Events, Jobs, Notifications, and Cross-Module Flows

N/A — 不新增事件/作业/通知。既有 `products.category.*` / `products.type.*`（`clientBroadcast`）继续驱动列表刷新；
`sourcing` 的报价提升仍按 code 找品类，本轮不改 code 与路径。

## Security, Privacy, and Compliance

- **Authorization:** 页面 `requireAuth` + `products.items.view`；写操作仍在命令层校验 `products.categories.manage` /
  `products.types.manage`。无新增 feature，不引入 role-name 判断。
- **Tenant isolation:** 客户端传的 `organizationId` 只作为**收窄**，服务端仍按会话 scope 过滤并 fail closed；别名路由
  保留原 `requireFeatures` 且渲染同一组件，不构成绕过。
- **Sensitive data:** 分类数据非 PII，无加密字段；本轮不新增日志与导出面（导出沿用 `DataTable` 既有能力）。
- **Abuse and failure modes:** 收窄读使跨组织枚举面更小；删除仍受"有子类/被引用不可删（422）"与乐观锁保护。

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | UI/integration | dev 应用 + 超级管理员；既有 3 级品类树与 5 条产品线 | 打开 `/backend/products/taxonomy`；切页签；分别访问两个旧 URL（其一带 `?flash=`） | 侧栏只有一个分类入口且无 create 子项；`?tab=lines` 生效；旧 URL 直接渲染对应页签并把 URL 规范化为 `/taxonomy`（`flash` 仍显示）；zh/en 两态 | REQ-001, REQ-002, REQ-003, REQ-007 |
| TEST-002 | UI/integration | 同上 | 折叠 `宠物`；对 `饮水机` 执行「新增子类」并保存 | 折叠隐藏整枝（只剩根行）；创建页「上级品类」预填 `宠物 / 饮水机`；保存后新节点嵌套在其下；`Enter` 在折叠箭头上可切换 | REQ-004, REQ-005 |
| TEST-003 | UI/security | 两个组织各有分类数据（品类 HQ 2 行 / 俄罗斯 AB 3 行；产品线 HQ 5 行 / AB 6 行） | 在 HQ 打开分类页；切换组织；切到"所有组织" | HQ 只见 HQ 行（请求带 `organizationId`）；切组织即换数据；「所有组织」为带组织列的只读总览（无行动作/无新增/行不可点 + 说明提示）；无 `products.items.view` 用户 403 且侧栏无入口 | REQ-006, REQ-002 |
| TEST-004 | unit | 纯函数（`lib/__tests__/categoryRows.test.ts`，8 例） | 构建树 + 展开/折叠 | 缺父级的行按根渲染；成环（自指/互指）行留在根不递归；子行只挂自己的父级；层内保持输入顺序；折叠隐藏整枝 | REQ-004 |

## Implementation Phases

三个阶段的依赖与顺序即交付顺序；每阶段都已落地并有实测证据。

### Phase 1 — 一个页面、一个导航入口（合并表面）

- **Depends on:** Phase 0（术语定名，已完成）
- **Outcome:** 侧栏只剩「产品分类」一个入口，页内两个页签；旧 URL 仍可解析；create/edit 页不再漏进侧栏。
- **Why this order / value delivered:** 先消除"点哪个"的歧义（业主最初的痛点），且不动数据与 API，风险最低。
- **Deliverables:** `components/ProductTaxonomyPage.tsx`（页签容器 + 页签定义行 + 页签状态进 URL + 别名规范化；
  导出 `PRODUCT_TAXONOMY_HREF` 与 `defaultTab`）；`backend/products/taxonomy/{page.tsx,page.meta.ts}`；
  `backend/products/{types,categories}/page.tsx` 渲染同一组件并锁定页签，两个 meta 加 `navHidden` 并把标题/面包屑换成分类页；
  `{items,types,categories}/{create,[id]/edit}/page.meta.ts` 加 `navHidden` + 面包屑指向分类页；
  两个表格把 `LIST_HREF` 改名为 `ROUTE_BASE`（create/edit 路径不变）；i18n 新增 `products.taxonomy.*` 键。
- **Requirements closed:** REQ-001, REQ-002, REQ-003, REQ-007
- **Tests:** TEST-001
- **Validation:** `yarn generate`、`yarn typecheck`、`yarn lint`、`yarn ds:check`、`yarn jest --config jest.config.cjs src/modules/products`
- **Exit gate:** 侧栏 `商品主数据` 只有 产品 / 产品分类（无 create 子项）；两个旧 URL 直接落在正确页签并规范化 URL；
  亮/暗、窄屏、zh/en 均正常；两个页签各自的空态/错误态可见。
- **Shipped — evidence:** 生成物含 `Product taxonomy`/`Product Lines`；侧栏仅 `产品 / 产品分类`；
  `/backend/products/types` → 产品线页签且 URL 变 `/backend/products/taxonomy?tab=lines`；
  `/backend/products/categories?flash=…` → 产品品类页签、URL 变 `/backend/products/taxonomy`、flash 文案仍显示；
  页签切换写 `?tab=lines`；zh/en 两轮实测；门禁全绿。

### Phase 2 — 产品品类页签变成真树

- **Depends on:** Phase 1 退出条件
- **Outcome:** 品类以可展开/折叠的嵌套树呈现（默认全开），行内可「新增子类」。
- **Why this order / value delivered:** 主表面的价值点；在合并后的单一入口里交付，避免同一批组件改两次。
- **Deliverables:** `lib/categoryRows.ts`（`buildCategoryTree` + `flattenCategoryTree`，纯函数）+ `lib/__tests__/categoryRows.test.ts`；
  `ProductCategoriesTable` 以扁平化行渲染树（名称列承载 `w-3` 令牌缩进与折叠箭头，`aria-expanded` + `ui.dataTable.expand.*`），
  去掉「上级品类」列与行上的 `parentName`、存储 `depth` 死字段；行动作首位加「新增子类」；
  `ProductCategoryForm` 创建态读取 `?parentId=`；i18n 新增 `products.categories.actions.createChild`。
- **Requirements closed:** REQ-004, REQ-005
- **Tests:** TEST-002, TEST-004
- **Validation:** 同上 + 浏览器实测（展开/折叠、行内新增子类、键盘切换）
- **Exit gate:** 3 级树嵌套显示且默认展开；折叠父级后其后代不可见；「新增子类」一次点击即带出父级并成功创建；键盘可达（Tab/Enter）。
- **Shipped — evidence:** 宠物（0 缩进）→ 饮水机（1）→ 无线饮水机（2）三层嵌套、默认展开；折叠 `宠物` 后列表只剩 1 行，
  再展开恢复（`饮水机` 仍保持展开）；`Enter` 在折叠箭头上切换（`aria-expanded` true→false）；
  行「新增子类」跳到 `/backend/products/categories/create?parentId=<饮水机 id>` 且「上级品类」预填 `宠物 / 饮水机`；
  实存一个子类探针验证保存后嵌套正确，随后删除（测试数据未留存）。

### Phase 3 — 维护页只显示当前组织

- **Depends on:** Phase 1 退出条件（与 Phase 2 互不依赖）
- **Outcome:** 两个页签的列表收窄到所选组织，不再出现不可保存的下级组织行。
- **Why this order / value delivered:** 消除"点开就失败"的缺陷；放在合并之后，因为收窄是行为变更，需要有单一入口承载说明。
- **Deliverables:** 两个表格用 `components/useSelectedOrganizationId.ts` 取所选组织并传 `organizationId`，scope version 进查询键；
  选中具体组织时列表只显示该组织、写操作照常；顶栏「所有组织」时改为**只读总览**（`components/useOrganizationNames.ts` 提供
  组织名，列表新增「组织」列，行动作/新增/行点击一律不渲染，表头 `products.taxonomy.scope.allOrganizationsReadOnly`）；
  跨组织写返回具名原因（`lib/errorStatus.ts` → `products.{types,categories}.form.notInOrganization`）而不是裸 404；
  README/spec 记录该行为变更。
- **Requirements closed:** REQ-006
- **Tests:** TEST-003
- **Validation:** 同上 + 浏览器实测（所选组织 / 全组织 / 切组织三态）
- **Exit gate:** HQ 只见本组织行；切到分公司只见其自有数据；「所有组织」是带组织列的只读总览；任一行的编辑可正常保存（不再跨组织 404）。
- **Shipped — evidence:** 请求 URL 带 `organizationId=<所选组织>`；HQ 产品线 5 行 / 俄罗斯 AB 6 行、HQ 品类 2 行 /
  俄罗斯 AB 3 行（均无重复观感行）；切组织即换数据；「所有组织」11 行逐行标注组织且只读（无操作列、无新增、行不可点）；
  跨组织保存给出具名原因（`PUT /api/products/types` 本组织行 **200**、下级组织行 **404** 原文 `Product type not found`）。

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001, `/backend/products/taxonomy` | `Tabs` + `GET /api/products/{categories,types}` | Phase 1 | TEST-001 | AC-001 |
| REQ-002 | J-002, 旧两个路由 | 同一组件 + `defaultTab` → `router.replace` 规范化（保留查询参数） | Phase 1 | TEST-001, TEST-003 | AC-002 |
| REQ-003 | 侧栏 | `page.meta.ts`（`navHidden` / order / group key） | Phase 1 | TEST-001 | AC-003 |
| REQ-004 | J-001, 品类页签 | `lib/categoryRows.ts` 纯函数 + `DataTable` 行 + 自持折叠集合 | Phase 2 | TEST-002, TEST-004 | AC-004 |
| REQ-005 | J-001, create 页 | `?parentId=` → `CrudForm` 初值 → `products.categories.create` | Phase 2 | TEST-002 | AC-005 |
| REQ-006 | J-003, 两个页签 | `GET …?organizationId=` + `useSelectedOrganizationId` | Phase 3 | TEST-003 | AC-006 |
| REQ-007 | 页签定义行 + i18n | `i18n/{zh,en}.json` | Phase 1 | TEST-001 | AC-007 |
| REQ-008 | 全部 | 无契约变更 | Phase 1–3 | TEST-001 | AC-008 |

## Rollout, Migration, and Rollback

- **Migration:** 无（无 schema、无数据变更）；本轮不需要 `yarn db:generate`。
- **Rollout order:** Phase 1 → 2 → 3，每阶段独立可发布；`yarn generate` 后审阅生成物（页面注册与标题/`navHidden`）。
- **Observability:** 无新增指标；错误沿用既有 API/命令错误面（403/409/422 文案不变，跨组织写给出具名原因）。
- **Rollback:** 无数据迁移，故回退无残留。Phase 1 回退 = 还原三个 `page.tsx` 与 `navHidden`（旧 URL 恢复为原页面）；
  Phase 2 回退 = 表格改回缩进平表并移除 `lib/categoryRows.ts` 的使用；Phase 3 回退 = 去掉 `organizationId` 参数（恢复读展开）。

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 别名与规范页同时可访问（两个 URL 服务同一内容） | 别名 URL 首次渲染时侧栏高亮不指向分类项 | 挂载后立即 `router.replace` 到 `/taxonomy`（保留查询参数），实测两个旧 URL 均规范化 | 低（一次性重定向，实测覆盖） |
| 收窄到所选组织改变读行为 | HQ 不再一眼看到下级组织的分类 | 组织切换器是既有机制；spec/README 明确记录；TEST-003 覆盖切组织 | 接受：维护页展示不可写行是更差的缺陷 |
| 树超过一页（>200 节点）时子树被分页切断 | 层级可能跨页断裂 | 沿用既有 `PAGE_SIZE=200` 与"整树一页"假设；缺父级的行按根渲染不丢数据 | 接受：超限时按页断裂但不丢数据 |
| 搜索结果为服务端过滤，可能缺祖先 | 命中行以根身份渲染，缩进层级不完整 | 保留 muted 的「层级路径」列说明真实归属 | 接受：可读性优于重建祖先 |
| `?parentId=` 预填被绕过（手改 URL 指向他组织/自身） | 保存时给出具名错误 | 命令仍校验父级可见性与成环；表单下拉已排除自身与后代 | 低（服务端兜底） |
| 折叠状态与新结果集的关系 | 运营刚折叠的行在换搜索/组织后重新展开 | 折叠集合只在同一结果集内有效，这是有意行为（新集合以全开呈现） | 接受：与改造前的"全量可见"一致 |

## Acceptance Criteria

- [x] **AC-001** — 侧栏 `商品主数据` 下只有一个分类入口「产品分类」，打开后可用页签在 `产品品类` / `产品线` 之间切换，URL 反映当前页签。（实测 zh/en 两轮）
- [x] **AC-002** — `/backend/products/types` 与 `/backend/products/categories` 直接落到分类页的正确页签，URL 随即规范化为 `/taxonomy[?tab=lines]` 且保留其余查询参数（`?flash=` 实测可见）。
- [x] **AC-003** — 侧栏不出现任何 create/edit 子项（items/types/categories 的 create 与 edit 页 `navHidden`；生成物已核对）。
- [x] **AC-004** — 品类页签以嵌套树呈现，默认展开、可折叠（折叠隐藏整枝），键盘（Tab+Enter）可切换，顺序为存储的 `tree_path`。
- [x] **AC-005** — 品类行的「新增子类」跳到创建表单并预填上级；保存后新节点嵌套在父级下（实测创建子类探针于 `饮水机` 下并已删除）。
- [x] **AC-006** — 两个页签只显示所选组织的行；切换组织即切换数据；「所有组织」显示为带组织列的只读总览（无写操作）。
- [x] **AC-007** — 页签定义行与全部新增文案中英双语齐备，亮/暗、窄屏无溢出。
- [x] **AC-008** — 表 / 命令 / API 路径 / feature / 事件 id / `code` / create-edit 路由路径全部未变（`git diff` 核对：仅页面、组件、lib、i18n、文档与生成物）。
- [x] **AC-009** — `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test` 通过（lint 0 error / ds:check 638 文件 / jest 26 suites・213 tests 全绿），受影响 UI 已浏览器实测（zh/en、亮/暗、空态/错误态、键盘、切组织、别名规范化）。

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | `AGENTS.md`、`.ai/guides/backend-ui.md`、`.ai/guides/architecture.md`、`.ai/guides/spec-delivery.md`、`skill://om-spec-writing`、`.ai/lessons/*`（导航/作用域/页面隐藏三条） |
| Data models, APIs, events, UI, and tests are internally consistent | pass | 无数据/契约变更；UI 契约表逐路由列出数据源与状态；TEST-001…004 对应 REQ；traceability 指向实装机制 |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001…J-003 在 Phase 1–3 内闭环，无"收尾阶段" |
| Platform-native reuse and extension points were chosen before custom code | pass | `Tabs`、`DataTable`、`CrudForm`、`RowActions`、`StatusBadge`、`IconButton` 全部复用；唯一自有的是层级/展开纯函数（平台无"默认全开的树表"原语，理由记入决策表） |
| UI contracts identify references, canonical components, and theme/state coverage | pass | UI 契约表 + 文本 mockup + 状态/键盘/窄屏/明暗行 |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | 三个阶段各含依赖、测试、价值与退出条件，并附实测证据 |

Verdict: `Implemented (Phases 0–3)` — `Ready for implementation` gate 于 2026-09-23 Phase 1 启动前通过。

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | 产品线的去留 | owner | resolved | **(a) 保留为平铺属性，本轮不动数据模型**（2026-09-23 业主确认） |
| Q-002 | 合并后的形态 | owner | resolved | **(a) 一个页面两个页签**（品类树为主 + 产品线为辅），旧 URL 保持可解析（2026-09-23 业主确认） |
| Q-003 | 品类主表面 | owner | resolved | **(a) 升级为真树视图**（展开/折叠 + 行内新增子类，不做拖拽排序）（2026-09-23 业主确认） |

## Changelog

| Date | Change |
|---|---|
| 2026-09-23 | Initial skeleton; Open Questions gate open |
| 2026-09-23 | 术语定名落地（Phase 0）：产品类型 → **产品线**、产品类别 → **产品品类**；两页描述改为写清定义；纠正品类页「合同与报表按品类分组」的不实描述；Domain Vocabulary 章节补齐判定三测试 |
| 2026-09-23 | Phase 0 实测证据补齐（generate/typecheck/lint/ds:check/test/i18n 检查 + zh/en 浏览器实测）；create 页漏进侧栏的机制与规则记入 `.ai/lessons/create-page-under-list-becomes-sidebar-child.md` |
| 2026-09-23 | Q-001…Q-003 由业主确认（均为推荐项）；spec 补齐 Overview/Goals/Non-goals/Reuse/Architecture/Journeys/UI 契约/Integration Coverage/Phases/Traceability/Rollout/Risks/Acceptance/Compliance |
| 2026-09-23 | Phase 3 收窄行为落地并实测：两个页签传 `organizationId`（HQ 产品线 5 行 / 俄罗斯 AB 6 行，HQ 品类 2 行 / 俄罗斯 AB 3 行，均无重复观感行）；新增 `components/useSelectedOrganizationId.ts` 让首屏即知所选组织；跨组织行保存的裸 `404` 改为 `products.{types,categories}.form.notInOrganization` 具名原因（`lib/errorStatus.ts`） |
| 2026-09-23 | **Phase 1–3 实施完成 → `Implemented (Phases 0–3)`**。最终方案（按业主确认后复核）：合并页 `/backend/products/taxonomy` 两个页签；旧 URL 直接渲染 + 挂载后 URL 规范化（不用 302，避免丢 `?flash=`）；品类树由 `lib/categoryRows.ts` 纯函数驱动、展开状态归页面（`DataTable` 自带 `getSubRows` 展开在行模型变化时会被框架重置，故不采用）；维护页收窄到所选组织。验证：`yarn generate/typecheck/lint(0 error)/ds:check(638)/test(26 suites・213 tests)` 全绿 + 浏览器实测（zh/en、亮/暗、别名渲染与规范化、树展开折叠、键盘 Enter、新增子类预填并创建嵌套、切组织、探针数据已删除） |
| 2026-09-23 | 按业主「spec 按最新方案改」复核全篇：把历史方案（`getSubRows` 展开、服务端 302 别名）从正文移入"已考虑并否决的替代方案"，机制描述统一到当前实现（含 `usePathname` 规范化、`ROUTE_BASE`、`useSelectedOrganizationId`、`errorStatus` 具名原因）；补齐 TEST-001…004 的实际断言与 Phase 1–3 的 shipped 证据 |
| 2026-09-23 | spec 与实装对齐（Phase 3 的「未选组织」态）：正文原写"不发请求 + 显示 `selectOrganizationRequired`"，实装为**带组织列的只读总览**（`allOrganizationsReadOnly`；`components/useOrganizationNames.ts` + 两个页签的「组织」列 + 行动作/新增/行点击一律不渲染）——命令在没有具体组织时无处可写，把不可写的行摆成可编辑的样子才是缺陷。REQ-006 / UI 契约状态行 / Localization / TEST-003 / Phase 3 / AC-006 与 Changelog 中原先那句 `selectOrganizationRequired` 一并改正 |
