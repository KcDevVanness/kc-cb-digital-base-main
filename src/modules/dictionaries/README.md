# dictionaries —— app 覆盖层 + 自建字典库页面

本目录对官方 `@open-mercato/core` 的 `dictionaries` 模块做两件事：语言覆盖（`i18n/zh.json`、`i18n/en.json`），
以及**页面体的 app 自建版本**。模块本身（实体、命令、事件、`/api/dictionaries**`、ACL、导航元数据）
仍归框架包所有。

## 为什么替换页面体

官方 `/backend/config/dictionaries`（`DictionariesManager`）的列表项只渲染 名称 + key +「Inherited」徽标，
**从不显示字典属于哪个组织**；而本部署每个组织都有一份同名共享词表（`currency`、`supplier_product_unit`、
`container_type`…）。结果是：

- 列表里同一批 key 每个组织一份、名称逐字相同，操作员无法分辨哪一条属于哪个组织；
- 可编辑性只由「当前选中组织」推导（`isInherited = dictionary.organizationId !== context.organizationId`，
  `dictionaries/api/route.ts`），切到「所有组织」时所有行都不带徽标、按钮全亮——但
  `POST/PATCH/DELETE /api/dictionaries` 需要组织上下文（`Organization context is required`），
  点保存只会失败；而条目写入对 superadmin 放行，能写进别的组织的词表。

## 覆盖机制

`backend/config/dictionaries/page.tsx` **遮蔽**包内同名页面文件：`src/modules/<id>` 与包目录同为一个模块根
（`@open-mercato/cli` 的 `scanModuleDir` 按逻辑路径合并，app 文件覆盖包文件），因此生成的 backend 路由清单
直接 import `@/modules/dictionaries/backend/config/dictionaries/page`。

`backend/config/dictionaries/page.meta.ts` 只是 `export { metadata } from '@open-mercato/core/…/page.meta'`：
导航分组、`dictionaries.view` + `dictionaries.manage` 门禁、页面标题、面包屑仍由包内元数据决定。

**不要在 `src/modules.ts` 里用 `overrides.routes.pages[...] = { Component }` 指向客户端组件。**
`modules.ts` 会被 CLI（`yarn mercato …`）在 Node 里加载，静态 import 一个含 `next/navigation` 的客户端组件图
会让它加载失败并拒绝启动（实测：MCP 侧 `Failed to load the app-level modules file … Refusing to bootstrap`）。

## 页面契约（scope 规则）

| 顶栏选择 | 列表 | 可写 |
|---|---|---|
| 具体组织 X | X 的字典排在最前并带「当前组织」组头 + 每行「本组织」徽标；其他组织（上级）行带「继承」徽标与组织名 | 仅 X 拥有的字典：新建 / 改名 / 删除 + 条目编辑 |
| 「所有组织」 | 只读；按组织分组显示（此时 API 只返回账号归属组织及其上级组织的字典） | 全部禁用，页面顶部说明原因 |

- 每行都显示所属组织名，行内工具提示说明「继承」字典在所属组织维护。
- 左侧列表自身滚动（`max-h-96`，`lg` 起用 `pane-below-header` 把面板钉在顶栏下方并限制在视口内，
  `src/app/globals.css` 里定义），字典数量再多也不会把页面拉长；右侧条目区独立滚动。
- 深链：`?dictionaryId=`（精确 id）、`?key=`（按 key，**优先当前组织那份**，否则取第一条）、
  `?returnTo=`（返回按钮）。
- 条目编辑复用官方 `DictionaryEntriesEditor`（值 / 标签 / 外观 / 排序模式 / 默认项 / 标签翻译），
  `readOnly` 由上表给出；本页只拥有列表、scope 规则与字典级对话框。
- 写操作与官方一致：`useGuardedMutation` + `withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt))`
  + `surfaceRecordConflict`。
- 记录上下文（企业版 record_locks 用）通过 `useSetCurrentRecordInjectionContext` 发布
  `dictionaries.dictionary` + id。

## 依赖的官方契约

`GET /api/dictionaries`（`organizationId`、`isInherited`、`managerVisibility`、`entrySortMode`、`updatedAt`）、
`POST|PATCH|DELETE /api/dictionaries[/:id]`、`GET /api/directory/organization-switcher`（组织名与当前选择，
与顶栏同源）、`@open-mercato/core/modules/dictionaries/components/DictionaryEntriesEditor`、
`…/lib/entrySort`。都是包导出表内的路径；升级 0.8.x 时复核字段名与组件 props。

## 验证

1. `yarn generate` → `.mercato/generated/backend-routes.generated.ts` 里该路由只有一条，且 import 指向
   `@/modules/dictionaries/backend/config/dictionaries/page`。
2. `yarn typecheck && yarn lint && yarn ds:check && yarn test`。
3. 浏览器实测（2026-09-23）：选总部 → 总部行「本组织」可编辑、分公司行「继承」且编辑/删除 disabled；
   经页面新建 / 改名 / 删除各一次并回读一致；选中「继承」字典时「添加条目」disabled；
   切「所有组织」→ 顶部提示 + 全只读；`?key=currency` 选中当前组织那份。
4. API 事实（实测）：`om_selected_org=__all__` 时 `POST /api/dictionaries` 返回 201 并写进**账号归属组织**；
   `om_selected_org=<org>` 时写入该组织。页面因此在「所有组织」下不提供写入口。

## 回滚

删除 `backend/config/dictionaries/page.tsx`、`backend/config/dictionaries/page.meta.ts`、`components/`、
`lib/` 后 `yarn generate`，路由即回到官方页面体。数据、API、ACL、命令未改动，无数据回退。
