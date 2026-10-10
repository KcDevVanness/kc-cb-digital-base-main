'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { SidebarCustomizationEditor } from '@open-mercato/ui/backend/sidebar/SidebarCustomizationEditor'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { NavTreePayload } from '../../../nav_shell/lib/treeTypes'

/**
 * App-owned body for `/backend/sidebar-customization`.
 *
 * This file shadows `@open-mercato/core/modules/auth/backend/sidebar-customization/page.tsx`: an app
 * module directory wins over the package for the same logical path, so the generated backend
 * manifest imports this page instead of the installed one. Only the body is owned here — the
 * installed `page.meta.ts` still supplies the route's `auth.sidebar.manage` gate, its settings
 * placement, its title and its breadcrumb, exactly as before.
 *
 * Why the body is replaced: the installed page lets the editor fall back to `chromePayload.groups`,
 * which the app's chrome wrapper blanks (`nav_shell/api/chrome`) so the shell renders the app-drawn
 * tree instead of the flat module list. The editor is unchanged — it takes the tree through its
 * `groups` prop, so role defaults, per-user overrides, hide/rename/reorder, variants, the optimistic
 * lock and the `auth.sidebar.manage` gate all keep working, on the new tree.
 *
 * The tree is fetched rather than rendered server-side because the editor is a client component and
 * its `onCanceled` callback cannot cross the server boundary. The editor is not rendered until the
 * tree arrives: an empty `groups` prop would let a user save a layout that hides everything.
 */
export default function SidebarCustomizationPage() {
  const t = useT()
  const router = useRouter()
  const goBack = React.useCallback(() => {
    router.push('/backend/settings')
  }, [router])

  const tree = useQuery({
    queryKey: ['nav_shell', 'tree'],
    queryFn: async () => {
      const call = await apiCall<NavTreePayload>('/api/nav_shell/tree', {
        credentials: 'include' as never,
      })
      if (!call.ok || !call.result) throw new Error('nav_shell.tree.unavailable')
      return call.result
    },
  })

  if (tree.isPending) {
    return <p className="p-4 text-sm text-muted-foreground">{t('nav_shell.loading')}</p>
  }

  if (!tree.data) {
    return (
      <div className="flex flex-col items-start gap-2 p-4">
        <p className="text-sm text-muted-foreground">{t('nav_shell.loadFailed')}</p>
        <button
          type="button"
          onClick={() => void tree.refetch()}
          className="text-sm font-medium text-foreground underline"
        >
          {t('nav_shell.retry')}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <SidebarCustomizationEditor groups={tree.data.groups} onCanceled={goBack} />
    </div>
  )
}
