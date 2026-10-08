# 导航（后台侧边栏树）

**放**：后台侧边栏「域 → 模块 → 页面」树的结构、维护入口、偏好与权限语义、已知限制、回滚。

**不放**：产品口径（→ `../prd/`）、单个模块的业务规则（→ `../modules/`、各模块 README）。

## 结构

侧边栏由 app 模块 `nav_shell` 自绘，不再使用框架内置的平铺列表：

```
公司订单 ─ 对内销售订单 / 对外销售订单 / 采购单
业务办理 ─ 采购（供应商 / 供应商产品库 / 供应商报价单）
         ─ 出口销售（对内报价单 / 对外报价单）
         ─ 合同与单据（购销合同 / 形式发票 / 商业发票 / 税务发票台账）
         ─ 发运与装箱（发运单 / 装箱单）
财务 ─ 订单档案 / 柜档案 / 逾期清单 / 柜费用 / 到岸成本 / 期间费用 / 应付台账 / 应收台账
经营概览 ─ 老板驾驶舱 / 月损益 / SKU 毛利 / 库存资金占用
仓储与库存 ─ WMS 首页 / 库存 / 仓库 / 库区 / 库位 / 批次 / 移动 / 预留
平台运营 ─ 渠道 / 订单镜像 / 结算单 / 对账
数据同步 ─ SKU 映射 / 同步健康
基础数据 ─ 商品主数据 / 产品分类 / 编码规则 / 交易对手 / 我方主体 / 字典维护
系统 ─ 用户 / 角色 / 组织 / 租户 / 实体记录 / 系统实体 / 附件库
```

- 配置单点真源：`src/modules/nav_shell/lib/navTree.ts`（`NAV_TREE`）；页面的标题、图标与过滤功能位
  取自该页 `page.meta.ts`，不在此重复。
- 明确不进树的页面（新建页、被 app 模块取代的安装层页面等）在 `TREE_EXCLUDED` 里逐条带理由登记；
  `navTree.coverage.test.ts` 会拦住「新增页面忘了登记」。
- 实现契约与回滚：`src/modules/nav_shell/README.md`。

## 新增一个页面之后

1. 在 `NAV_TREE` 的对应节点加 `{ href: '/backend/…' }`，或加进 `TREE_EXCLUDED` 并写理由。
2. `yarn generate`（页面的 `page.meta.ts` 进路由清单）+ `yarn jest --config jest.config.cjs src/modules/nav_shell`。

## 偏好与权限

| 事项 | 语义 |
|---|---|
| 谁能看到哪些条目 | 页面 `requireFeatures` 是唯一闸门；树按调用方的**有效功能位**在服务端删除无权条目，节点因此空掉时一起消失。超管视为不受限（响应里 `featureFiltered: false`，客户端不再二次过滤） |
| 谁能自定义 | 与平台一致：`/backend/sidebar-customization`（app 遮蔽安装层同名页面，编辑对象 = 本树），写偏好需要 `auth.sidebar.manage` |
| 偏好层级 | 角色偏好 → 用户偏好（用户覆盖角色）；键：域 = 节点 id（`tree:orders`）、模块节点 = 显式 id（`tree:module:purchasing`）、页面 = `href` |
| 隐藏 | `hiddenItems` 是显示开关，与授权无关；条目保留在编辑器里以便「重新显示」 |
| 排序 | 域内条目排序（`itemOrder`）由本模块应用——安装层只保存不读取；编辑器只在域的顶层支持拖拽排序，嵌套条目支持隐藏/改名 |
| 语言 | 页面条目用该页自己的 `titleKey`（zh/en 已随页面提供）；域与模块节点用 `nav_shell.*` 键（`src/modules/nav_shell/i18n/`） |

## 已知限制

- **框架自带的侧边栏搜索框失效**：壳在侧栏上方渲染的搜索框过滤的是内置分组，而分组已被置空；本树在它下方自带搜索框（占位文案：`搜索导航`）。要移除前者需要框架提供开关。
- **设置类页面**（用户 / 角色 / 组织 / 租户 / 实体）在树里可达，但停留在这类页面上时壳会切到设置侧栏，树暂时消失——这是壳的既有行为。
- **历史组级偏好失效一次**：旧 `*.nav.group` 组键不再匹配新的 `tree:*` 域 id；条目级（href）偏好不受影响。在 `/backend/sidebar-customization` 重设即可。

## 自查

```bash
yarn jest --config jest.config.cjs src/modules/nav_shell
curl -s -b "$COOKIE" "$APP_URL/api/nav_shell/chrome" | jq '.groups'       # []
curl -s -b "$COOKIE" "$APP_URL/api/nav_shell/tree"   | jq '.groups[].name' # 9 个域
```

浏览器：9 个域、无平铺重复、逐级折叠、活跃高亮、关键词过滤、折叠态只显示图标、≤420px 抽屉内可用；
只授 `cross_border.shipments.view` 的账号只见「业务办理 → 发运与装箱」，直接访问
`/backend/finance/payables` 仍被页面门禁拒绝。

## 回滚

`adminNavApi` 改回 `/api/auth/admin/nav`、去掉 `mobileSidebarSlot`、从 `src/modules.ts` 移除
`nav_shell`、删除 `src/modules/auth/backend/sidebar-customization/`——内置平铺列表原样回来
（`nav.groupOrder` 与各页 `pageGroup` 从未改动）。
