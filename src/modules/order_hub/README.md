# `order_hub` — 公司订单（根单 + 订单工作台 + 详情 hub）

app 自有模块。**公司订单是一个真表**：`order_hub_company_orders`（根记录：编号/标题/下单日期/预计交货/状态/是否已收款/备注）
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
| 实体（`data/entities.ts`） | `CompanyOrder` → `order_hub_company_orders`（唯一键 `(tenant_id, organization_id, number)`；`number = CO-<年>-<4位>` 在创建时发号、撞唯一键重试一次；**默认客户/供应商** 4 列：`customer_party_id`/`customer_snapshot`、`supplier_id`/`supplier_snapshot`，可清空）；`CompanyOrderLink` → `order_hub_company_order_links`（唯一键 `(company_order_id, kind, ref_id)`；`ref_number`/`ref_counterparty`/`ref_snapshot` 在关联时冻结）；`CompanyOrderCollaborator` → `order_hub_company_order_collaborators`（唯一键 `(company_order_id, organization_id)`，协作组织白名单）；`CompanyOrderDocument` → `order_hub_company_order_documents`（第七轮：唯一键 `(company_order_id, slot, attachment_id)`；行 id 即附件 `recordId`）。迁移 `Migration20261009024200_order_hub.ts`（两新表）+ `Migration20261009044102_order_hub.ts`（4 列追加）+ `Migration20261009051049_order_hub.ts`（协作表）+ `Migration20261009064750_order_hub.ts`（`payment_status` 列 + `status` 列默认值 `placed`）+ `Migration20261009073318_order_hub.ts`（第七轮：槽位表） |

| API | `GET\|POST\|PUT\|DELETE /api/order_hub/orders`（`makeCrudRoute`：列表筛选 `search`（公司订单号/标题/子单号）/`status`/`kind`/`id`/`ids`，服务端分页与排序；scope = **显式可见 id 集**：我的组织集 ∪ 我协作的根单）；`GET\|POST /api/order_hub/orders/links`（GET 按 `companyOrderId` 或 `refId` 读关联——`refId` 是旧 URL 的反查；POST = 成套替换）；`POST /api/order_hub/orders/link-child`（幂等挂一张子单；销售类无目标时自动建根）；`GET\|POST /api/order_hub/orders/collaborators`（协作组织读取/成套替换，仅所有者）；`GET /api/order_hub/orders/fields?companyOrderId=`（第五轮：35 列只读汇总；不可见根 → `{}`，不 404）；`GET /api/order_hub/orders/attachments?companyOrderId=` + `GET /api/order_hub/orders/attachments/<id>[?download=1]`（第五轮：文件名/元数据列表与字节代理，按**根单可见性**授权，头与 installed 文件路由一致）；`GET\|POST\|DELETE /api/order_hub/orders/documents`（第七轮：槽位列表/登记/删除，写仅所有者；上传本体走 installed）；`GET /api/order_hub/stages?ids=`（工作台的一次批量汇总：四阶段计数 + `counterparty`/`childNumbers`/`kinds`/`amounts`（第五轮按币种追加）；ids 为公司订单 id，1–200） |

