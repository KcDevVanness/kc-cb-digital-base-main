import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { z } from 'zod'
import { handleTradeTypeChannelsRequest } from '../../../lib/tradeTypeChannels.server'

const logger = createLogger('internal_sales')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.quotes.view'] },
}

/** Trade-type channel ids for the current organization, for the quotes surfaces. */
export async function GET(request: Request): Promise<Response> {
  try {
    return await handleTradeTypeChannelsRequest(request)
  } catch (err) {
    // The sanitized answer is for the caller; the cause stays in the server log, because a failing
    // read here blocks every document save in this organization.
    logger.error('Failed to resolve trade-type channels', { err })
    return NextResponse.json({ error: 'Could not resolve the trade-type channels' }, { status: 500 })
  }
}

const channelResponseSchema = z.object({
  organizationId: z.string().uuid(),
  channels: z.object({
    internal: z.string().uuid().nullable(),
    external: z.string().uuid().nullable(),
  }),
  missing: z.array(z.string()),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Internal sales',
  summary: 'Trade-type channels',
  methods: {
    GET: {
      summary: 'Resolve the organization trade-type channels',
      description:
        'Returns the ids of the organization\'s `INTERNAL_SALES` and `EXTERNAL_SALES` channels so a document form can mark a write. Read-only: the channels are seeded by the module setup (`yarn mercato seed:defaults --module internal_sales`). Gated by the document view feature rather than `sales.channels.view`, because operators creating documents do not necessarily hold the channel feature.',
      tags: ['Internal sales'],
      responses: [
        { status: 200, description: 'The two channel ids (null when not seeded yet).', schema: channelResponseSchema },
      ],
      errors: [
        { status: 400, description: 'No organization selected', schema: z.object({ error: z.string() }).passthrough() },
        { status: 401, description: 'Not authenticated', schema: z.object({ error: z.string() }).passthrough() },
        { status: 403, description: 'Missing the document view feature', schema: z.object({ error: z.string() }).passthrough() },
      ],
    },
  },
}
