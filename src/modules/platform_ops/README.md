# `platform_ops` — 平台渠道、订单镜像、结算与对账

app 自有模块。跨境电商的平台侧作业面：渠道主数据 → 平台订单镜像（幂等 ingest）→ 平台结算单
（幂等 import）→ 对账队列（差异 → 决定）。**传输层**（真去平台拉数据）按 Q4 决策接入，本模块
只提供稳定的落地命令与契约。

## 表面

| 层 | 内容 |
|---|---|
| 实体（`data/entities.ts`） | `PlatformOpsChannel` / `PlatformOpsOrderMirror` / `PlatformOpsSettlement` / `PlatformOpsSettlementLine` / `PlatformOpsReconciliationItem` → 表 `platform_ops_channels` / `platform_ops_order_mirrors` / `platform_ops_settlements` / `platform_ops_settlement_lines` / `platform_ops_reconciliation_items` |
| API | `GET|POST /api/platform_ops/channels`、`/orders`、`POST /orders/ingest`、`/settlements`、`/settlements/lines`、`POST /settlements/import`、`/reconciliation`、`POST /reconciliation/{resolve,ignore}` |
| 命令 | `platform_ops.channels.{create,update,delete}`、`platform_ops.orders.ingest`、`platform_ops.settlements.import` |
| 后台页面 | `/backend/platform_ops/channels`（列表/新建/编辑）、`/orders`（镜像列表）、`/settlements`（列表/详情）、`/reconciliation`（队列） |
| 事件 | `platform_ops.channel.{created,updated,deleted}`、`platform_ops.orders.ingested`、`platform_ops.settlement.imported`、`platform_ops.reconciliation.{raised,resolved}` |
| 权限 | `platform_ops.channels.view|manage`、`platform_ops.settlements.view|manage`、`platform_ops.reconciliation.view|manage` |
| 迁移 | `migrations/Migration20260921094226_platform_ops.ts` |

## 规则（有意为之）

- **幂等按业务键**：订单镜像按 (渠道, 平台订单号) 去重，重放返回 `created/unchanged` 计数而非重复插入；
  结算导入同样按结算单号与行键去重，重放 `raised:0`。
- **差异进队列，不进明细**：结算明细只标"订单存在/不存在"，金额差异由对账队列表达
  （`amount_mismatch` / `missing_in_erp`），避免同一事实两处口径。
- **决定不复活**：`resolve`/`ignore` 后重放同一批数据不会重新打开已决定的差异。
- **传输层未接**：`integrations`（外部 id 映射、provider 注册）与 `data_sync`（流式导入导出、游标）
  已启用，是 Q4 落地传输的接入点；落地命令是稳定契约，加传输层不改表、不改命令。
- **不跨模块 ORM 关联**：对 `sales`/`wms` 的关联只存 ID/快照。

## 验证

```bash
yarn generate && yarn typecheck
yarn test src/modules/platform_ops
# 冒烟：渠道 201 → ingest 首次 created:2 / 重放 unchanged:2 → 结算导入 lines:3, raised:2, linked:1
#       → 队列 2 条 → resolve/ignore 200 → 重放仍 raised:0
```

## 回滚

从 `src/modules.ts` 移除 `{ id: 'platform_ops', from: '@app' }` 并 `yarn generate`；表与数据保留。

## 相关知识（`.ai/lessons/`）

- `currency-dictionary-seeding.md` — 结算币种与汇率主数据的关系。
- `.ai/specs/2026-09-21-platform-ops.md` — 命令、幂等键与对账语义的完整定义。
