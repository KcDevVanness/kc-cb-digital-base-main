# `order_hub` — 订单工作台

app 自有模块。**以公司订单为根的一屏总览**：三类订单（对内销售 / 对外销售 / 采购）在同一张表上，
每行带四个填充阶段（采购 / 发运 / 单证 / 收汇·退税）与「只看待补」筛选。需求见
[`.ai/specs/2026-10-08-order-centric-entry.md`](../../../../.ai/specs/2026-10-08-order-centric-entry.md)
（Phase 4 / REQ-001、REQ-009、REQ-010）。

无实体、无迁移、无写路径：读四个来源并在浏览器合并，行操作只是跳转（详情 / hub / 全字段抽屉）。

## 表面

| 层 | 内容 |
|---|---|
| 页面 | `/backend/orders`（`navHidden`：入口只走导航树「公司订单 → 订单工作台」，路由仍可直达） |
| API | `GET /api/order_hub/stages?ids=<uuid,…>`（1–200 个，超限 400；`order_hub.view`） |
| 权限 | `order_hub.view`（`setup.ts` 默认授予 `superadmin`/`admin`；既有租户用 `yarn mercato auth sync-role-acls` 补授） |
| 共用件 | `@/lib/orders/purchaseOrderStatus`（采购状态徽章与文案映射，`purchasing` 的列表/详情与工作台共用；词条仍在 `purchasing` 的 i18n） |
| 单元 | `lib/__tests__/orderPending.test.ts`（待补判定 × 三类订单 × 终态；合并排序） |
| 集成 | `__integration__/stages.spec.ts`（构造两类订单 + 分摊 + 合同 + 单据 + 收汇 + 退税 → 断言计数/勾选；未知 id 与跨组织不出现；超限 400） |

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

跨模块读用**一次性 cast + 注释**声明投影表（`.ai/lessons/kysely-bare-handle-types-tables-away.md`），
不引入别的模块的实体。

## 工作台（`components/OrderWorkbench.tsx`）

- **四个来源**：对内销售 `GET /api/sales/orders?channelIds=<internal>`、对外销售（同理）、
  `GET /api/purchasing/purchase-orders`、`GET /api/order_hub/stages?ids=`；每源 `pageSize=50`、
  按 `created_at desc`，**在浏览器合并**（买方名是加密列，只有官方 API 能解密——服务端合并要么把密文
  发到前端，要么把解密搬进一个没人拥有的聚合路由）。
- **单源失败不影响其余**：每个来源独立 react-query；行内错误 + 重试。
- **合并与分页**：按 `createdAt desc` 排序、同 id 去重；「加载更多」取当前屏最旧那行所属来源的下一页；
  累计 300 行后改为提示收窄筛选。
- **筛选**：类型（全部/对内/对外/采购，经 DataTable 的筛选条）、状态（选项由当前已加载行派生，经同一套
  文案渲染）、单号搜索（服务端）、「只看待补」（`lib/orderPending.ts`：对内 = 未取消且
  `采购|发运|单证` 有 0 或未收汇；对外 = 未取消且 `发运|单证` 有 0；采购 = 非取消/已关闭且
  `发运|单证` 有 0 或未收汇或未退税）。
- **阶段单元格**：计数 > 0 → 链到 hub 对应分区 / 采购单详情；= 0 且有写权限 → 直达预填新建
  （`?orderKind=&orderId=`）；采购行的「采购」列恒 `—`。
- **新建入口**：按 `sales.orders.manage` / `purchasing.orders.manage` 显隐；chrome payload 未就绪时不隐藏
  （宁可多显示一个页面门禁本就会拦的按钮，也不隐藏调用方可能拥有的入口）。
- **「全字段」抽屉**：采购行读既有投影 `GET /api/export_finance/order-files?purchaseOrderId=&pageSize=1`
  分三组（订单 / 单证与文件 / 财务），每组标题右侧「去填写」链、页脚「在订单档案中打开」；销售行 = 抬头 +
  四分支计数，页脚「打开订单详情」。该组无权限（403）→ 组内无权限文案，其余组照常；读失败 → 抽屉内错误 +
  重试，列表不受影响。**不新增聚合 API**：35 个字段的口径只有 `export_finance` 一处。

## 规则（有意为之）

- **不在服务端合并列表**：见上（解密边界）。工作台只做展示与跳转，不复制任何模块的写路径。
- **落地页不变**：`/backend` 仍是仪表盘；工作台是导航树里的一个一级入口。
- **未标记贸易类型的历史销售单不列出**：与两个入口列表同口径，用
  `yarn mercato internal_sales backfill-trade-type --apply` 归类。
- **阶段投影不缓存**：一次屏幕一次读，缓存会让「刚补的那一步」看起来没生效。

## 验证

```bash
yarn jest --config jest.config.cjs src/modules/order_hub
yarn mercato test:integration order_hub-stages
yarn mercato auth sync-role-acls   # 既有租户补授 order_hub.view
```

浏览器：树里「公司订单 → 订单工作台」可进入；三类订单都列出且阶段列与订单 hub 一致；「只看待补」只剩有缺口
且未取消的订单；阶段为 0 的格子点击直达预填新建；新建按钮按 manage 功能位显隐；采购行「全字段」三组与
`/backend/export-finance/orders/<id>` 同值、无 `export_finance.orders.view` 时该组显示无权限文案；`/backend`
仍是仪表盘。

## 回滚

删除 `src/modules/order_hub/`、从 `src/modules.ts` 移除该模块、去掉 `nav_shell` 的
`NAV_TREE` 里「订单工作台」那一条。既有列表、hub、预填与权限位都不受影响。
