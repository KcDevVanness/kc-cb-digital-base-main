# 多公司组织模型与权限配置

## 适用范围

本文件规定"一个集团、多家公司"在本系统里的建模方式与后台配置步骤：租户与组织的关系、组织树形状、各公司账号与角色的划法、总部汇总与分公司隔离的开关位置。

适用于：新增/调整分公司、给分公司配管理员、排查"某账号看不到数据 / 看到了不该看的数据"。

不适用于：产品需求定义（→ `../prd/`）、上线与生产环境（→ `../deploy/`）。

## 结论：一个租户 + 组织树

```
tenant: 广州凯翠国际贸易有限公司        ← 隔离边界，全集团唯一
└─ organization: kaicui  广州凯翠国际贸易有限公司（总部/外贸，根）
   ├─ organization: ru   俄罗斯 AB 有限公司（分公司）
   └─ organization: …    后续东南亚各分公司（一律挂在总部之下）
```

**为什么不是"一家公司一个租户"**（依据见下）：

1. **跨租户没有读取路径**（除 superadmin 用 cookie 切租户，且仍是"一次看一个租户"，不是合并视图）。一公司一租户 ⇒ "总部打通分公司数据"无路可走。
2. **内部贸易需要双方在同一隔离域**：销售单证的关联对象（客户、仓库）在命令层强制同组织（跨组织写入 403）。
3. **"总部看全部、分公司只看自己"是框架一等能力**：ACL 的组织白名单 + 组织树后代展开。

## 本部署现状（2026-09-28 已建成）

组织树与上面「目标形状」一致（`/backend/directory/organizations`）：

| 组织 | id | slug | 说明 |
|---|---|---|---|
| 广州凯翠国际贸易有限公司 | `9279aeeb-3fa4-42f6-8ee1-0071293e5776` | `kaicui` | 主体/根。由原演示组织 `Acme Corp` **改名**而来（id 未变），已有主数据因此留在主体；租户名同步改为「广州凯翠国际贸易有限公司」 |
| 俄罗斯 AB 有限公司 | `fb381e5e-7855-4915-bc43-99a2951a3ef9` | `ru` | 分公司，`parentId` = 主体 |
| 东南亚 AB 有限公司 | `c608b673-6722-478a-83e9-6290dadb47b6` | `sea` | 分公司，`parentId` = 主体 |

角色与账号（照「角色矩阵」建；组织范围 = 各自分公司组织，admin **没有** `directory.organizations.manage`）：

| 角色（租户内唯一，带分公司前缀） | 账号（**dev 密码 `Branch2026!`**，投产前必须改） | 功能位 |
|---|---|---|
| `ru-admin` / `sea-admin` | `ru-admin@acme.com` / `sea-admin@acme.com` | `auth.users.list/create/edit/delete`、`auth.roles.list/manage`、`auth.acl.manage`、`directory.organizations.view` |
| `ru-operator` / `sea-operator` | `ru-operator@acme.com` / `sea-operator@acme.com` | `sales.orders.view/manage`、`sales.quotes.view/manage`、`sales.shipments.manage`、`sales.channels.view/manage`、`products.items.view`、`parties.view`、`parties.manage`、`our_parties.view`、`catalog.products.view`、`wms.view`、`currencies.view` |
| `ru-warehouse` / `sea-warehouse` | `ru-warehouse@acme.com` / `sea-warehouse@acme.com` | `wms.view`、`wms.receive_inventory`、`wms.manage_inventory`、`wms.adjust_inventory`、`wms.cycle_count`、`wms.manage_reservations`、`wms.manage_locations`、`catalog.products.view` |
| `hq-operator`（总部侧，2026-09-28 建） | `hq-operator@acme.com`（**dev 密码 `HqOperator2026!`**，投产前必须改） | `sales.orders.view/manage`、`sales.quotes.view/manage`、`sales.shipments.manage`、`sales.channels.view/manage`、`products.items.view/manage`、`products.prices.manage`、`parties.view/manage`、`catalog.products.view`、`directory.organizations.view`、`wms.view`、`currencies.view`（组织范围留空） |

