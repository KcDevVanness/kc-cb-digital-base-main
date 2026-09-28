import { z } from 'zod'
import { SUPPLY_ENDPOINTS } from '../lib/endpoints/supply'

/**
 * Input contracts for the ru_sync surfaces: the SKU map (the module's only write path) and the
 * read queries of the mapping list and the health view.
 */

const uuid = () => z.string().uuid()

export const SKU_MAP_STATUSES = ['mapped', 'ignored', 'unmapped'] as const
export type SkuMapStatus = (typeof SKU_MAP_STATUSES)[number]

const endpointSchema = z.enum(SUPPLY_ENDPOINTS)

export const skuMapListSchema = z.object({
  status: z.enum([...SKU_MAP_STATUSES, 'all']).optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
})

/**
 * Binding a RU code. `productId` is required for `mapped` and forbidden for `ignored`; the command
 * enforces the pair rather than letting a half-filled decision through.
 */
export const skuMapUpdateSchema = z
  .object({
    ruSku: z.string().trim().min(1).max(120),
    status: z.enum(['mapped', 'ignored']),
    productId: uuid().nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((value) => value.status !== 'mapped' || Boolean(value.productId), {
    message: 'productId is required when binding a code',
    path: ['productId'],
  })

export const ruHealthQuerySchema = z.object({
  endpoint: endpointSchema.optional(),
})

export type SkuMapListQuery = z.infer<typeof skuMapListSchema>
export type SkuMapUpdateInput = z.infer<typeof skuMapUpdateSchema>
export type RuHealthQuery = z.infer<typeof ruHealthQuerySchema>
