# 2026-10-10 — 统一「返回」目标：回到操作者来的那一页（导航轨迹 + `?returnTo=` + 台账兜底）

**Source doc:** owner 2026-10-10 对 `/backend/quotes` 的设计反馈（浏览器标签 `d5027df7-1156-4160-b805-50646797f0f6`）：
「从这个按钮点击进去的『按此报价新建单』按钮，进入的界面再返回，不是返回『销售报价单』感觉逻辑有问题，根据很多返回按钮不是按照
history -1 的逻辑，有些混乱，你帮我检查所有返回按钮的逻辑是否遵循此逻辑，都要修改统一」。需求记录即本条反馈；本仓无 issue 体系。
**Base:** `origin/dev`（`09c6403`）
**Branch:** `feat/unified-back-navigation`（worktree `../kc-cb-digital-base-min-back-nav`）
**PR:** #173（draft → ready）

## Goal

工作台 `/backend/quotes` 的行操作「按此报价新建订单」跳到订单 create 页（`/backend/internal-sales/orders/create?fromQuote=…`），
该页自己的台账是**订单工作台**，于是页头「← 返回」把操作者丢到订单列表，而不是他来的报价单工作台。同一形状（每条返回链接写死
一个台账常量）遍布 app 自有模块的约 30 个页面，owner 口径是「返回 = 回到我来的那一页（history -1）」。

根因：返回链接是**渲染期的 href**——框架的 `FormHeader` / `CrudForm` / `RecordNotFoundState` 都只接受 `backHref` 字符串并渲染
`<Link href>`，没有可以调 `router.back()` 的接缝（见 `.ai/lessons/installed-inputs-have-no-component-override.md`），
所以「来源」必须在点击前就知道；而 2026-10-09 引入的 `?returnTo=` 只覆盖作者记得标注的跳转。

## What Changed

- `src/lib/navigation/returnTo.ts`：`useReturnHref` → **`useBackHref(fallback)`**，按优先级解析：① `?returnTo=`（白名单
  `readReturnTo`，仅 `/backend/` 路径、无控制字符/反斜杠）→ ② 本标签页导航轨迹（`om:nav-origin:v1`，`{at, from}` 两页）→
  ③ 调用方台账。新增纯函数 `nextNavOrigin` / `readNavOrigin` / `resolveBackHref` / `backendLocation`（整串位置都过同一白名单，
  `sessionStorage` 与查询串同等不可信）。
- `src/components/BackendNavOriginReporter.tsx` + `src/app/(backend)/backend/layout.tsx`：后端外壳挂载一次，每次导航把
  `pathname + ?query` 记进轨迹（未记录的当前页由 `resolveBackHref` 的 `origin.at` 分支解析，渲染期与 effect 后同解）。
- **全量清扫**：app 自有模块的每个 `backHref` / `cancelHref` / `RecordNotFoundState` 返回链接都改走 `useBackHref(<原台账>)`
  （internal_sales、order_hub、purchasing、products、product_codes、trade_docs、cross_border、export_finance、finance、
  platform_ops、parties、our_parties、example；共 35 个文件、约 100 处渲染点）。
- `src/modules/internal_sales/components/InternalSalesTable.tsx`：工作台「按此报价新建订单」的行操作额外携带
  `withReturnTo(href, 当前工作台 URL)`——这条跳转的目标页台账是**订单**工作台，显式来源还能跨新标签页生效。
- 文档：`.ai/lessons/opened-page-returns-to-its-origin.md`（规则改写：轨迹 → `?returnTo=` → 台账）+ 目录行、
  `src/modules/internal_sales/README.md`（工作台行操作与返回/取消两节）、`src/modules/order_hub/README.md`（「返回本页」两处）。

## 口径与边界（Assumptions）

- `?returnTo=` 仍**优先于**轨迹：它是显式意图，且是唯一能跨新标签页 / 收藏 / 刷新的载体。
- 轨迹是**同标签页**的（`sessionStorage`）：新标签页、深链、通知链接没有轨迹 → 回退各自台账（与改动前一致）。
- post-save 落地仍是 `pushWithFlash`（push）：落地页的「返回」因此指回刚提交的表单——与浏览器自身返回键一致（本单元不改保存后跳转，
  若要「保存后返回列表」应把落地改成 replace，另开一刀）。
- 安装层模块页面（node_modules 里的 sales / catalog / customers 等）的返回链接仍是框架写死的台账：代码不归本仓，无法接这个
  共享件（同上 lesson 的边界）。app 自有页面已全部统一。
- `example/backend/umes-handlers/page.tsx` 的 `cancelHref="/backend/blocked"` 是 UMES 探针页的刻意目标，保持字面量。

## 🧪 验证（真机冒烟：worktree dev server，`PORT=3100`，admin@acme.com）

| 流程 | 期望 | 实测 |
|---|---|---|
| `/backend/quotes` 行操作「按此报价新建订单」→ create 页「← 返回」（确认未保存更改） | `/backend/quotes` | ✅ 落到 `/backend/quotes`（标题「销售报价单」） |
| `/backend/quotes?type=internal` 行「编辑」→ 编辑页「← 返回」 | 带类型筛选的工作台 | ✅ `/backend/quotes?type=internal`（轨迹保留 query） |
| 公司订单 hub → 关联销售单「编辑」（URL 带 `returnTo=<hub>`，轨迹指向别处）→ 「← 返回」 | hub（显式来源优先） | ✅ `/backend/orders/<rootId>` |
| 新标签页直接打开编辑页（带伪造 `?returnTo=https://evil.example/x`） | 忽略伪造值 → 模块台账 | ✅ `/backend/internal-sales/orders` |
| 新标签页打开 create 页（带 `?returnTo=%2Fbackend%2Fquotes`） | 显式来源生效 | ✅ `/backend/quotes` |
| 轨迹内容 | `pathname + query`，两页 | ✅ `{"at":"…/edit","from":"/backend/quotes?type=internal"}` 等 |

单元测试：`src/lib/navigation/__tests__/returnTo.test.ts` 17 项（解析优先级、回调台账、白名单拒绝、轨迹推进/幂等、query 校验）。

宽门禁（worktree，本地跑的就是单元 PR 的验证证据）：

```bash
yarn generate && yarn typecheck && yarn lint && node scripts/check-lessons.mjs && yarn ds:check && yarn test && yarn build
# generate ✅（281 artifacts）/ typecheck ✅ / lint ✅（0 errors，12 个既有 warning）/
# lessons ✅ / ds:check ✅（1110 files）/ test ✅（94 suites, 845 tests）/ build ✅
```

主目录复核（owner 要求「功能代码必须在主目录 `yarn dev` 里能 review」）：`git merge --no-ff feat/unified-back-navigation` 进主目录
本地 `dev`，`git diff feat/unified-back-navigation dev` 为空（合并树与分支树逐字节相同，分支门禁即合并树门禁）；在主目录
`http://localhost:3000`（admin@acme.com）重跑报告流程：`/backend/quotes` 行操作 → create 页 → 「← 返回」→ 确认未保存更改 →
落到 `/backend/quotes`（标题「销售报价单」）；安装层页面 `/backend/customers/companies` 在挂载轨迹记录器后照常渲染。

## 回滚

revert 本 PR 即可：无迁移、无数据、无 API；`sessionStorage` 里残留的 `om:nav-origin:v1` 无人读取（键名带版本，页面回退到台账行为）。
