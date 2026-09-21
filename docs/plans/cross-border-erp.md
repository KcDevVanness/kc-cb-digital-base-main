# 跨境 ERP 实施计划

> 落地 [`../prd/cross-border-erp.md`](../prd/cross-border-erp.md)：把"国内采购 → 跨境发运 → 海外仓 → 平台履约 → 结算"在系统内闭环。
> 模块归属地图见 [`../dev/business-architecture.md`](../dev/business-architecture.md)。
> **丢失上下文时**：先读"目标"，再读"进度"与文末"交接须知"，然后按"阶段划分"继续。

## 目标

三条链（采购 / 跨境 / 平台）在系统内闭环并可追溯；账实以本系统 `wms` 为准；组织可见性正确（总部看全部下级、分公司只看自己）；界面中英双语、权限 fail-closed。

## 阶段划分

- [x] **阶段一 purchasing：供应商主数据** —— 验收：组织内编码唯一（含已删）、默认币种来自币种字典、列表/新建/编辑页可用、未授权 403。
- [x] **阶段二 purchasing：采购单 + 明细 + 阶段付款** —— 验收：单号 `PO-<年>-<4位>`、含税/不含税金额推导正确、非法流转 422、定金/尾款可部分支付、付款状态由付款行推导。
- [x] **阶段三 cross_border：发运 / 在途 / 出口单证** —— 验收：多采购单合并到一张发运单（拼柜）分摊累计不超采购量；收货落 `wms.inventory.receive` 并回写采购单行 `received_quantity`；里程碑单调不回退。**已实现并验证**（见"进度"）。
- [ ] **阶段四 platform_ops：平台连接器与结算对账** —— 验收：同一批数据重复拉取不产生重复记录；差异进对账而非覆盖账面。
- [ ] **阶段五 收尾** —— 付款附件、提醒规则（PRD Q6）、分公司仪表盘、`yarn test:integration:ephemeral` 全量集成套件、审计/撤销链补验。

### 阶段三任务拆解（下一步，先写 spec）

1. 实体：`cross_border_shipments`（编号、承运人/货代、出口口岸、状态、当前里程碑、预计/实际到港）、`cross_border_shipment_allocations`（发运单 ↔ 采购单行 + 分摊数量）、`cross_border_export_documents`（按 PRD Q1 决定是否结构化）。
2. 命令：create/update、`allocate`（累计不得超采购量）、`depart`（进入在途）、`milestone`（推进，单调）、`receive`（`wms.inventory.receive` + 回写已收数量）、`cancel`。
3. 路由：`/api/cross_border/shipments{,/allocations,/milestones,/documents}`。
4. 页面：列表 / 新建（选采购单行 + 分摊数量）/ 详情（里程碑时间线、单证附件、收货动作）。
5. ACL：`cross_border.shipments.view|manage`、`cross_border.documents.manage`。
6. 测试：超发被拒、部分收货、里程碑回退被拒、跨组织隔离、附件上传下载。

### 阶段四任务拆解

先启用 `integrations`、`data_sync`（纯注册表变更，不动数据）；按 `sync_akeneo` 形状建连接器（凭证加密、外部 id 映射、游标、幂等 upsert），落地订单/库存镜像/结算三类数据，再做对账条目与差异页面、分公司只读视图。

## 依赖与风险

| 项 | 说明 |
|---|---|
| 依赖模块 | 已启用 `catalog`/`customers`/`sales`/`wms`/`currencies`/`dictionaries`/`feature_toggles`/`attachments`/`notifications`；阶段四需启用 `integrations`、`data_sync` |
| 数据库 | 本地开发库已应用 purchasing 两个迁移；新迁移一律 `yarn db:generate` → 审阅（确认无 drop）→ **批准后** `yarn db:migrate` |
| 业务输入 | 阶段三需 PRD Q1（单证范围）/Q2（拼柜单证粒度）/Q3（货代是否有实时轨迹）；阶段四需 Q4（平台对接形态） |
| 风险：拼柜分摊算错 | 按行数量分摊 + 累计不超采购量的硬校验 + 专项测试 |
| 风险：外部数据不完整 | 账面为准 + 对账条目，绝不静默覆盖 |
| 风险：跨组织主数据分发缺失 | 维持组织私有；需要时单独立项（PRD Q5） |

## 进度

