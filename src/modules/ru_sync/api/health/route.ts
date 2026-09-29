import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ruHealthQuerySchema } from '../../data/validators'
import { loadRuHealth } from '../../lib/health'
import { RU_PROVIDER_KEY } from '../../lib/adapter'
import { resolveRequestScope } from '../../lib/requestScope'
import { ruSyncTag } from '../openapi'

const logger = createLogger('ru_sync').child({ component: 'health-route' })

const endpointHealthSchema = z.object({
  endpoint: z.string(),
  path: z.string(),
  lastAsOf: z.string().nullable(),
  cursor: z.string().nullable(),
  lastAdvancedAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  lastRunStatus: z.string().nullable(),
  lastRunError: z.string().nullable(),
  status: z.enum(['ok', 'stale', 'failing', 'never']),
  ageHours: z.number().nullable(),
})

const healthResponseSchema = z.object({
  staleAfterHours: z.number(),
  checkedAt: z.string(),
  stale: z.boolean(),
  endpoints: z.array(endpointHealthSchema),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['ru_sync.view'] },
}

/**
 * 同步健康 — one row per supply endpoint: the snapshot date the projection carries, the watermark
 * the next pull resumes from, when it last moved, and what the latest run did.
 *
 * `stale` is about the watermark's age (24 h by default), which is the number that decides whether
 * the cockpit may trust its numbers; `failing` reports that the last attempt errored.
 */
export async function GET(request: Request) {
  const scope = await resolveRequestScope(request)
  if (!scope.ok) return scope.response

  try {
    const query = ruHealthQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const result = await loadRuHealth(
      scope.em,
      { tenantId: scope.tenantId, organizationIds: scope.organizationIds },
      RU_PROVIDER_KEY,
    )
    const endpoints = query.endpoint
      ? result.endpoints.filter((entry) => entry.endpoint === query.endpoint)
      : result.endpoints
    return NextResponse.json({ ...result, endpoints })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query', details: error.issues }, { status: 400 })
    }
    logger.error('Failed to load the RU sync health', { err: error })
    return NextResponse.json({ error: 'Failed to load the RU sync health' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: ruSyncTag,
  methods: {
    GET: {
      summary: 'Report the RU sync health per endpoint (snapshot date, cursor, last run)',
      tags: [ruSyncTag],
      query: ruHealthQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Per-endpoint health; `stale` is true when any endpoint is stale or its last run failed.',
          schema: healthResponseSchema,
        },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing ru_sync.view' },
      ],
    },
  },
}
