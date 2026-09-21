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
