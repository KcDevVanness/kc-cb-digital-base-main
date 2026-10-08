# 公司订单为根的第二轮重构（报价单合并 + 订单单据维度 + hub 就地编辑 + 菜单再分层 + 取消「只看待补」）

**Status:** in-progress（阶段 E / A / B / C 已交付，阶段 D 在飞；PR #147，base `dev`）
**Source doc:** [`.ai/specs/2026-10-08-order-centric-entry.md`](../specs/2026-10-08-order-centric-entry.md)

## 为什么有这一轮

第一轮把入口收到「公司订单」后，owner review 指出四处仍需改，外加一处筛选要删：

| # | 问题 | 决定 |
|---|---|---|
| 1 | 对内 / 对外销售报价单还是两条平铺入口 | 合并成 `/backend/quotes` 一条列表 + 类型列 + 类型筛选（D2） |
| 2 | 公司订单的「单据」靠合同推导（`trade_docs_contract_orders` → `documents.contract_id`） | 订单拥有自己的单据维度：新表 `trade_docs_order_documents`（D1） |
| 3 | 订单 hub 的草稿填写不如 `/backend/trade-docs/contracts/<id>` 直观 | hub 对齐合同页组织，且区块内可就地编辑（D3） |
| 4 | 采购 / 出口销售 / 合同与单据 / 发运与装箱不是在「订单工作台」之下 | 侧栏四层：公司订单 → 订单工作台 → 四个业务组 → 页面（D4） |
| 5 | 工作台「只看待补」勾选框 | 删除筛选、`pending` 参数与 `lib/orderPending.ts`；阶段列保留（D5） |

## 阶段与证据

| 阶段 | 内容 | 证据 |
|---|---|---|
| E | 工作台取消「只看待补」 | `order_hub` 单测 16（`compareByCreatedAtDesc` 移入 `mergeOrders`）、`src` 内 0 处旧符号；spec/README 同步 |
| A | 侧栏四层 + 分支行标题可点 | `yarn jest src/modules/nav_shell` 22 passed；`docs/dev/navigation.md` 与模块 README 同步（含「新加一层不能拖拽排序」的已知限制） |
| B | `/backend/quotes` 合并报价列表 | `yarn jest src/modules/internal_sales` 60 passed（含 `quoteListParams` 5 例）；两个旧 URL 307 |
| C | 订单单据维度 | 迁移 `Migration20261008095745_trade_docs`（已应用）、`trade_docs.orders.documents.replace` + `GET/POST /api/trade_docs/orders/documents`、集成 `__integration__/order-documents.spec.ts`、`documentCount` 口径改按订单自己的关联行 |
| D | hub 对齐合同页 + 就地编辑 + 装箱单区块 | 共享 `src/lib/related/RelatedSection.tsx`、`src/lib/quick-edit/QuickEditDialog.tsx` + 五个字段工厂；hub 六区块 |

## 交付方式

一个工作单元 = 一个 worktree = 一条分支 = 一个 PR（#147，base `dev`）。阶段 D 的两块共享件与两个模块 README
分别在**叠加在单元分支上的竖片 worktree**里并行开发，由集成者合并进单元分支；竖片分支不进 PR、合并后删除。
