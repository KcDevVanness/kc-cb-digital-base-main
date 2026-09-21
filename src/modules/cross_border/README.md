# `cross_border` — 发运单、在途里程碑、出口单证

app 自有模块。把多张采购单**拼柜**成一张发运单，跟踪在途节点与出口单证，收货时把数量回写
`purchasing`（采购单行）与 `wms`（库存）。需求见 [`docs/prd/cross-border-erp.md`](../../../docs/prd/cross-border-erp.md)。

## 表面

| 层 | 内容 |
|---|---|
| 实体（`data/entities.ts`） | `CrossBorderShipment` / `CrossBorderShipmentAllocation` / `CrossBorderShipmentMilestone` / `CrossBorderExportDocument` → 表 `cross_border_shipments` / `cross_border_shipment_allocations` / `cross_border_shipment_milestones` / `cross_border_export_documents` |
| API | `GET|POST /api/cross_border/shipments`、`/shipments/allocations`、`/shipments/milestones`、`/shipments/documents`，动作路由 `POST /shipments/{depart,receive,cancel}` |
| 命令 | `cross_border.shipments.{create,update,delete,depart,receive,cancel,advance-milestone}`、`cross_border.documents.{create,update,delete}` |
| 后台页面 | `/backend/cross_border/shipments`（列表/新建/详情：分配明细、节点时间线、单证） |
| 事件 | `cross_border.shipment.{created,updated,departed,received,cancelled,deleted,milestone_recorded}`、`cross_border.export_document.{created,updated,deleted}` |
| 权限 | `cross_border.shipments.view|manage`、`cross_border.shipments.receive`、`cross_border.documents.manage` |
| 迁移 | `migrations/Migration20260921092726_cross_border.ts` |

## 规则（有意为之）

- **分摊不可超发**：`allocations` 累计数量不得超过采购单行的订购数量，超出返回 **422**；同一采购单重复分摊同样拒绝。
- **发运即锁定**：`depart` 把已分摊采购单推进到 `shipped`，之后不允许再改分摊。
- **里程碑单调**：`advance-milestone` 只允许前进，回退返回 **422**；历史节点保留可查。
- **收货幂等**：`receive` 写 `wms` 余额并回写采购单行已收数量，重复收货不重复计数（按采购单行累加）。
- **单证是弱类型集合**：类型枚举校验，非法类型返回 **400**；单证文件走 `attachments`。
- **不跨模块 ORM 关联**：对 `purchasing`、`wms`、`attachments` 只存 ID，靠命令与事件联动。

## 验证

```bash
yarn generate && yarn typecheck
yarn test src/modules/cross_border
# 冒烟：两张采购单合并一张发运单 201 → 超发 422 → depart 后两张采购单转 shipped →
#       里程碑前进 201 / 回退 422 → receive 后 wms 余额与采购单行已收数量一致
```

## 回滚

从 `src/modules.ts` 移除 `{ id: 'cross_border', from: '@app' }` 并 `yarn generate`；已应用的迁移
与既有数据保留（数据回滚需单独评估）。

## 相关知识（`.ai/lessons/`）

- `installed-inputs-have-no-component-override.md` — 详情页里复用安装组件时的边界。
