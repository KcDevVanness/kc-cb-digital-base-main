# `order_hub` — 订单工作台

app 自有模块。**以公司订单为根的一屏总览**：三类订单（对内销售 / 对外销售 / 采购）在同一张表上，
每行带四个填充阶段（采购 / 发运 / 单证 / 收汇·退税）。需求见
[`.ai/specs/2026-10-08-order-centric-entry.md`](../../../../.ai/specs/2026-10-08-order-centric-entry.md)
（Phase 4 / REQ-001、REQ-009、REQ-010）。

无实体、无迁移、无写路径：一个聚合路由在服务端读三个来源并合并分页，行操作只是跳转（详情 / hub / 全字段抽屉）。

## 表面

| 层 | 内容 |
|---|---|
| 页面 | `/backend/orders`（工作台，`navHidden`：入口只走导航树「公司订单 → 订单工作台」，路由仍可直达） |
| 页面 | `/backend/orders/<id>`（订单详情 hub，`navHidden`：由工作台行、采购单来源链接与旧详情 URL 的 301/307 进入） |
| API | `GET /api/order_hub/orders`（聚合列表，见下） |
| API | `GET /api/order_hub/stages?ids=<uuid,…>`（1–200 个，超限 400；`order_hub.view`） |
| 权限 | 工作台 `order_hub.view`；订单 hub `sales.order.view`（与其读的 `/api/sales/orders`、`/api/sales/order-lines` 同门禁）。`setup.ts` 默认授予 `superadmin`/`admin`；既有租户用 `yarn mercato auth sync-role-acls` 补授 `order_hub.view` |
| 共用件 | `@/lib/orders/purchaseOrderStatus`（采购状态徽章与文案映射，`purchasing` 的列表/详情与工作台共用；词条仍在 `purchasing` 的 i18n） |
| 单元 | `lib/__tests__/mergeOrders.test.ts`（跨源归并、去重、截断、分页切片、合计、两个行映射、`compareByCreatedAtDesc` 排序） |
| 集成 | `__integration__/order-hub-stages.spec.ts`（阶段投影）与 `__integration__/order-hub-aggregate.spec.ts`（聚合列表分页、合计、筛选、跨组织） |

## 聚合列表（`api/orders/route.ts` → 客户端 `lib/mergeOrders.ts`）

工作台不再在浏览器合并：**一个请求**打到聚合路由，路由把调用方的凭证原样转发给每个来源自己的列表路由——
`GET /api/sales/orders`（按贸易类型通道各一次）与 `GET /api/purchasing/purchase-orders`。解密因此留在拥有它的模块里
（买方名是加密列，只有 sales 的路由解密），本路由既不读对方表也不复制对方的过滤逻辑。

| 参数 | 口径 |
|---|---|
| `page` / `pageSize` | 页码 ≥1（默认 1）、每页 1–100（默认 20）；非法值 400 |
| `type` | `all`（默认）/ `internal` / `external` / `purchase`；只读选中的来源 |
| `status` | 可选，精确匹配合并行的 `status`（安装层销售列表没有状态过滤，故在窗口内过滤） |
| `search` | 可选，透传给各来源的列表路由 |

**扫描窗口**：每个来源按 `pageSize=100`、`created_at desc` 从第 1 页向上取，直到累计行数 ≥ `page * pageSize`、
该来源 `total` 用尽，或达到 `MAX_SCAN_PER_SOURCE = 500`。合并 = 按来源顺序展平 → 同 id 去重（保留先出现者）→
按 `createdAt desc` 排序 → 取前 `page * pageSize` 行；随后批量接一次阶段投影，再做 `status` 过滤，
最后 `slicePage`。**来源顺序是去重与同时间戳的稳定 tiebreak**，改动它会改变分页。

**`total` 口径（重要）**：不加 `status` 时是三个来源 `total` 的精确和；
加了任一过滤时只统计**扫描窗口内**命中的行数，是下界，需配合 `totalIsCapped`
（任一来源在自己的 `total` 前停下，或对端自己报了 `OM_LIST_COUNT_CAP`）——UI 用它提示「收窄筛选」。

**降级**：某个来源调用方无权读取（例如没有 `purchasing.orders.view`）或读取失败时，**不让整个响应失败**——
该来源不出行，名字进 `unavailableSources`，工作台在工具栏提示「部分来源不可用」；对端 401 则原样返回。

**ACL**：本路由 `order_hub.view`；每个来源是否可见由对端自己的功能位裁决（`sales.orders.view` /
`purchasing.orders.view`），本路由不代替它们授权。

## 阶段投影（`lib/orderStages.ts`）

一次请求按 id 批量读，每个阶段一次 scoped 查询（tenant + 组织及后代 + 软删过滤），因此**别的组织的
id 直接不出现**——响应不确认外部记录是否存在。

| 字段 | 口径 |
|---|---|
| `procurementCount` | 销售行：`source_sales_order_id = id` 且状态非 `cancelled` 的采购单数；采购行恒 0 |
| `shipmentCount` | 经销售分摊（销售行）或采购分摊（采购行）关联的**去重**发运单数，软删发运单不计 |
| `documentCount` | 该订单关联合同的 PI/CI + 税务发票数 + 其发运单的出口单证数 |
| `collected` | 销售行：任一关联采购单的收汇档案 `collection_status = 'received'`；采购行：本单自己的 |
| `refunded` | 任一关联发运单存在退税档案 |

跨模块读用**一次性 cast + 注释**声明投影表（`.ai/lessons/kysely-bare-handles-tables-away.md`），
不引入别的模块的实体。

## 工作台（`components/OrderWorkbench.tsx`）

