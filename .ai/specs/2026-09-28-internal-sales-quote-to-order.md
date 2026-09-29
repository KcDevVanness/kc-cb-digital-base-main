# 内部销售：报价单「转为订单」行操作

**Date**: 2026-09-28
**Status**: Implemented and verified (2026-09-28)

> 本 spec 只覆盖一个能力：让操作员在**自建内部销售报价列表**上把报价单转为订单。
> 引擎侧（`sales.quotes.convert_to_order` 命令 + `POST /api/sales/quotes/convert` 路由）已存在且行为已实测，
> 本切片只补界面入口、确认与跳转。

## TLDR

主体给分公司报完价、分公司确认后，操作员在 `/backend/internal-sales/quotes` 的行操作里点「转为订单」，
确认后单据**就地**变成订单（保留行与买方快照、拿到新的订单号），界面直接跳到该订单的本模块编辑页。
复用官方 `sales` 引擎的转换命令与 REST 路由，不新造转换逻辑、不新增表、不新增功能位。

## Problem Statement

现状（2026-09-28 实测）：引擎的 `sales.quotes.convert_to_order` 由 `POST /api/sales/quotes/convert {quoteId}`
暴露（门禁 `sales.quotes.manage` + `sales.orders.manage`），调用返回 **200** 且**单据就地转换**——
同一个 id 从 `sales_quotes` 变成 `sales_orders`、拿到新的 `ORDER-…` 号、行与买方快照随行。
但**两个界面都没有入口**：安装层单据详情页的 Actions 菜单里没有它，本模块的报价列表行操作只有「编辑」。
操作员因此只能：把报价单当对外报价文本、另建一张订单（行要重录），或直接调 REST。
见 `src/modules/internal_sales/README.md`「报价 → 订单的转换：引擎有、界面没有」。

## Overview and Success Measures

- **Primary outcome:** 报价列表出现「转为订单」行操作；确认后单据成为订单，并跳到本模块订单编辑页；报价不再出现在报价列表。
- **Leading indicators:** 转换失败（403/404/网络）给出可读提示且单据不变。
- **Baseline:** 今天该操作只能靠 REST（无界面入口）。
- **Market / product reference:** 平台自身的单据详情页未提供该动作；本切片不照搬任何外部产品。

## Goals

- **REQ-001** — `/backend/internal-sales/quotes` 的行操作在调用者同时具备 `sales.quotes.manage` 与
  `sales.orders.manage` 时显示「转为订单」（i18n zh/en 各一条）；订单列表不显示该动作。
- **REQ-002** — 点击后先弹**不可撤销确认**（说明：就地转换、保留行与买方快照、新订单号、报价不再存在），
  取消则不发任何请求。
- **REQ-003** — 确认后 `POST /api/sales/quotes/convert {quoteId}`；成功 → flash + 失效报价列表查询 +
  跳转 `/backend/internal-sales/orders/{orderId}/edit`（`orderId` 取响应，缺失时回退为该单据 id）。
- **REQ-004** — 失败（含 403/404）→ flash 错误信息，停留在列表，不做任何本地状态假设。

## Non-goals

- 不做反向（订单 → 报价）、不做批量转换、不做转换前校验（价格/状态/库存）。
- 不改引擎命令、不新增表/迁移/功能位、不改安装层页面。
- 不在本模块提供「发送/接受」等其余单据动作（各自单独立项）。

## Proposed Solution

`src/modules/internal_sales/components/InternalSalesTable.tsx`：
- 复用已有的 `hasFeature(chrome payload)` 门禁写法新增 `canConvertToOrder`（`kind === 'quote'` ∧ 两个 manage 功能位）；
- 行操作数组追加 `{ id: 'convert-to-order', label, onSelect }`；
- `useConfirmDialog`（`variant: 'destructive'`）→ `readApiResultOrThrow('/api/sales/quotes/convert', …)` →
  `flash` + `queryClient.invalidateQueries({ queryKey })` + `router.push('/backend/internal-sales/orders/{id}/edit')`；
- 组件返回包一层 fragment 以渲染 `ConfirmDialogElement`（与 `ProductsTable` 同款）。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| 用引擎的就地转换 | 引擎已实现且实测 200；行、快照、编号序列都由它维护 | 本模块自建「复制成订单」 | 会造出第二套编号/金额逻辑，且与引擎语义漂移 |
| 跳转取响应里的 `orderId` | 就地转换后 id 与报价相同，但以响应为准更稳（引擎未来若改语义仍正确） | 直接用报价 id 拼 URL | 依赖实现细节，脆弱 |
| 双 manage 门禁 | 路由本身要求两个功能位；只给一半会 403 | 只看 `sales.quotes.manage` | 会出现点得动但必然失败的控件 |
| 确认框标 destructive | 转换不可撤销（报价行被移出 `sales_quotes`） | 无确认直接转 | 误点即不可逆 |

## Traceability

| Requirement | Artifact |
|---|---|
| REQ-001…004 | `src/modules/internal_sales/components/InternalSalesTable.tsx`、`src/modules/internal_sales/i18n/{zh,en}.json` |

## Evidence (2026-09-28)

- **真机（dev，superadmin）**：`/backend/internal-sales/quotes` 行操作出现「转为订单」→ 确认框文案为不可撤销说明 →
  确认后 `POST /api/sales/quotes/convert` **200**，flash 成功，跳到 `/backend/internal-sales/orders/{id}/edit`；
  报价列表不再有该单，订单列表出现同一 id、新号 `ORDER-20260928-00005`（探针单已删）。
- **引擎语义旁证**：转换前 `GET /api/sales/quotes?ids=<id>` 命中、转换后同 id 只在 `/api/sales/orders` 命中；
  转换出的订单行仍带 `productVariantId`（目录镜像后）。
- **门禁**：`yarn typecheck` 0 error｜`yarn lint` 0 error｜`yarn test` 全绿｜`yarn ds:check` 通过。

## Changelog

| 2026-09-28 | 首版：报价列表新增「转为订单」行操作（不可撤销确认 + 就地转换 + 跳订单编辑页）。 |
