import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { companyOrderLinkChildSchema } from '../../../data/validators'
import { orderHubTag } from '../../openapi'

const logger = createLogger('order_hub').child({ component: 'link-child-route' })

const linkChildResponseSchema = z.object({
  companyOrderId: z.string().uuid(),
  linked: z.boolean(),
  created: z.boolean(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['order_hub.manage'] },
}

/**
 * Attach one child document to a company order (`order_hub.orders.link-child`).
 *
 * A hand-written action route: the write lands in this module's own command, but the input is a
 * single attach with an optional target root, so it does not belong in a CRUD factory. It follows
 * the documented non-factory path — mutation guards first, then the command bus, then the
 * after-success callbacks once the write has committed. With no `companyOrderId` a sales-kind child
 * gets a fresh root (已下单 / 未收款); a purchase child is refused with 422 (`company_order_required`).
 */
export async function POST(request: Request) {
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  try {
    const body = (await request.json()) as Record<string, unknown>
    const parsed = companyOrderLinkChildSchema.parse(body)

    const guards = await runRouteMutationGuards({
      container,
      req: request,
      auth: {
        tenantId: auth.tenantId,
        organizationId: auth.orgId ?? null,
        userId: auth.sub,
      },
      input: {
        resourceKind: 'order_hub.company_order.link',
        resourceId: parsed.companyOrderId ?? null,
        operation: 'create',
        mutationPayload: parsed as unknown as Record<string, unknown>,
      },
    })
    if (!guards.ok) return guards.response

    const input = { ...(parsed as unknown as Record<string, unknown>), ...(guards.modifiedPayload ?? {}) }
    const commandBus = container.resolve('commandBus') as {
      execute: (id: string, options: { input: unknown; ctx: unknown }) => Promise<{ result?: unknown }>
    }
    const envelope = await commandBus.execute('order_hub.orders.link-child', {
      input,
      ctx: { container, auth, request, selectedOrganizationId: auth.orgId ?? null },
    })

    await guards.runAfterSuccess()
    return NextResponse.json(envelope.result ?? null, { status: 200 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.issues }, { status: 400 })
    }
    if (error instanceof CrudHttpError) return NextResponse.json(error.body, { status: error.status })
    if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
      const status = error.status
      if (status >= 400 && status < 500) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid request' }, { status })
      }
    }
    logger.error('Failed to link a child document to a company order', { err: error })
    return NextResponse.json({ error: 'Failed to link a child document to a company order' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orderHubTag,
  methods: {
    POST: {
      summary: 'Attach one child document to a company order (idempotent)',
      tags: [orderHubTag],
      requestBody: { schema: companyOrderLinkChildSchema },
      responses: [
        { status: 200, description: 'The company order that now holds the child.', schema: linkChildResponseSchema },
        { status: 400, description: 'Invalid input' },
        { status: 403, description: 'Missing order_hub.manage' },
        { status: 422, description: 'The child does not resolve in scope, or a purchase child has no target root' },
      ],
    },
  },
}