- **一个取数**：`useQuery(['order-hub-orders', page, pageSize, type, status, search, scopeVersion])`
  打 `/api/order_hub/orders`；类型 / 状态 / 搜索都是请求参数，任一变更都会把页码重置为 1。
- **单源失败不影响其余**：由聚合路由的 `unavailableSources` 表达，行内错误 + 重试只重取这一个请求。
- **分页**：`DataTable` 用服务端的 `page / pageSize / total / totalPages`，页码可选 20 / 50 / 100；
  `totalIsCapped` 时工具栏展示「已到扫描上限」提示。
- **状态筛选选项**：租户的 `sales.order_status` 字典条目与采购状态枚举（`PURCHASE_ORDER_STATUSES`）的并集——
  不再由当前页的行派生（服务端分页后一页并不持有全部状态）。
- **阶段单元格**：计数 > 0 → 链到 hub 对应分区 / 采购单详情；= 0 且有写权限 → 直达预填新建
  （`?orderKind=&orderId=`）；采购行的「采购」列恒 `—`。
- **新建入口**：只有一个「新建订单」按钮，按 `sales.orders.manage` 显隐（chrome payload 未就绪时不隐藏，
  宁可多显示一个页面门禁本就会拦的按钮）；点击弹窗选贸易类型 → 对内 / 对外销售建单页。**采购单的建单入口
  在采购台账页与订单详情的采购分区，不在这里**（D7）。
- **「全字段」抽屉**：采购行读既有投影 `GET /api/export_finance/order-files?purchaseOrderId=&pageSize=1`
  分三组（订单 / 单证与文件 / 财务），每组标题右侧「去填写」链、页脚「在订单档案中打开」；销售行 = 抬头 +
  四分支计数，页脚「打开订单详情」。该组无权限（403）→ 组内无权限文案，其余组照常；读失败 → 抽屉内错误 +
  重试，列表不受影响。**不新增聚合 API**：35 个字段的口径只有 `export_finance` 一处。

## 订单详情 hub（`components/OrderDetail.tsx`，页面 `/backend/orders/<id>`）

订单为根的**唯一填写面**：抬头 + 明细行 + 五个后续分区（采购订单 / 发运单 / 购销合同 / 单据 /
收汇·退税），每个分区自带预填新建入口与「查看全部」台账链接。它是 `internal_sales` 旧 hub 的原样迁移
（共用件仍 `import` 自 `internal_sales/lib`，不复制）。

- **贸易类型来自单据数据，不来自路径**：读抬头（`GET /api/sales/orders?id=<id>&pageSize=1`）的
  `channelId`，用 `useTradeTypeChannels('order')` 的通道映射经 `tradeTypeFromChannelId` 判定；标记缺失或
  无法识别时按 `internal` 渲染（块内合同 kind 用 `internal_sales_order`）——与工作台同一口径。抬头读或
  通道映射未就绪时保持 loading，链接不会在首帧后翻转。
- **块锚点**：分区 `<section id>` 为 `purchasing` / `shipments` / `contracts` / `documents` / `money`，
  工作台行内的深链（`/backend/orders/<id>#purchasing` 等）因此可解析。
- **台账链接**：「查看全部」指向该分支的只读列表——采购 `/backend/purchasing/orders`、发运
  `/backend/cross_border/shipments`、合同 `/backend/trade-docs/contracts`、单据 `/backend/trade-docs/proformas`、
  收汇·退税 `/backend/export-finance/orders`。
- **写路径**：只写订单自己的状态（确认 / 作废），走 `internal_sales/lib/salesStatusWrite.ts`——与列表同一个
  写实现；其余一律交给各自模块的命令。
- **失败隔离**：每个分区独立 react-query，某分区读失败只在该分区显示错误 + 重试，其余照常。
- **门禁**：`sales.order.view`（与旧 hub 相同）；页面 `navHidden`，不进树。

## 规则（有意为之）

- **服务端合并，凭证转发**：聚合路由调用各来源自己的列表路由（而非读它们的表），买方名始终在 sales 模块内解密，
  加密列不会以密文形态跨到前端或本模块；来源的过滤逻辑只有一份。
- **`total` 是精确时精确、过滤时是下界**：见上表；UI 用 `totalIsCapped` 说明何时该收窄筛选。
- **落地页不变**：`/backend` 仍是仪表盘；工作台是导航树里的一个一级入口。
- **未标记贸易类型的历史销售单不列出**：与两个入口列表同口径，用
  `yarn mercato internal_sales backfill-trade-type --apply` 归类。
- **阶段投影不缓存**：一次屏幕一次读，缓存会让「刚补的那一步」看起来没生效。

## 验证

```bash
yarn jest --config jest.config.cjs src/modules/order_hub
yarn mercato test:integration order_hub-stages
yarn mercato test:integration order_hub-aggregate
yarn mercato auth sync-role-acls   # 既有租户补授 order_hub.view
```

浏览器：树里「公司订单 → 订单工作台」可进入；底部是页码控件、翻页内容变化、`共 N 条` 与接口 `total` 一致；
类型 / 状态 / 关键词任一变更只发一次聚合请求；三类订单都列出且阶段列与订单 hub 一致；
阶段为 0 的格子点击直达预填新建；「新建订单」按 manage 功能位显隐、弹窗选贸易类型后进入对应建单页；
采购行「全字段」三组与 `/backend/export-finance/orders/<id>` 同值、无 `export_finance.orders.view` 时该组显示
无权限文案；`/backend` 仍是仪表盘。

## 回滚

删除 `src/modules/order_hub/`、从 `src/modules.ts` 移除该模块、去掉 `nav_shell` 的
`NAV_TREE` 里「订单工作台」那一条。既有列表、hub、预填与权限位都不受影响。
