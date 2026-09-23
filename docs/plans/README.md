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
| [2026-09-22-supplier-product-library.md](../../.ai/specs/2026-09-22-supplier-product-library.md) | Phases 1–7 已实现并验证；产品库 2026-09-23 整体移交 `purchasing`（D4，表改名保留数据） | `purchasing` 产品库 |
| [2026-09-22-order-file-and-export-finance.md](../../.ai/specs/2026-09-22-order-file-and-export-finance.md) | 已实现（仅投影单测，集成测试待补） | `purchasing`/`cross_border`/`trade_docs`/`export_finance` |
| [2026-09-23-local-to-s3-storage-migration.md](../../.ai/specs/2026-09-23-local-to-s3-storage-migration.md) | **Phase 0 + Phase 1 已交付**（provider 已装/已探针；`storage_ops` 五条命令 + 13 单测 + 7 集成用例，MinIO 全流程彩排通过；分区仍 local）；Phase 2 切换待启动 | `attachments` 本地→S3 迁移前置与一键迁移 |
| [2026-08-06-reference-module-activation.md](../../.ai/specs/2026-08-06-reference-module-activation.md)、`SPEC-000-template.md`、`README.md` | **harness 托管文件**（`.ai/harness/manifest.json` 标 `userEditable: false`）：勿手改，会随 `yarn mercato agentic:init --update-harness` 重写 | 参考模块启用 / 模板 |

## 索引

| 文档 | 状态 |
|---|---|
| [lookup-field-dropdown.md](./lookup-field-dropdown.md) | 阶段一进行中（补丁已交付，待上游接受） |
| [cross-border-erp.md](./cross-border-erp.md) | 阶段一~四、六、七完成并验证；阶段五（收尾）进行中 |
