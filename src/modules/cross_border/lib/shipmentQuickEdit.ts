import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { quickEditValues, readRowDate, readRowText } from '@/lib/quick-edit/rowValues'
import { loadCarrierOptions, loadContainerTypeOptions, loadPortOptions } from '../components/shipmentFormOptions'

/**
 * The shipment header fields the order hub's 发运单 block may quick-edit in place.
 *
 * The set is the writable head of `shipmentUpdateSchema`: the logistics facts an operator corrects on
 * a booked container. The allocations and the contract links are absent on purpose — they say which
 * goods travel and under which contract, which is the shipment's own page's business — and so are
 * the status transitions (depart/receive/close), which are never a field edit.
 *
 * The pickers read the same `carrier` / `port` / `container_type` dictionaries the shipment form
 * does, and 承运人/起运港 stay typeable so a carrier or port the list does not carry yet never blocks a
 * correction. Field labels are i18n keys resolved by the dialog that renders them.
 */
export const fields: CrudField[] = [
  {
    id: 'carrierName',
    label: 'cross_border.shipments.form.field.carrierName',
    type: 'combobox',
    allowCustomValues: true,
    resolveLabel: (value) => value,
    loadOptions: (query) => loadCarrierOptions(query),
  },
  {
    id: 'departurePort',
    label: 'cross_border.shipments.form.field.departurePort',
    type: 'combobox',
    allowCustomValues: true,
    resolveLabel: (value) => value,
    loadOptions: (query) => loadPortOptions(query),
  },
  {
    id: 'containerType',
    label: 'cross_border.shipments.field.containerType',
    type: 'select',
    loadOptions: (query) => loadContainerTypeOptions(query),
  },
  {
    id: 'containerNumber',
    label: 'cross_border.shipments.field.containerNumber',
    type: 'text',
  },
  {
    id: 'sealNumber',
    label: 'cross_border.shipments.field.sealNumber',
    type: 'text',
  },
  {
    id: 'bookingNumber',
    label: 'cross_border.shipments.field.bookingNumber',
    type: 'text',
  },
  {
    id: 'etd',
    label: 'cross_border.shipments.form.field.etd',
    type: 'date',
  },
  {
    id: 'eta',
    label: 'cross_border.shipments.form.field.eta',
    type: 'date',
  },
  {
    id: 'notes',
    label: 'cross_border.shipments.form.field.notes',
    type: 'textarea',
  },
]

/**
 * Reads the writable head off one shipment row — the module's camelCase projection first, then the
 * raw column — and omits what the row does not carry (see `quickEditValues`).
 */
export function toValues(row: Record<string, unknown>): Record<string, unknown> {
  return quickEditValues({
    carrierName: readRowText(row, 'carrierName', 'carrier_name'),
    departurePort: readRowText(row, 'departurePort', 'departure_port'),
    containerType: readRowText(row, 'containerType', 'container_type'),
    containerNumber: readRowText(row, 'containerNumber', 'container_number'),
    sealNumber: readRowText(row, 'sealNumber', 'seal_number'),
    bookingNumber: readRowText(row, 'bookingNumber', 'booking_number'),
    etd: readRowDate(row, 'etd'),
    eta: readRowDate(row, 'eta'),
    notes: readRowText(row, 'notes'),
  })
}
