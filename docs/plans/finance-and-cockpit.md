# 财务模块完善 · 数据打通 · 老板驾驶舱 实施计划

> 落地 [`../prd/finance-and-cockpit.md`](../prd/finance-and-cockpit.md)：把"柜费用 → 到岸成本 → 应付/应收/库存资金占用/损益"在系统内算清，把俄方 supply 8 端点接进来，最后让老板一页看六类数。
> 执行口径（需求、数据模型、API、测试与阶段 exit gate）以 [`.ai/specs/2026-09-28-finance-ledger-and-cockpit-data.md`](../../.ai/specs/2026-09-28-finance-ledger-and-cockpit-data.md) 为准；本文只写排期、依赖与验收。

## 目标

三个新 app 模块（`finance` 钱 / `ru_sync` 数据 / `boss_cockpit` 看）+ `export_finance` 一处加法列；跑通"柜级费用 → 到岸成本 → 台账 → 损益 → 驾驶舱"，全程不写 peer 表、不建凭证总账、无汇率不按 1 摊。

## 阶段划分

- [x] **阶段一 `finance` 成本底座** —— 验收：柜费用可记；到岸成本 Σ分摊 == 费用×汇率（2 位）；三页（费用/到岸成本/库存资金占用）明暗 + 空态 + 缺汇率标红；迁移经批准应用。**已完成并验证**（证据见"进度"）。
- [x] **阶段二 费用与台账** —— 验收：期间费用 CRUD；应付四值与手算一致；三类应收各一行；收汇金额回读一致且旧记录不报错。**已完成并验证**（证据见"进度"）。
- [x] **阶段三 `ru_sync` supply 8 端点** —— 验收：mock 全量行数一致；同 `as_of` 重放 0 新增；失败游标不推进；映射页与健康页可用。**已完成并验证**（证据见"进度"）。
- [x] **阶段四 `boss_cockpit` v1** —— 验收：供应三数 + 未识别在途 + CN 资金三数 + SKU 覆盖率可看，每数带 `as_of` 与来源；stale banner 实测；4 个 widget 在宿主仪表盘可见。**已实测**（2026-09-28：页面与 API 同源、六类数与快照/台账相符；4 个 widget 在仪表盘渲染同一组数，`defaultEnabled: false` 按用户在「自定义」开启）。
- [x] **阶段五 供应计划闭环** —— 验收：缺口勾选生成采购单**草稿**；未映射 SKU 422 且不生成。**已完成并验证**（接口实测；未映射异常清单即映射页默认筛选）。
- [x] **阶段六 ads 9 端点 + 损益** —— 验收：订单/结算进既有幂等入口（500/2000 切批）；损益与俄方页误差 ≤ 0.2 п.п. / 20 ₽；事实/预测不混列。**已实测**（2026-09-28：9 个 ads 端点实拉 `completed`、重放 `created=0`；月损益读回真实卢布数，SKU 毛利在缺中方成本时标 `missing` 而不计 0）。
- [x] **阶段七 驾驶舱 v2 + 四预警** —— 验收：六类数齐全；四预警各触发一次且去重生效。**已实测**（四预警各触发一次、同条件重放通知数不变；驾驶舱加 ДРР 双口径、周复盘、月损益入口；四预警事件 + 通知类型 + 订阅者 + 拉取后评估，去重靠 `groupKey` 刷新）。
- [x] **阶段八 流程收尾** —— 验收：端到端链路脚本（全新库）通过；三条到期提醒各触发一次；`docs/prd/cross-border-erp.md` 验收清单按实测闭环。**已实测**：FLOW-G1 在全新一次性库上 1 passed（串起供应商→采购单→定金→发运→柜费用→收货→到岸成本→尾款→收汇→退税，并对账行已收 == wms 余额、Σ分摊 == Σ费用×汇率、收汇入应收台账、退税按柜分摊回单）；提醒命令的机制见"进度"（无调度模块，故为 cron 可调用的命令）。

## 依赖与风险

