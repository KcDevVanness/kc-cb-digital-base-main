# ru-petkit — 俄罗斯 PETKIT 外部系统调研（非本项目系统）

本目录描述的是**外部系统**（`https://report.petkit-api.ru`，俄罗斯 PETKIT 数据分析与供应计划），不是本仓库自研 ERP。
只读调研 + 对接文档，不写代码、不做迁移。阅读时不要与本项目系统混淆：本项目的需求见 [`../prd/`](../prd/)，实现见 `src/modules/<id>/`。

**放**：RU 外部系统的取证、功能分析、字段清单、对接 brief、系统功能 PRD（中文为准）。
**不放**：本项目 ERP 的需求 / 计划 / 实现（→ `../prd/`、`../plans/`、`../dev/`）；任何代码改动。

## 索引

| 文档 | 说明 |
| [prd.md](./prd.md) | 系统功能 PRD（中文为准，11 页 F-01…F-11 + 口径 + 分级 + 验收 + 开放问题） |
| [supply-sync-tech.md](./supply-sync-tech.md) | 给俄方技术团队的总包 v2：5 问直答 + 我方业务一页纸 + §B 术语对照 + 16 端点技术规范（§1–§8 supply / §10–§22 ads·映射·验收）+ §A.7 勾选 |
| [system-analysis.md](./system-analysis.md) | 功能分析长文（逐页功能、决策 × 频率、价值分级） |
| [field-mapping.md](./field-mapping.md) | 字段与维度需求清单（6 域表）+ 中方 7 模块映射锚点 |
| [integration-brief.md](./integration-brief.md) | 发俄方：本系统架构 + 模块清单 + HTTP 接口规范 + 分工待办 |
| [evidence.md](./evidence.md) | 取证证据包（逐路由来源行、筛选器、指标、口径表、流转图、网络快照） |
| [export-sample-pk44.csv](./export-sample-pk44.csv) | 小样本（单 SKU 单日 5 行 17 列，仅用于提取列头） |
| [shots/](./shots/) | 11 张全页截图（`01-overview.webp` … `11-export.webp`） |
