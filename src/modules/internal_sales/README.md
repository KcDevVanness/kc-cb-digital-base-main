# `internal_sales` — 内部销售单据（自建界面，官方 sales 引擎）

app 自有**界面层**模块：为「总部 → 分公司」的内部销售提供自建的报价单/订单**列表、新建与编辑**页，
**行引用自建商品主数据**（`products_products.id`）。单据本体仍由官方 `sales` 链承载
（编号、状态、金额引擎、发货、发票、退货、收款），本模块只通过其公开 API 驱动，不重写引擎。

需求与证据见 [`.ai/specs/2026-09-22-products-and-trade-docs.md`](../../../.ai/specs/2026-09-22-products-and-trade-docs.md) 的 Phase 6。

## 表面

| 层 | 内容 |
|---|---|
| 页面 | `/backend/internal-sales/quotes`、`/quotes/create`、`/quotes/[id]/edit`；`/backend/internal-sales/orders`、`/orders/create`、`/orders/[id]/edit`（六个页面的 `pageGroupKey` 都是 `cross_border.nav.group`，即侧边栏「出口业务」组——2026-09-28 由「外贸」改名，只改 label；本模块没有自己的导航分组）。订单页标题带业务缩写「内部销售订单（PO）」（N-1）：**2026-09-29 起真正落到界面**——`internal_sales.list.order.title` 与 `form.order.{create,edit}Title` 两个语言的字典都带「（PO）」/「(PO)」，`backend/internal-sales/orders/**/page.meta.ts` 的 `pageTitle` 兜底串同步（此前只有 page.meta 的兜底串带 PO，字典仍是「内部销售订单」，而侧边栏/页面标题取的是 `pageTitleKey` → 字典值）。报价单按 N-1 **不挂缩写**，改由页面描述说明它不是 PI（`internal_sales.list.quote.description`：「总部对分公司的报价单据，不是对外收款依据的形式发票（PI）…」） |
| 列表状态列（2026-09-28；表头文案 2026-09-29 补齐） | 列表新增「状态」列：读官方 `GET /api/sales/{quotes,orders}` 的 `status`（字典**值**，可为 null），经租户字典 `sales.order_status`（`loadDictionaryEntriesByKey` + `createDictionaryMap` + `DictionaryValue`）渲染标签与字典色点；无状态渲染 `—`，字典读不到时保留原值。报价与订单共用该字典（引擎口径）。**表头字段的 i18n key 当时漏了 zh/en 两份字典**（`internal_sales.list.columns.status`），列头渲染出裸 key；2026-09-29 已补「状态」/「Status」 |
| 组件 | `components/InternalSalesTable.tsx`（列表）、`components/InternalSalesForm.tsx`（抬头 + 行编辑器 + 买方选择器，一次提交整单）、`lib/buyer.ts`（买方值协议与快照编解码，纯函数） |
| 买方选项 | 关联组织：`GET /api/directory/organization-switcher`（requireAuth，无额外功能位）；外部客户：`GET /api/parties/options?roles=buyer` 与 `GET /api/parties/{id}`（均需 `parties.view`） |
| 读 | 官方 `GET /api/sales/{quotes,orders}`（抬头）与 `GET /api/sales/{quote,order}-lines?quoteId\|orderId=`（行，**snake_case** 列名，`pageSize` 上限 **100**） |
| 新建写 | 官方 `POST /api/sales/{quotes,orders}`（抬头 + 行一次提交；命令 `sales.quotes\|orders.create`） |
| 编辑写 | 抬头 `PUT /api/sales/{quotes,orders}`（**只写抬头标量字段**）+ 行 `PUT/DELETE /api/sales/{quote,order}-lines`（`PUT` → `…lines.upsert`，`DELETE` → `…lines.delete`） |
| 权限 | 列表页声明读功能位 `sales.quote.view` / `sales.order.view`，新建/编辑页声明 `sales.quotes.manage` / `sales.orders.manage`（本模块不新造功能位：写入的门禁在官方 API 上）。**列表上的「新建」与行操作「编辑」按复数的 manage 功能位渲染**（`hasFeature(chrome payload)`，与 `products` 列表同一写法；chrome payload 未就绪时不隐藏），只读账号只看到只读列表 |
| 事件 | **无**（本模块不声明 `events.ts`；单据的 `sales.*` 事件由官方命令发出） |
| 实体/迁移 | **无**（不新增表；单据写在官方 `sales_*` 表里） |

