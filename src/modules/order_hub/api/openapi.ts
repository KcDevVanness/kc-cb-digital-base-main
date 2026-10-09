import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const orderHubTag = 'Order Hub'

export const orderHubErrorSchema = z.object({
  error: z.string(),
}).passthrough()

export const orderHubOkSchema = z.object({
  ok: z.literal(true),
})

export const orderHubCreatedSchema = z.object({
  id: z.string().uuid(),
})

const buildOrderHubCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: orderHubTag,
  defaultCreateResponseSchema: orderHubCreatedSchema,
  defaultOkResponseSchema: orderHubOkSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} in the current organization scope.`,
})

export function createOrderHubCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildOrderHubCrudOpenApi(options)
}
