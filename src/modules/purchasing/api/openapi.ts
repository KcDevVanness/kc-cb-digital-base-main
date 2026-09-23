import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const purchasingTag = 'Purchasing'

export const purchasingErrorSchema = z.object({
  error: z.string(),
}).passthrough()

export const purchasingOkSchema = z.object({
  ok: z.literal(true),
})

export const purchasingCreatedSchema = z.object({
  id: z.string().uuid(),
})

const buildPurchasingCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: purchasingTag,
  defaultCreateResponseSchema: purchasingCreatedSchema,
  defaultOkResponseSchema: purchasingOkSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} in the current organization scope.`,
})

export function createPurchasingCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildPurchasingCrudOpenApi(options)
}

/** Shared error responses for the command-backed routes (import, promote, replace-prices). */
export const purchasingCommandErrors = [
  { status: 400, description: 'Validation failed', schema: purchasingErrorSchema },
  { status: 401, description: 'Not authenticated', schema: purchasingErrorSchema },
  { status: 403, description: 'Missing feature', schema: purchasingErrorSchema },
  { status: 404, description: 'Record not found in this organization', schema: purchasingErrorSchema },
  { status: 409, description: 'Concurrent change or illegal state', schema: purchasingErrorSchema },
  { status: 422, description: 'The referenced record or state cannot be used', schema: purchasingErrorSchema },
] as const
