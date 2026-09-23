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
- [ ] **阶段四 platform_ops：平台连接器与结算对账** —— 验收：同一批数据重复拉取不产生重复记录；差异进对账而非覆盖账面。
- [ ] **阶段五 收尾** —— 付款附件、提醒规则（PRD Q6）、分公司仪表盘、`yarn test:integration:ephemeral` 全量集成套件、审计/撤销链补验。
- [x] **阶段六 products + trade_docs：产品主数据与购销合同/发票（双口径金额）** —— 验收：三档价格（采购/内部结算/对外销售）可取；类别树 `tree_path` 正确且环被拒 422；采购/销售合同两方向可流转（单号 `PC/SC-<年>-<4位>`）、非法流转 422；行绑定**已确认**发票后财务金额取发票值、发票作废回退；合同金额 = 数量×单价 2 位四舍五入；发票附件可归档下载；合同 Excel 最后补（栏位以 `lib/contractTemplate.ts` 常量为准）。spec：[`.ai/specs/2026-09-22-products-and-trade-docs.md`](../../.ai/specs/2026-09-22-products-and-trade-docs.md)

- [x] **阶段七 sourcing：供应商报价单 + Excel 报价导入** —— 验收：`.xls`/`.xlsx` 都能解析（PetKit 报价单 69 行 + 6 个分类横幅；形式发票 78 行且页脚/银行账号被剔除）；列映射带置信度并可存为模板复用；复核台可勾选/改 SKU；确认得 `SQ-<年>-<4位>`；提升按 SKU 建/改商品并合并 `purchase` 档价格（不动 internal/export），重复提升幂等；标准模板下载后免映射；AI 映射未配置时置灰。spec：[`.ai/specs/2026-09-22-supplier-quotation-import.md`](../../.ai/specs/2026-09-22-supplier-quotation-import.md)

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
| 新增第三方依赖 | 阶段七引入 SheetJS `xlsx`（官方 CDN tarball）作为唯一的表格读取器；仓库此前无任何解析库，`.xls`(BIFF8) 只能靠它 |
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

| 六 products + trade_docs | ✅ 完成并验证 | spec [`.ai/specs/2026-09-22-products-and-trade-docs.md`](../../.ai/specs/2026-09-22-products-and-trade-docs.md)；迁移已生成+审阅+应用（products 13 条 / trade_docs 16 条 addSql，仅建表/索引/外键）；种子幂等（`seed:defaults --module products` 跑两次仍每组织 5 个类型）。API 实测：类型 201/重复 409；类别 A>B>C 的 `treePath`/`depth`/`ancestorIds` 正确、挂到自身后代 **422 且数据不变**、有子类或被商品引用删除 **422**；商品 201/重复 SKU 409、停用后默认列表 0 条而 `status=all` 1 条、旧版本写入 **409**（`optimistic_lock_conflict`）；三档价格 200 且整组替换后缺失行**转停用**（`isActive=false`）；跨组织读为空、跨组织删除 404、无功能位员工对四个新路由一律 **403**。合同：建两行（含 4 位小数单价）→ 头三列 4835.77/4835.77/0 与手算一致 → `draft→signed` **422 状态不变** → `issue` 得 `PC-2026-0001` → 重复 issue 422 → sign/close 201 → 签发后编辑 **409**。双口径分离实测：把 BND 改成 0 位小数后同一合同 合同金额 3601.80 / 财务金额 3602 / 差额 **-0.20**。发票：绑定他人合同行 **400**；confirm 后合同财务金额 3601.20 → **3601.14**、差额 0.06、行来源 `invoice`；重复 confirm 422；void 后回退 3601.20、来源 `computed`。附件：multipart 上传 200（分区回退 `privateAttachments`）+ `attach` 200 + 下载 200。Excel：`POST /api/trade_docs/contracts/<id>/document` 200 → 落附件；`GET` 返回 `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`、2463 字节、ZIP 头；用独立读取器（SheetJS）复核：明细金额为**数字**、明细求和服务端等于合同金额单元格、大写中英双份；draft 生成 **422**。导出：合同 CSV 表头含 `Contract Amount / Finance Amount / Difference`。浏览器实测（superadmin，深色主题）：商品列表/新建（分组+价格行，类型选择器已按选定组织收敛为每条一次）、类别树（`宠物 / 饮水机 / 无线饮水机` 带层级缩进）、合同列表（三列金额，负差额用错误色）、合同详情（双口径金额块 + 行来源 `From invoice` + 生成/下载合同）、发票列表与发票页（上传扫描件 → 绑定 → Confirm invoice → 合同财务金额变为票面值）、财务/组织上下文提示（跨组织操作给出“切换组织”提示）、`Ctrl+Enter` 提交成功、420px 窄屏三个页面均无横向溢出。`yarn generate` ✓ ｜ `yarn typecheck` ✓ ｜ `yarn lint` 0 error（8 warning 均为既有）｜ `yarn test` 104 passed ｜ `yarn ds:check` 本模块 0 违规（唯一违规在并行开发的 `sourcing` 模块）｜ `yarn build` exit 0（✓ Compiled successfully） |