| 命令 | `order_hub.orders.create\|update\|delete`（可撤销、乐观锁、软删；create 可带 `links[]` 与默认客户/供应商，同事务落库）、`order_hub.orders.links.replace`（成套替换 + **移动**语义：子单只属于一张公司订单）、`order_hub.orders.link-child`（幂等）、`order_hub.orders.collaborators.replace`（仅所有者、成套替换、根版本乐观锁；协作者写其它字段 422 `collaborator_field_not_allowed`，owner-only 动作 403 `company_order_owner_required`）、`order_hub.orders.documents.attach\|detach`（第七轮：槽位文件登记/移除，仅所有者、可撤销、发 `order_hub.company_order.documents.updated` 并失效关联缓存） |
| CLI | `yarn mercato order_hub backfill-company-orders [--apply] [--tenant=] [--organization=]`——按 `(tenant, organization)` 扫描带贸易类型渠道的销售单，1:1 建根并冻结快照；再把带 `source_sales_order_id` 的采购单挂到对应根。dry-run 默认、幂等（重跑 `created=0`）、跨组织边界由 scope 决定 |
| 页面 | `/backend/orders`（工作台，`navHidden`：入口走导航树「公司订单 → 订单工作台」）；`/backend/orders/create`、`/backend/orders/<id>/edit`（CrudForm，`navHidden`）；`/backend/orders/<id>`（详情 hub，`navHidden`，同时承担旧销售单 URL 的解析落点） |
| 权限 | 读 `order_hub.view`（工作台/hub/links/stages）；写 `order_hub.manage`（CRUD、关联替换、link-child、create/edit 页）。**协作组织**的写只放开 `status`/`notes`（服务端白名单），其余 owner-only。`setup.ts` 默认授予 `superadmin`/`admin`；既有租户用 `yarn mercato auth sync-role-acls` 补授 `order_hub.manage` |
| 事件 | `order_hub.company_order.created\|updated\|deleted`、`order_hub.company_order.links.updated`（`clientBroadcast`） |
| 共享件 | `src/lib/related/RelatedSection.tsx`（区块壳）、`src/lib/quick-edit/QuickEditDialog.tsx`（下游区块就地编辑，字段工厂仍在各模块 `lib/*QuickEdit.ts`）、`src/lib/attachments/AttachmentsSection.tsx`（文件区块壳，app 级共享；第五轮起可用 `listHref`/`fileHref` 指向调用方自己的路由，默认仍是 installed 的 `/api/attachments`）、`src/lib/orders/companyOrderParams.ts`（`?companyOrderId=` 解析，两个建单表单共用）、`internal_sales` 的贸易类型通道解析（`lib/tradeTypeChannelIds.ts` / `tradeTypeChannels.server.ts`） |
| 单元 | `lib/__tests__/companyOrder.test.ts`、`lib/__tests__/companyOrderResolve.test.ts`、`commands/__tests__/companyOrders.test.ts`、`components/__tests__/companyOrderOptions.test.ts`（选项合并/回退过滤） |
| 集成 | `__integration__/company-orders.spec.ts`（CRUD/搜索/状态/kind/跨组织/祖先组织可见）、`company-order-links.spec.ts`（替换+快照+幂等+自动建根+反查+汇总口径+**移动**）、`company-order-backfill.spec.ts`（CLI dry-run/apply/重跑）、`company-order-create-fields.spec.ts`（建单带默认客户/供应商与 `links[]`）、`company-order-collaborators.spec.ts`（协作可见/字段白名单/成套替换/409）、`company-order-files.spec.ts`（附件上传/列表/删除）、`company-order-fields.spec.ts`（35 列汇总/币种分组/不可见根空对象）、`company-order-attachment-access.spec.ts`（所有者/协作/无关三视角的列表与字节）、`company-order-documents.spec.ts`（第七轮：槽位登记/列表/代理下载/重复 409/删除/协作只读/无关组织） |

## 工作台（`components/OrderWorkbench.tsx`）

- 一次取数：`GET /api/order_hub/orders`（分页/筛选）+ 一次 `GET /api/order_hub/stages?ids=`（本页行的四阶段计数与
  子单事实）。筛选任一变化重置页码；`?type=internal|external|purchase`（旧列表 URL 的 307 带过来的）映射到
  `kind=internal_sales_order|external_sales_order|purchase_order`。
- 列（第八轮起 = **根单自己的字段**，与详情页抬头卡同序）：编号（链到 hub，协作行带「协作」徽标）/ 标题 / 下单日期 /
  预计交货 / 状态（`order_hub` 常量徽章）/ 是否已收款（第六轮字段：`paid_full`/`unpaid` 标签，历史行 `—`）/ 默认客户 / 默认供应商（根单冻结的 `{name}` 快照，无则 `—`）/ **金额**
  （第五轮：`stages.amounts`，按币种显示销售金额，无销售子单时显示采购金额；`—` 表示无） / 采购·发运·单证·收汇退税四格（>0 与 =0 都链到 hub 对应锚点，hub 有
  新建入口）/ 行操作「打开」与「全字段」。**子单号与「对方」不再成列**：子单事实（冻结单号、对端名）归详情页的关联
  区块；搜索仍按子单号命中根单（服务端 `search` 覆盖）。
