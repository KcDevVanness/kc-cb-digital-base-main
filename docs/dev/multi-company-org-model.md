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
功能位 id 的权威清单是各模块的 `src/modules/<id>/acl.ts`（`yarn generate` 后进 ACL 面板），下表只列每个角色**至少**要有的组；
业务面已由自建模块接管（`products`/`purchasing`/`sourcing`/`trade_docs`/`cross_border`/`export_finance`/`parties`/`platform_ops`/`internal_sales`），
官方 `catalog`/`sales`/`wms` 的功能位只在对应官方页面/引擎仍被使用时才需要。

| 角色 | 组织范围 | 功能位 | 备注 |
|---|---|---|---|
| `group-admin` 集团管理层 | 留空（全部组织） | `auth.users.*`、`auth.roles.*`、`auth.acl.manage`、`directory.organizations.view/manage`、`directory.tenants.view` + 各业务模块所需 view/manage | 总部；**唯一**可持有 `directory.organizations.manage` 的角色（见"注意"第 1 条） |
| `hq-sales` 总部外贸/采购 | `kaicui` | `products.items.view/manage`、`products.categories.manage`、`products.prices.manage`、`parties.view/manage`、`purchasing.suppliers.view/manage`、`purchasing.orders.view/manage`、`sourcing.quotes.view/manage`、`sourcing.import.run`、`sourcing.promote.run`、`trade_docs.contracts.view/manage`、`trade_docs.invoices.view/manage`、`cross_border.shipments.view/manage`、`sales.quotes.view/manage`、`sales.orders.view/manage` | 建供应商/采购单/报价、购销合同与发票、发运单；对分公司的内部销售也走这里 |
| `hq-finance` 总部财务/汇总 | 留空（默认即全集团） | `export_finance.orders.view`、`export_finance.cabinets.view`、`export_finance.manage`、`purchasing.payments.manage`、`purchasing.orders.view`、`trade_docs.*.view`、`platform_ops.settlements.view`、`platform_ops.reconciliation.view`、`sales.payments.manage`、`wms.view` + 仪表盘 | 只读汇总 + 收付款/收汇退税登记 |
| `<分公司>-admin` | 本公司组织 | `auth.users.list/create/edit/delete`、`auth.roles.list/manage`、`auth.acl.manage`、`directory.organizations.view` | **不给** `directory.organizations.manage` |
| `<分公司>-operator` | 本公司组织 | `sales.orders.view/manage`、`sales.quotes.view/manage`、`sales.shipments.manage`、`sales.channels.view/manage`、`products.items.view`、`parties.view`、`catalog.products.view`、`wms.view` | 日常运营（跨境电商） |
| `<分公司>-warehouse` | 本公司组织 | `wms.view`、`wms.receive_inventory`、`wms.manage_inventory`、`wms.adjust_inventory`、`wms.cycle_count`、`wms.manage_reservations`、`wms.manage_locations`、`catalog.products.view` | 收货入库、盘点；收货按变体入账，需能读目录商品 |

## 配置步骤

1. **组织**：`/backend/directory/organizations` → 新分公司以**总部**为父组织（不要挂到别的分公司下）；核对已有组织的父子关系。
2. **角色**：`/backend/roles/create` 建角色 → `/backend/roles/{id}/edit` → ACL 面板勾功能位（依赖项如 `products.items.manage` → `products.items.view`、`purchasing.orders.manage` → `purchasing.orders.view` 会提示，按提示一并勾；币种下拉还要 `currencies.view`，那是自建路由 `GET /api/currency_policy/currencies` 的门禁）→ 设 Organizations scope → 保存。
3. **账号**：`/backend/users/create` → 选目标组织（分公司账号选分公司组织）+ 分配角色。
4. **总部汇总**：总部角色留空组织范围即可；如需一次看全部组织，用顶栏切换器选"全部组织"。

## 验证方式

配置完成后按三条自查（等价于自动化验证场景）：

1. 分公司业务员账号登录 → 自建商品/订单列表（`/backend/products/items`、`/backend/sales/orders`）**只出现本公司数据**；组织切换器里总部为**灰色不可选**，其他分公司**不出现**。
2. 分公司管理员账号 → 试图把某角色的 Organizations scope 设为"全部组织" → 应报 403（`Cannot grant unrestricted organization access`）。
3. 集团账号登录 → 默认视图含总部 + 全部下级；组织切换器可选"全部组织"。

跨组织写入加固（创建用户的目标组织、ACL 归属）见 `.ai/specs/2026-09-21-auth-scope-guard-hardening.md`；该 spec 落地后，上表"分公司管理员"的能力边界由框架强制。

## 注意

1. **`directory.organizations.manage` 不下放给分公司管理员**：组织写操作目前只校验租户、不校验操作者组织范围，而组织树的父子关系直接决定可见范围（把自己的组织设为他人父组织 = 获得对方数据可见性）。认证域的三条写路径（建用户的目标组织、角色/用户 ACL 归属）已由 `scope_guards` 封堵（[`.ai/specs/2026-09-21-auth-scope-guard-hardening.md`](../../.ai/specs/2026-09-21-auth-scope-guard-hardening.md)，同一 spec 明确把本缺口列为**不在范围内**），**组织树写操作这条缺口仍未修、也还没有 spec**，落地前只给总部。
2. **业务数据按组织私有**：产品、客户、订单、仓库都是组织级；总部"一份产品卖给所有分公司"需要在各目标组织各自建（或后续做分发）。**字典也是组织级 + 父组织继承**：`dictionaries.organization_id` 决定归属，子组织能读上级组织的词表（页面上标「继承」），但写只落在当前选中组织；因此同一 key 在每个组织各有一份（`currency`、`supplier_product_unit`…），`/backend/config/dictionaries` 会按组织分组显示归属、只放开当前组织的写（见 [`src/modules/dictionaries/README.md`](../../src/modules/dictionaries/README.md)）。顶栏选「所有组织」时该页整页只读：该状态下 API 会把写落到账号归属组织，不要依赖这一点。自定义字段定义等其余主数据是租户级共享（设计如此）。
3. **功能开关是租户级**，不是组织级（`feature_toggle_overrides` 只按租户）；需要按组织区分的行为走 `configs:module_config`（支持 tenant + organization）。
4. **组织切换靠 cookie**：浏览器端正常；脚本/机器人调 API 需自行带 `om_selected_org`，否则落在账号 home org。
