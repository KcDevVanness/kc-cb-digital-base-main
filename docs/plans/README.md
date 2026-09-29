# plans — 计划开发需求文档

**放**：把一份 PRD 落成可执行的阶段计划——阶段划分、每阶段交付、依赖、风险、进度。

**不放**：需求本身（→ `../prd/`）、已完成的复盘（→ `../pitfalls/`）。

命名与章节骨架见 [`../README.md`](../README.md)。一份计划对应一份 PRD，文件名保持一致。

## 骨架

```md
# <特性名> 实施计划

## 目标
一句话说明这份计划要落地什么；链到对应 PRD。

## 阶段划分
每阶段必须**能独立验收**（可单独合并、可单独回滚），不要出现「做到一半才有用」的阶段。

- [ ] 阶段一：<做什么> —— 验收：<怎么判定>
- [ ] 阶段二：<做什么> —— 验收：<怎么判定>

## 依赖与风险
依赖的外部条件（凭据、上游版本、其他人的改动）；风险 + 兜底方案。

## 进度
| 阶段 | 状态 | 备注 |
|---|---|---|
| 一 | 未开始 | |
```

## 与 `.ai/specs/` 的关系

框架的 `spec-pr` 交付链会把规格写进 `.ai/specs/`（agent 可执行、按阶段推进）。
本目录面向**人**：给团队看的排期、依赖和验收口径。

两者内容重叠时，`.ai/specs/` 是执行口径，本文档是沟通口径——不要互相复制整段，
链过去即可。

## 规格状态板（`.ai/specs/`）

**权威状态是每份 spec 的 `**Status**` 行**（那里写清已交付到哪一阶段、哪些还开着）；
下表只是给人看的总览，2026-09-23 与代码核对过一遍。逐条实测证据见
[`cross-border-erp.md`](./cross-border-erp.md) 的"进度"表。

