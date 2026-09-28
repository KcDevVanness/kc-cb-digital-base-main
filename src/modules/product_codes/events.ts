import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Events emitted by the product-codes module.
 *
 * Rule changes are `crud` so the standard subscribers (audit, index) can attach; `code.issued` is
 * `custom` because issuing a number is not a row change — it is the one irreversible act in this
 * module, and it is worth being observable on its own.
 */
const events = [
  { id: 'product_codes.rule.created', label: 'Code rule created', entity: 'product_code_rule', category: 'crud' },
  { id: 'product_codes.rule.updated', label: 'Code rule updated', entity: 'product_code_rule', category: 'crud' },
  { id: 'product_codes.rule.deleted', label: 'Code rule deleted', entity: 'product_code_rule', category: 'crud' },
  { id: 'product_codes.code.issued', label: 'Product code issued', entity: 'product_code_ledger', category: 'custom' },
  { id: 'product_codes.alias.created', label: 'Retired product code recorded', entity: 'product_code_alias', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'product_codes',
  events,
})

export const emitProductCodesEvent = eventsConfig.emit

export type ProductCodesEventId = typeof events[number]['id']

export default eventsConfig
