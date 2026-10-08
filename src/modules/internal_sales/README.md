# `internal_sales` — 销售单据（自建界面，官方 sales 引擎）

app 自有**界面层**模块：为**对内（总部 → 分公司）与对外（分公司 → 当地客户）两种贸易类型**的销售提供自建的
报价单/订单**列表、新建与编辑**页——**每种类型一个专属入口**（对内 `/backend/internal-sales/**`、对外
`/backend/external-sales/**`），入口即类型，菜单名与列表口径都只覆盖自己那一半。**行引用自建商品主数据**
（`products_products.id`）。单据本体仍由官方
`sales` 链承载（编号、状态、金额引擎、发货、发票、退货、收款），本模块只通过其公开 API 驱动，不重写引擎。

需求与证据见 [`.ai/specs/2026-09-22-products-and-trade-docs.md`](../../../.ai/specs/2026-09-22-products-and-trade-docs.md) 的 Phase 6。

## 订单详情 hub（2026-10-08）

`/backend/internal-sales/orders/<id>`（对外入口同页，`external-sales/orders/[id]` 直接 re-export）把
「一张订单的后续填写」收在一页：抬头 + 明细行 + 五个分区（采购订单 / 发运单 / 购销合同 / 单据 /
收汇·退税），每个分区自带预填的新建入口。

| 事项 | 口径 |
|---|---|
| 门禁 | `sales.order.view`（与列表同一条）；页面 `navHidden`，只从列表与采购单的来源链接进入 |
| 贸易类型 | 由路径判定（`tradeTypeFromPathname`），因此同一组件服务两个入口，链接/预填/合同 kind 都跟着入口走 |
| 分区数据源 | 采购订单 `?sourceSalesOrderId=`；发运单 `?salesOrderId=`；合同 `contracts/orders?orderKind=&orderId=` → `contracts?ids=`；单据 `documents?contractId=` + `invoices?contractId=`（每张关联合同各读一次后合并）；收汇/退税 `collections?purchaseOrderId=` / `refunds?shipmentId=`（单条读，逐采购单/发运单各一次） |
| 失败隔离 | 每个分区独立 react-query：某分区读失败只在该分区显示错误 + 重试，其余分区照常 |
| 写路径 | 只写订单自己的状态（确认 / 作废），走 `lib/salesStatusWrite.ts` —— 与列表**同一个**写实现（同一个乐观锁头、同一套引擎语义）；其余一律交给各自模块的命令 |
| 分页上限 | 各分区一次读 `pageSize=100`：`/api/sales/order-lines` 的上限就是 100，超过是 400 |
| 预填链接 | `/backend/purchasing/orders/create?orderKind=&orderId=`、`/backend/cross_border/shipments/create?…`、`/backend/trade-docs/contracts/create?…`、`/backend/trade-docs/proformas/create?…`（订单只有一张关联合同时附 `&contractId=`） |

共用件：`lib/salesDocumentRecord.ts`（列表行投影，列表与 hub 共用）、`lib/salesStatusWrite.ts`
（状态写）、`lib/tradeType.ts`（贸易类型）。

## 表面

