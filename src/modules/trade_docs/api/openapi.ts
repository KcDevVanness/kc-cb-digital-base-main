import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createCrudOpenApiFactory, type CrudOpenApiOptions } from '@open-mercato/shared/lib/openapi/crud'

export const tradeDocsTag = 'Trade Documents'

export const tradeDocsErrorSchema = z.object({
  error: z.string(),
}).passthrough()

export const tradeDocsOkSchema = z.object({
  ok: z.literal(true),
})

export const tradeDocsCreatedSchema = z.object({
  id: z.string().uuid(),
})

const buildTradeDocsCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: tradeDocsTag,
  defaultCreateResponseSchema: tradeDocsCreatedSchema,
  defaultOkResponseSchema: tradeDocsOkSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} in the current organization scope.`,
})

export function createTradeDocsCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildTradeDocsCrudOpenApi(options)
}