> 读功能位的 id 与安装层不一致：本模块列表页声明的是**单数** `sales.quote.view` / `sales.order.view`，
> 而安装层 `sales` 自己的列表页与 API 声明的是**复数** `sales.quotes.view` / `sales.orders.view`，
> 两者并不互相匹配（`matchFeature` 只做精确/前缀通配匹配，不认单复数）——超管之所以照常打开，
> 是因为 `rbacService.userHasAllFeatures` 对 `isSuperAdmin` 直接放行，而不是因为 id 对上了。
> 要按角色真正收紧门禁，先把两边的 id 统一。**真机实测（2026-09-28，临时只读角色 + 账号）**：只给单数
> → 列表页 **Access Denied**；单数 + 复数都给 → 页面正常渲染、列表可读（该账号同时验证了「无 manage
> 时不显示新建/行操作」）。所以当前给非超管角色配这个模块时，**两组 id 都要给**。

> **金额口径（REQ-006，见 [`.ai/specs/2026-09-28-money-scale-2dp-unification.md`](../../../.ai/specs/2026-09-28-money-scale-2dp-unification.md)）：** 本模块是内置 `sales` 的**边界适配层**——入口只发**金额 2 位、单价 4 位**；`InternalSalesForm` 在提交前校验每行「数量与单价最多 4 位小数」（`Line {line}: quantity and unit price accept at most 4 decimal places`），超位即拒。内核 `sales_*` 列仍 18,4 属实现细节，展示与导出统一按 2 位（`MoneyAmount`）。

> **报价 → 订单的转换：引擎有、界面没有（2026-09-28 实测）。** 官方命令 `sales.quotes.convert_to_order` 由 REST `POST /api/sales/quotes/convert {quoteId}` 暴露（门禁 `sales.quotes.manage` + `sales.orders.manage`），实测 **200** 且**单据就地转换**（同一个 id 从 `sales_quotes` 变成 `sales_orders`、拿到新的 `ORDER-…` 号、行与买方快照随行）。**安装层的单据详情页与本模块都没有这个入口**（官方详情页的 Actions 菜单里没有它）。因此当前流程是：要么直接在本模块新建订单（报价只作对外报价文本），要么走上面这条 REST；要在本模块加「转为订单」行操作，需要先立 spec（转换后原报价 URL 失效，需跳转到订单编辑页）。

## 买方：关联组织 + 外部客户（2026-09-28）

内部销售的两个方向共用这一套页面，买方的语义随之分两种（spec：
[`.ai/specs/2026-09-28-internal-sales-buyer-linkage.md`](../../../.ai/specs/2026-09-28-internal-sales-buyer-linkage.md)）：

| 方向 | 卖方 | 买方 | 选择器来源 |
|---|---|---|---|
| **内部**（主体 → 分公司） | 集团主体组织（如广州凯翠国际贸易有限公司） | **关联组织**：组织树里的分公司（俄罗斯 AB 有限公司、后续东南亚） | 顶栏组织切换器的同一份 payload（`GET /api/directory/organization-switcher`），取 `selectable` 且 ≠ 当前所选组织的节点 |
| **对外**（分公司 → 客户） | 分公司组织 | **外部客户**：自建 `parties` 主数据（角色 `buyer`；分公司的档案只带 `branch`，不进这个列表） | `GET /api/parties/options?roles=buyer`，按当前组织收窄 |

- 一个可搜索选择器、两个来源，**来源写在选项标签最前**（`关联组织：名字` / `外部客户：CODE — name`，
  lesson `merged-picker-source-belongs-in-the-label`）；选中后**买方名称自动回填**（组织 = 组织名；
  档案 = `GET /api/parties/{id}` 的 `name`），名称字段仍可编辑——没有档案的买方仍可直接手填（旧能力保留）。
  前缀/占位符/两处失败提示五个串都在模块字典里（`internal_sales.form.buyer.{relatedOrgPrefix,externalPrefix,
  selectPlaceholder,orgLoadFailed,partyLoadFailed}`，en/zh 各一份）；**2026-09-29 之前这几个 key 漏了两份字典**，
  组件只能渲染英文兜底——中文界面里的「Related organization: 俄罗斯 AB 有限公司」就是这么来的。
