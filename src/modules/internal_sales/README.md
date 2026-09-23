# `internal_sales` — 内部销售单据（自建界面，官方 sales 引擎）

app 自有**界面层**模块：为「总部 → 分公司」的内部销售提供自建的报价单/订单**列表、新建与编辑**页，
**行引用自建商品主数据**（`products_products.id`）。单据本体仍由官方 `sales` 链承载
（编号、状态、金额引擎、发货、发票、退货、收款），本模块只通过其公开 API 驱动，不重写引擎。

需求与证据见 [`.ai/specs/2026-09-22-products-and-trade-docs.md`](../../../.ai/specs/2026-09-22-products-and-trade-docs.md) 的 Phase 6。

## 表面

| 层 | 内容 |
|---|---|
| 页面 | `/backend/internal-sales/quotes`、`/quotes/create`、`/quotes/[id]/edit`；`/backend/internal-sales/orders`、`/orders/create`、`/orders/[id]/edit`（六个页面的 `pageGroupKey` 都是 `cross_border.nav.group`，即侧边栏「外贸」组；本模块没有自己的导航分组） |
| 组件 | `components/InternalSalesTable.tsx`（列表）、`components/InternalSalesForm.tsx`（抬头 + 行编辑器，一次提交整单） |
| 读 | 官方 `GET /api/sales/{quotes,orders}`（抬头）与 `GET /api/sales/{quote,order}-lines?quoteId\|orderId=`（行，**snake_case** 列名，`pageSize` 上限 **100**） |
| 新建写 | 官方 `POST /api/sales/{quotes,orders}`（抬头 + 行一次提交；命令 `sales.quotes\|orders.create`） |
| 编辑写 | 抬头 `PUT /api/sales/{quotes,orders}`（**只写抬头标量字段**）+ 行 `PUT/DELETE /api/sales/{quote,order}-lines`（`PUT` → `…lines.upsert`，`DELETE` → `…lines.delete`） |
| 权限 | 列表页声明读功能位 `sales.quote.view` / `sales.order.view`，新建/编辑页声明 `sales.quotes.manage` / `sales.orders.manage`（本模块不新造功能位：写入的门禁在官方 API 上） |
| 事件 | **无**（本模块不声明 `events.ts`；单据的 `sales.*` 事件由官方命令发出） |
| 实体/迁移 | **无**（不新增表；单据写在官方 `sales_*` 表里） |

> 读功能位的 id 与安装层不一致：本模块列表页声明的是**单数** `sales.quote.view` / `sales.order.view`，
> 而安装层 `sales` 自己的列表页与 API 声明的是**复数** `sales.quotes.view` / `sales.orders.view`，
> 两者并不互相匹配（`matchFeature` 只做精确/前缀通配匹配，不认单复数）——超管之所以照常打开，
> 是因为 `rbacService.userHasAllFeatures` 对 `isSuperAdmin` 直接放行，而不是因为 id 对上了。
> 要按角色真正收紧门禁，先把两边的 id 统一。

## 为什么这样做（而不是 eject `sales`）

- 官方 `sales` 单据链的行 schema 是 `productId: uuid().optional()`，**不做目录校验**；命令里查目录只为 UoM 富化，
  查不到会走 fallback 不报错 → 自建商品 id 本来就能存（[lesson](../../../.ai/lessons/sales-lines-accept-any-product-uuid.md)）。
- 官方 `LineItemDialog` 硬编码 `/api/catalog/products`、没有 injection spot、也没有注册组件替换句柄（平台只有
  `page:`/`data-table:`/`crud-form:`/`section:` 四种），按配置换不了，只能整页替换或 eject；eject 会把整条链的
  升级责任接过来（当初 `catalog` eject 就是因此被否），而本模块只要 6 个页面。