- 「全字段」抽屉（第五轮重写）：读 `GET /api/order_hub/orders/fields?companyOrderId=` 的公司订单级汇总，四组——
  **订单**（编号/标题/状态/子单号）、**金额与日期**（按币种的销售/采购/定金/已付/应付 + 下单/预计交货/出运）、
  **单证与文件**（按 kind 的单号、INV.NO、按 `doc_type` 的发运单证计数、采购水单与发票条数）、**财务**（收汇状态与
  涉外收入证明、退税状态与金额、KC 盖章）；只读，缺失显示 `—`，整块失败在抽屉内提示 + 重试。
- 「新建订单」→ `/backend/orders/create`（按 `order_hub.manage` 显隐；chrome payload 未就绪时不隐藏）。

## 详情 hub（`components/OrderDetail.tsx`，`/backend/orders/<companyOrderId>`）

- 抬头卡（编号 + 标题副标题 + 下单/预计交货/备注/是否已收款/客户/供应商 六格 + 编辑；动作区只留 编辑 / 协作组织，
  协作者为「修改状态与备注」——「全字段」是**工作台行操作**，详情页本身就是填写面，不再重复入口），区块按**业务板块**
  分组（与 nav_shell 导航树同构）：采购（`purchasing`）→ 出口销售（`sales`）→ 合同与单据（`contracts` / `documents`）→
  发运与装箱（`shipments` / `packing-lists`）→ 收汇·退税（`money`）→ 文件（`files`）；`#purchasing`/`#contracts`/
  `#documents`/`#shipments`/`#packing-lists`/`#money`/`#files` 沿用，`#internal-orders`/`#external-orders` 退役
  （对内/对外合并为一个「销售订单」区块）。
- **两个可写关联区块**（销售订单 = 对内 + 对外两个 kind 的合并列表，行带 对内/对外 徽标；采购订单）：行来自
  `GET /api/order_hub/orders/links?companyOrderId=`（一次读全量，按 kind 渲染）显示冻结快照；行号「点开」= 右侧
  **只读预览抽屉**（打开时按 id 现场读该单据）；「编辑」→ 模块自己的页面（销售单/采购单的编辑页，带 `?returnTo=`
  回到本页）；「移除」= 用当前 `updatedAt` 做一次成套替换；「关联…」打开 `CompanyOrderLinkDialog`（销售区块在对话框
  内选 对内/对外，成套替换、保存带版本、409 走平台冲突条并重读、跨组织/未知 422）；「新建」带 `?companyOrderId=`
  （采购单在恰有一张销售子单时另带 `&orderKind=&orderId=`，让来源锚一起写；销售区块先在对话框里选类型）。
- **预览抽屉**（`components/LinkedRecordPreviewDrawer.tsx` + `linkedRecordPreviewSources.tsx`）：所有区块的行「点开」
  都走它——复用 app 级 `SourcePreviewDrawer`，按 kind（销售/采购/合同/PI·CI/税务发票/发运单/装箱单/收汇/退税）各自
  读一条并映射为只读字段，缺失字段显示「—」；抽屉底部「编辑」才离开本页（带 `?returnTo=`），读失败在抽屉内给重试。
- **返回本页**：hub 生成的所有跳转链接都带 `returnTo=<本页>`，目标模块页面用共享件
  `src/lib/navigation/returnTo.ts` 的 `useReturnHref()` 作为自己的「返回」链接（白名单：仅 `/backend/` 开头、
  无空白/控制字符的同站路径，非法值回退各模块默认台账）。
