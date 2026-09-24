import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createCrudOpenApiFactory, type CrudOpenApiOptions } from '@open-mercato/shared/lib/openapi/crud'

export const sourcingTag = 'Sourcing'

export const sourcingErrorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
  })
  .passthrough()

export const sourcingOkSchema = z.object({
  ok: z.literal(true),
})

export const sourcingCreatedSchema = z.object({
  id: z.string().uuid(),
})

const buildSourcingCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: sourcingTag,
  defaultCreateResponseSchema: sourcingCreatedSchema,
  defaultOkResponseSchema: sourcingOkSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} in the current organization scope.`,
})

export function createSourcingCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildSourcingCrudOpenApi(options)
}

/** Shared error responses for the command-backed routes (parse, remap, approve, promote). */
export const sourcingCommandErrors = [
  { status: 400, description: 'Validation failed', schema: sourcingErrorSchema },
  { status: 401, description: 'Not authenticated', schema: sourcingErrorSchema },
  { status: 403, description: 'Missing feature', schema: sourcingErrorSchema },
  { status: 404, description: 'Record not found in this organization', schema: sourcingErrorSchema },
  { status: 409, description: 'Concurrent change or illegal state', schema: sourcingErrorSchema },
  { status: 422, description: 'The workbook or the quotation state cannot be used', schema: sourcingErrorSchema },
] as const