| 层 | 内容 |
|---|---|
| 页面 | `/backend/internal-sales/quotes`、`/quotes/create`、`/quotes/[id]/edit`；`/backend/internal-sales/orders`、`/orders/create`、`/orders/[id]/edit`（六个页面的 `pageGroupKey` 是 `cross_border.nav.group.sales`（侧边栏「出口业务-对内销售」组，菜单项「对内销售报价单」/「对内销售订单（PO）」；**2026-09-30 起**：只改 label、key 不变，入口本身固定对内——类型控件只读、列表按 `channelId=<INTERNAL_SALES>` 过滤）；对外入口的六个页面是同批 `page.tsx` 的 re-export，`pageGroupKey` 是 `cross_border.nav.group.externalSales`（「出口业务-对外销售」组，菜单项「对外销售报价单」/「对外销售订单（PO）」）。2026-09-29 之前这两组叫「出口业务-内部销售」与 `cross_border.nav.group`（后者没有字典键，中文界面渲染出英文裸串「Cross-Border」、也不在 `nav.groupOrder` 里）；2026-09-29 到 09-30 之间那组曾叫「出口业务-销售」（当时两种类型同表）。订单页标题带业务缩写「对内销售订单（PO）」（N-1）：**2026-09-29 起真正落到界面**——`internal_sales.list.order.title` 与 `form.order.{create,edit}Title` 两个语言的字典都带「（PO）」/「(PO)」，`backend/internal-sales/orders/**/page.meta.ts` 的 `pageTitle` 兜底串同步（此前只有 page.meta 的兜底串带 PO，字典仍是「内部销售订单」，而侧边栏/页面标题取的是 `pageTitleKey` → 字典值）。报价单按 N-1 **不挂缩写**，改由页面描述说明它不是 PI（`internal_sales.list.quote.description`：「总部对分公司的报价单据，不是对外收款依据的形式发票（PI）…」） |
| 列表状态列（2026-09-28；表头文案 2026-09-29 补齐） | 列表新增「状态」列：读官方 `GET /api/sales/{quotes,orders}` 的 `status`（字典**值**，可为 null），经租户字典 `sales.order_status`（`loadDictionaryEntriesByKey` + `createDictionaryMap` + `DictionaryValue`）渲染标签与字典色点；无状态渲染 `—`，字典读不到时保留原值。报价与订单共用该字典（引擎口径）。**表头字段的 i18n key 当时漏了 zh/en 两份字典**（`internal_sales.list.columns.status`），列头渲染出裸 key；2026-09-29 已补「状态」/「Status」。**2026-09-30**：入口即类型，列表不再有「类型」列——`internal_sales.list.columns.tradeType` 与 `list.unmarkedHint`（「类型列显示为 —」那句）一并删除 |
| 组件 | `components/InternalSalesTable.tsx`（列表 + 状态行操作：发出/重新发出、确认、作废，以及按状态门禁的下单动作）、`components/InternalSalesForm.tsx`（抬头 + 行编辑器 + 买方选择器 + 买方邮箱 + 报价载入面板挂载，一次提交整单；新建写 `statusEntryId=draft`）、`components/QuoteLoadPanel.tsx`（从报价单载入的按钮/对话框/来源行 + 来源报价预览抽屉）、`lib/buyer.ts`（买方值协议与快照编解码，含买方邮箱 `contact.email`）、`lib/documentValues.ts`（单据 ↔ 表单值编解码，纯函数）、`lib/quoteLoad.ts`（报价载入 loader，纯函数 + 两次读请求；预览映射 `sourceQuotePreviewFromDraft`）、`lib/salesStatus.ts`（状态常量 + 动作策略，纯函数）、`lib/salesStatusEntries.ts`（租户状态字典 → `value → entryId`，供列表与表单共用）、`lib/salesStatus.ts` 的字典键也供预览抽屉共用 |
| 买方选项 | 关联组织：`GET /api/directory/organization-switcher`（requireAuth，无额外功能位）；外部客户：`GET /api/parties/options?roles=buyer` 与 `GET /api/parties/{id}`（均需 `parties.view`） |
| 读 | 官方 `GET /api/sales/{quotes,orders}`（抬头）与 `GET /api/sales/{quote,order}-lines?quoteId\|orderId=`（行，**snake_case** 列名，`pageSize` 上限 **100**） |
| 新建写 | 官方 `POST /api/sales/{quotes,orders}`（抬头 + 行一次提交；命令 `sales.quotes\|orders.create`） |
| 编辑写 | 抬头 `PUT /api/sales/{quotes,orders}`（**只写抬头标量字段**）+ 行 `PUT/DELETE /api/sales/{quote,order}-lines`（`PUT` → `…lines.upsert`，`DELETE` → `…lines.delete`） |
| 报价转化（已移除） | **2026-09-30 按要求移除**：`/backend/internal-sales/quote-conversion` 页面、`GET /api/internal_sales/quote-conversion` 只读接口与 `lib/quoteConversion.ts` 全部删除（owner：「暂时不需要」）。曾经的实现读订单冻结的 `metadata.internalSales.sourceQuote` 做纯读侧聚合；如需恢复，按本行描述重建即可（无迁移、无数据依赖） |
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