| 阶段 | 状态 | 证据 |
|---|---|---|
| 一 供应商 | ✅ 完成并验证 | 冒烟 401/403/201/200/409/200；浏览器实测列表与表单；迁移已应用 |
| 二 采购单 | ✅ 完成并验证 | API：金额 1200/156/1356、`PO-2026-0001`、重复 place 422、定金+尾款 → 已付 906.80/未付 449.20、shipped→received→close 全 201；浏览器实测列表与详情；迁移已应用 |
| 三 发运/在途/单证 | ✅ 完成并验证 | API：两张采购单合并一张发运单 201；超发 422（`Allocating 6 exceeds the ordered quantity of 10.0000 (already allocated 6) for PO-2026-0002`）；重复行 422；depart → `SHP-2026-0001` 且两张采购单自动转 `shipped`；里程碑前进 201、回退 422、历史 2 条；收货 201 → `wms` 余额 11.0000（6+5）、采购单行已收 6.0000/5.0000、发运单 `received`；单证 建/查/改/删 201/200/200、非法类型 400。浏览器实测列表与详情（分配明细、节点时间线、单证空态）。迁移已应用 |
| 四 平台连接器/结算 | ✅ 核心已实现并验证（传输层待 Q4） | API：渠道 201；订单 ingest 首次 `created:2`、重放 `unchanged:2`；结算导入 `lines:3, raised:2, linked:1`（1 匹配 + 1 金额不符 + 1 本地无单）；重放 `raised:0`；队列 2 条（`amount_mismatch` expected 2550 / actual 2600、`missing_in_erp` AMZ-9999）；resolve/ignore 各 200；决定后重放仍 `raised:0`（不复活）。浏览器实测结算单列表/明细（3 行，含匹配标记）与对账空态。`integrations`+`data_sync` 已启用并建表。迁移已应用 |
| 五 收尾 | ⏳ 进行中 | ✅ `yarn test` 修绿（原为红：`src/lib/i18n/__tests__/dictionary-fallback.test.ts` 里写死的"该 key 未翻译"断言被 ERP 的 zh overlay 覆盖，改为运行时挑选回退 key）；✅ 审计链实测：`action_logs` 中 `purchasing.supplier / purchase_order / purchase_payment`、`platform_ops.settlement` 均有 `execution_state=done` 且带 `command_payload`；✅ 结算明细列名改为"订单存在"；✅ **采购付款凭证（银行回单）**：新增 `attachment_id` 列（迁移已应用）+ `purchasing.purchase-payments.attach` 命令与 PUT 动作 + 付款对话框上传字段（先建付款→上传→绑定，上传失败不丢付款，行内可重试）+ 付款记录"付款凭证"列。API 实测：付款 201 → 附件上传 200 → 绑定 200 → 列表 `attachment: yes`；浏览器实测列内出现"查看文件"链接。✅ **组织可见性实测（完整）**：组织树已就位（HQ `bf4ccd1a` depth 0 → 俄罗斯分公司 `f346f491` depth 1）；①**总部看全部下级**：superadmin + 选中 HQ → 3 张采购单 / 2 个渠道（含分公司自建的 RU-OZON）；②**切组织即切数据**：同一账号选中俄罗斯 → 采购单 0、渠道 0（只剩自己那 1 个）；③**分公司只看自己**：用 `POST /api/auth/roles` + `PUT /api/auth/roles/acl` 建了 `ru-viewer` 角色（features = 三个 view、organizations = [RU]）并给 `ru-viewer@acme.com` 绑定在俄罗斯组织下 → 渠道 **200 且只有 RU-OZON**、采购单 **200 且 total 0**（总部 3 张一张都看不到）；④**不能向上看**：同账号把组织 cookie 改成 HQ → **422 `organization_selection_invalid`**（框架直接拒绝越界选择）；⑤**无功能位不泄露**：employee 账号对三个模块路由一律 **403**。⛔ `yarn test:integration:ephemeral` 无法运行：Docker 未启动，且 `.ai/qa/tests/` 下只有 `playwright.config.ts`、没有任何 spec |

**门禁现状**：`yarn generate` ✓ ｜ `yarn typecheck` ✓（仅剩既有 `src/modules/scope_guards/__integration__/scope-guards.spec.ts` 报错，与本模块无关）｜ `yarn lint` 0 error、本模块 0 warning ｜ `yarn ds:check` ✓。

**规格与证据文件**：总纲 `.ai/specs/2026-09-21-app-owned-business-module.md`；采购 `.ai/specs/2026-09-21-purchasing-module.md`；业务再评估与两次实测 `.ai/analysis/2026-09-21-business-model-reassessment.md`、`…-catalog-eject-spike.md`、`…-disable-official-chain-drill.md`。

## 交接须知（新接手者先读这一段）

**环境**

| 事项 | 结论 |
|---|---|
| 本仓 dev server | supervisor `om-dev` 跑在 **http://localhost:3001**（3000 属于另一个 checkout `kc-cb-digital-base`） |
| 开发账号 | `superadmin@acme.com` / `admin@acme.com` / `employee@acme.com`；密码用 `yarn mercato auth set-password --email … --password …` 重设（策略：长度 + 数字 + 大写 + 特殊字符） |
| 登录 API | `POST /api/auth/login` 只吃 **form-urlencoded**（`email`/`password`/可选 `tenantId`），不是 JSON |
| 组织上下文 | API 调用带 `om_selected_org=<organizationId>` cookie，否则 400 `organization_scope_required` |
| 本地库 | `postgres://…@localhost:5532/kc_cb_base_min`；`yarn mercato auth list-users / list-orgs` 可查 |

**代码约定与踩过的坑**

| 事项 | 结论 |
|---|---|
| 实体规范 ID | 由类名推导：`purchasing_supplier` → `purchasing:purchasing_supplier`（写错会让查询引擎去找不存在的表） |
| 列表布尔过滤 | 不用 `z.coerce.boolean()`（`"false"` → `true`）；用 `parseBooleanToken` 并兼容工厂预解析的布尔值 |
| 软删 + 唯一约束 | 约束不排除已删行；查重要包含已删记录并返回 409，否则用户遇到 500 |
| 原始 SQL | 用 `em.getKysely()`；`connection.execute` 不接受 `?` 或 `$n` 占位符 |
| 后台路由路径 | `backend/**` 去模块名（`backend/purchasing/orders/page.tsx` → `/backend/purchasing/orders`）；API 保留模块名 |
| 页面授权 | 每个 `page.tsx` 必须配 `page.meta.ts`（`requireAuth` + `requireFeatures`），否则页面没有授权门禁 |
| 币种 | 选项来自**币种字典** `/api/customers/dictionaries/currency`，不是汇率主表 |
| 跨模块 | 不 import 别模块实体、不建跨模块 ORM 关联；用 id + 快照、事件、extension、可选 DI |
| 迁移 | 已发布迁移不可改；新增走 `yarn db:generate` 并审阅 SQL |
| UI | 走 `CrudForm`/`DataTable`/`Page`/`PageBody` + 共享 CRUD helper；对话框支持 `Cmd/Ctrl+Enter` 与 `Esc`；文案进 `i18n/{zh,en}.json` |
