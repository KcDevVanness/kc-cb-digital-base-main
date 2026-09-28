import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createCrudOpenApiFactory, type CrudOpenApiOptions } from '@open-mercato/shared/lib/openapi/crud'

export const productCodesTag = 'Product codes'

export const productCodesErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
}).passthrough()

export const productCodesOkSchema = z.object({
  ok: z.literal(true),
})

export const productCodesCreatedSchema = z.object({
  id: z.string().uuid(),
})

/**
 * The error responses every route in this module can answer with, declared once so the OpenAPI
 * document and the generated client agree on the shapes an operator's UI has to render: a missing
 * organization, a denied feature, an unknown code-list value and the optimistic-lock conflict.
 */
export const productCodesCommandErrors = [
  { status: 400, description: 'Invalid input, unknown code-list value, or no organization selected', schema: productCodesErrorSchema },
  { status: 403, description: 'The caller lacks the required feature', schema: productCodesErrorSchema },
  { status: 404, description: 'The rule or record was not found in this organization', schema: productCodesErrorSchema },
  { status: 409, description: 'A stale version was submitted, or the name is already taken', schema: productCodesErrorSchema },
  { status: 422, description: 'The rule cannot produce a valid product code', schema: productCodesErrorSchema },
]

const buildProductCodesCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: productCodesTag,
  defaultCreateResponseSchema: productCodesCreatedSchema,
  defaultOkResponseSchema: productCodesOkSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} in the current organization scope.`,
})

export function createProductCodesCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildProductCodesCrudOpenApi(options)
}