| 规格 | 状态 | 覆盖 |
|---|---|---|
| [2026-09-21-app-owned-business-module.md](../../.ai/specs/2026-09-21-app-owned-business-module.md) | 已被子规格取代，作为共享决策索引保留；REQ-011（传输层）/REQ-013（分公司仪表盘）未完成 | 总纲 |
| [2026-09-21-erp-core-module-activation.md](../../.ai/specs/2026-09-21-erp-core-module-activation.md) | 已实现 | 7 个官方 ERP 模块 + zh 覆盖层 |
| [2026-09-21-purchasing-module.md](../../.ai/specs/2026-09-21-purchasing-module.md) | 已实现（分公司仪表盘/区块未做） | `purchasing` |
| [2026-09-21-cross-border-shipments.md](../../.ai/specs/2026-09-21-cross-border-shipments.md) | 已实现（Q1–Q3 用可逆默认） | `cross_border` |
| [2026-09-21-platform-ops.md](../../.ai/specs/2026-09-21-platform-ops.md) | 已实现 A+B；Phase C 传输层待 PRD Q4 | `platform_ops` |
| [2026-09-21-auth-scope-guard-hardening.md](../../.ai/specs/2026-09-21-auth-scope-guard-hardening.md) | 已实现（组织树写缺口不在范围、仍未立项） | `scope_guards` |
| [2026-09-21-catalog-customization-and-eject-decision.md](../../.ai/specs/2026-09-21-catalog-customization-and-eject-decision.md) | 已被取代，仅保留决策记录与官方 catalog 的保留契约清单 | `catalog`（不 eject） |
| [2026-09-22-products-and-trade-docs.md](../../.ai/specs/2026-09-22-products-and-trade-docs.md) | 已实现 | `products` / `trade_docs` / `internal_sales` |
| [2026-09-22-product-variants.md](../../.ai/specs/2026-09-22-product-variants.md) | Phases 1–2 已实现；Phase 3（wms 轮）延后 | `products` 变体 |
| [2026-09-22-app-owned-party-master.md](../../.ai/specs/2026-09-22-app-owned-party-master.md) | Phases 1–3 已实现；Phase 4 待 Q-P-004 | `parties` |
| [2026-09-22-supplier-quotation-import.md](../../.ai/specs/2026-09-22-supplier-quotation-import.md) | 已实现 | `sourcing` 报价导入 |
| [2026-09-22-supplier-product-library.md](../../.ai/specs/2026-09-22-supplier-product-library.md) | Phases 1–7 已实现并验证；产品库 2026-09-23 整体移交 `purchasing`（D4，表改名保留数据）。**Phase 8（关联商品：直觉化 + 手动关联）2026-09-23 已实现并验证**（集成 TEST-SPL-009/010/011 全绿 + 浏览器冒烟；无新表无迁移） **Phase 9（供应商折扣 + 本公司报价归位）2026-09-24 已实现并验证**；**Phase 10（价格组收成一条供货价）2026-09-24 已实现并验证**（价格组只剩 币种/单价/折扣，其它价格行只读回传；单元 TEST-SPL-015 + 浏览器冒烟，无迁移） | `purchasing` 产品库 |
| [2026-09-22-order-file-and-export-finance.md](../../.ai/specs/2026-09-22-order-file-and-export-finance.md) | 已实现（仅投影单测，集成测试待补） | `purchasing`/`cross_border`/`trade_docs`/`export_finance` |
| [2026-09-23-product-taxonomy-consolidation.md](../../.ai/specs/2026-09-23-product-taxonomy-consolidation.md) | 已实现（Phase 0–3：术语定名 → 两页合并为 `/backend/products/taxonomy` 两页签、旧 URL 直接渲染并规范化 → 品类真树（默认全开、可折叠、行内新增子类）→ 维护页收窄到所选组织）；spec 机制描述已与实装对齐，实测证据见各 Phase 的 "Shipped — evidence" | `products` 产品线/产品品类页面合并 + 导航修复 + 维护页按组织收窄 |
| [2026-09-23-local-to-s3-storage-migration.md](../../.ai/specs/2026-09-23-local-to-s3-storage-migration.md) | **Phase 0 + Phase 1 已交付**（provider 已装/已探针；`storage_ops` 五条命令 + 13 单测 + 9 集成用例，MinIO 全流程彩排通过；分区仍 local）；**Phase 2 实作手册已备**（`docs/deploy/storage-cutover-runbook.md`），待对象存储服务开通 | `attachments` 本地→S3 迁移前置与一键迁移 |
| [2026-09-24-supplier-code-issuance.md](../../.ai/specs/2026-09-24-supplier-code-issuance.md) | 已实现并验证（供应商编码由命令发 `SUP-####`：连续、含软删行不复用、按组织独立；新建表单隐藏该字段、编辑只读；接口仍接受显式 `code`；无迁移） | `purchasing` 供应商主数据 |
| [2026-09-24-dictionary-main-menu-entry.md](../../.ai/specs/2026-09-24-dictionary-main-menu-entry.md) | 已实现并验证（主菜单「基础数据 → 字典维护」→ `/backend/dictionaries`，复用同一页面体；设置侧栏那份与 installed 元数据不动） | `dictionaries` 入口 |
| [2026-09-24-supplier-quotation-change-analysis.md](../../.ai/specs/2026-09-24-supplier-quotation-change-analysis.md) | 已实现并验证（三条只读接口 + 详情页对比面板 + 列表页「变更」标签 + 货号价格时间线；页面标题改「供应商报价与变更」（2026-09-28 起按 N-3 改为「供应商报价单（SQ）」，变更分析仍在详情与页签）；无新表/无迁移/无新权限位。证据：单元 `lib/__tests__/quoteChanges.test.ts`；集成 `__integration__/quote-changes.spec.ts` → `yarn mercato test:integration quote-changes` **3 passed**（TEST-002/003/004，全新库）；浏览器实测） | `sourcing` 报价变更分析 |
| [2026-09-24-attachment-file-preview.md](../../.ai/specs/2026-09-24-attachment-file-preview.md) | 已实现并验证（app 级共享查看器：图片对话框内等比显示、PDF 由 Mozilla PDF.js 渲染到同源 canvas、不支持/过大/越权三态保留下载；5 个模块 9 处引用 + 产品照片接线；无新 API/权限/迁移、CSP 与 installed `attachments` 未改。证据：单元 `src/lib/attachments/__tests__/previewKind.test.ts`、浏览器实测（3 页 PDF → 3 个 canvas 且像素吻合、图片、TXT、行操作、照片、暗色、窄屏）、`yarn build` ✓） | `purchasing` / `export_finance` / `cross_border` / `trade_docs` 附件预览 |
| [2026-09-24-pi-ci-tax-invoice-documents.md](../../.ai/specs/2026-09-24-pi-ci-tax-invoice-documents.md) | **全部 5 个 Phase 已实现并验证（2026-09-28）**：Phase 0 术语与菜单；Phase 1 PI 全链路；Phase 2 CI + 发运单↔内部销售订单分摊 + 旧单证槽位收口；Phase 3 税务发票票种/税额/`TI-` 发号与合同口径隔离；Phase 4 单据间一次性复制（PI→CI→税务发票）+ 文档收口。证据：门禁全绿（generate/typecheck/lint 0 error/ds:check 747 files/test 290 passed）+ 集成四套 **10 / 7 / 5 / 4 passed** + 浏览器实测（PI 签发→生成→下载→作废；发运详情销售分摊与单证提示；CI 从发运单汇总；PI→CI 复制并链回源单据）。遗留：F-305（发票生成/打印）为规格内可选项，未做 | 外贸三单据：PI / CI / 税务发票 + 菜单命名校正 + `trade_docs`/`cross_border` 配套改动 |
| [2026-09-28-finance-ledger-and-cockpit-data.md](../../.ai/specs/2026-09-28-finance-ledger-and-cockpit-data.md) | Phase 1–8 全部交付并实测：17 端点实拉（8 supply + 9 ads，重放幂等）、四预警各触发一次且去重、三条到期提醒、FLOW-G1 端到端链路在全新一次性库上绿、11 个页面与 4 个 widget 渲染真实数据；实测查出并修掉四个真实缺陷（通知 uuid 列、跨模块缓存失效、金额卡丢 footer、ДРР widget 占位符） | `finance`（新）+ `ru_sync`（新）+ `boss_cockpit`（新）+ `export_finance` 加列 |
| [2026-09-28-internal-sales-buyer-linkage.md](../../.ai/specs/2026-09-28-internal-sales-buyer-linkage.md) | 已实现并验证（内部销售单据的买方 = **关联组织**（顶栏组织切换器 payload − 当前组织，分公司账号自然没有内部项）+ **外部客户**（`parties`，`/api/parties/options` 新增可选 `roles` 过滤）；选中回填买方名称，链接写 `customerSnapshot.internalSales.{organizationId\|partyId}`，不再读 `customers/companies`；无新表/无迁移/无新权限位。证据：单元 18 例（买方 13 + 组织选项 5）+ `yarn test` 38 suites/320、集成 parties roles 用例、curl 组合过滤、浏览器新建/编辑实测、库内快照回读一致） | `internal_sales` 买方字段 + `parties` 选项源 |
| [2026-09-28-money-scale-2dp-unification.md](../../.ai/specs/2026-09-28-money-scale-2dp-unification.md) | **已实现并验证（2026-09-28）**：金额恒 2 位 HALF_UP、单价恒 4 位；引擎 `trade_docs/lib/money.ts` 2 位化（删币种位机制、`divideHalfUp`/`toScaledUnits` 迁入）；8 模块金额列 `numeric(18,2)`、单价列 `numeric(18,4)`，**迁移已应用到开发库**（应用前备份 21 张表，`/tmp/kc-money-backup/kc-money-20260928.sql`；40 列核对 0 偏差）；purchasing/platform_ops/cross_border/sourcing/products/currency_policy 写路径引擎化与对账精确化；展示统一（`MoneyAmount` 2 位、单价 4 位）；internal_sales 入口校验；11 份 spec + 9 份 docs + 7 份 README 同步。证据：generate/typecheck/lint(0 error)/test(54 suites/439)/ds:check(891) 全绿；ephemeral 集成 **76 passed**（金额相关全过）。存留：storage_ops 4 例环境门控、finance-flow 新规格自身 ACL（均与金额无关） | 全模块金额/单价口径 + `finance`/`export_finance`/`trade_docs` 计算与对账 |
| [2026-09-28-product-distribution-to-branches.md](../../.ai/specs/2026-09-28-product-distribution-to-branches.md) | 已实现并验证（PRD Q5 落地：**分发副本**而非共享读；`source_product_id` 一列 + `products.items.distribute` 一命令 + `POST /api/products/items/distribute` 一路由 + 商品列表行/表头两个入口；字段白名单、变体按 code upsert、价格仅首次复制、SKU 冲突跳过、越界 403。证据：迁移审阅并应用；单元 11 例（分发 6 + 组织选项 5）；集成 **3 passed**；真机 9 件分发到两分公司（幂等重跑 `created:9/updated:9`）、分公司行选品器可选；门禁全绿） | `products` 分发 + `src/lib/orgs` 共享组织选项 |
| [2026-09-29-internal-sales-order-from-quote.md](../../.ai/specs/2026-09-29-internal-sales-order-from-quote.md) | 已实现并验证（订单从报价单载入：订单新建页「从报价单载入」+ 报价列表「按此报价新建订单」；抬头与全部行一次性预填、报价保留、可出多张订单；新订单写 `metadata.internalSales.sourceQuote` 并在编辑页显示来源链接；编辑页单文档读 `ids=`→`id=`；值编解码抽到 `lib/documentValues.ts` 并兼容安装层序列化的 `comment` 键；无新表/无迁移/无新权限位。证据：单元 2 suites/27 tests、真机 QUOTE-20260929-00022 → ORDER-20260929-00008 全流程、403 拦截提示、脏表单覆盖确认、窄屏+深色；门禁全绿） | `internal_sales` 报价→订单引用加载 |
| [2026-08-06-reference-module-activation.md](../../.ai/specs/2026-08-06-reference-module-activation.md)、`SPEC-000-template.md`、`README.md` | **harness 托管文件**（`.ai/harness/manifest.json` 标 `userEditable: false`）：勿手改，会随 `yarn mercato agentic:init --update-harness` 重写 | 参考模块启用 / 模板 |

## 索引

| 文档 | 状态 |
|---|---|
| [lookup-field-dropdown.md](./lookup-field-dropdown.md) | 阶段一进行中（补丁已交付，待上游接受） |
| [cross-border-erp.md](./cross-border-erp.md) | 阶段一~四、六、七完成并验证；阶段五（收尾）进行中 |
| [finance-and-cockpit.md](./finance-and-cockpit.md) | 阶段一~八全部完成并实测（17 端点实拉、四预警、三条到期提醒、FLOW-G1 端到端链路绿；实测查出并修掉四个真实缺陷，见 spec Changelog） |
