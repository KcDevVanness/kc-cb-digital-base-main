import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getBackendRouteManifests } from '@open-mercato/shared/modules/registry'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  findSidebarPreference,
  loadFirstRoleSidebarPreference,
} from '@open-mercato/core/modules/auth/services/sidebarPreferencesService'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import { buildNavTree, type NavRouteFacts } from '../../lib/buildNavTree'

/**
 * The app's navigation tree, already filtered for the caller and shaped like a chrome payload.
 *
 * Three steps, all fail-closed:
 * 1. scope — `resolveFeatureCheckContext` resolves the organization set exactly as the installed
 *    chrome route does; a caller with no allowed organization gets an empty tree rather than an
 *    unfiltered one;
 * 2. features — a page whose `requireFeatures` the caller does not hold is removed, and a node left
 *    without a visible page disappears with it. A superadmin is treated as unrestricted, which the
 *    response records as `featureFiltered: false` so the client skips its own re-check instead of
 *    hiding entries the server deliberately kept;
 * 3. preferences — role preference, then the default-adoption pass, then the user preference, in
 *    the platform's own order (`auth/lib/backendChrome.tsx`).
 *
 * Uncached on purpose: saving a layout in `/backend/sidebar-customization` must be visible on the
 * next navigation, and the payload is a few kilobytes.
 */

const logger = createLogger('nav_shell').child({ component: 'tree-route' })

export const metadata = {
  GET: { requireAuth: true },
}

const treeItemSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.object({
    id: z.string().optional(),
    href: z.string(),
    title: z.string(),
    defaultTitle: z.string().optional(),
    enabled: z.boolean().optional(),
    hidden: z.boolean().optional(),
    pageContext: z.enum(['main', 'admin', 'settings', 'profile']).optional(),
    iconName: z.string().optional(),
    iconMarkup: z.string().optional(),
    order: z.number().optional(),
    requireFeatures: z.array(z.string()).optional(),
    children: z.array(treeItemSchema).optional(),
  }),
)

const treeResponseSchema = z.object({
  groups: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string(),
      defaultName: z.string().optional(),
      items: z.array(treeItemSchema),
    }),
  ),
  featureFiltered: z.boolean(),
})

export async function GET(request: Request) {
  const auth = await getAuthFromRequest(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { translate, locale } = await resolveTranslations()
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const rbac = container.resolve('rbacService') as {
      getEffectiveFeatures: (
        userId: string,
        scope: { tenantId: string | null; organizationId: string | null },
      ) => Promise<string[]>
    }

    let scopedOrganizationId: string | null = auth.orgId ?? null
    let scopedTenantId: string | null = auth.tenantId ?? null
    let allowNavigation = true
    try {
      const { organizationId, scope, allowedOrganizationIds } = await resolveFeatureCheckContext({
        container,
        auth,
        request,
      })
      scopedOrganizationId = organizationId
      scopedTenantId = scope.tenantId ?? auth.tenantId ?? null
      if (Array.isArray(allowedOrganizationIds) && allowedOrganizationIds.length === 0) {
        allowNavigation = false
      }
    } catch {
      scopedOrganizationId = auth.orgId ?? null
      scopedTenantId = auth.tenantId ?? null
    }

    const unrestricted = auth.isSuperAdmin === true && allowNavigation
    const grantedFeatures =
      allowNavigation && !unrestricted
        ? await rbac.getEffectiveFeatures(auth.sub, {
            tenantId: scopedTenantId,
            organizationId: scopedOrganizationId,
          })
        : []
    const granted = new Set(grantedFeatures)
    const isAllowed = (features: readonly string[] | undefined): boolean => {
      if (!allowNavigation) return false
      if (unrestricted) return true
      if (!features || features.length === 0) return true
      return features.some((feature) => granted.has(feature))
    }

    let rolePreference = null
    if (Array.isArray(auth.roles) && auth.roles.length > 0 && scopedTenantId) {
      const roles = await em.find(Role, { name: { $in: auth.roles }, tenantId: scopedTenantId })
      const roleIds = Array.isArray(roles) ? roles.map((role) => role.id) : []
      if (roleIds.length > 0) {
        rolePreference = await loadFirstRoleSidebarPreference(em, {
          roleIds,
          tenantId: scopedTenantId,
          locale,
        })
      }
    }

    const userPreference = auth.sub
      ? await findSidebarPreference(em, {
          userId: auth.sub,
          tenantId: scopedTenantId,
          organizationId: scopedOrganizationId,
          locale,
        })
      : null

    const groups = buildNavTree({
      entries: getBackendRouteManifests() as unknown as NavRouteFacts[],
      translate: (key, fallback) => (key ? translate(key, fallback) : fallback),
      isAllowed,
      rolePreference,
      userPreference,
    })

    return NextResponse.json({ groups, featureFiltered: !unrestricted && allowNavigation })
  } catch (error) {
    logger.error('Failed to build the navigation tree', { err: error })
    return NextResponse.json({ error: 'Failed to build the navigation tree' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Navigation shell',
  summary: 'App navigation tree',
  methods: {
    GET: {
      summary: 'Resolve the app navigation tree for the authenticated caller',
      description:
        'Returns the domain → module → page tree with the caller’s role and user sidebar preferences applied and every page the caller is not authorized for removed. `featureFiltered: false` means the caller is unrestricted (superadmin) and the client must not re-filter.',
      responses: [
        { status: 200, description: 'Navigation tree', schema: treeResponseSchema },
        { status: 401, description: 'Unauthorized' },
        { status: 500, description: 'The tree could not be assembled' },
      ],
    },
  },
}