- **子单行的状态徽标**：有状态才渲染（销售走销售字典、采购走采购词表、未知码回原值）；无状态的行**不渲染徽标**——
  本开发库 9 张销售单里 8 张没有状态，只写「—」的徽章不承载信息（owner 2026-10-09 复查）。纯函数在
  `components/companyOrderChildStatus.ts`，单测 `components/__tests__/companyOrderChildStatus.test.ts`。
- **五个下游只读区块**（合同/单据/发运/装箱/收汇·退税）：按**子单集合并集**读各模块既有 API（每个子单一次，按 id
  去重，子单数上限 20，超出在区块尾部提示）；每区块独立 query、独立 loading/error(+重试)；行号「点开」同样走预览
  抽屉，合同/单据/发运仍保留 `QuickEditDialog` 就地改头部字段；「新建」的目标子单解析：无子单时禁用并提示，恰一个
  直连，多个先弹选择器（都带 `returnTo`）。「查看全部」：恰一个相关子单时带该子单过滤，否则落到不带过滤的台账页
  （单值过滤表达不了并集）。
- **单据字段槽位**（第七轮）：`components/OrderDocumentsSection.tsx` 在 `#documents` 板块下逐槽位一行（本单文件
  chips + 该行独立上传 + 子单来源信号），数据来自 `GET /api/order_hub/orders/documents`；通用文件区仍在其下
  （「其他文件」）。详见「第七轮」节。
- **失败隔离**：某区块读失败只在该区块显示错误 + 重试，其余照常。

## 关联与预填（写入闭环）

- **关联的唯一事实来源**是本模块的关联表：成套替换（对话框）与单条幂等挂载（建单表单）都写
  `order_hub_company_order_links`，快照在关联时冻结（对端改名不回写；对端被硬删时冻结值仍显示、实时读自然为空）。
- `?companyOrderId=` 已接入 `internal_sales`（对内/对外同一表单）与 `purchasing` 的新建表单：保存成功后调用
  `POST /api/order_hub/orders/link-child`，再落到公司订单页（采购单带 `#purchasing`）。关联调用失败**不阻断已创建的
  单据**：仍落到公司订单页并给出警告闪讯；参数非法 → 行内提示并忽略。销售类子单在**没有** `companyOrderId` 时
  由 `link-child` 自动建一张根（已下单 / 未收款；报价→订单、直接访问建单页等旧入口因此不悬空）。
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

## 第四轮：起手信息、协作组织与文件（2026-10-09）

- **建单抓起手信息**：`/backend/orders/create` 增加 默认客户（`parties` buyer 选项源）、默认供应商（`purchasing/suppliers`）与「关联已有单据」两个搜索多选（销售单按贸易类型通道、采购单）；保存时 `links[]` 与根单**同一事务**落库（未知/跨组织 422）。默认客户/供应商只是**录入默认**，子单创建后各自持有真源；经 `?companyOrderId=` 进入 `internal_sales`/`purchasing` 新建表单时按这两个默认预填（字段为空才填）。
- **协作组织白名单**：根单详情页「协作组织」对话框（组织多选、排除自身组织、成套替换 + 版本锁）；被加入的组织**可见**该根单（工作台带「协作」徽标、hub 只读），且只能通过「修改状态与备注」写 `status`/`notes`（服务端白名单，其余字段 422；`delete`/关联/协作维护等 owner-only 动作 403）。读路径说明：列表 scope 是**显式可见 id 集**（我的组织集 ∪ 我协作的根单）——用 id 集而非 `$or`，因为引擎在「顶层 `id` 过滤 + `$or`」并存时 OR 组不再匹配。
- **文件区块**：hub 的「文件」区块复用 installed `attachments`（表单域 `entityId='order_hub:company_order'`、`recordId=根单 id`），上传/列表/预览/下载/删除；共享壳 `src/lib/attachments/AttachmentsSection.tsx`（app 级，只做展示与调用，权限仍由 attachments 的路由裁决）。未拆细的水单/证明/盖章件先挂这里，后续逐个拆到模块时再迁移。注意 attachments 自带组织作用域：**协作组织看不到所有者组织名下的文件**——第五轮已用本模块的列表/字节代理路由解决（见下节）。
- **一个子单只属于一张公司订单**：`create.links[]` 与 `links.replace` 会把已在其它根上的子单**移动**过来（同事务删旧关联并失效其缓存）；`link-child` 带显式目标沿用幂等（返回现有根）。

