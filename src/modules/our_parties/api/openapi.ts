import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const ourPartiesTag = 'Our entities'

export const ourPartiesErrorSchema = z.object({
  error: z.string(),
}).passthrough()

export const ourPartiesOkSchema = z.object({
  ok: z.literal(true),
})

export const ourPartiesCreatedSchema = z.object({
  id: z.string().uuid(),
})

/**
 * One profile with its decrypted bank block, as the aggregate detail route projects it. Declared
 * here so the route and its OpenAPI document cannot drift.
 */
export const ourPartyProfileDetailSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  addressLine1: z.string().nullable().optional(),
  addressLine2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  bankAccounts: z.array(
    z.object({
      id: z.string().uuid(),
      beneficiaryBank: z.string(),
      accountNumber: z.string(),
      swiftCode: z.string().nullable().optional(),
      bankAddress: z.string().nullable().optional(),
      isDefault: z.boolean(),
    }),
  ),
  updatedAt: z.string().nullable(),
})

export const ourPartyProfileDetailResponseSchema = z.object({
  item: ourPartyProfileDetailSchema,
})

const buildOurPartiesCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: ourPartiesTag,
  defaultCreateResponseSchema: ourPartiesCreatedSchema,
  defaultOkResponseSchema: ourPartiesOkSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower}; a row is visible only within its own company's organization scope.`,
})

export function createOurPartiesCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildOurPartiesCrudOpenApi(options)
}