- **可见性 fail-closed，不在表单里写业务规则**：分公司账号的切换器 payload 只有它自己（加上不可选的祖先上下文），
  排除自身后自然没有任何「关联组织」选项；总部账号只见自己的下级。所以「总部 → 分公司」由平台的组织可见性
  直接成立，「分公司不能向上/同级」不需要额外判断。
- **落库 = 快照，不占 `customerEntityId`**（该列在 installed 契约里是 `customer_entities.id`，放组织 id 是类型谎言）：

```jsonc
customerSnapshot = {
  "name": "俄罗斯 AB 有限公司",                        // 本模块列表/表单的读取键（沿用）
  "customer": { "displayName": "俄罗斯 AB 有限公司" },  // installed 单据详情页/更新响应派生买方名的读取点
  "internalSales": { "organizationId": "<组织 id>" }    // 或 { "partyId": "<档案 id>" }
}
```

  更新时买方为空（选择器与名称字段都空）写 `customerSnapshot: null`（显式清除；不携带 = installed 的「字段缺席不改」，
  旧快照会残留）；只清选择器、名称字段仍有文本时，快照降为 `{ name, customer.displayName }`（去链接、保留手工名）。
  旧单据（快照只有 `{ name }`）读取路径不变。
- 两个来源**各自失败、各自提示**：组织 payload 读不到或 `parties.view` 被拒时，字段下方给出行内提示，
  另一半仍可用（不渲染成「没有任何买方」的空列表）。
- 交互（沿用 `ComboboxInput`，与行选品器同款）：未选中时点开即列出全部；已选中时点击会显示当前选项，
  换买方直接在字段里**输入**（组织按名称过滤、外部客户按 `code` 在服务端搜索），或先点 × 清空再选。
- 已知限制：外部客户的选择器按 **code** 搜索（`name` 是加密列，installed 口径见
  `.ai/specs/2026-09-22-app-owned-party-master.md` Q-P-008）；组织选项与顶栏切换器同集合（切换器 payload 不带
  `isActive`，停用组织不会被额外隐藏）。

## 为什么这样做（而不是 eject `sales`)

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
| `productVariantId` | **桥接**：商品填了「官方目录链接」时，自动取其默认启用变体（`/api/catalog/variants`，响应是 snake_case）；否则留空。**目录链接是履约前提**：把本单行分摊到发运单时要求该商品能经 `catalog_product_id` 桥接到官方目录（否则 422，`cross_border` 的销售分摊）、收货时 `resolveDefaultVariantId` 取不到变体同样 **422**（`has no variant, so stock cannot be received`）；官方 `sales` 的发货命令本身只挂订单行（`sales_shipment_items` 无变体列），不校验变体 |
| `catalogSnapshot` | 打印/展示快照（sku/name/spec），写入时冻结，商品改名不改写历史单据 |

> 选择器解析完选中标签后**会以同一个商品 id 再触发一次 `onChange`**（2026-09-28 真机确认）。表单只在商品
> **变化**时清空 `productLabel`/`productVariantId`，同值重复触发原地重解析--否则在两次异步解析的窗口内保存，
> 落库行会没有变体（发货/海外仓收货按变体级入账）。教训：`.ai/lessons/combobox-same-value-refire-must-not-clear-derived-state.md`。

## 与官方动态页的关系（2026-09-22 更正）

官方 `sales` 的**动态**页面（`/backend/sales/documents/[id]`、`quotes/[id]`、`orders/[id]`）此前在本机返回 404，
当时的记录把它们当成「平台/环境问题」——**那个结论是错的**：404 来自 `src/modules.ts` 里把这些 pathname
写成 `routes.pages: { ...: null }`，`null` 会把路由清单条目整条摘除。现已全部改成
`{ metadata: { navHidden: true } }`（仍不进侧边栏，URL 可解析），所以官方动态页可访问，官方列表的行内链、
通知深链（`sales.order.created` → `/backend/sales/orders/{id}` 等）都不再 404。详见
[`docs/dev/architecture.md`](../../../docs/dev/architecture.md) 的「官方 UI 的隐藏策略」。

