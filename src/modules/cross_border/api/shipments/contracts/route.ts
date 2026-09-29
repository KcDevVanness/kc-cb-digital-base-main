import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { CrossBorderShipmentContract } from '../../../data/entities'
import { shipmentContractListSchema } from '../../../data/validators'
import { createCrossBorderCrudOpenApi } from '../../openapi'

const ENTITY_ID = 'cross_border:cross_border_shipment_contract' as const

const contractItemSchema = z
  .object({
    id: z.string().uuid(),
    shipmentId: z.string().uuid(),
    contractId: z.string().uuid(),
    contractNumber: z.string().nullable().optional(),
    contractDirection: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
  })
  .passthrough()

type ContractListQuery = z.infer<typeof shipmentContractListSchema>

function foreignKeyId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id
  return null
}

function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

/**
 * Read-only list of the purchase/sales contracts a shipment travels under.
 *
 * The links are written exclusively through the shipment create/update commands (where the
 * contract is resolved and its number/direction are frozen), so this surface only reads. It is
 * also what the contract hub uses to find a contract's shipments (`?contractId=`).
 */
export const { metadata, GET } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['cross_border.shipments.view'] },
  },
  orm: {
    entity: CrossBorderShipmentContract,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: shipmentContractListSchema,
    entityId: ENTITY_ID,
    defaultSort: { field: 'created_at', dir: 'asc' },
    fields: [
      'id',
      'shipment_id',
      'contract_id',
      'contract_number',
      'contract_direction',
      'tenant_id',
      'organization_id',
      'created_at',
    ],
    buildFilters: async (query: ContractListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.shipmentId) filters.shipment_id = query.shipmentId
      if (query.contractId) filters.contract_id = query.contractId
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: String(item.id),
      shipmentId: foreignKeyId(item.shipment_id) ?? String(item.shipment_id ?? ''),
      contractId: String(item.contract_id ?? ''),
      contractNumber: (item.contract_number ?? null) as string | null,
      contractDirection: (item.contract_direction ?? null) as string | null,
      created_at: toIsoTimestamp(item.created_at),
    }),
  },
})

export const openApi = createCrossBorderCrudOpenApi({
  resourceName: 'Shipment Contract',
  pluralName: 'Shipment Contracts',
  querySchema: shipmentContractListSchema,
  listResponseSchema: createPagedListResponseSchema(contractItemSchema, { paginationMetaOptional: true }),
})
