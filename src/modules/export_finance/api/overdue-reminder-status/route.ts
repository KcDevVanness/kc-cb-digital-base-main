import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { loadOverdueReminderStatuses } from '../../lib/overdueReminderStatus'
import { exportFinanceTag } from '../openapi'

const logger = createLogger('export_finance').child({ component: 'overdue-reminder-status-route' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['export_finance.orders.view'] },
}

/**
 * 已提醒 lookup for the 逾期清单: `{ reminders: { <resourceId>: <lastSentAt ISO> } }`.
 *
 * Read-only and deliberately tiny: the worklist asks whether a reminder went out for the rows it is
 * showing, and this answers from the notifications the reminder command itself wrote (keyed by the
 * same `group_key`), so the badge can never claim more than the platform accepted.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(request)
    if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const organizationId = scope?.selectedId ?? scope?.filterIds?.[0] ?? auth.orgId ?? null
    if (!organizationId) {
      return NextResponse.json(
        { error: 'Select an organization to access this resource', code: 'organization_scope_required' },
        { status: 400 },
      )
    }
    const em = container.resolve('em') as EntityManager
    const reminders = await loadOverdueReminderStatuses(em, { tenantId: auth.tenantId, organizationId })
    return NextResponse.json({ reminders })
  } catch (error) {
    logger.error('Failed to load the overdue reminder status', { err: error })
    return NextResponse.json({ error: 'Could not load the overdue reminder status' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: exportFinanceTag,
  summary: 'Overdue reminder status',
  methods: {
    GET: {
      summary: 'When each overdue document was last reminded',
      description:
        'Read-only. Returns the newest reminder timestamp per resource (a purchase order id or a shipment id), read from the notifications the `export_finance overdue-reminders` command wrote — the same `group_key` (`<kind>:<resourceId>:<the day it became late>`) the command keys them by. Used by the 逾期清单 to mark rows that have already been told.',
      tags: [exportFinanceTag],
      responses: [
        {
          status: 200,
          description: 'Reminder timestamps by resource id',
          schema: z.object({ reminders: z.record(z.string(), z.string()) }),
        },
        { status: 400, description: 'No organization selected', schema: z.object({ error: z.string() }).passthrough() },
        { status: 401, description: 'Not authenticated', schema: z.object({ error: z.string() }).passthrough() },
        { status: 403, description: 'Missing export_finance.orders.view', schema: z.object({ error: z.string() }).passthrough() },
      ],
    },
  },
}
