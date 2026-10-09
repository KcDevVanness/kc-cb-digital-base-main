# `order_hub` — 公司订单（根单 + 订单工作台 + 详情 hub）

app 自有模块。**公司订单是一个真表**：`order_hub_company_orders`（根记录：编号/标题/下单日期/预计交货/状态/备注）
+ `order_hub_company_order_links`（关联表：`kind` ∈ `internal_sales_order` / `external_sales_order` /
`purchase_order`，带冻结快照）。订单工作台每行 = 一张公司订单，点进 `/backend/orders/<companyOrderId>`；详情页按
**购销合同的方式**给出「关联已有 / 预填新建」：对内/对外销售订单与采购订单是三个可写关联区块，下游（购销合同 /
单据 / 发运单 / 装箱单 / 收汇·退税）按关联子单的**并集只读**展示。需求与验收见
[`.ai/specs/2026-10-09-company-order-root.md`](../../../../.ai/specs/2026-10-09-company-order-root.md)（取代
`2026-10-08-order-centric-entry.md` 的工作台/详情口径）。

> 为什么不是「聚合列表」：2026-10-09 owner 反馈——工作台此前是 sales/purchase 两张既有列表的 UI/服务端聚合，
> 行身份是**别人的单据**（采购行点开就是采购单模块页），也无法像合同页那样把不同模块的数据关联式填入同一张单；
> 本模块因此改为「新表存数据 + 表间关联」。

## 表面

| 层 | 内容 |
|---|---|
| 实体（`data/entities.ts`） | `CompanyOrder` → `order_hub_company_orders`（唯一键 `(tenant_id, organization_id, number)`；`number = CO-<年>-<4位>` 在创建时发号、撞唯一键重试一次）；`CompanyOrderLink` → `order_hub_company_order_links`（唯一键 `(company_order_id, kind, ref_id)`；`ref_number`/`ref_counterparty`/`ref_snapshot` 在关联时冻结）。迁移 `migrations/Migration20261009024200_order_hub.ts`（**只建这两张表 + 索引/唯一键/FK**） |
| API | `GET\|POST\|PUT\|DELETE /api/order_hub/orders`（`makeCrudRoute`：列表筛选 `search`（公司订单号/标题/子单号）/`status`/`kind`/`id`/`ids`，服务端分页与排序；`?id=` 即详情）；`GET\|POST /api/order_hub/orders/links`（GET 按 `companyOrderId` 或 `refId` 读关联——`refId` 是旧 URL 的反查；POST = 成套替换）；`POST /api/order_hub/orders/link-child`（幂等挂一张子单；销售类无目标时自动建根）；`GET /api/order_hub/stages?ids=`（工作台的一次批量汇总：四阶段计数 + `counterparty`/`childNumbers`/`kinds`；ids 为公司订单 id，1–200） |
| 命令 | `order_hub.orders.create\|update\|delete`（可撤销、乐观锁、软删）、`order_hub.orders.links.replace`（成套替换：跨组织/未知引用 422、重复 422、过期版本 409、非撤销型）、`order_hub.orders.link-child`（幂等：唯一键兜底；`purchase_order` 无目标 → 422 `company_order_required`） |
| CLI | `yarn mercato order_hub backfill-company-orders [--apply] [--tenant=] [--organization=]`——按 `(tenant, organization)` 扫描带贸易类型渠道的销售单，1:1 建根并冻结快照；再把带 `source_sales_order_id` 的采购单挂到对应根。dry-run 默认、幂等（重跑 `created=0`）、跨组织边界由 scope 决定 |
| 页面 | `/backend/orders`（工作台，`navHidden`：入口走导航树「公司订单 → 订单工作台」）；`/backend/orders/create`、`/backend/orders/<id>/edit`（CrudForm，`navHidden`）；`/backend/orders/<id>`（详情 hub，`navHidden`，同时承担旧销售单 URL 的解析落点） |
| 权限 | 读 `order_hub.view`（工作台/hub/links/stages）；写 `order_hub.manage`（CRUD、关联替换、link-child、create/edit 页）。`setup.ts` 默认授予 `superadmin`/`admin`；既有租户用 `yarn mercato auth sync-role-acls` 补授 `order_hub.manage` |
| 事件 | `order_hub.company_order.created\|updated\|deleted`、`order_hub.company_order.links.updated`（`clientBroadcast`） |
| 共享件 | `src/lib/related/RelatedSection.tsx`（区块壳）、`src/lib/quick-edit/QuickEditDialog.tsx`（下游区块就地编辑，字段工厂仍在各模块 `lib/*QuickEdit.ts`）、`src/lib/orders/companyOrderParams.ts`（`?companyOrderId=` 解析，两个建单表单共用）、`internal_sales` 的贸易类型通道解析（`lib/tradeTypeChannelIds.ts` / `tradeTypeChannels.server.ts`） |
| 单元 | `lib/__tests__/companyOrder.test.ts`、`lib/__tests__/companyOrderResolve.test.ts`、`commands/__tests__/companyOrders.test.ts` |
| 集成 | `__integration__/company-orders.spec.ts`（CRUD/搜索/状态/kind/跨组织/祖先组织可见）、`company-order-links.spec.ts`（替换+快照+幂等+自动建根+反查+汇总口径）、`company-order-backfill.spec.ts`（CLI dry-run/apply/重跑） |

