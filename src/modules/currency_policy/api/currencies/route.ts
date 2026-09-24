import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

const logger = createLogger('currency_policy')

const CURRENCY_DICTIONARY_KEYS = ['currency', 'currencies']

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['currencies.view'] },
}

/**
 * Currency picker source.
 *
 * The data lives in the installed `dictionaries` module (this module already reconciles that
 * dictionary — see `lib/apply.ts`). It is served from here rather than from
 * `/api/customers/dictionaries/currency` so the app's pickers stop depending on a `customers`-hosted
 * route and on `customers.people.view`; `currency_policy` is the app module that owns the currency
 * policy, so it owns the picker too.
 *
 * The response keeps the `{ entries: [{ value, label }] }` shape the pickers already consume, so the
 * five call sites only change their URL constant.
 */
export async function GET(request: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const readableIds = organizationScope?.filterIds?.length
    ? organizationScope.filterIds
    : organizationScope?.selectedId
      ? [organizationScope.selectedId]
      : auth.orgId
        ? [auth.orgId]
        : []
  if (readableIds.length === 0) {
    return NextResponse.json(
      { error: 'Select an organization to access this resource', code: 'organization_scope_required' },
      { status: 400 },
    )
  }

  try {
    const em = container.resolve('em') as EntityManager
    const fork = em.fork()
    const dictionaries = await fork.find(
      Dictionary,
      {
        tenantId: auth.tenantId,
        key: { $in: CURRENCY_DICTIONARY_KEYS },
        organizationId: { $in: readableIds },
        deletedAt: null,
        isActive: true,
      } as FilterQuery<Dictionary>,
      { orderBy: { organizationId: 'asc', createdAt: 'asc' } },
    )
    const dictionary = dictionaries.find((row) => row.organizationId === readableIds[0]) ?? dictionaries[0] ?? null
    if (!dictionary) {
      return NextResponse.json({ entries: [] })
    }

    const entries = await fork.find(
      DictionaryEntry,
      {
        dictionary: dictionary.id,
        tenantId: auth.tenantId,
        organizationId: dictionary.organizationId,
      } as FilterQuery<DictionaryEntry>,
      { orderBy: { position: 'asc', value: 'asc' } },
    )

    return NextResponse.json({
      entries: entries.map((entry) => ({
        value: entry.value,
        label: entry.label ?? entry.value,
      })),
    })
  } catch (err) {
    logger.error('Failed to resolve currency options', { err })
    return NextResponse.json({ error: 'Could not load currencies' }, { status: 500 })
  }
}

const currencyOptionSchema = z.object({ value: z.string(), label: z.string() })
const currencyOptionsSchema = z.object({ entries: z.array(currencyOptionSchema) })
const currencyOptionsErrorSchema = z.object({ error: z.string() }).passthrough()

export const openApi: OpenApiRouteDoc = {
  tag: 'Currency policy',
  summary: 'Currency options',
  methods: {
    GET: {
      summary: 'List currency options',
      description:
        'Scoped option source backed by the installed `dictionaries` module; the shape matches the pickers’ existing `{ entries }` contract.',
      tags: ['Currency policy'],
      responses: [
        { status: 200, description: 'Available currency entries.', schema: currencyOptionsSchema },
      ],
      errors: [
        { status: 400, description: 'Missing organization scope', schema: currencyOptionsErrorSchema },
        { status: 403, description: 'Missing currencies.view', schema: currencyOptionsErrorSchema },
      ],
    },
  },
}
