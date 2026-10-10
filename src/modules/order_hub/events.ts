import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Events emitted by the order hub.
 *
 * The id segment after the module id is the `CrudEventsConfig.entity` value, so the CRUD ids are
 * what the data engine emits (`order_hub.company_order.created`, …). `clientBroadcast` keeps open
 * workbench and hub lists in sync without polling; payloads carry identifiers and scope only.
 */
const events = [
  { id: 'order_hub.company_order.created', label: 'Company Order Created', entity: 'company_order', category: 'crud', clientBroadcast: true },
  { id: 'order_hub.company_order.updated', label: 'Company Order Updated', entity: 'company_order', category: 'crud', clientBroadcast: true },
  { id: 'order_hub.company_order.deleted', label: 'Company Order Deleted', entity: 'company_order', category: 'crud', clientBroadcast: true },
  { id: 'order_hub.company_order.links.updated', label: 'Company Order Links Updated', entity: 'company_order', category: 'lifecycle', clientBroadcast: true },
  /**
   * 根单持有字段（订单描述 / 采购负责人）变化，或采购单新挂上根单：载荷带**值**与收件采购单 id，
   * `purchasing` 的订阅者据此把两个字段镜像到采购单（第十轮：入口统一在根单，采购侧只读）。
   * 不发广播：改动只在采购模块的读面可见，本页保存后自行刷新。
   */
  { id: 'order_hub.company_order.order_fields_updated', label: 'Company Order Order Fields Updated', entity: 'company_order', category: 'lifecycle' },
  { id: 'order_hub.company_order.collaborators.updated', label: 'Company Order Collaborators Updated', entity: 'company_order', category: 'lifecycle', clientBroadcast: true },
  { id: 'order_hub.company_order.documents.updated', label: 'Company Order Documents Updated', entity: 'company_order', category: 'lifecycle', clientBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'order_hub',
  events,
})

export type OrderHubEventId = typeof events[number]['id']

export default eventsConfig