## 第五轮：35 列汇总、附件协作可见与草稿单据可选（2026-10-09）

- **35 列汇总到公司订单视角**：新只读投影 `lib/companyOrderFields.ts`（跨模块 scoped 读，照 `lib/orderStages.ts` 的方法；每次读都带 `tenant_id` + 组织集，协作根额外并入所有者组织做纵深防御）→ `GET /api/order_hub/orders/fields?companyOrderId=`。金额**一律按币种分组**（销售/采购/定金/已付/应付，应付口径用采购模块的 `derivePaymentState`，绝不做跨币种加总）；日期（下单/预计交货/出运=关联发运单最早 `departed_at`，缺失取里程碑最新一条）；单据按 kind 的单号 + INV.NO（`commercial`）；发运单证按 `doc_type` 计数与最近单号/附件在否；采购水单及发票条数（installed `attachments` 按 `purchasing:purchase_order` / `purchasing:purchase_payment` 计数）；收汇（状态 + 涉外收入证明）、退税（状态 + 金额）、KC 盖章（合同的 `attachment_id`）。不可见根返回 `{}`（不 404，不确认他组织 id 存在）。`stages` 追加 `amounts`（工作台金额列用），全部只增不改。
- **附件协作可见**：`GET /api/order_hub/orders/attachments?companyOrderId=`（列表）与 `GET /api/order_hub/orders/attachments/<id>[?download=1]`（字节代理，复用 `StorageDriverFactory`，头/文件名/CSP/缓存策略与 installed 文件路由逐项一致）。授权 = **根单可见性**（所有者组织或协作组织；无关组织列表空、字节 404）；列表行只按 tenant + `entity_id='order_hub:company_order'` + `record_id=根单` 读（installed 的组织作用域正是协作组织看不到文件的原因）。hub 文件区块改走本模块两条路由（`AttachmentsSection` 新增 `listHref`/`fileHref` 可选属性，其它调用方行为不变）；**上传/删除仍走 installed `POST/DELETE /api/attachments` 且只对所有者显示**——协作组织的写被 installed 的 `attachments.manage` 挡下（403）；若给协作组织补授 `attachments.manage`，installed 的上传会把行写在其**自己组织**下，不会进入所有者的文件列表（UI 因此始终对协作组织隐藏上传入口）。字节路由的沙箱 CSP（`default-src 'none'; sandbox`）在 `next.config.ts` 里与 installed 文件路由一样**单独豁免**全站 CSP——不豁免会被 `/:path*` 规则覆盖（实测踩过，见 run record）。
- **草稿单据可选**：`companyOrderOptions.mergePurchaseOrderCandidates` 把「无 search 的第 1 页」与「带 search 的第 1 页」合并去重，再按 单号 / 供应商名 / 打印标签（无号草稿的标签带 id 前缀）客户端过滤、单号全等优先——**无号草稿**因此可以在建单表单与关联对话框里被搜到；空输入不报错。

## 第六轮：订单状态词表与「是否已收款」（2026-10-09）

owner 在 `/backend/orders/create` 的口径（两件，均按 owner 原话落地）：

- **订单状态 = 7 个业务阶段**（生命周期序）：已下单 `placed` → 生产 `in_production` → 工厂提货 `factory_pickup` → 已报关
  `customs_declared` → 已装运 `shipped` → 路上 `in_transit` → 到仓库 `warehoused`。新建默认 `placed`；DB 列默认同步为
  `placed`（迁移 `Migration20261009064750_order_hub.ts`，**不回填**既有行）。
