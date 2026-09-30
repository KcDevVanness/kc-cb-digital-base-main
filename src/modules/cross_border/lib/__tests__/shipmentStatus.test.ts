import { describe, expect, it } from '@jest/globals'
import {
  SHIPMENT_STATUS_FILTER_ORDER,
  SHIPMENT_TRANSITIONS,
  canTransitionShipment,
  isTerminalShipmentStatus,
} from '../shipmentStatus'
import { SHIPMENT_STATUSES } from '../../data/validators'

/**
 * The shipment state machine is the one authority behind four guards (depart / receive / close /
 * cancel) and the detail page's action buttons, so its edges are pinned here: the physical stages
 * advance in one direction, the archival stage closes the chain, and nothing leaves a terminal
 * status.
 */
describe('shipment transitions', () => {
  it('advances through the physical stages and only there', () => {
    expect(canTransitionShipment('draft', 'in_transit')).toBe(true)
    expect(canTransitionShipment('in_transit', 'received')).toBe(true)
    expect(canTransitionShipment('received', 'closed')).toBe(true)
    // No skipping and no walking back.
    expect(canTransitionShipment('draft', 'received')).toBe(false)
    expect(canTransitionShipment('draft', 'closed')).toBe(false)
    expect(canTransitionShipment('in_transit', 'in_transit')).toBe(false)
    expect(canTransitionShipment('received', 'in_transit')).toBe(false)
  })

  it('cancels only what is still in progress, and closes only what arrived', () => {
    expect(canTransitionShipment('draft', 'cancelled')).toBe(true)
    expect(canTransitionShipment('in_transit', 'cancelled')).toBe(true)
    // Received goods exist in the warehouse — they are closed, not cancelled.
    expect(canTransitionShipment('received', 'cancelled')).toBe(false)
    expect(canTransitionShipment('closed', 'cancelled')).toBe(false)
    expect(canTransitionShipment('cancelled', 'closed')).toBe(false)
  })

  it('keeps closed and cancelled terminal', () => {
    expect(isTerminalShipmentStatus('closed')).toBe(true)
    expect(isTerminalShipmentStatus('cancelled')).toBe(true)
    expect(isTerminalShipmentStatus('received')).toBe(false)
    expect(SHIPMENT_TRANSITIONS.closed).toHaveLength(0)
    expect(SHIPMENT_TRANSITIONS.cancelled).toHaveLength(0)
  })

  it('offers every status the API accepts, in one order', () => {
    expect([...SHIPMENT_STATUS_FILTER_ORDER].sort()).toEqual([...SHIPMENT_STATUSES].sort())
    expect(SHIPMENT_STATUS_FILTER_ORDER).toEqual(['draft', 'in_transit', 'received', 'closed', 'cancelled'])
  })
})
