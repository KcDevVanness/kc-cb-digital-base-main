import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createCrudOpenApiFactory, type CrudOpenApiOptions } from '@open-mercato/shared/lib/openapi/crud'

export const productsTag = 'Products'

export const productsErrorSchema = z.object({
  error: z.string(),
}).passthrough()

export const productsOkSchema = z.object({
  ok: z.literal(true),
})

export const productsCreatedSchema = z.object({
  id: z.string().uuid(),
})

const buildProductsCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: productsTag,
  defaultCreateResponseSchema: productsCreatedSchema,
  defaultOkResponseSchema: productsOkSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} in the current organization scope.`,
})

export function createProductsCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildProductsCrudOpenApi(options)
}