- 相对角色矩阵的两处**补充**（都写在功能位一列里）：operator 多 `parties.manage`（分公司维护**自己**的外部客户档案）与 `currencies.view`（币种下拉的门禁，见「配置步骤」第 3 条的括号说明）。
- **我方主体档案（`our_parties`，2026-09-30）**：我们自己的公司抬头与银行按**组织**维护（`/backend/our-parties`），合同/PI/CI 的「我方主体（主数据）」选择器读组织链并回填；单据角色因此需要 `our_parties.view`（下表已补）。
- **分公司打印档案**：`parties` 里的 `RU-AB` / `SEA-AB`（角色只给 `branch`，建在**主体**组织的档案里）——供合同/PI/CI 的对手方打印块；银行与地址待业务补录。内部销售单据的买方是**组织**（「关联组织」），不走这份档案，因此它不会出现在内部销售买方下拉的「外部客户」分组（该分组只列角色 `buyer` 的档案，见 [`.ai/specs/2026-09-28-internal-sales-buyer-linkage.md`](../../.ai/specs/2026-09-28-internal-sales-buyer-linkage.md)）。
- **词表已就位**：两个分公司都跑过 `seed:defaults --module currency_policy`（币种 16 条 + FX 主数据）与 `--module sales`（`sales.*` 状态字典、税率、收付款/运输方式），所以分公司的报价单能选币种、列表能渲染状态标签——实测分公司业务员建单返回 201（自己的单号序列 `QUOTE-20260928-00001`，探针单已删）。
- **分公司可以自己维护外部客户**：operator 在 `/backend/parties/create` 填 编码/名称 + 勾「买方」→ Save（实测 `POST /api/parties` **201**），该客户立即出现在**本组织**买方下拉的「外部客户：」分组并能自动回填买方名称；HQ 的同一下拉**不会**出现它（内部销售选择器按所选组织收窄；不带 `organizationId` 的裸选项路由会按平台读语义展开到下级组织，应用内选择器一律收窄）。分公司的对手方列表也只显示本公司数据。
- **商品按分发副本共享（2026-09-28 已实现；2026-10-10 起在官方 catalog 上重造）**：总部在 `/backend/products/items` 用行操作/表头「分发到分公司」把 catalog 商品（字段 + 变体 + 首次价格）复制进选中的分公司组织，副本用 `source_product_id`（`product_erp` 自定义字段）回指来源；重复分发只更新字段，**价格在分公司侧自管**；分公司自建同 SKU 时该 SKU 跳过并报告。共享读路径已否决（会破坏「分公司看不到上级」的可见性不变量）。spec：[`.ai/specs/2026-09-28-product-distribution-to-branches.md`](../../.ai/specs/2026-09-28-product-distribution-to-branches.md) 的语义 + [`.ai/specs/2026-10-10-catalog-single-store.md`](../../.ai/specs/2026-10-10-catalog-single-store.md)（新存储）。

## 机制（决定可见范围的三件事）

| 机制 | 位置 | 语义 |
|---|---|---|
| 组织白名单 `organizations_json` | 角色 ACL / 用户 ACL（`/backend/roles/{id}/edit`、`/backend/users/{id}/edit` 的 "Organizations scope"） | 留空 = **全部组织**；勾选 = 仅这些组织 **+ 其后代** |
| 组织树 | `/backend/directory/organizations`（`parentId`） | 选中一个组织 ⇒ 读写范围 = 它 + 全部后代；**不含父级** |
| 选中组织 cookie | 顶栏组织切换器（`om_selected_org`） | 读范围按它收敛；**非超管默认 = 自己所在组织 + 其后代** |

三条推论：

- **总部账号的默认视图 = 总部 + 全部下级**，因此"分公司都挂总部之下"这一形状直接决定集团汇总是否开箱可用；要看全部组织还可在切换器选"全部组织"。
- **分公司账号看不到同级、也选不到上级**：切换器只列出可访问组织（上级节点仅作层级上下文、`selectable:false`）。
- 角色按"选中组织 + 其祖先链"生效，所以"授予子公司的角色"在总部视图下不生效，反之成立。

## 角色矩阵（照此配置）

勾选位置：`/backend/roles/{id}/edit` → ACL 面板先勾功能位、再设 Organizations scope。角色名在租户内唯一，分公司角色加前缀。
功能位 id 的权威清单是各模块的 `acl.ts`——**已装模块在包内** `node_modules/@open-mercato/core/src/modules/<id>/acl.ts`，**app 自有模块**在 `src/modules/<id>/acl.ts`（`yarn generate` 后进 ACL 面板），下表只列每个角色**至少**要有的组；
业务面已由自建模块接管（`products`/`purchasing`/`sourcing`/`trade_docs`/`cross_border`/`export_finance`/`parties`/`platform_ops`/`internal_sales`），
官方 `catalog`/`sales`/`wms` 的功能位只在对应官方页面/引擎仍被使用时才需要。