| 项 | 说明 |
|---|---|
| 依赖模块 | 已启用 `purchasing`/`cross_border`/`trade_docs`/`export_finance`/`platform_ops`/`products`/`parties`/`wms`/`sales`/`integrations`/`data_sync`/`notifications`/`dashboards`/`dictionaries`/`attachments`/`currencies`/`currency_policy` |
| 外部依赖 | 俄方 token 与联调窗口（Q-010）；`A.4` 四项敏感确认（成本毛利/ФБО 只读/增量粒度/币种混用）——未勾选前阶段三用 mock 夹具，阶段六的 `cost` 行由中方到岸成本单边提供并标来源 |
| 数据库 | 迁移一律 `yarn db:generate` → 审阅（只允许建表/加列/索引/外键、确认无 drop）→ **批准后** `yarn db:migrate`。阶段一 `finance_shipment_costs`；阶段二 `finance_expenses` + `export_finance_collections` 两列；阶段三 三张 `ru_sync_*` |
| 风险：汇率缺失 | 行标 `unconvertible`/`rateMissing`，不进 CNY 合计、页面标红；永不按 1 摊、永不填 0 |
| 风险：SKU 映射覆盖不满 | 未映射禁生成 PO + 派生异常清单 + 覆盖率可见；不静默合并 |
| 风险：仓库无可读库存余额表 | 库存资金占用退回「SKU 最新到岸单价 × 已收货数量」并标注口径来源（阶段一实现第一步确认 `wms` 表名） |
| 风险：分摊规则漂移 | 与退税分摊同规则（HALF_UP + 余差落占比最大行 + 平手取最小 `lineNumber`），单测钉死 |
| 新增依赖 | 无（不引图表库；趋势用一方 SVG 组件，确需先问） |

## 进度

> 2026-09-28 实拉与页面复核（dev）：17 个端点全量拉取（8 supply + 9 ads）行数与 fixture 相符、同 `as_of` 重放 `created=0`；四预警各触发一次且重放不新增通知；`finance due-reminders` 三条规则各触发一次；11 个页面（驾驶舱 / RU 健康 / RU 映射 / 应付 / 应收 / 期间费用 / 柜费用 / 到岸成本 / 库存资金占用 / 月损益 / SKU 毛利）与 4 个仪表盘 widget 渲染真实数据。这一轮查出并修掉四个真实缺陷（通知 uuid 列、跨模块缓存失效、金额卡 `value=null` 丢 footer、ДРР widget 占位符），逐条记在 spec 的 Changelog。

