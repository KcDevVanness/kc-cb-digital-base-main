# Run record — 商品单一存储改造的 Linear 镜像同步（2026-10-10）

**单元**：`feat/catalog-cutover-phase1`（PR #171，spec `.ai/specs/2026-10-10-catalog-single-store.md` 的 Phase 3 尾项）
**命令**（`docs-root` 指向本工作树——它的 `docs/**` 领先于 `dev`）：

```bash
node scripts/linear-sync/sync.mjs --docs-root .
node scripts/linear-sync/sync.mjs --apply --docs-root .
node scripts/linear-sync/sync.mjs --audit --docs-root .
```

## 结果

| 步骤 | 输出 |
|---|---|
| dry-run | payload 104 条；状态分布 In Progress 9 · Done 81 · Todo 10 · Backlog 4；待写 21 条、跳过 83 条、新建 0 条 |
| apply | **新建 0 · 更新 21 · 认领 0 · 跳过 83 · 修复后通过 0 · 失败 0**（逐条回读校验；无 `linear_write_unconfirmed`） |
| audit | **审计通过：104 条，全部在项目内且父子关系正确** |
| 孤儿清单 | **0 条**（项目 issue 104 = 文档节点 104，逐一按标题对齐；`scripts/linear-sync/orca.mjs` 的 `listProjectIssues` vs `payloads.mjs` 的 `buildPayloads` 比对） |

被更新的 21 条（本次改造的口径变化）：SP-46…SP-57（E 组商品/合同需求，含 E-1 改口径）、SP-62/SP-64（F-4/F-6）、
SP-70（G-3）、SP-77/SP-78（整体验收清单/开放问题）、SP-86（财务验收 8）、SP-101（阶段五历史补记）、
SP-15（业务架构开发文档）、SP-28（规格状态板索引）。

**manifest**：`scripts/linear-sync/manifest.json` 记录了本次写入（anchor → issue、内容哈希、来源
`feat/catalog-cutover-phase1 @ b834cf1`），随本 PR 提交，重跑按哈希跳过。

## 说明（对 PR 里此前那句「等 owner 的 Linear token」的更正）

本仓的 Linear 写入走 **Orca**（`/Applications/Orca.app/Contents/Resources/bin/orca`，Orca app 运行且已连接
Linear 即可），**不需要**单独的 Linear API token——此前的阻塞备注是错的。本轮实测：dry-run/apply/audit 全部
exit 0，无需任何凭据准备。

**不删 issue**：同步只创建/更新；本次无内容被移除，故没有需要人工处理的孤儿。下次若重命名或删除章节标题，
旧 issue 会留下——用同一比对（标题对齐）产出清单再人工处理。