| 角色 | 组织范围 | 功能位 | 备注 |
|---|---|---|---|
| `group-admin` 集团管理层 | 留空（全部组织） | `auth.users.*`、`auth.roles.*`、`auth.acl.manage`、`directory.organizations.view/manage`、`directory.tenants.view` + 各业务模块所需 view/manage | 总部；**唯一**可持有 `directory.organizations.manage` 的角色（见"注意"第 1 条） |
| `hq-sales` 总部外贸/采购 | `kaicui` | `products.items.view/manage`、`products.prices.manage`、`parties.view/manage`、`purchasing.suppliers.view/manage`、`purchasing.orders.view/manage`、`sourcing.quotes.view/manage`、`sourcing.import.run`、`sourcing.promote.run`、`trade_docs.contracts.view/manage`、`trade_docs.invoices.view/manage`、`our_parties.view/manage`、`cross_border.shipments.view/manage`、`sales.quotes.view/manage`、`sales.orders.view/manage` | 建供应商/采购单/报价、购销合同与发票、发运单；对分公司的内部销售也走这里 |
| `hq-finance` 总部财务/汇总 | 留空（默认即全集团） | `export_finance.orders.view`、`export_finance.cabinets.view`、`export_finance.manage`、`purchasing.payments.manage`、`purchasing.orders.view`、`trade_docs.*.view`、`platform_ops.settlements.view`、`platform_ops.reconciliation.view`、`sales.payments.manage`、`wms.view` + 仪表盘 | 只读汇总 + 收付款/收汇退税登记 |
| `<分公司>-admin` | 本公司组织 | `auth.users.list/create/edit/delete`、`auth.roles.list/manage`、`auth.acl.manage`、`directory.organizations.view` | **不给** `directory.organizations.manage` |
| `<分公司>-operator` | 本公司组织 | `sales.orders.view/manage`、`sales.quotes.view/manage`、`sales.shipments.manage`、`sales.channels.view/manage`、`products.items.view`、`parties.view`、`our_parties.view`、`catalog.products.view`、`wms.view` | 日常运营（跨境电商） |
| `<分公司>-warehouse` | 本公司组织 | `wms.view`、`wms.receive_inventory`、`wms.manage_inventory`、`wms.adjust_inventory`、`wms.cycle_count`、`wms.manage_reservations`、`wms.manage_locations`、`catalog.products.view` | 收货入库、盘点；收货按变体入账，需能读目录商品 |
| `hq-operator` | **留空**（= 全部组织；默认视图为总部 + 全部下级） | `sales.orders.view/manage`、`sales.quotes.view/manage`、`sales.shipments.manage`、`sales.channels.view/manage`、`products.items.view/manage`、`products.prices.manage`、`parties.view/manage`、`our_parties.view/manage`、`catalog.products.view`、`directory.organizations.view`、`wms.view`、`currencies.view` | 总部业务员：开内部销售单（买方 = 分公司）+ 维护商品（catalog）与三档价 + 分发到分公司。分类/编码规则功能位已随单一存储改造退役（2026-10-10）；`directory.organizations.manage` 不给 |

## 配置步骤

1. **组织**：`/backend/directory/organizations` → 新分公司以**总部**为父组织（不要挂到别的分公司下）；核对已有组织的父子关系。
2. **词表与单据基线**：新组织建成后为它跑一次参考数据种子 —— `yarn mercato seed:defaults --module currency_policy`（币种字典、FX 主数据、抓取配置）与 `yarn mercato seed:defaults --module sales`（报价/订单状态字典、税率、收付款与运输方式；按需再补其他模块）。**不跑这一步，新分公司的币种下拉是空的**：`GET /api/currency_policy/currencies` 只读「当前组织 + 后代」的字典副本，**不向上**取父组织的（「父组织继承」只在字典库页面与平台通用读路径生效），少了它报价单连币种都选不出来。种子幂等，可重复跑（HQ 侧重跑为零变更）。
3. **角色**：`/backend/roles/create` 建角色 → `/backend/roles/{id}/edit` → ACL 面板勾功能位（依赖项如 `products.items.manage` → `products.items.view`、`purchasing.orders.manage` → `purchasing.orders.view` 会提示，按提示一并勾；币种下拉还要 `currencies.view`，那是自建路由 `GET /api/currency_policy/currencies` 的门禁）→ 设 Organizations scope → 保存。
4. **商品分发**：新分公司要对外销售，就在总部 `/backend/products/items` 用行操作/表头「分发到分公司」把商品（catalog 商品 + 变体 + 首次价格）发过去（详见 `src/modules/products/README.md` 的「表面」一节）；不发就是空的（商品按组织存在，系统不做隐式共享）。
5. **仓库与库位**：为每个分公司建一个仓库并**至少建一个库位**（类型 `bin`，如 `A-01`）——入口是左侧菜单的 **WMS** 组：仓库 `/backend/wms/warehouses`、库位 `/backend/wms/locations`（该组自 2026-09-30 起进主菜单，此前只能 URL 直达，见 [`architecture.md`](./architecture.md) 的隐藏策略；建仓库要 `wms.manage_warehouses`、建库位要 `wms.manage_locations`）。收货是「仓库 + 库位 + 目录变体」三元组：`wms.inventory.receive` 的 `locationId` 必填，且库位必须属于该仓库（否则 422 `invalid_location`），变体取不到同样 422（见 `src/modules/cross_border/README.md`）。**本部署现状**：俄罗斯 `RU-FULLOG`、东南亚 `SEA-WH-01`，各含库位 `A-01`（2026-09-28 实测收货 1 件 → 200、余额回落 0）。
6. **账号**：`/backend/users/create` → 选目标组织（分公司账号选分公司组织）+ 分配角色。
7. **总部汇总**：总部角色留空组织范围即可；如需一次看全部组织，用顶栏切换器选"全部组织"。

