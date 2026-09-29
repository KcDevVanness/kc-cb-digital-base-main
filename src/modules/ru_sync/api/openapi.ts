import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createCrudOpenApiFactory, type CrudOpenApiOptions } from '@open-mercato/shared/lib/openapi/crud'

export const ruSyncTag = 'RU Sync'

export const ruSyncErrorSchema = z
  .object({
    error: z.string(),
  })
  .passthrough()

const buildRuSyncCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: ruSyncTag,
  defaultCreateResponseSchema: z.object({ id: z.string().uuid() }),
  defaultOkResponseSchema: z.object({ ok: z.literal(true) }),
  makeListDescription: ({ pluralLower }) => `Returns ${pluralLower} in the current organization scope.`,
})

export function createRuSyncCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildRuSyncCrudOpenApi(options)
}