- **旧词表只退役出选择器**：`draft`/`in_progress`/`completed`/`cancelled` 仍是合法存储值（`COMPANY_ORDER_STORED_STATUSES`），
  校验/筛选/i18n/徽章都在；编辑表单与「修改状态」用 `companyOrderStatusOptions(当前值)`（当前词表 + 该行旧值）。
  补录 CLI 对历史销售单为 `draft`/`cancelled` 时保留其原义标签。
- **「是否已收款」**（`payment_status`，`paid_full`=已收全款 / `unpaid`=未收款）：建单/编辑表单可选（建单默认 `unpaid`），
  hub 抬头卡显示；列可空——迁移前的行显示「—」。命令三态：缺席=默认 `unpaid`（仅 create）、显式 `null`=清空为「—」、
  有值=写入。协作组织写该字段 422（白名单不含它）。
- 单位/集成：`data/__tests__/validators.test.ts`（词表 + 三态）、`__integration__/company-orders.spec.ts`（默认值、旧值可写可读可筛、
  `shipped`+`paid_full` 更新）。
## 第七轮：字段级附件槽位（一字段一附件位）（2026-10-09，owner 反馈）

- **一句话**：第五轮的文件区是一个**笼统上传框**，与 35 列的每个单据字段没有一一对应；本轮给**每个单据字段一个槽位**，「哪个字段挂哪张文件」由本模块的表回答。
- **表**：`order_hub_company_order_documents`（一行 = 一个槽位文件）：`id`（**调用方生成**，同时就是 installed `attachments.record_id`）/`company_order_id`/`slot`/`attachment_id`/`file_name`（登记时冻结）/`tenant_id`/`organization_id`（根单所有者组织）。槽位枚举（与对端模块单证码对齐）：`commercial_invoice`、`packing_list`、`bill_of_lading`、`telex_release`、`customs_declaration`、`domestic_freight_receipt`、`booking_charges_receipt`、`purchase_slip_invoice`、`foreign_income_certificate`、`kc_invoice_stamp`；「其他」沿用根单通用文件区。
- **文件本体仍归 installed `attachments`**（分区/配额/危险扩展名/OCR 规则不变）：上传走 `POST /api/attachments`，`entityId='order_hub:company_order_document'`、`recordId=<槽位行 id>`；登记走本模块 `POST /api/order_hub/orders/documents`（**仅所有者**；校验附件属本租户且 `recordId` 与行 id 一致，重复 409）。删除 = 先 `DELETE /orders/documents?id=`（仅所有者）再删文件（installed）；文件删除失败只留无 UI 引用的孤儿文件（`storage_ops audit` 可发现）。
- **读**：`GET /api/order_hub/orders/documents?companyOrderId=`（scope = 根单可见性：所有者组织 ∪ 协作组织；附件已丢的行返回 `missing: true`）；字节仍走第五轮的 `GET /api/order_hub/orders/attachments/<id>`（现同时接受 `order_hub:company_order` 与 `order_hub:company_order_document` 两类记录，附件 → 槽位行 → 根单 → 可见性）。
- **汇总**：`loadCompanyOrderFields` 的 `documents.bySlot`（每个槽位：本单文件 + 子单来源信号 `contract`/`shipment`/`collection`/`purchasing`，既有 `kcStamp`/`exportDocuments` 等字段保留）。
- **UI**：hub「单据与文件」区块（`components/OrderDocumentsSection.tsx`）逐槽位一行——文件 chips（预览/下载/删除）+ 该行独立「上传」+ 子单来源徽标（链到页内 `#contracts`/`#shipments`/`#money`）；「其他文件」仍是原通用区；协作者只读（无上传/删除）。抽屉「单证与文件」按槽位显示（哪张文件/何时/来源）。
- **实现期修复**：无号草稿合同**已盖章但无单号**时，来源计数被漏（原先只在有单号时入列）——改为按**盖章存在**计数、单号仅作标签。

