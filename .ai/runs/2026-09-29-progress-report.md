# 进度汇报文档（progress-report）

## Goal

Add the living human-facing progress report `docs/reports/progress.md` for the cross-border ERP:
the owner's phase-1 / phase-2 requirement list mapped to ✅ / 🟡 半完成 / ⬜ status, the forward
plan, and the open decisions — written so it can be pasted into Feishu as-is (owner 2026-09-29:
「转化成飞书可复制的文档，内容精炼，不用很复杂」).

## Source docs

`docs/plans/README.md`（规格状态板）· `docs/plans/cross-border-erp.md` · `docs/plans/finance-and-cockpit.md` ·
`.ai/specs/**` 的 `**Status**` 行 · `src/modules.ts`.

## Scope

- New folder contract `docs/reports/README.md` + the report `docs/reports/progress.md`.
- One appended row in `docs/README.md` (the docs index).
- Non-goals: no code changes, no spec `Status` rewrites (statuses are cited, not restated as new
  authority), no `docs/plans/*` edits.

## Implementation Plan

### Phase 1: 文档落地

- 1.1 写 `docs/reports/progress.md`：精炼的飞书可复制版；经营概览与财务按 owner 口径标「半完成」。
- 1.2 写 `docs/reports/README.md` 目录契约 + 在 `docs/README.md` 追加一行索引。

### Phase 2: 校验与交付

- 2.1 文档适用门禁：新文档内的相对链接存在性检查 + diff 复读。
- 2.2 提交、推送、PR（draft → ready）与标签、汇总评论。

## Risks

- 状态漂移：每条状态引用其来源（spec / 计划表 / 迁移 / 生成物）；文档内写明更新规则。
- 与 owner 的业务口径差异：经营概览 / 财务按 owner 2026-09-29 的口径标「半完成」，不按仓库内的
  「Phase 交付」表述改写为已完成。

## Progress

PR: #58

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: 文档落地

- [x] 1.1 写 `docs/reports/progress.md` — 5761621
- [x] 1.2 写目录契约与 `docs/README.md` 索引行 — 5761621

### Phase 2: 校验与交付

- [x] 2.1 链接存在性检查 + diff 复读 — 5761621（32 条相对链接 0 缺失）
- [x] 2.2 提交、推送、PR、标签
