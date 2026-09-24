# 项目文档（docs/）

本目录存放**给人看**的项目文档。`.ai/` 存放给编码 agent 用的 harness 上下文，
两者职责不同，不要互相复制：

| | `docs/` | `.ai/` |
|---|---|---|
| 读者 | 人（开发、产品、运维） | 编码 agent |
| 形态 | 长文，可含时间线、证据、图 | 短规则，可路由、可校验 |
| 维护 | 跟着功能一起改 | `yarn mercato agentic:init --update-harness` 管理 |
| 校验 | 人工评审 | `node scripts/check-lessons.mjs` 等 |

## 目录职责

| 目录 | 放什么 | 现有文档 |
|---|---|---|
| `dev/` | 怎么搭、怎么跑、架构与关键机制的实现方式 | [setup](./dev/setup.md)、[architecture](./dev/architecture.md)、[i18n](./dev/i18n.md)、[currency-policy](./dev/currency-policy.md)、[multi-company-org-model](./dev/multi-company-org-model.md)、[business-architecture](./dev/business-architecture.md)、[parallel-development](./dev/parallel-development.md) |
| `deploy/` | 怎么构建、怎么上线、环境变量契约、运维动作 | [runtime](./deploy/runtime.md) |
| `prd/` | 产品需求：解决什么问题、给谁用、验收标准 | [lookup-field-dropdown](./prd/lookup-field-dropdown.md)、[cross-border-erp](./prd/cross-border-erp.md) |
| `plans/` | 计划开发需求：分阶段、任务拆解、依赖与排期 | [lookup-field-dropdown](./plans/lookup-field-dropdown.md)、[cross-border-erp](./plans/cross-border-erp.md) |
| `pitfalls/` | 踩坑复盘：现象、时间线、根因、处置、如何避免 | [dev-runtime-stale-incident](./pitfalls/dev-runtime-stale-incident.md)、[dictionary-delete-is-not-locale-removal](./pitfalls/dictionary-delete-is-not-locale-removal.md)、[agent-sandbox-scripts-break-the-build](./pitfalls/agent-sandbox-scripts-break-the-build.md)、[radix-popover-spins-jsdom-event-loop](./pitfalls/radix-popover-spins-jsdom-event-loop.md) |

每个目录的 `README.md` 是该目录的契约：放什么、不放什么、索引。

## 命名

- 文件一律 kebab-case 英文名 + `.md`：`i18n.md`、`stripe-webhook.md`
- 一个主题一个文件；不要按时间追加成流水账
- 时间只写在正文的「时间线」里，不进文件名——否则同一主题会散成多份

## 必备章节骨架

**dev / deploy**：`## 适用范围` → 正文 → `## 验证方式`（怎么确认文档没写错）

**prd**：`## 背景与问题` → `## 目标 / 非目标` → `## 用户与场景` → `## 验收标准` → `## 开放问题`

**plans**：`## 目标` → `## 阶段划分`（每阶段可独立验收）→ `## 依赖与风险` → `## 进度`

**pitfalls**：`## 现象` → `## 时间线` → `## 证据` → `## 根因` → `## 处置` → `## 如何避免`

## 状态从哪来（避免再次漂移）

- **规格（`.ai/specs/**`）与模块 README 的权威状态在文件自己的 `**Status**` / 表格里**；
  [`plans/README.md`](./plans/README.md) 的「规格状态板」只是给人看的总览，**改状态时两边一起改**。
- 交付了一件事（一个阶段、一次迁移、一条能力上线）时，**同一个改动里**更新：spec 的 `Status` + Changelog 行、
  plans 的「进度」表、受影响的 `docs/dev/*`、以及对应模块的 `src/modules/<id>/README.md`。
- 写「还没做/已完成」这类判断时，用能重跑的命令或文件行号做依据（`src/modules.ts`、生成物、
  迁移文件名），不要只凭记忆。

## 新增一份文档

1. 选目录；都不合适就先在这里加一行再加目录
2. 按上面的骨架起头，文件名 kebab-case
3. 在该目录的 `README.md` 索引里加一行
4. 改了行为 / 配置 / 流程 → 在**同一个改动**里更新对应文档

## 与 `.ai/lessons/` 的边界

踩坑只留**一处**，否则必然漂移：

- 短、可路由、能写成一条可执行规则的 → `.ai/lessons/<slug>.md`
  （agent 读，`node scripts/check-lessons.mjs` 校验，根 `AGENTS.md` 里要求扫描）
- 需要时间线、日志证据、上下文的长篇复盘 → `docs/pitfalls/`

写 `docs/pitfalls/` 时，如果同类规则已经在 `.ai/lessons/` 里，正文里链接过去，不要重写一遍。