> **报价 → 订单有两条路：就地转换与引用加载（2026-09-29 更新）。** 官方命令 `sales.quotes.convert_to_order`
> 由 REST `POST /api/sales/quotes/convert {quoteId}` 暴露（门禁 `sales.quotes.manage` + `sales.orders.manage`），
> **单据就地转换**：同一个 id 从 `sales_quotes` 变成 `sales_orders`、拿到新的 `ORDER-…` 号、行与买方快照随行，
> 报价本身被引擎硬删（安装源 `commands/documents.ts:6733-6737`），不可撤销；本模块报价列表的「转为订单」行操作
> 即此路径（spec [`.ai/specs/2026-09-28-internal-sales-quote-to-order.md`](../../../.ai/specs/2026-09-28-internal-sales-quote-to-order.md)）。
> **更正（2026-09-29）**：安装层报价详情页的 Actions 里**是有** Convert to order 的（安装源
> `backend/sales/documents/[id]/page.tsx` 的 `handleConvert`，`@open-mercato/core@0.8.0`）——此前
> 「安装层详情页与本模块都没有这个入口」的记录与当前安装版本不符。另一条路是**引用加载**：
> 订单新建页「从报价单载入」与报价列表「按此报价新建订单」——报价保留、内容可改、可出多张订单
> （spec [`.ai/specs/2026-09-29-internal-sales-order-from-quote.md`](../../../.ai/specs/2026-09-29-internal-sales-order-from-quote.md)）。

## 订单从报价单载入（引用加载，2026-09-29）

订单新建页顶部有「从报价单载入」：选一张报价 → 抬头（币种/买方链接与名称/客户参考号/备注）与**全部行**
一次性填入表单，改完保存为新订单；报价单本身不改不删。报价列表的行操作「按此报价新建订单」是同一 loader 的
快捷入口（跳 `/backend/internal-sales/orders/create?fromQuote=<id>`，进页自动载入）。与「转为订单」的分工：
转换 = 报价即最终版、就地不可逆；载入 = 以报价为模板、报价保留、可出多张订单（owner 2026-09-29 确认的业务事实：
一张订单可能分批发运/分多柜，多张订单也可能合一条柜）。

- **来源记录与预览（2026-09-29 起为抽屉预览）**：载入后保存的订单写 `metadata.internalSales.sourceQuote = { id, number }`——
  引擎的 `metadata` 是文档上的自由 jsonb，更新路径不携带该键时引擎「缺席不改」，所以编辑订单不会清掉它。
  订单新建/编辑页显示「来源报价单：QUOTE-…」，**点单号在当前页打开右侧预览抽屉**（平台 `Drawer`，走同一个
  `loadQuoteDraft` 只读：报价单号/买方/币种/状态/金额（未税）/行数 + 明细；状态用租户字典渲染、金额用 `MoneyAmount`），
  不跳页、不丢已填内容；只有抽屉页脚的「打开报价单」才跳回报价编辑页（脏表单仍由 `CrudForm` 的离开确认兜底）。
  此前该单号是直接跳转链接，点一下就把未保存的订单表单留在身后——这是本次改动的动机。载入是一次性的：之后报价与订单互不影响。
- **映射**：复用编辑页同一组纯函数（`lib/documentValues.ts` 的 `toInternalSalesFormValues` /
  `toInternalSalesLineValues` + `lib/buyer.ts` 的 `readBuyerSnapshot`）；行 key 重新发为本地 `line-N`（新建载荷
  不能带源行 id）；空报价只载抬头并提示补明细；表单已有输入时先弹覆盖确认。
