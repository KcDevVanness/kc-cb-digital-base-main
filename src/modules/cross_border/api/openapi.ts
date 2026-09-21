import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const crossBorderTag = 'Cross-Border'

export const crossBorderErrorSchema = z.object({
  error: z.string(),
}).passthrough()

export const crossBorderOkSchema = z.object({
  ok: z.literal(true),
})

export const crossBorderCreatedSchema = z.object({
  id: z.string().uuid(),
})

const buildCrossBorderCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: crossBorderTag,
  defaultCreateResponseSchema: crossBorderCreatedSchema,
  defaultOkResponseSchema: crossBorderOkSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} in the current organization scope.`,
})

export function createCrossBorderCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildCrossBorderCrudOpenApi(options)
}
