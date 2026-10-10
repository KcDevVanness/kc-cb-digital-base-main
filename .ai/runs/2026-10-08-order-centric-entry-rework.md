# 公司订单主维度的入口重构（菜单收敛 + 服务端分页 + 订单为根的填写面）

Source doc: `.ai/specs/2026-10-08-order-centric-entry.md`（REQ-001/002/003/005 的后续返工）
Owner review 六个问题：入口已归集到公司订单，但菜单仍按旧模块平铺；工作台用「加载更多」而非正常分页；
新建入口仍是按流程分模块（三个按钮），没有走订单为根、详情内逐块补全的形态；对内/对外销售订单仍各有
一套入口；「系统」域条目没有图标；菜单组织整体需要重构。

口径（owner 明确）：公司订单是一套**全新的组织入口**，旧模块页面退化为「填写/台账」层——写入全部发生在
订单详情里，旧列表只在台账入口与填写跳转里出现。

## 决策速览

|#|决策|
|---|---|
|D1|侧边栏隐藏整个「业务办理」域；其页面只在订单填写（hub 分区块）与台账入口出现|
|D2|「公司订单」域 = 订单工作台 + 4 个只读台账入口：采购单台账 / 合同台账 / 单据台账 / 发运台账|
|D3|供应商 / 供应商产品库 / 供应商报价单 → 「基础数据」域|
|D4|销售报价单（对内/对外）不进树，只从「新建订单」流程与旧 URL 进入|
|D5|取消独立的对内/对外销售订单列表入口：工作台是唯一入口|
|D6|订单详情 hub 迁到 `/backend/orders/<id>`；旧 detail URL 重定向过去|
|D7|工作台只保留「新建订单」（选贸易类型）；采购单的建单入口在采购台账页与订单详情的采购分区|
|D8|采购台账页保留自己的「新建采购单」（无来源订单的采购单合法）|
|D9|工作台分页改为服务端聚合 API，真 `total` + 页码|
|D10|订单详情是唯一的填写面：采购/发运/合同/单据/收汇退税 都在 hub 的 RelatedSection 块里补|
|D11|（owner 复审 2026-10-08，取代 D1/D2/D3/D4 的分组口径）公司订单 = 订单工作台 + **采购 / 出口销售 / 合同与单据 / 发运与装箱 四个二级组**（三级为页面）；供应商 / 供应商产品库 / 供应商报价单 挂在「采购」下（基础数据不再含这三页）；对内/对外销售报价单在「出口销售」下回归树；上一版的四个「台账」节点取消（组内页面即台账）；对内/对外销售订单列表仍不进树（D5 不变）|

## 三个工作单元（一个单元 = 一个工作树 = 一个分支 = 一个 PR）

1. `feat/order-centric-menu-rework` — 菜单收敛与图标（D1–D4、D6 的树侧；D11 复审后为最终结构）
   - `nav_shell/lib/navTree.ts`：删除 `tree:operations` 域；`tree:orders` = 工作台 + 采购 / 出口销售 /
     合同与单据 / 发运与装箱 四个二级组（D11）；`tree:master_data` 保持原有六项；两个订单列表登记
     `TREE_EXCLUDED`（带原因）。
   - `NavTreeLeaf.iconName` + `buildLeaf` 的解析优先级（页面元数据的字符串图标优先，配置兜底），
     「系统」域 7 条写死图标。
   - i18n zh/en 各 4 个业务组键；覆盖率/构建单测更新；README 与 `docs/dev/navigation.md` 更新。
2. `feat/order-hub-aggregate-paging` — 服务端聚合列表与真实分页（D9）
   - `order_hub/lib/mergeOrders.ts`（纯函数：跨源归并/去重/切片/合计/行映射）。
   - `order_hub/api/orders/route.ts`：手写守卫路由，转调各模块自己的列表处理器（不跨模块解密），
     扫描窗口 `MAX_SCAN_PER_SOURCE = 500`，`total` 语义与 `totalIsCapped` 写进 `openApi` 与 README。
   - `OrderWorkbench` 取数层重写：单请求、服务端 `total`、筛选进参数、工具栏收敛为单个「新建订单」。
3. `feat/order-detail-root` — 订单为根的填写面（D5、D6、D7、D10）
   - hub 组件搬到 `order_hub`，`/backend/orders/[id]`（`navHidden`），交易类型由数据（渠道标记）判定。
   - 旧列表/详情 URL 重定向到工作台/hub；工作台读取 `?type=` 初始筛选。
   - 建单保存后落到 hub；分区块文案统一为「去填写 X」/空态「点这里补一张」。

## Progress

> 约定：`- [ ]` 未完成，`- [x]` 已完成，附 commit sha。

### Phase 1：菜单收敛与图标（`feat/order-centric-menu-rework`）

- [x] 1.1 `NAV_TREE` 重写（公司订单 = 工作台 + 4 台账；删除业务办理域；基础数据追加供应商三页；退役入口登记）
- [x] 1.2 leaf `iconName` + `buildLeaf` 解析优先级 + 系统域 7 个图标
- [x] 1.3 i18n zh/en 4 个台账键（删 5 个退役键，zh/en 各 19 键）
- [x] 1.4 覆盖率/构建单测更新 + README
- [x] 1.5 验证：nav_shell jest 绿、故意删条必须红、浏览器侧边栏与直链 200 → 门禁与 PR（commit `c25f773`；门禁 `EXIT=0`）
- [x] 1.6 owner 复审（D11）：公司订单下四个二级业务组（采购/出口销售/合同与单据/发运与装箱）、取消台账节点、供应商三页回到「采购」、报价单回树；i18n 与单测跟进；`docs/dev/navigation.md` 同步
- [x] 1.7 复审后重跑验证：nav_shell jest、浏览器二级/三级展开、门禁复跑（commit `c96d775`，PR #144 追加提交；门禁 `EXIT=0`）

### Phase 2：服务端聚合列表与真实分页（`feat/order-hub-aggregate-paging`）

- [x] 2.1 `lib/mergeOrders.ts` + 单测
- [x] 2.2 `api/orders/route.ts` 聚合路由（窗口扫描、total 语义、openApi）
- [x] 2.3 `OrderWorkbench` 取数层重写（单查询、服务端分页、单个新建订单弹窗、i18n 清理）
- [x] 2.4 集成用例 `__integration__/order-hub-aggregate.spec.ts` + README/openApi total 定义
- [x] 2.5 验证：order_hub jest、真机分页/total/pending/400、集成用例 **6 passed**、浏览器分页（commit `4afc8a8`；门禁 `EXIT=0`）

### Phase 3：订单为根的填写面（`feat/order-detail-root`）

- [x] 3.1 hub 迁移到 `order_hub` + `/backend/orders/[id]` 页与 `page.meta.ts`
- [x] 3.2 交易类型由数据判定；链接改为工作台/编辑/预填新建
- [x] 3.3 旧列表与详情 URL 重定向；工作台读 `?type=`（改用组件内 `useSearchParams()`：后端 catch-all 不转发 `searchParams`）
- [x] 3.4 建单保存落到 hub；分区文案（去填写 X / 空态）
- [x] 3.5 验证：浏览器建单→hub（`POST /api/sales/orders` 201 → `/backend/orders/<新 id>`）、四个旧 URL 307、回归 `shipment-sales-order-filter` **4 passed** / `order-source-link` **4 passed**（commit `61376a0`；门禁 `EXIT=0`）

## Verification（每阶段 PR 前 / 合并 dev 后）

`yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build`；
浏览器验证用 dev supervisor 的 `Backend URL` 行；集成测试 `yarn mercato test:integration <name>`。