- **读路径**：编辑页的单文档读由 `?ids=` 改为 `?id=`——安装层工厂只有 `id`（单数）返回**含 `metadata`** 的完整
  投影，`ids` 走的是去掉 metadata 的 grid 投影（安装源 `api/documents/factory.ts` 的 `resolveListFields`）。
- **选择器的标签（2026-09-29 修正）**：载入对话框里的报价选择器对**已载入**的报价单走
  `resolveQuoteLabel(id)`（`GET /api/sales/quotes?id=` → 与选项列表同一个 `quoteOptionFromRecord`），
  行选品器对缺快照标签的行走 `loadProductOption`（按 id 读自建商品）。此前两者都依赖 `ComboboxInput`
  的兜底解析：该兜底在 dev 的 StrictMode 双调用 effect 下会取消自己的请求、再被 ref 拦住重试，于是重开
  对话框只显示裸 uuid。教训见 [`.ai/lessons/preselected-picker-value-needs-a-label-resolver.md`](../../../.ai/lessons/preselected-picker-value-needs-a-label-resolver.md)。
- **权限与失败**：读报价要安装层复数功能位 `sales.quotes.view`；缺位/读失败 → 面板行内提示（+ 自动载入时 flash），
  表单内容不变，**载入不发任何写请求**。

## 状态与生命周期：报价 / 订单（2026-09-30，spec `.ai/specs/2026-09-30-document-status-lifecycle.md`）

状态不是本模块造的标签，而是引擎字段 `status` + 租户字典 `sales.order_status` 的**条目**：写入一律用
`statusEntryId`（`lib/salesStatusEntries.ts` 的 `useSalesStatusEntries` 把字典 value 解析成条目 id），引擎自己
解析出值、写 `status_entry_id`、留痕，并在订单跳到 `confirmed`/`canceled` 时发 `sales.order.confirmed` /
`sales.order.cancelled`。策略是纯函数（`lib/salesStatus.ts`）：**行操作按状态推导**，界面不提供自由改状态的下拉。

| 单据 | 状态与动作 | 门禁 |
|---|---|---|
| 报价 | 新建即 `draft`；「发出报价」走引擎 `POST /api/sales/quotes/send`（写 `validUntil`/`sentAt`/接受令牌 + 发信）→ `sent`；「作废」→ `canceled`（终态） | **未 `sent`/`confirmed` 的报价不显示「转为订单 / 按此报价新建订单」**（「从报价单载入」的选择器同样只列可下单的报价，`?fromQuote=` 指向不可下单的报价时行内拒绝）；`canceled` 之后三个动作全消失（平台 `send` 也拒绝 canceled） |
| 订单 | 新建即 `draft`；「确认订单」→ `confirmed`；「作废」→ `canceled` | 发运单的销售分摊选择器只列**已确认及之后**的状态（`confirmed`/`in_fulfillment`/`fulfilled`，Phase 1 只写得到 `confirmed`）；`draft`/`canceled` 不出现 |
| 历史单据 | `status` 为空（本模块启用前写入的单据） | 显示「—」；报价照旧可下单、订单照旧可分摊，选择器行内标注「未标记状态」——不追溯、不锁存量数据 |

- **买方邮箱**：报价发出需要收件地址，引擎按 `customerSnapshot.contact.email` → `customer.displayName` 之外的第二顺位
  `customer.primaryEmail` → `metadata.customerEmail` 解析；本模块把它做成表单字段「买方邮箱」写进**快照**
  （`lib/buyer.ts` 的 `buildBuyerSnapshot({ email })`），选外部客户时会用 `GET /api/parties/{id}` 的 `email` 预填
  （已有输入不覆盖）。快照每次保存整体重写，所以没有 metadata 合并/覆盖的风险。