## 验证方式

配置完成后按三条自查（等价于自动化验证场景）：

1. 分公司业务员账号登录 → 自建商品/订单列表（`/backend/products/items`、`/backend/sales/orders`）**只出现本公司数据**；组织切换器里总部为**灰色不可选**，其他分公司**不出现**。
2. 分公司管理员账号 → 试图把某角色的 Organizations scope 设为"全部组织" → 应报 403（`Cannot grant unrestricted organization access`）。
3. 集团账号登录 → 默认视图含总部 + 全部下级；组织切换器可选"全部组织"。

跨组织写入加固（创建用户的目标组织、ACL 归属）见 `.ai/specs/2026-09-21-auth-scope-guard-hardening.md`；该 spec 落地后，上表"分公司管理员"的能力边界由框架强制。

**已实测（2026-09-28，本部署两个分公司）**：6 个账号均可登录；每个角色的功能位按上表生效（`POST /api/auth/feature-check` 逐项核对，越权功能一律 false）；分公司业务员的切换器里总部为 `selectable:false`、同级分公司不出现；分公司管理员把角色 scope 设为「全部组织」→ **403** `Cannot grant unrestricted organization access`、设为 HQ 组织 → **403**、把用户建到 HQ 组织 → **403** `scope_guards.user_destination_outside_scope`；分公司业务员在 HQ 上下文读商品/单据 → **422**、读对手方 → **空列表**（无跨组织泄漏）；分公司业务员的报价单页币种下拉 16 项、买方下拉零选项（不能向上/同级）。

**分公司对外销售已实测（2026-09-28）**：商品分发后，俄罗斯/东南亚业务员各自的行选品器都能搜到本公司副本（`P570 — Fresh Element SOLO Smart Pet Feeder`）、币种下拉含东南亚本币集；俄罗斯业务员在 UI 里用副本商品建报价单成功（`POST /api/sales/quotes` **201**、单号 `QUOTE-20260928-00002`、合计 37.00、行的 `productId` = 副本 id、`catalogSnapshot` 冻结 sku/name/spec，探针单已删）。买方手工填名时快照 `{name, customer.displayName}`；有客户档案/分公司对手方后改选即带链接。

## 注意

1. **`directory.organizations.manage` 不下放给分公司管理员**：组织写操作目前只校验租户、不校验操作者组织范围，而组织树的父子关系直接决定可见范围（把自己的组织设为他人父组织 = 获得对方数据可见性）。认证域的三条写路径（建用户的目标组织、角色/用户 ACL 归属）已由 `scope_guards` 封堵（[`.ai/specs/2026-09-21-auth-scope-guard-hardening.md`](../../.ai/specs/2026-09-21-auth-scope-guard-hardening.md)，同一 spec 明确把本缺口列为**不在范围内**），**组织树写操作这条缺口仍未修、也还没有 spec**，落地前只给总部。
2. **业务数据按组织私有**：商品（catalog 表同样是组织级的 `organization_id`）、客户、订单、仓库都是组织级；总部「一份商品卖给所有分公司」由**分发副本**解决（总部商品列表的「分发到分公司」动作，见上）--不发就是空的，系统不做隐式共享。**字典也是组织级 + 父组织继承**：`dictionaries.organization_id` 决定归属，子组织能读上级组织的词表（页面上标「继承」），但写只落在当前选中组织；因此同一 key 在每个组织各有一份（`currency`、`supplier_product_unit`…），`/backend/config/dictionaries` 会按组织分组显示归属、只放开当前组织的写（见 [`src/modules/dictionaries/README.md`](../../src/modules/dictionaries/README.md)）。顶栏选「所有组织」时该页整页只读：该状态下 API 会把写落到账号归属组织，不要依赖这一点。自定义字段定义等其余主数据是租户级共享（设计如此）。
3. **功能开关是租户级**，不是组织级（`feature_toggle_overrides` 只按租户）；需要按组织区分的行为走 `configs:module_config`（支持 tenant + organization）。
4. **组织切换靠 cookie**：浏览器端正常；脚本/机器人调 API 需自行带 `om_selected_org`，否则落在账号 home org。