- 官方**新建**页 `/backend/sales/documents/create`（唯一强绑官方目录的创建流程）已隐藏；官方报价/订单**列表**
  （`/backend/sales/quotes`、`/backend/sales/orders`）同样只做 `navHidden`——`src/modules.ts` 把它们的
  `routes.pages` 条目改成 `{ metadata: { navHidden: true } }`，所以它们不进侧边栏，但 URL 仍可解析、平台视角还在。
  `config/sales`、渠道与价格相关页面不动。

## 两条平台行为，本模块必须照着做

1. **`sales.*.update` 不替换行**：它只 `applyDocumentUpdate` 抬头标量，行归各自的集合端点
   （`…lines.upsert`）。所以编辑 = 先改抬头、再逐行 upsert（带上行 id，才是更新而不是新增）、最后删掉被移除的行。
2. **所有 sales 命令（含行）锁的是「父单据」的版本**（`enforceSalesDocumentOptimisticLock`），而一次行写入会因重算合计
   而推进该版本。因此只有**一次**写可以携带操作员加载的版本：抬头的 PUT；其后的行写入由这一次抬头校验兜底。
   表单因此设置 `disableOptimisticLock`（平台文档正是为「锁定归子资源命令层」的表单提供该开关），并在抬头 PUT 上
   显式携带版本；保存成功后重新读取单据（否则同一次会话里的第二次保存会 409）。

## 行的三条引用（与采购链同构）

| 字段 | 含义 |
|---|---|
| `productId` | 自建商品主数据 id（**唯一权威**，选品器只给 `products` 的商品，且按当前组织收敛） |
| `productVariantId` | **桥接**：商品填了「官方目录链接」时，自动取其默认启用变体（`/api/catalog/variants`，响应是 snake_case）；否则留空。发货/海外仓收货按变体级入账，缺变体只能在履约环节被拒 |
| `catalogSnapshot` | 打印/展示快照（sku/name/spec），写入时冻结，商品改名不改写历史单据 |

## 与官方动态页的关系（2026-09-22 更正）

官方 `sales` 的**动态**页面（`/backend/sales/documents/[id]`、`quotes/[id]`、`orders/[id]`）此前在本机返回 404，
当时的记录把它们当成「平台/环境问题」——**那个结论是错的**：404 来自 `src/modules.ts` 里把这些 pathname
写成 `routes.pages: { ...: null }`，`null` 会把路由清单条目整条摘除。现已全部改成
`{ metadata: { navHidden: true } }`（仍不进侧边栏，URL 可解析），所以官方动态页可访问，官方列表的行内链、
通知深链（`sales.order.created` → `/backend/sales/orders/{id}` 等）都不再 404。详见
[`docs/dev/architecture.md`](../../../docs/dev/architecture.md) 的「官方 UI 的隐藏策略」。

本模块自己的新建/保存后跳转**仍然指向自己的编辑页**（`/backend/internal-sales/{quotes,orders}/[id]/edit`），
不依赖官方动态页——这是设计选择，不是绕开坏页面。

## 验证

```bash
yarn generate && yarn typecheck && yarn lint && yarn ds:check
# 冒烟（dev server 在跑时）：
#  UI 新建报价/订单（选自建商品 + 数量 + 未税单价）→ 201；落库行 productId=products_products.id、
#  有官方目录链接的商品 productVariantId 自动填默认变体、catalogSnapshot 有 sku/name/spec；
#  列表出现该单；行操作进入本模块编辑页；改数量保存 → PUT 抬头 200 + PUT …-lines 200，行 id 不变、引用与快照保留。
#  /backend/sales/documents/create 只做 `navHidden`：不在侧边栏，但 URL 仍可解析（不是 404）。
```

## 回滚

从 `src/modules.ts` 移除 `{ id: 'internal_sales', from: '@app' }` 并 `yarn generate`；本模块没有自己的表与迁移
（无 DDL 可回退），单据数据仍在官方 `sales_*` 表里，不受影响。同时把 `sales` 的 `routes.pages` 覆盖去掉即可恢复
官方新建页的侧边栏入口——该覆盖只改导航可见性，那些 URL 一直是可解析的。