- **发出后编辑会被打回草稿**：平台行为——**任何**对 `sent` 报价的更新都会清 `acceptanceToken`/`sentAt` 并把状态复位 `draft`
  （引擎在应用完载荷之后无条件执行，载荷里的 `statusEntryId` 会被它覆盖），所以本模块：
  ① 编辑页在单据仍是 `sent` 时显示横幅「保存会把状态退回草稿并作废已发链接」；
  ② **作废一张已发出的报价要写两次**——先做一次无字段变更的更新（触发引擎自己的「撤回」），再用返回的新版本把状态置 `canceled`；
  ③ 每次状态写入后**回读单据核对落库值**，不一致就如实报错，不谎报成功。
- **转换出来的订单仍可确认**：`sent` 报价被「转为订单」时引擎把**报价状态复制给订单**（`status: snapshot.quote.status`），得到的是 `sent` 订单；
  本模块的 `canConfirm` 对「未作废且未过确认」开放，所以这类订单能确认、能发运（否则转换会产出一张永远发不出去的订单）。
- **列表新列**：报价多一列「有效至」（`validUntil`）——只有状态仍是 `sent` 的报价显示日期（引擎撤回后 `valid_until` 会留在库里），`sent` 且已过期时红字 + 「已过期」；「行数」列改名
  「明细行数」/“Line items”（它就是 `line_item_count` = 单据明细行数）。对外入口的订单标题与对内一样带业务缩写
  「对外销售订单（PO）」（N-1 缩写口径，2026-09-30 补齐）。
- **本地开发发信**：本仓 dev 没有配置发信 provider，`sendEmail` 会抛 `EMAIL_TRANSPORT_NOT_CONFIGURED`——但引擎的
  send 路由**先提交事务再发信**，所以状态会照样变 `sent`、界面只看到失败提示。本地联调请设
  `OM_DISABLE_EMAIL_DELIVERY=true`（`.env.example` 有注释说明），让 send 直接跳过外发。
- **字典标签目前是英文**（Draft/Sent/Confirmed/Canceled 由平台播种）：本 Phase 没有改租户数据；要中文可在
  `/backend/dictionaries`（字典维护）把 `sales.order_status` 的 10 个标签改成中文词表（草稿/已发出/已接受/已履行/已作废…），
  代码只认 value，改标签不影响任何判断。

## 贸易类型：对内 / 对外（2026-09-29；入口口径 2026-09-30 定稿）

