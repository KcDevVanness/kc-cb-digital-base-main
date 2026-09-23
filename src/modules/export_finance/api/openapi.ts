import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const exportFinanceTag = 'Export Finance'

export const exportFinanceErrorSchema = z.object({
  error: z.string(),
}).passthrough()

export const exportFinanceOkSchema = z.object({
  ok: z.literal(true),
})

export const exportFinanceCreatedSchema = z.object({
  id: z.string().uuid(),
})

const buildExportFinanceCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: exportFinanceTag,
  defaultCreateResponseSchema: exportFinanceCreatedSchema,
  defaultOkResponseSchema: exportFinanceOkSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} in the current organization scope.`,
})

export function createExportFinanceCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildExportFinanceCrudOpenApi(options)
}
