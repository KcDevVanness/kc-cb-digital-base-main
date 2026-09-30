import { SHIPMENT_STATUSES, type ShipmentStatus } from '../data/validators'

export { SHIPMENT_STATUSES, type ShipmentStatus }

/**
 * The shipment state machine — one authority for "which status may follow which".
 *
 * The command layer (`cross_border.shipments.*`) rejects transitions that are not listed here, the
 * detail page derives its action buttons from the same table, and the tests pin it. Before this
 * existed the rules lived only inside each command's guard, so a new status (the archival `closed`)
 * had to be threaded through four separate `if`s.
 *
 * Physical stages advance in the order below; `cancelled` is the旁路 from the states that are still
 * work-in-progress, and `closed`/`cancelled` are terminal.
 */
export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  draft: ['in_transit', 'cancelled'],
  in_transit: ['received', 'cancelled'],
  received: ['closed'],
  closed: [],
  cancelled: [],
}

/** Whether `to` may follow `from`. Unknown pairs (including a no-op) are never allowed. */
export function canTransitionShipment(from: ShipmentStatus, to: ShipmentStatus): boolean {
  // `from` arrives from a text column (and from the API), so an out-of-enum value must fail closed
  // with a 422 from the caller's guard — never throw a TypeError out of the command.
  return (SHIPMENT_TRANSITIONS[from] ?? []).includes(to)
}

/** Terminal statuses: no action may move a shipment out of them. */
export function isTerminalShipmentStatus(status: ShipmentStatus): boolean {
  return SHIPMENT_TRANSITIONS[status].length === 0
}

/**
 * The order the list filter offers the statuses in: the physical stages, then the two ways out.
 * Re-exported from the API's own enum, which stays the single source — the UI filter and the
 * component's badge/label maps read this instead of keeping a second literal.
 */
export const SHIPMENT_STATUS_FILTER_ORDER: readonly ShipmentStatus[] = SHIPMENT_STATUSES