## 工作台（`components/OrderWorkbench.tsx`）

- 一次取数：`GET /api/order_hub/orders`（分页/筛选）+ 一次 `GET /api/order_hub/stages?ids=`（本页行的四阶段计数与
  子单事实）。筛选任一变化重置页码；`?type=internal|external|purchase`（旧列表 URL 的 307 带过来的）映射到
  `kind=internal_sales_order|external_sales_order|purchase_order`。
- 列：编号（链到 hub）/ 子单号（冻结的 `ref_number` 并集）/ 对方（**优先销售子单的买方**，否则采购子单的供应商）
  / 下单日期 / 状态（`order_hub` 常量徽章）/ 采购·发运·单证·收汇退税四格（>0 与 =0 都链到 hub 对应锚点，hub 有
  新建入口）/ 行操作「打开」与「全字段」。
- 「全字段」抽屉：有关联采购子单 → 读第一张采购子单的 `GET /api/export_finance/order-files` 投影（订单/单证与文件/
  财务三组，任一组 403 只在组内提示）；否则为公司订单抬头 + 子单号 + 四计数。
- 「新建订单」→ `/backend/orders/create`（按 `order_hub.manage` 显隐；chrome payload 未就绪时不隐藏）。

## 详情 hub（`components/OrderDetail.tsx`，`/backend/orders/<companyOrderId>`）

- 抬头卡（编号/标题/下单/预计交货/状态 + 编辑）+ 八个区块，锚点 `internal-orders` / `external-orders` /
  `purchasing` / `contracts` / `documents` / `shipments` / `packing-lists` / `money`（后六个沿用旧 hub 的 id，
  工作台深链可继续解析）。
- **三个可写关联区块**（对内/对外销售订单、采购订单）：行来自 `GET /api/order_hub/orders/links?companyOrderId=&kind=`，
  显示冻结快照；「打开」→ 销售单编辑页（`/backend/{internal,external}-sales/orders/<refId>/edit`）/ 采购单详情页；
  「移除」= 用当前 `updatedAt` 做一次成套替换；「关联…」打开 `CompanyOrderLinkDialog`（成套替换、保存带版本、409 走
  平台冲突条并重读、跨组织/未知 422）；「新建」带 `?companyOrderId=`（采购单在恰有一张销售子单时另带
  `&orderKind=&orderId=`，让来源锚一起写）。
- **五个下游只读区块**（合同/单据/发运/装箱/收汇·退税）：按**子单集合并集**读各模块既有 API（每个子单一次，按 id
  去重，子单数上限 20，超出在区块尾部提示）；每区块独立 query、独立 loading/error(+重试)；下游行沿用
  `QuickEditDialog` 就地改头部字段；「新建」的目标子单解析：无子单时禁用并提示，恰一个直连，多个先弹选择器。
  「查看全部」：恰一个相关子单时带该子单过滤，否则落到不带过滤的台账页（单值过滤表达不了并集）。
- **失败隔离**：某区块读失败只在该区块显示错误 + 重试，其余照常。

## 关联与预填（写入闭环）