## 第八轮：工作台行以根单字段为准（2026-10-09，owner 反馈）

owner 看 `/backend/orders` 后反馈：`对方` 看不出是什么，整行「还是有采购单的影子数据」——`子单号`（关联子单的冻结
`ref_number` 并集）与 `对方`（优先销售子单买方、否则采购子单供应商）都是**子单的事实**；按 owner 口径，工作台的列应当
与订单详情页的抬头卡一致。

- **行 = 根单自己的字段**（编号/标题/下单日期/预计交货/状态/是否已收款/默认客户/默认供应商），后接金额列与四个阶段列；解析抽到
  `components/companyOrderDisplay.ts` 的 `toOrderWorkbenchRow`（非空字符串以外一律 `null` → 渲染 `—`，不让 `undefined`
  落进单元格）；同文件的 `snapshotDisplayName` 由工作台与 hub 抬头卡共用（hub 原先自带一份本地实现，现只此一处）。
- **`子单号`/`对方` 两列退役**：子单号在详情页的关联区块读、也能被搜索命中；「对方」这个词随之退出界面（根单的两个
  默认往来方各有其名）。
- **「是否已收款」列**（第六轮字段）：`paid_full`/`unpaid` 按第六轮标签渲染，`null`（迁移前的历史行）渲染 `—`。
- 口径与证据：spec「第八轮」节（REQ-028 / TEST-021–022 / AC-025）；单测 `components/__tests__/companyOrderDisplay.test.ts`。

## 第九轮：板块布局、关联预览与「回到订单」（2026-10-09，owner 反馈）

> 本轮在本地分支上原按「第六轮」开发；落到 `dev` 时该号已由 #152（订单状态词表/是否已收款）占用，第七轮为
> #157（字段级附件槽位）、第八轮为 #156（工作台行改显根单字段），故按落地顺序记为**第九轮**
> （REQ-029…REQ-038 / TEST-023…TEST-026 / AC-026…AC-035）。

- **板块布局**：hub 的区块按 采购 / 出口销售 / 合同与单据 / 发运与装箱 四个业务板块分区（`SectionHeader` 标题，
  与 `nav_shell` 导航树同构），其后是 收汇·退税 与 文件；「对内销售订单 / 对外销售订单」不再是两个并列区块，而是
  合并的「销售订单」区块（行徽标区分，单据与通道标记不变）。
- **关联预览**：任何区块的行「点开」= 右侧只读预览抽屉（`LinkedRecordPreviewDrawer` + `linkedRecordPreviewSources`，
  复用 `@/lib/source-preview`），「编辑」是独立按钮（子单行 → 模块编辑页）；不再「点开即离开页面」。
- **回到本页**：hub 跳到模块页面的链接都带 `?returnTo=`，模块页面用 `@/lib/navigation/returnTo` 的 `useReturnHref()`
  当「返回」目标（改动落在 purchasing / internal_sales / trade_docs / cross_border / export_finance 的
  详情与编辑页）。
- **表单与文案**：公司订单建单/编辑页不再填写「标题」（列保留、历史值仍在抬头副标题显示，保存不发送 `title`）；
  抬头「默认客户/默认供应商」改称「客户/供应商」；采购单「订单描述」改读字典库的 **Product categories**
  （`product_category`，product_codes 播种），`purchasing` 不再播种 `order_product_category`。
- **空状态徽标退役（复查）**：子单行只在**有状态**时渲染徽章；无状态（本库 8/9 张销售单）不再出现只写「—」的
  徽章。抽取 `components/companyOrderChildStatus.ts`（单测覆盖 null / 销售字典 / 采购词表 / 原值四条路径）。
- **「全字段」入口收敛（复查）**：hub 抬头动作区不再放「全字段」按钮；35 列汇总抽屉保留为**工作台行操作**
  （入口只在列表侧，详情页不重复）。

## 规则（有意为之）

