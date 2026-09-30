# Run note — 单据状态生命周期 + 逾期提醒（2026-09-30）

一条长会话的交付记录：把「各业务板块缺状态」从骨架推进到**可用的状态机 + 门禁 + 报表 + 提醒**，
并在过程中**三次用代码否掉了文档里的猜测**（下节）。所有单元都已合并进 `main` 并经真机或门禁验证；
本文件只做索引，权威仍是各 spec 的 `**Status**` 行与 [`.ai/specs/2026-09-30-document-status-lifecycle.md`](../specs/2026-09-30-document-status-lifecycle.md)。

## 交付（全部已上线，PR → 波次 → `main`）

| 交付 | PR / 波次 | 关键证据 |
|---|---|---|
| Phase 1 销售链状态（draft/发出/确认/作废 + 下单门禁 + 有效期） | 早前波次 | 列表徽章、有效至、过期高亮；发运分摊只列 confirmed |
| Phase 2·A 发运归档 `closed` | 早前波次 | 终态守卫 + 三处「只认 received」读路径补齐 |
| Phase 2·C 收款/退税**状态与事实绑定** + 派生逾期标记 | #77 → #79 | 三种非法组合 422 逐条说明；`collectionOverdue`/`refundOverdue` 进列表与 CSV |
| Phase 3·A 供应商产品库**停用/启用**行操作 | #81 → #82 | 真机：停用后离开活跃视图、可一键恢复；夹具已回滚 |
| Phase 4·A **逾期清单** `/backend/export-finance/overdue` | #87 → #88 | `overdue=true` 落在行派生标记上：`all=2 / overdue=1 / CSV 1 行` |
| Phase 4 **转化率** `/backend/internal-sales/quote-conversion` | #95/#96/#98 → #99 | 读订单冻结的 `metadata.internalSales.sourceQuote`；双分母 + 原始计数；夹具验证后回滚 |
| Phase 4·B **逾期提醒**命令 + 通知类型 + **清单「已提醒」标记** + 部署手册 | #104/#105、#110/#111、#116/#117 | 命令 2 条 → 再跑仍 2 条（刷新）→ `--dry-run` 零写 → 拆夹具回 0；页面两行「已提醒 2026-09-15 判定日」 |
| 阶段五验证：全量集成套件实跑 / 审计撤销链实测 | #106/#107、#108/#109 | `104 passed / 4 failed / 5 skipped`（4 失败全为 `storage_ops` 的 S3 门禁）；undo 200 → 字段复原、条目 `undone`、令牌不可复用 |
| 规格/状态板与事实对齐（含 Phase 4·B 草稿×实现对账） | #102/#103、#112/#113、#114/#115 | 「仍待」清单收敛为迁移批次 + 分公司仪表盘 |
| 分公司仪表盘**口径草案**（阶段五最后一项） | #118 → #119 | 7 个候选数字 + 各自数据来源，全部现有读、无新列 |

## 三次「文档写错了，代码是对的」

1. **采购单门禁与事件**：骨架要求「补收货/付款门禁与事件」，核对现网发现**早已实现**（`commands/orders.ts:803/929/961` + 五个生命周期事件），Phase 3 不再重复实现。
2. **审计载荷加密**：原计划用 `action_logs` 做「状态停留时长」——实测**时间线明文、取值列是 at-rest 密文**（`…:v1`），SQL 判定不了日志行对应哪个状态 ⇒ 改道为随迁移批次加 `status_changed_at`。
3. **转化率不需要新列**：订单已冻结 `metadata.internalSales.sourceQuote`，转化率是纯读侧聚合；只有**停留时长**需要新列。

## 跑法要点（两次踩坑后记下）

- `yarn test:integration:ephemeral`：ephemeral 以 **production 模式**起服务，`.env` 的占位 `JWT_SECRET` 会让服务退出 ⇒ 必须传真密钥；把 `DATABASE_URL` 指到**独立库**（本次 `kc_cb_itest`，跑完 DROP），集成夹具不落开发库。
- 审计接口真实前缀是 **`/api/audit_logs/audit-logs/…`**（模块 id + 源目录名各一层）；写短了会 404，容易被误判为无此能力。
- 全量 `yarn test` 会跑 `src/lib/i18n/__tests__/language-purity.test.ts`：**英文词典里出现中文会让波次 `checks` 失败**（本次踩过一次，只跑模块子集时漏掉）。

## 仍待（都需要 owner 决定，代码侧已无自走项）

1. **迁移批次批准**：`cross_border_export_documents.status`（2·B）+ 结算单确认/付款列（3·B）+ 费用付款日期列 + `sales_*` 的 `status_changed_at`。
2. **Q-010**：结算单「导入自动 `reconciled`」与「人工确认」合一还是分开、谁有权确认。
3. **合并促销 PR #94**（树 == `main`，五项门禁全绿；合并即触发 `deploy.yml`）或 force-with-lease 复位 `production`。
4. **分公司仪表盘**：勾选数字 / 受众 / 是否 HQ 横向对比（口径已列全）。
