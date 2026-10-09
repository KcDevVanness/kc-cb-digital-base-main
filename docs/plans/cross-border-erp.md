# 跨境 ERP 实施计划

> 落地 [`../prd/cross-border-erp.md`](../prd/cross-border-erp.md)：把"国内采购 → 跨境发运 → 海外仓 → 平台履约 → 结算"在系统内闭环。
> 模块归属地图见 [`../dev/business-architecture.md`](../dev/business-architecture.md)。
> 实施 PR：[#1](https://github.com/KcDevVanness/kc-cb-digital-base-main/pull/1)（分支 `feat/cross-border-erp`）。
> **丢失上下文时**：先读"目标"，再读"进度"与文末"交接须知"，然后按"阶段划分"继续。

## 目标

三条链（采购 / 跨境 / 平台）在系统内闭环并可追溯；账实以本系统 `wms` 为准；组织可见性正确（总部看全部下级、分公司只看自己）；界面中英双语、权限 fail-closed。

## 阶段划分

- [x] **阶段一 purchasing：供应商主数据** —— 验收：组织内编码唯一（含已删）、默认币种来自币种字典、列表/新建/编辑页可用、未授权 403。
- [x] **阶段二 purchasing：采购单 + 明细 + 阶段付款** —— 验收：单号 `PO-<年>-<4位>`、含税/不含税金额推导正确、非法流转 422、定金/尾款可部分支付、付款状态由付款行推导。
- [x] **阶段三 cross_border：发运 / 在途 / 出口单证** —— 验收：多采购单合并到一张发运单（拼柜）分摊累计不超采购量；收货落 `wms.inventory.receive` 并回写采购单行 `received_quantity`；里程碑单调不回退。**已实现并验证**（见"进度"）。
- [x] **阶段四 platform_ops：平台连接器与结算对账** —— 验收：同一批数据重复拉取不产生重复记录；差异进对账而非覆盖账面。**核心已实现并验证**；传输层（连接器/文件/第三方）待 Q4 定（见"进度"）。
- [ ] **阶段五 收尾** —— 付款附件、提醒规则（PRD Q6）、分公司仪表盘、`yarn test:integration:ephemeral` 全量集成套件、审计/撤销链补验。
  - ✅ 已做：付款附件（`PurchaseOrderDetail` 的付款附件上传/预览 + `purchasing.purchase-payments.attach`，2026-09-30 核对现网已实现）；提醒规则（PRD Q6 已答 → `finance due-reminders` 既有约定，2026-09-30 按同款补齐 `export_finance overdue-reminders`）。
  - ✅ 已做：**全量集成套件**（2026-09-30）：**104 passed / 4 failed / 5 did not run（43.8s）**；4 个失败**全在 `storage_ops`**，原因是 `STORAGE_OPS_TEST_S3_CONFIG` 未设置（spec 自带门禁的报错原文），不是回归。**跑法要点**（第一次尝试失败的原因在此）：ephemeral 以 **production 模式**起服务，`.env` 里的占位 `JWT_SECRET` 会让它直接退出（`Refusing to run in production with an unsafe signing secret`）⇒ 必须给真密钥；另外建议把 `DATABASE_URL` 指到独立库（本次跑在临时库 `kc_cb_itest` 上，跑完已 DROP），避免集成夹具写进开发库。
  - ✅ 已做：**审计/撤销链实测**（2026-09-30）：改一个商品的 `description`（走 `PUT /api/products/items`）→ `GET /api/audit_logs/audit-logs/actions?resourceKind=products.product&resourceId=<id>` 拿到该次写入的 `undoToken` → `POST /api/audit_logs/audit-logs/actions/undo` **200** `{ok:true, logId}` → 商品字段回到改前值（`description` 复原为 `null`）、审计条目 `executionState` 变为 `undone` 且**该条不再携带 `undoToken`**（不能重复撤销）。**路径坑**：接口真实前缀是 `/api/audit_logs/audit-logs/…`（模块 id 与源目录名各占一层），写成 `/api/audit_logs/actions` 会 404。
  - ⬜ **分公司仪表盘（owner 2026-09-30：先不做）** —— 口径已由 PRD C-3 给出（分公司看本组织订单/镜像/结算只读、总部看汇总），实现路径与候选数字见下；owner 明确先不做，本节保留方案备查。
    - **受众**：分公司运营（**本组织、只读**）+ **总部（汇总）**；与既有的组织作用域（`om_selected_org`）和组织可见性三条规则一致。
    - **内容（按 C-3 的三族）**：① **订单镜像** —— `platform_ops` 镜像订单（现有 `/backend/platform_ops/orders` 的读面）；② **库存** —— 以**本系统 `wms` 账为准**（PRD AC-5 已定「库存账以 wms 为准，平台/3PL 只作同步输入」，具体读面实现时按 `.ai/guides/modules/wms/` 核）；③ **结算与对账** —— `platform_ops` 结算单 + **未决对账条目**（现有 `/settlements`、`/reconciliation` 的读面）。
    - **总部汇总**：同一页按组织分组展示（C-3 的「总部看汇总」）；分公司的用户只看自己组织。
    - **可选附加（C-3 不要求，勾了再加）**：我此前列的财务数字 —— 在途柜数 / 应收未收（+逾期）/ 退税未到（+逾期）/ 本月出运 / 采购在途 / 报价转化率 / 库存低于阈值；全部现有读、无新列。
    - **仍只剩一个问题**：**只做 C-3 三族**（推荐 —— 口径直接来自你的 PRD），还是**叠加财务数字**（勾哪几个）。
    - **现状证据**：`platform_ops` 只有 channels/orders/settlements/reconciliation 四个各自独立页，**没有**一处把三族收成分公司视图 —— 所以 C-3 的这张看板确实还没做。
    - **不做**（防范围膨胀）：图表库、指标定义编辑器、缓存层。
| 六·补48 分公司仪表盘口径草案（阶段五，待 owner 勾选） | ✅ 完成 | 把「需要页面口径」具体化为 **7 个候选数字 + 各自数据来源**（全部现有读、无新列：在途柜数 / 应收未收+逾期 / 退税未到+逾期 / 本月出运 / 采购在途 / 报价转化率 / 库存低阈值），给出表面建议（经营概览组、按组织作用域；可选 HQ 横向对比）与**只需你定的三件事**（勾数字 / 给谁看 / 要不要对比）；同时写明不做项（图表库、指标编辑器、缓存层）。证据：阶段五行内 |
| 六·补49 分公司仪表盘改以 PRD C-3 为口径（阶段五，待 owner 一句话确认） | ✅ 完成 | 找到口径来源：**PRD C-3**（`docs/prd/cross-border-erp.md:75`）+ 角色表 `:42` ⇒ 受众「分公司运营（本组织只读）+ 总部汇总」与内容「订单镜像 / 库存（以 `wms` 账为准）/ 结算与对账」都**不需要重新定义**；我此前列的财务数字降级为**可选附加**。**仍只剩一问**：只做 C-3 三族，还是叠加财务数字（勾哪几个）。现状证据：`platform_ops` 有四个各自独立的页、没有分公司视图页 ⇒ C-3 的这张看板确实未做。证据：阶段五行内 |
| 六·补50 移除报价转化报告（按 owner 要求） | ✅ 完成 | 删除页面 `/backend/internal-sales/quote-conversion`、只读接口 `GET /api/internal_sales/quote-conversion`、`lib/quoteConversion.ts` + 单测、中英 14×2 键；README 表面表改为「已移除」并写明恢复路径（实现只读订单冻结的 `metadata.internalSales.sourceQuote`，无迁移、无数据依赖）。证据：本 PR |
| 六·补51 回退状态/付款列迁移（按 owner 要求） | ✅ 完成 | 先按批准落地五列（PR #128）并应用到开发库，随后 owner 表示暂时不要 ⇒ 生成 drop 迁移并应用：`cross_border_export_documents.status`、`platform_ops_settlements.confirmed_at`/`paid_at`、`finance_shipment_costs.paid_at`、`finance_expenses.paid_at` 全部移除，实体字段、迁移快照同步回退；真机核对（information_schema）**五列已不存在**。Phase 2·B / 3·B 与 `status_changed_at` 回到待批准。证据：本 PR |
| 六·补52 owner 决定「先不做」：结算单确认（Q-010）、分公司仪表盘、当前 main 部署到 production | ✅ 已记录 | 三个能力都**保留了完整方案**（结算单：事实列 + 动作矩阵的成本；仪表盘：PRD C-3 口径 + 7 个候选数字；部署：促销分支刷新脚本）。促销 PR #94 已关闭（需要时 reopen 并刷新到当时 main 即可，刷新命令在 PR 与 run note 中）。证据：本 PR + #94 关闭说明 |
| 六·补53 公司订单根单化（`order_hub`：`order_hub_company_orders` + `order_hub_company_order_links` + 工作台/详情重写 + 补录 CLI） | ✅ 已实现并验证（PR 待合并） | owner 2026-10-09 选定「容器根单 + 全量补录」：工作台每行=一张公司订单、点进 `/backend/orders/<companyOrderId>`（不再跳采购单模块页）；详情页三个可写关联区块（对内/对外/采购，成套替换对话框 + 预填新建）+ 五个下游并集只读区块；`?companyOrderId=` 预填接入 internal_sales/purchasing（保存后自动关联并跳回）；旧销售单 URL 经关联表归位；`yarn mercato order_hub backfill-company-orders --apply` 1:1 补录历史。证据：`yarn jest src/modules/order_hub` 3 suites·28 tests；ephemeral 集成 6/9/3 = **18 passed**；浏览器实测（工作台/hub/关联替换/旧 URL/未关联建根/两条预填链路/暗色/窄屏/键盘）；迁移已生成审阅**未应用**。spec：[`.ai/specs/2026-10-09-company-order-root.md`](../../.ai/specs/2026-10-09-company-order-root.md) |
