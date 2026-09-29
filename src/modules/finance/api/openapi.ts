import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createCrudOpenApiFactory, type CrudOpenApiOptions } from '@open-mercato/shared/lib/openapi/crud'

export const financeTag = 'Finance'

export const financeErrorSchema = z
  .object({
    error: z.string(),
  })
  .passthrough()

export const financeOkSchema = z.object({
  ok: z.literal(true),
})

export const financeCreatedSchema = z.object({
  id: z.string().uuid(),
})

const buildFinanceCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: financeTag,
  defaultCreateResponseSchema: financeCreatedSchema,
  defaultOkResponseSchema: financeOkSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} in the current organization scope.`,
})

export function createFinanceCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildFinanceCrudOpenApi(options)
}