- **一个入口 = 一种贸易类型，类型不单独选**：`/backend/internal-sales/**` 是对内入口、`/backend/external-sales/**` 是对外入口，`lib/tradeType.ts` 的 `tradeTypeFromPathname` 直接按 pathname 返回 `SalesTradeType`（`salesEntryFromPathname` 已删）。类型决定买方选择器给哪一半（关联组织 vs 外部客户）、决定单据打在哪个通道上，也是列表的服务端过滤键；`lib/tradeType.ts` 是纯函数单点（`tradeTypeFromBuyerKind` / `tradeTypeFromSnapshot` / `resolveRowTradeType`）。界面上的类型标签是「对内」/「对外」；两条系统通道行本身的显示名仍是「内部销售」/「对外销售」（已落库的数据，改了会与新组织不一致）。
- **写入引擎原生标记**：单据的 `channel_id` 指向本组织的两条系统通道 `INTERNAL_SALES` / `EXTERNAL_SALES`（`setup.ts` 的 `onTenantCreated` + `seedDefaults` 幂等播种；已有组织跑 `yarn mercato seed:defaults --module internal_sales`）。`sales_channels.code` 上 `(organization, tenant, code)` 唯一，重复播种不会产生第二条。通道缺失时**保存被拦截**并给出可执行提示——不带标记的单据会从两个筛选列表里同时消失。
- **解析通道不走官方渠道页**：本模块自带 `GET /api/internal_sales/trade-type-channels/{quotes,orders}`（门禁是单据自己的 `sales.quotes.view` / `sales.orders.view`），因为分公司业务员通常没有 `sales.channels.view`；该路由只读，写入只发生在播种与回填。
- **两个入口，一套实现（2026-09-30 定稿口径）**：`/backend/internal-sales/**`（「出口业务-对内销售」，菜单项「对内销售报价单」/「对内销售订单（PO）」）与 `/backend/external-sales/**`（「出口业务-对外销售」，「对外销售报价单」/「对外销售订单」）是同一批页面（后者 re-export 前者的 `page.tsx`，只换 `page.meta.ts`）。
  - **列表只列自己的类型**：服务端固定传 `channelId=<入口通道>`（`InternalSalesTable` 的 `entryChannelId`），另一类型永不出现；因此「类型」列被删除（每行都是入口的类型）。**入口通道未播种时列表不发请求**，在表格位置显示与保存拦截同一句可执行提示（`internal_sales.form.tradeType.channelsMissing`）——不会退化成「不过滤」把两种类型混在一起。
  - **表单的类型是只读值**：`useFields` 只保留「显示为值」的分支（`internal_sales.form.field.tradeTypeFixed` 带 `{{type}}` 占位），入口不再提供可切换的类型下拉；买方选择器由类型推导，只有该类型的来源。
  - **未标记的历史单据**：`channel_id` 为空的单据（早于通道标记，买方可能也没有链接）**两个入口都不列出**——没法把它们归到任一类；表头计数就是官方列表 `channelIdsEmpty=true` 的 total（对**全部**「无通道」单据计数）。归类只有两条路：**带买方链接**（`customerSnapshot.internalSales.organizationId|partyId`）的用 `yarn mercato internal_sales backfill-trade-type --apply` **批量**打标；**没有链接**的回填会跳过（dry-run 报 `without a buyer link`），只能逐单在要归的那类入口的编辑页打开并保存——保存按入口类型打通道（见下条）。所以**计数不保证被命令清零**（本机 dev 库 2026-09-30 实测：扫描 8 单 → 4 已标记 · 4 无买家链接，`--apply` 没有可写项）。installed 列表页（`navHidden`，URL 可用）仍能读到它们。
  - **编辑跨类型单据会跳入口**：编辑页加载后比对单据自己的类型（通道优先、快照兜底），不一致即 `router.replace` 到该类型入口的编辑页；两者都没有（真·未标记）时按**所在入口**归类，保存即打该入口的通道。
  - **报价载入跟着入口类型走**：订单新建页「从报价单载入」的选择器按入口类型过滤（`loadQuoteOptions(query, channelId)`）；载入只填抬头与行，**不动类型**（入口固定，`adoptQuoteType` 已删）——选择器本就只列同类型的报价单，买方链接与通道不会互相矛盾。
- **回填历史单据**：`yarn mercato internal_sales backfill-trade-type`（默认 dry-run，`--apply` 才写，需 owner 批准）。分类规则＝快照链接（`internalSales.organizationId` → internal；`partyId` → external），**不做猜测**：没有链接的单据只报数（`skipped`），不会被打标。`customer_snapshot` 是加密列，所以 CLI 走官方实体 + 解密读取助手，而不是裸 SQL。
- **下游**：发运单的销售分摊选择器只列**对内**订单（`cross_border/components/shipmentFormOptions.ts` 传 `channelId=<internal>`）；对外订单不进出口分摊链。

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
编辑页专用名，避免下一个作者再按「详情页」去拼返回目标；教训见
[`.ai/lessons/edit-page-is-not-its-own-back-target.md`](../../../.ai/lessons/edit-page-is-not-its-own-back-target.md)。
**2026-09-29 起**：入口化的跳转统一走 `documentEditHrefForTradeType(kind, id, tradeType)`（哪个入口的编辑页
由单据自己的类型决定），不带类型的 `documentEditHref` 已删除——它只会算出对内那一条路径。

**四个 create/edit 页的面包屑（2026-09-29 修正）**：`quotes|orders/create` 与 `quotes|orders/[id]/edit` 的
面包屑此前是 `{ labelKey: 'internal_sales.page.title', href: '/backend/sales/{quotes,orders}' }`——标签是
「内部销售单据」一类的中性名，却链到**官方**列表，与本模块的列表/编辑页不同源。现在与 `purchasing`/`parties`
同款：面包屑第一级就是它要落到的**本模块列表**（`internal_sales.list.quote.title` →
`/backend/internal-sales/quotes`，订单侧同理），指向的页面与标签一致，也不再离开自建界面。
`internal_sales.page.title` 由此没有任何引用，两份字典里一并删掉（key 集合仍逐键一致）。

