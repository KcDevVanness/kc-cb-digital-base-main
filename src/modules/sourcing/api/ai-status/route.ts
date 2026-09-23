import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { sourcingErrorSchema, sourcingTag } from '../openapi'
import { resolveAiStatus } from '../../lib/aiMapping'

/**
 * Whether the optional AI mapping assist can run at all.
 *
 * The wizard calls this before rendering the AI block, so an unconfigured deployment shows a
 * disabled button with the environment variable to set instead of a failing request. It reports
 * the provider and model that would be used — never a credential.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sourcing.quotes.view'] },
}

export async function GET() {
  const container = await createRequestContainer()
  const auth = await getAuthFromCookies()
  if (!auth?.tenantId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return Response.json(resolveAiStatus(container))
}

const statusSchema = z.object({
  available: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
})

export const openApi: OpenApiRouteDoc = {
  tag: sourcingTag,
  summary: 'AI mapping availability',
  methods: {
    GET: {
      summary: 'AI mapping availability',
      description:
        'Reports whether a model provider is configured for this deployment, and which provider and model the AI mapping assist would use. No credential is ever returned.',
      responses: [{ status: 200, description: 'Availability', schema: statusSchema }],
      errors: [
        { status: 401, description: 'Not authenticated', schema: sourcingErrorSchema },
        { status: 403, description: 'Missing feature', schema: sourcingErrorSchema },
      ],
    },
  },
}
