import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const partiesTag = 'Parties'

export const partiesErrorSchema = z.object({
  error: z.string(),
}).passthrough()

export const partiesOkSchema = z.object({
  ok: z.literal(true),
})

export const partiesCreatedSchema = z.object({
  id: z.string().uuid(),
})

/**
 * Display-name option row: `value` is the party id, `label` is what an operator reads. `roles` rides
 * along so a merged picker can label a group branch and an external customer differently without a
 * second request (additive — existing consumers read `value`/`label` only).
 */
export const partyOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  roles: z.array(z.string()),
})

export const partyOptionsResponseSchema = z.object({
  items: z.array(partyOptionSchema),
})

const buildPartiesCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: partiesTag,
  defaultCreateResponseSchema: partiesCreatedSchema,
  defaultOkResponseSchema: partiesOkSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} in the current organization scope.`,
})

export function createPartiesCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildPartiesCrudOpenApi(options)
}

export const partyOptionsOpenApi: OpenApiRouteDoc = {
  tag: partiesTag,
  summary: 'Party options',
  methods: {
    GET: {
      summary: 'List party options',
      description:
        'Scoped option source for pickers: display names only, filtered by code (the plaintext column). Encrypted fields are decrypted for the response but never used as a filter. Optional `roles=<role>[,<role>]` narrows the list to parties holding any of the listed roles; an unknown role name answers 400. Each item carries the roles the party holds.',
      tags: [partiesTag],
      responses: [
        { status: 200, description: 'Available party options.', schema: partyOptionsResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Missing parties.view', schema: partiesErrorSchema },
      ],
    },
  },
}