## 验证

```bash
yarn generate && yarn typecheck && yarn lint && yarn ds:check
npx jest src/modules/internal_sales                     # 买方值协议 / 快照 / 组织选项装配 / 报价载入 / 贸易类型 的单元测试（3 suites / 38 tests）
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
#  从报价单载入（2026-09-29 真机，dev + @open-mercato/core@0.8.0；探针单已删）：
#  报价 QUOTE-20260929-00022（买方=关联组织「俄罗斯 AB 有限公司」、USD、客户参考号 BR-42、备注、
#  1 行 LOWMOQ-1790586676106（变体 96861c70-…）12 × 26.5）→ 订单新建页「从报价单载入」→
#  选择器列出「QUOTE-20260929-00022 — 俄罗斯 AB 有限公司」→ 载入后抬头与行全部填入（含备注）、
#  flash「已从报价单 … 载入」+ 来源行 → 改数量 7 → 保存 → ORDER-20260929-00008，落库
#  metadata.internalSales.sourceQuote = { id, number }，行 product_id/product_variant_id/数量=7 保留；
#  订单编辑页显示「来源报价单 QUOTE-20260929-00022」并链接回报价编辑页；报价未变（仍在列表、行仍 12）。
#  报价列表行操作「按此报价新建订单」→ /orders/create?fromQuote=<id> 自动载入（同款结果）；表单已有输入时
#  载入先弹覆盖确认（destructive）。
#  403 分支（拦截 GET /api/sales/quotes → 403）：面板行内提示「没有读取报价单的权限。」、表单保持为空；
#  载入期间只发读请求。窄屏 420px 与深色模式已核对；读路径对照：同一订单 `?ids=` 返回 metadata=null、
#  `?id=` 返回已存来源键。
#  来源报价预览抽屉（2026-09-29 真机）：探针报价 QUOTE-20260929-00025（CNY、买方 Preview probe buyer、
#  1 行 PREVIEW-PROBE-1 / PV-1 · probe spec / 3 × 12.5）+ 由其创建的订单 → 订单编辑页点「来源报价单：QUOTE-20260929-00025」
#  → 右侧抽屉显示 报价单号/买方/币种/状态（—）/金额（未税）（—）/行数 1 + 明细行，**页面 URL 与表单值不变**（表单值对照
#  「Preview probe buyer」仍在）；抽屉页脚「打开报价单」在干净表单上直接跳到 /quotes/<id>/edit；中英文两版抽屉均已核对
#  （标题复用 `internal_sales.form.sourceQuote.label`）。探针报价与探针订单验后已删（`GET /api/sales/quotes` total 回到 2）。
#  入口 = 贸易类型（2026-09-30 真机，dev server 4100 + 独立 .env 端口块；数据为 dev 库现值）：
#  zh 侧边栏：「出口业务-对内销售」（对内销售报价单 / 新建对内销售报价单 / 对内销售订单（PO））与
#  「出口业务-对外销售」（对外销售报价单 / 对外销售订单）；切 en 同一屏为 “EXPORT OPERATIONS — INTERNAL SALES”
#  （Internal sales quotes / Internal sales orders (PO)）——无裸 key、无英文兜底串混进中文界面。
#  列表：`/backend/internal-sales/quotes` 2 行（= API `channelId=<internal>` 的 2 张 QUOTE-20260929-00023/00024），
#  列头无「类型」（报价单号/买方/状态/金额（未税）/行数/创建时间）；
#  `/backend/internal-sales/orders` 1 行（ORDER-20260929-00007）+ 提示「本组织有 4 张单据早于贸易类型标记…两个入口都不列出」
#  （API `channelIdsEmpty=true` total=4），`/backend/external-sales/orders` 1 行（ORDER-20260929-00011）+ 同一条提示，
#  两列表互不出现对方的单据；对外页描述指向「出口业务-对内销售」组。
#  表单：`/backend/internal-sales/quotes/create` 贸易类型只读「对内」+「本入口固定为「对内」…」（`{{type}}` 插值），
#  买方选择器只列「关联组织：俄罗斯 AB 有限公司 / 东南亚 AB 有限公司」；`/backend/external-sales/quotes/create`
#  同理只列「外部客户：E2E-CUST-474336 — …」；订单新建页「从报价单载入」选择器只列 2 张对内报价。
#  跨入口跳转：`/backend/internal-sales/orders/<对外单 id>/edit` → 落到 `/backend/external-sales/.../edit`；
#  反向亦然（内部单从对外入口进入会跳到对内入口的编辑页，标题「编辑对内销售订单（PO）」、类型只读「对内」）。
#  420px 窄屏 + 深色模式：列表无横向溢出（scrollWidth = innerWidth）。
#  状态生命周期（2026-09-30 真机，dev server + 本工作树 .env：OM_DISABLE_EMAIL_DELIVERY=true）：
#  ① 建单即草稿：`POST /api/sales/quotes`（带 `statusEntryId=<draft 条目>` + 快照 `contact.email`）→ 201，
#     读回 `status='draft'`、`statusEntryId` 指向本组织 draft 条目、快照含 contact.email；列表徽章显示 Draft、有效至 —。
#  ② 行操作门禁：draft 报价只有「编辑 / 发出报价 / 作废」——**没有**「转为订单 / 按此报价新建订单」。
#  ③ 发出报价：对话框（有效期默认 14 天）→ 引擎 `POST /api/sales/quotes/send` → 读回 `status='sent'`、
#     `valid_until` = 14 天后；列表该行显示 Sent + 「有效至 2026年10月14日」；
#     行操作变为「编辑 / 重新发出 / 按此报价新建订单 / 转为订单 / 作废」——**门禁随状态打开**。
#  ④ 订单确认/作废：draft 订单行操作「确认订单」→ 读回 `status='confirmed'`；「作废」→ `canceled`。
#  ⑤ 发运分摊门禁：`/backend/cross_border/shipments/create` 的「对内销售订单」选择器只出现
#     `ORDER-20260930-00029`（confirmed）与 `ORDER-20260929-00007 (未标记状态)`（历史 NULL）；
#     被作废的订单**不出现**（同一页面对照）。探针单据验后已删（列表回到 2 张报价 / 6 张订单）。
#  评审修订后的复验（2026-09-30，同一 dev server）：
#  ⑥ 作废一张 **sent** 报价（两步写入：引擎撤回 + 置 canceled）→ 读回 `status='canceled'`（此前一次 PUT 会被引擎复位成 draft）；
#  ⑦ 「转为订单」一张 sent 报价 → 生成的订单 `status='sent'`，订单列表出现「确认订单」→ 确认后 `status='confirmed'`；
#  ⑧ 「从报价单载入」选择器只列可下单的报价（draft 报价不出现），`/orders/create?fromQuote=<draft id>` 行内提示「这张报价还没有发出或已作废，不能下单。」且不填单；
#  ⑨ 编辑一张 sent 报价 → 表单顶部出现横幅「保存会把状态退回草稿并作废已发链接，需要时请重新发出。」；
#  ⑩ 「有效至」只对仍为 `sent` 的报价显示（撤回成 draft 的报价显示 —）。探针单据验后已删（回到 2 张报价 / 6 张订单）。
```

## 回滚

从 `src/modules.ts` 移除 `{ id: 'internal_sales', from: '@app' }` 并 `yarn generate`；本模块没有自己的表与迁移
（无 DDL 可回退），单据数据仍在官方 `sales_*` 表里，不受影响。同时把 `sales` 的 `routes.pages` 覆盖去掉即可恢复
官方新建页的侧边栏入口——该覆盖只改导航可见性，那些 URL 一直是可解析的。