| 七 sourcing 报价导入 | ✅ 完成并验证 | spec [`.ai/specs/2026-09-22-supplier-quotation-import.md`](../../.ai/specs/2026-09-22-supplier-quotation-import.md)。API 实测（真实文件，非 superadmin 角色）：PetKit `.xlsx` 建单→上传→解析 **69 行 / 表头第 4 行 / 6 个分类横幅 / 13 列全映射**，派生 SKU `P4108`+`P4108-UVC`、`P41171-5PCS`、`P4113-UVC`，`10 pallets` → MOQ 10 + 告警，外箱 `46.5*46.5*40 cm`；`remap` 存模板命中并重建 69 行；批量保存 5 行（含改 SKU）；`approve` → `SQ-2026-0001`；`promote` → `created:5`（CNY purchase 价 + `min_quantity=MOQ`），**重复提升 `skipped:5`**（幂等）。`订单表-2026 EXW.xls`：**78 行**、双行表头合并、页脚 TOTAL/账期/银行账号被剔除、米制 `L/W/H` 归一化 `46/47/41 cm`、无货号行用名称 slug，确认 + 提升 2 行。标准模板下载 → 重新导入 `templateMatched:true`（3 行示例）。AI：`ai-status` 未配置、`ai-mapping` 503 `ai_not_configured` 且不写库。跨组织：切到俄罗斯分公司看到 0 张报价单、外组织 id 返回 404。UI 浏览器实测（zh + en、明暗两色、1440 与 420 px）：列表（工具栏/状态徽标/计数）、导入向导（上传 → 列映射表含置信度与模板命中 → 复核网格）、复核台（表头计数、批量操作、提升后计数刷新）。单测 40 项全绿；`yarn generate && typecheck && lint && ds:check && test && build` 全绿；`sourcing` 迁移已应用。注意：新模块的功能点需要 `yarn mercato auth sync-role-acls` + 重启进程才对既有角色生效（见 `.ai/lessons/module-features-need-role-acl-sync.md`）。 |

| 六·补 商品主数据接管前台与采购 | ✅ 完成并验证 | 产品表单改为三步（基本信息 / 出口·包装·锂电 / 三档价格，切换不丢输入、校验失败跳到出错步），可见性由 `lib/formLayout.ts` 单点控制；官方 `catalog` 的商品/类别/变体页面经 `src/modules.ts` 的 `routes.pages` 覆盖隐藏（侧栏已无 CATALOG，模块与 API 保留，`sales` 仍可用）；采购单行改引用 `products_products`（新增可空 `product_id`，迁移已应用，`catalog_product_id` 保留给历史行）。实测：新行 `productId` + 快照、缺引用 400、跨组织商品 400、历史行照常显示；商品填「官方目录链接」后新行自动带桥接 id 且发运分摊 201，未填链接时分摊 422 并提示补链接；UI 端产品表单选链接并保存 → API 校验链接与快照已落库；采购单 UI 选品落 `productId`+桥接 id（3×88.5=265.5） |

| 六·补2 内部销售单据（自建界面） | ✅ 完成并验证 | 新增 app 自有模块 `internal_sales`（报价/订单 各 列表·新建·编辑 6 页面，复用 `sales.*.manage`，无新表/无迁移）；行引用 `products_products` 并自动桥接官方目录默认变体；官方「新建单据」页隐藏、官方列表与 `config/sales` 保留。实测：UI 建报价 2×55.50=111.00、订单 3×44.40=133.20 与 6×63.25=379.50（编辑后），行上 `product_id`+`product_variant_id`(默认变体)+`catalog_snapshot` 全部落库；编辑改数量 → `PUT /api/sales/{quotes,orders}` 200 + `PUT /api/sales/{quote,order}-lines` 200，**行 id 不变**（upsert 不重复）；保存后重读单据（否则第二次保存 409）。过程中修掉一个真实缺陷：异步选品回填用陈旧闭包写回，导致慢查询落地时把刚选的商品清掉（两个表单同修）。发现官方 sales 动态页在本机 dev 404（列表正常、与覆盖无关，已用关覆盖实验证），故跳转指向本模块编辑页 |

**门禁现状**（2026-09-23 09:30 推送前全量重跑，含 `internal_sales`/`trade_docs`/`export_finance`/`parties`）：`yarn generate` ✓ ｜ `yarn typecheck` ✓ ｜ `yarn lint` 0 error（8 warning 均为既有）｜ `yarn ds:check` ✓ 597 files ｜ `yarn test` ✓ 177 passed ｜ `yarn build` ✓（Compiled successfully，`.mercato/next/BUILD_ID` 与路由表均生成）。

**规格与证据文件**：总纲 `.ai/specs/2026-09-21-app-owned-business-module.md`；采购 `.ai/specs/2026-09-21-purchasing-module.md`；报价导入 `.ai/specs/2026-09-22-supplier-quotation-import.md`；业务再评估与两次实测 `.ai/analysis/2026-09-21-business-model-reassessment.md`、`…-catalog-eject-spike.md`、`…-disable-official-chain-drill.md`。

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
