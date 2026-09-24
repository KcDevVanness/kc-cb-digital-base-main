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

/** Display-name option row: `value` is the party id, `label` is what an operator reads. */
export const partyOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
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
        'Scoped option source for pickers: display names only, filtered by code (the plaintext column). Encrypted fields are decrypted for the response but never used as a filter.',
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