| 阶段 | 状态 | 证据 |
| --- | --- | --- |
| 一 `finance` 成本底座 | ✅ 完成并验证 | 迁移 `Migration20260928064025_finance` 经批准已应用（仅建表 + 2 索引，无 drop）。门禁：`yarn generate` / `typecheck` 0 / `lint` 0 error / `ds:check` 783 files / `yarn test` 320 passed（含新增 13 条到岸成本单测）/ `yarn build` ✓。接口实测（`admin@acme.com`，组织 Acme Corp）：建柜 → `POST /api/finance/shipment-costs`（USD 1000 @7）→ `GET /api/finance/landed-costs?shipmentId=…` 得 `allocatedCny=7000.0000 == feesCny`、`purchaseCny=2000.0000`、`landedTotalCny=9000.0000`、`landedUnitCostCny=1800.0000`；无汇率费用（USD 500）进 `unconvertibleFees` 且被剔除；两条 CSV 输出表头正确；`/api/finance/inventory-value` 200（本库无 wms 余额 → 空行 + `totals.value=0.0000`）。错误路径：未知费用类型 400、`amount=0` 400、`exchangeRate=0` 400、已取消柜 409、跨组织/已删柜 404。浏览器实测：三页在财务组可导航；列表（含字典显示名 海运/关税、按汇率表取）、到岸成本页（KPI 2,000/7,000/7,000/9,000 + 缺汇率红色提示 + 按行/按 SKU 两表）、库存页空态；暗色 + 亮色 + 390px 窄屏；冒烟数据已清理（4 条费用 + 3 张柜已软删） |
| 二 费用与台账 | ✅ 完成并验证 | 迁移 `Migration20260928071448_finance`（建 `finance_expenses` + 2 索引）与 `Migration20260928071448_export_finance`（`export_finance_collections` 加可空 `amount`/`received_at`，带回滚）经批准已应用。门禁：generate / typecheck 0 / lint 0 error / ds:check 805 files / test 322 passed / build ✓。接口实测：应付（2 单 unpaid 2000/0/2000）→ 加一笔定金 500 → `500.0000/1500.0000/deposit_paid` → 删付款回 `unpaid`（与采购单手算一致，状态来自 `purchasing` 的 `derivePaymentState`）；应收三类各出证并只按币种合计（出口收汇 1200.0000 已收满、平台结算带 `receivedAt` 950 已收 vs 不带 475 全未收、内部销售 2 单 USD 125 未收）；`collectedAmount: null` 回读为 null（旧记录路径）；费用创建/更新/删除 200-201，期间倒置 400、未知类型 400、跨组织渠道 404；订单档案财务视图与 CSV 增加 `collectedAmount`/`collectedAt`。浏览器实测：应付台账（分组 + 明细 + 状态徽章）、应收台账（多币种提示 + 分币种合计 + 三类来源）、期间费用列表（字典显示名 广告费）、订单档案财务页新增「已收金额 / 收款日期」输入。修掉两个真实 bug：`platform_ops_settlements` 无 `deleted_at` 列；`sales_orders.status` 为 NULL 时被 `not in` 过滤掉（应收漏单） |
| 三 `ru_sync` supply 8 端点 | ✅ 完成并验证（+ ads 9 端点实拉已验，见阶段六行） | 迁移 `Migration20260928073630_ru_sync` 经批准已应用（`ru_sync_snapshots`/`ru_sync_cursors`/`ru_sync_sku_map` 三表 + 唯一约束）；`progress` 模块启用（`data_sync\` run 依赖 \`progressService\`，此前任何运行都起不来）并应用其自带两笔迁移。实测（mock contract server 作为 fixtures）：8 端点全量拉取 → 投影行数与 fixture 逐一相等（skus 3 / sku_mappings 2 / stock 2 / in_transit 1 / unrecognized_inbound 2 / plan 1 / shipments 1 / params 1），8 条游标全部推进（skus 到 10:05，其余 10:00）；重放同 `as_of` → 表内行数不变（幂等）；杀掉 mock 后跑 plan → run `failed\`（`fetch failed`）且游标保持原值；健康接口 7 端点 `ok` + `plan` 为 `failing`（带 lastRunError），把游标改到 25h 前则转 `stale`；SKU 映射派生清单 6 条（含 `РК56`）、绑定/忽略/缺 productId 400/跨组织商品 404 四路实测；健康页与映射页浏览器实测（暗色 + 宽屏）。单测 43 例（归一化/游标/两域 schema/整轮拉取）。 |
| 四 `boss_cockpit`（v1 + v2 六类数） | ✅ 完成并验证 | 模块注册 + 只读页 + 4 widgets（`yarn generate` 已产出 `boss_cockpit:{supply-gap,in-transit,overstock,drr}:widget`）+ `GET /api/boss_cockpit/summary`（供应三数 + 未识别在途 + CN 资金三数 + SKU 覆盖率，每数带 `asOf`/来源；`stale` 取自 ru_sync 健康投影）。实测（2026-09-28，dev 重启后）：页面与 API 同源，六类数与快照/台账逐条相符（缺口 11,988.00 RUB、在途 51,918.00 USD · 1,141.0000、ДРР 7.5% / 实付 4.4% / 目标 ≤20%、周销售 1,037,844.00 RUB · 18.0000、周毛利率 37.9%、周广告实付 66,444.00 RUB、应付未付 5,200.00 CNY、应收未收 250.00 USD、库存资金占用 600.00）、积压金额按无越线数据留 `--`；4 个 widget 在仪表盘上渲染同一组数（`defaultEnabled: false`，按用户在「自定义」里开启）。 |
| 五 供应计划闭环 | ✅ 完成并验证 | `POST /api/ru_sync/plan/draft-pos`：从最新 plan 快照 + 映射决策建**草稿**采购单（不 place）——实测 201，`status=draft`、RUB、total 11988.00（= 74 × 162.00，币种一致时带入俄方单价）；勾选含未映射码（`РК56`）→ **422** 且订单数不变（整单不落）；映射决策按 `matchKey` 宽松匹配。 |
| 六 ads 9 端点 + 损益 | ✅ 完成并验证 | 实测（2026-09-28，mock contract server）：9 个 ads 端点逐个 `completed`（created 1/2/1/1/4/1/1/1/2，与 fixture 行数相符），同 `as_of` 重放 `created=0`；З&П 读回真实卢布数（销售 5,006,199.00 RUB）、SKU 毛利读回 PK44（收入 1,037,844.00、平台费 458,042.00、广告 66,444.00、毛利率 37.90%，中方到岸成本缺失时如实标 `missing` 而不计 0）。9 个 ads 端点 schema（`lib/endpoints/ads.ts`，含 15 个订单状态枚举、四平台价格四小数、结算 fee_type 三码）+ 落点：`ads_orders` → `platform_ops.orders.ingest`（按 (channel, external_order_id) 聚合成单行、≤500/批、整批 422 时逐单重试）、`ads_settlements` → `platform_ops.settlements.import`、其余七端点入快照；缺 `platform_ops` 渠道时按 `channel_not_configured\` 逐项报告而不丢行。\`finance/lib/profitLoss.ts\`（ОПИУ 行项与俄方同名同序、事实/预测分列、成本行保留 CNY 且不混算）与 \`finance/lib/skuMargin.ts\`（双币种并排、仅在有汇率时算混合毛利、超 0.2 п.п./20 ₽ 列对账候选）两页 + 两路由。单测：ads schema 正反例 8 例 + 订单聚合 1 例 |
| 七 驾驶舱 v2 + 四预警 | ✅ 完成并验证 | 驾驶舱补 ДРР 双口径（应计/实付 + 目标线）、周复盘三数（周销售/周毛利率/周广告实付）、月损益入口；`ru_sync/lib/alerts.ts` 四阈值在对应端点拉取收尾后评估并各发一个 typed event，`ru_sync.alert.*` 四通知类型 + 四个订阅者，重复条件按 `groupKey` 刷新同一条通知（平台通知服务的既有去重）。 |
| 八 流程收尾 | ✅ 完成并验证 | FLOW-G2：`lib/dueReminders.ts` 三条规则（逾期未付款按 `derivePaymentState` 的未付额、逾期未发运按「状态 placed 且无柜位分摊」、库存低于阈值按采购档起订量）→ `finance.reminder.*` 三事件 + 三通知类型与订阅者，入口 `yarn mercato finance due-reminders --org … --tenant …`（无调度模块，故为可由 cron 调用的命令）。FLOW-G1：`src/modules/finance/__integration__/finance-flow.spec.ts` 串起 供应商→采购单→定金→发运→柜费用→收货→到岸成本→尾款→收汇→退税，断言四处（行已收 == wms 余额 10 == 10、Σ分摊 == Σ费用×汇率 1400 == 200×7、应付结清 1000/1000、收汇 1200 入应收台账且余额 0、退税 130 分摊回单）。**2026-09-28 在全新一次性库上 1 passed**；这条链路顺带查出并修掉两个真实缺陷：`cross_border.shipments.depart`/`.receive` 走过命令总线写别的模块的集合（订单状态、行已收数量、wms 余额）却不清它们的 CRUD 列表缓存（`ENABLE_CRUD_API_CACHE=true` 时读回旧值），已加 `invalidatePeerCaches()` 在两处调用。 |
