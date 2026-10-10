import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { GET as installedBackendChrome } from '@open-mercato/core/modules/auth/api/admin/nav'

/**
 * The backend chrome payload the shell actually reads, with `groups` blanked.
 *
 * Everything else is the installed payload verbatim — brand, current organization, roles,
 * `grantedFeatures`, the settings and profile sections and their path prefixes — so the shell's
 * settings/profile sidebars, the organization switcher and the customization editor keep working
 * unchanged. Only the flat main-nav list is dropped, because the main nav is now drawn by
 * `SidebarNavTree` from `/api/nav_shell/tree`; leaving `groups` populated would render the old flat
 * list next to the tree.
 *
 * Delegating to the installed handler (instead of rebuilding the payload) keeps its scope
 * resolution, its module-surface fingerprint and its 30-minute cache: this route adds no cache of
 * its own, so a preference saved in the editor invalidates the tree (uncached) without waiting for
 * the chrome cache to expire.
 */

export const metadata = {
  GET: { requireAuth: true },
}

const chromeResponseSchema = z.object({
  groups: z.array(z.unknown()),
  settingsSections: z.array(z.unknown()),
  settingsPathPrefixes: z.array(z.string()),
  profileSections: z.array(z.unknown()),
  profilePathPrefixes: z.array(z.string()),
  grantedFeatures: z.array(z.string()),
  roles: z.array(z.string()),
  brand: z.unknown().nullable().optional(),
  currentOrganization: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
})

export async function GET(request: Request) {
  const installed = await installedBackendChrome(request)
  if (!installed.ok) return installed
  const payload = (await installed.json()) as Record<string, unknown>
  return NextResponse.json({ ...payload, groups: [] })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Navigation shell',
  summary: 'Backend chrome payload with the flat main-nav list blanked',
  methods: {
    GET: {
      summary: 'Resolve the backend chrome payload without the flat nav groups',
      description:
        'Returns the installed chrome payload (brand, current organization, roles, granted features, settings and profile sections) with `groups: []`, so the shell renders the app-drawn navigation tree instead of the flat module list. Unauthorized callers get the installed handler response unchanged.',
      responses: [
        { status: 200, description: 'Chrome payload with `groups: []`', schema: chromeResponseSchema },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