- **根单不持有业务数据**：客户/币种/金额/明细仍在销售单与采购单里；根单只持有编号/标题/日期/状态/是否已收款/备注与关联。
- **无跨模块 ORM 关系**：对端一律标量 id + 冻结快照；跨模块读是 scoped 只读投影（列名本地声明，见
  `lib/orderStages.ts` 与 lesson `kysely-bare-handle-types-tables-away`）。
- **销售单对方名的解密**：`sales_orders.customer_snapshot` 是加密列，关联快照必须走
  `findWithDecryption` 读（`lib/companyOrder.ts`），直读 SQL 会把密文冻结进快照。
- **写缓存**：关联集合与订单列表是两类缓存资源，命令提交后两者都显式失效（含补录 CLI——它不经过请求路径）。
- **状态是模块常量**（第六轮起 `placed`/`in_production`/`factory_pickup`/`customs_declared`/`shipped`/`in_transit`/`warehoused`，即
  已下单→生产→工厂提货→已报关→已装运→路上→到仓库），不是销售引擎的字典：根单状态是操作员自己的标记；子单状态仍归各自引擎/模块。
  旧词表（`draft`/`in_progress`/`completed`/`cancelled`）仅作为**可存储值**保留：旧行照原标签显示、可原样保存、可按旧值筛选；
  下拉与「修改状态」只提供当前词表（+ 该行自己的旧值），新建行不再产生旧值。
- **「是否已收款」是根单自己的两态标记**（`paid_full`=已收全款 / `unpaid`=未收款；建单默认 `unpaid`），照 owner 的表格习惯；
  `export_finance` 的按采购单收汇档案（含金额/日期/涉外收入证明）是**另一件事**，两者不互相改写。列可空：迁移前已存在的行渲染为「—」，
  不替它回答「未收款」。协作组织不能写该字段（白名单仍只有 `status`/`notes`）。
- **未标记贸易类型的销售单不出现在工作台**（与两个销售入口列表同口径）。

## 验证

```bash
yarn jest --config jest.config.cjs src/modules/order_hub src/lib/navigation
JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral company-orders
JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral company-order-links
JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral company-order-backfill
JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral company-order-fields
JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral company-order-attachment-access
yarn mercato auth sync-role-acls   # 既有租户补授 order_hub.manage
```

浏览器（2026-10-09 实测，ephemeral 环境）：工作台行=公司订单（`CO-…`，子单号/对方/四阶段列）；点行进
`/backend/orders/<companyOrderId>`；「关联…」成套替换后区块与工作台计数同步；hub 三个「新建」带
`?companyOrderId=` 且保存后自动关联并跳回（采购单 `#purchasing`）；旧 `/backend/orders/<salesOrderId>` 归位；
「未关联」态可一键建根并关联；暗色与窄屏（390×844）正常；对话框 Esc 关闭。

浏览器（第九轮，2026-10-09）：hub 六个板块标题 + 合并「销售订单」区块两行（对内/对外 徽标）；行号「点开」=
右侧只读预览抽屉（采购/销售两种都实测），抽屉底部「编辑」带 `returnTo=%2Fbackend%2Forders%2F<id>`；跳到对内
销售编辑页后「← 返回」= 该订单页；`?returnTo=https://evil.example/x` 与缺参都回退模块台账；无状态子单行不出现
空徽标（有状态的采购行照常）；hub 抬头动作区无「全字段」；工作台「全字段」抽屉 = 订单 / 金额与日期 / 单证与文件 /
财务 四组数据；建单页无「标题」、抬头 = 客户/供应商；采购单「订单描述」候选 = `TP — 尿片 / CL — 猫砂 / LB — 猫砂盆 /
LS — 猫砂铲 / CB — 餐具`；窄屏 390×844 正常。

## 回滚

回退本次改动即恢复旧实现所需的全部文件已随本 PR 删除（`lib/mergeOrders.ts` 与旧聚合路由）；两张新表可保留
（不被旧逻辑读取），如需彻底清理：先删 `order_hub_company_order_links` 再删 `order_hub_company_orders`。
