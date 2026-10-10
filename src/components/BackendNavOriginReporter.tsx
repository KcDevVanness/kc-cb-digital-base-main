'use client'

import * as React from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { backendLocation, recordNavOrigin } from '@/lib/navigation/returnTo'

/**
 * Records every backend page the operator lands on into the per-tab navigation trail, so that
 * page's 「返回」 link points at the page they came from (see `returnTo.ts`).
 *
 * Mounted once by the backend shell — pages never mount this, and it renders nothing.
 */
export function BackendNavOriginReporter() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  React.useEffect(() => {
    recordNavOrigin(backendLocation(pathname, searchParams?.toString() ?? null))
  }, [pathname, searchParams])

  return null
}