本模块自己的新建/保存后跳转**仍然指向自己的编辑页**（`/backend/internal-sales/{quotes,orders}/[id]/edit`），
不依赖官方动态页——这是设计选择，不是绕开坏页面。

**编辑页的返回/取消（2026-09-29 修正）**：本模块没有单据详情页，编辑页**就是**该单据的页面，所以编辑页的
`backHref`/`cancelHref` 指向**列表**（`listHrefFor`，与新建页一致）。此前两处取的是
`documentDetailHref`——它返回的正是编辑页自身（`${listHref}/${id}/edit`），于是页头「← 返回」与页头/页脚的
「取消」三个链接全部指回当前地址栏的 URL，点击没有任何反应（2026-09-29 真机报告）。该 helper 同时更名为
`documentEditHref`，避免下一个作者再按「详情页」去拼返回目标；教训见
[`.ai/lessons/edit-page-is-not-its-own-back-target.md`](../../../.ai/lessons/edit-page-is-not-its-own-back-target.md)。

**四个 create/edit 页的面包屑（2026-09-29 修正）**：`quotes|orders/create` 与 `quotes|orders/[id]/edit` 的
面包屑此前是 `{ labelKey: 'internal_sales.page.title', href: '/backend/sales/{quotes,orders}' }`——标签是
「内部销售单据」一类的中性名，却链到**官方**列表，与本模块的列表/编辑页不同源。现在与 `purchasing`/`parties`
同款：面包屑第一级就是它要落到的**本模块列表**（`internal_sales.list.quote.title` →
`/backend/internal-sales/quotes`，订单侧同理），指向的页面与标签一致，也不再离开自建界面。
`internal_sales.page.title` 由此没有任何引用，两份字典里一并删掉（key 集合仍逐键一致）。

## 验证

```bash
yarn generate && yarn typecheck && yarn lint && yarn ds:check
npx jest src/modules/internal_sales                     # 买方值协议 / 快照 / 组织选项装配的单元测试
# 冒烟（dev server 在跑时）：
#  UI 新建报价/订单（选自建商品 + 数量 + 未税单价）→ 201；落库行 productId=products_products.id、
#  有官方目录链接的商品 productVariantId 自动填默认变体、catalogSnapshot 有 sku/name/spec；
#  列表出现该单；行操作进入本模块编辑页；改数量保存 → PUT 抬头 200 + PUT …-lines 200，行 id 不变、引用与快照保留。
#  买方：下拉出现「关联组织：<分公司名>」与「外部客户：<CODE — name>」；选组织 → 名称回填 → 保存后
#  customer_snapshot 含 name + customer.displayName + internalSales.organizationId；编辑页回显同一选项，
#  改数量保存 → 抬头 PUT 200 + 行 PUT 200、行 id 不变、快照保留；选外部客户 → 快照带 partyId 且名称为档案名；
#  清选择器（名称仍在）→ 快照降为 { name, customer.displayName }；选择器与名称都清空 → 快照写显式 null。
#  （2026-09-28 在 dev 逐条实测：QUOTE-20260928-00004 全流程 + 上述四种快照形状）
#  选带「官方目录链接」的商品 → 落库 product_variant_id = 该目录商品的默认启用变体
#  （2026-09-28 实测 LOWMOQ-1790586676106 → 96861c70-…），无链接的商品留空；编辑保存后变体保留。
#  订单侧同套验证（2026-09-28 真机）：`/backend/internal-sales/orders/create` 选「关联组织：俄罗斯 AB 有限公司」+
#  商品 P4108-UVC（无目录链接 → 变体留空）→ `ORDER-20260928-00004`（合计 176）→ 列表行操作进编辑页 →
#  改数量保存 `PUT orders` 200 + `PUT order-lines` 200、行 id 不变、快照与变体状态保留（探针单已删）。
#  /backend/sales/documents/create 只做 `navHidden`：不在侧边栏，但 URL 仍可解析（不是 404）。
```

## 回滚

从 `src/modules.ts` 移除 `{ id: 'internal_sales', from: '@app' }` 并 `yarn generate`；本模块没有自己的表与迁移
（无 DDL 可回退），单据数据仍在官方 `sales_*` 表里，不受影响。同时把 `sales` 的 `routes.pages` 覆盖去掉即可恢复
官方新建页的侧边栏入口——该覆盖只改导航可见性，那些 URL 一直是可解析的。
