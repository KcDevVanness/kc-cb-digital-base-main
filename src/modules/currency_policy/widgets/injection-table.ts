import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Where the CNY column is injected.
 *
 * One spot today: the installed sales-orders table's column host. The installed documents route
 * publishes an enricher host for orders only (`enrichers: binding.kind === 'order' ? … : undefined`), and
 * a column widget can only read a value that already exists on the row — so quotes and payments have no
 * source to read and are deliberately absent here rather than mounting a column that would render empty
 * on every row (see the spec's Phase 6 note).
 *
 * The table is keyed on the spot id only, so the entry is inert when `sales` is disabled.
 */
export const injectionTable: ModuleInjectionTable = {
  'data-table:sales.orders:columns': {
    widgetId: 'currency_policy.injection.sales-order-cny',
    priority: 60,
  },
}

export default injectionTable