- **关联的唯一事实来源**是本模块的关联表：成套替换（对话框）与单条幂等挂载（建单表单）都写
  `order_hub_company_order_links`，快照在关联时冻结（对端改名不回写；对端被硬删时冻结值仍显示、实时读自然为空）。
- `?companyOrderId=` 已接入 `internal_sales`（对内/对外同一表单）与 `purchasing` 的新建表单：保存成功后调用
  `POST /api/order_hub/orders/link-child`，再落到公司订单页（采购单带 `#purchasing`）。关联调用失败**不阻断已创建的
  单据**：仍落到公司订单页并给出警告闪讯；参数非法 → 行内提示并忽略。销售类子单在**没有** `companyOrderId` 时
  由 `link-child` 自动建一张草稿根（报价→订单、直接访问建单页等旧入口因此不悬空）。
- **旧 URL 归位**（`lib/companyOrderResolve.ts`）：`/backend/orders/<salesOrderId>`（老通知/收藏/采购来源链接/旧列表
  重定向）先按公司订单 id 读，读不到则用 `orders/links?refId=` 反查并 `replace` 到公司订单页；仍找不到时显示
  「该单据尚未关联公司订单」状态，给「新建公司订单并关联」（按销售单渠道推导 kind 后 `link-child`）与「关联到已有
  公司订单」两个入口，不留 404 空白。

## 补录（升级步骤）

```bash
yarn mercato order_hub backfill-company-orders              # dry-run：打印每个 scope 的待建/跳过计数与样例
yarn mercato order_hub backfill-company-orders --apply      # 幂等落库；重跑 created=0
```

- 只处理**带贸易类型渠道**的销售单（与两个销售入口列表同口径）；未标记的历史单先用
  `yarn mercato internal_sales backfill-trade-type --apply` 归类，再跑本命令。
- 同一笔生意的对内 + 对外两张销售单会各自生成一张根（1:1）；合并靠详情页的「关联…」成套替换把子单搬到同一根下。
- 新迁移在部署时应用（本机 dev 由 dev supervisor 在下次 `yarn dev` 应用）；**迁移 + `--apply` 之前工作台是空的**。

## 规则（有意为之）

- **根单不持有业务数据**：客户/币种/金额/明细仍在销售单与采购单里；根单只持有编号/标题/日期/状态/备注与关联。
- **无跨模块 ORM 关系**：对端一律标量 id + 冻结快照；跨模块读是 scoped 只读投影（列名本地声明，见
  `lib/orderStages.ts` 与 lesson `kysely-bare-handle-types-tables-away`）。
- **销售单对方名的解密**：`sales_orders.customer_snapshot` 是加密列，关联快照必须走
  `findWithDecryption` 读（`lib/companyOrder.ts`），直读 SQL 会把密文冻结进快照。
- **写缓存**：关联集合与订单列表是两类缓存资源，命令提交后两者都显式失效（含补录 CLI——它不经过请求路径）。
- **状态是模块常量**（`draft` / `in_progress` / `completed` / `cancelled`），不是销售引擎的字典：根单状态是操作员
  自己的标记；子单状态仍归各自引擎/模块。
- **未标记贸易类型的销售单不出现在工作台**（与两个销售入口列表同口径）。

## 验证

```bash
yarn jest --config jest.config.cjs src/modules/order_hub
JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral company-orders
JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral company-order-links
JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral company-order-backfill
yarn mercato auth sync-role-acls   # 既有租户补授 order_hub.manage
```

浏览器（2026-10-09 实测，ephemeral 环境）：工作台行=公司订单（`CO-…`，子单号/对方/四阶段列）；点行进
`/backend/orders/<companyOrderId>`；「关联…」成套替换后区块与工作台计数同步；hub 三个「新建」带
`?companyOrderId=` 且保存后自动关联并跳回（采购单 `#purchasing`）；旧 `/backend/orders/<salesOrderId>` 归位；
「未关联」态可一键建根并关联；暗色与窄屏（390×844）正常；对话框 Esc 关闭。

## 回滚

回退本次改动即恢复旧实现所需的全部文件已随本 PR 删除（`lib/mergeOrders.ts` 与旧聚合路由）；两张新表可保留
（不被旧逻辑读取），如需彻底清理：先删 `order_hub_company_order_links` 再删 `order_hub_company_orders`。
