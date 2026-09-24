import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const platformOpsTag = 'Platform Ops'

export const platformOpsErrorSchema = z.object({
  error: z.string(),
}).passthrough()

export const platformOpsOkSchema = z.object({
  ok: z.literal(true),
})

export const platformOpsCreatedSchema = z.object({
  id: z.string().uuid(),
})

const buildPlatformOpsCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: platformOpsTag,
  defaultCreateResponseSchema: platformOpsCreatedSchema,
  defaultOkResponseSchema: platformOpsOkSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} in the current organization scope.`,
})

export function createPlatformOpsCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildPlatformOpsCrudOpenApi(options)
}
