'use client'

import * as React from 'react'
import Link from 'next/link'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { Button } from '@open-mercato/ui/primitives/button'
import { cn } from '@open-mercato/shared/lib/utils'

/** A preview page of one related collection, plus the collection's total for the 「查看全部」 link. */
export type RelatedPage<T> = { items: T[]; total: number }

/** How many rows one section preview loads; each hub renders fewer rows than that. */
const RELATED_PAGE_SIZE = 20

/**
 * One hub section reads its own collection through its owner's list API — the orders, shipments and
 * packing lists from `cross_border`, the PI/CI from `trade_docs`. The row mapper keeps each
 * section's display shape explicit; the `total` decides whether 「查看全部」 is offered.
 */
export async function loadRelatedPage<T>(
  apiPath: string,
  params: Record<string, unknown>,
  mapItem: (item: Record<string, unknown>) => T,
): Promise<RelatedPage<T>> {
  const payload = await fetchCrudList<Record<string, unknown>>(apiPath, {
    pageSize: RELATED_PAGE_SIZE,
    ...params,
  })
  return { items: (payload.items ?? []).map(mapItem), total: payload.total ?? 0 }
}

/**
 * The translated copy a section shows in its four states. The contract page and the order hub own
 * different keys and wording, so the caller passes its own strings in rather than have this module
 * hard-code one hub's catalog. `retry` is read only beside `onRetry`, `viewAll` only beside
 * `viewAllHref`.
 */
export type RelatedSectionMessages = {
  loading: React.ReactNode
  loadFailed: React.ReactNode
  retry?: React.ReactNode
  viewAll?: React.ReactNode
}

export type RelatedSectionProps = {
  /** Block anchor, so a hub page can link straight at one section (the order hub does). */
  id?: string
  title: string
  /** The 'new' or 'manage' entry in the header; omitted where the relation has no writer. */
  action?: React.ReactNode
  isLoading: boolean
  failed: boolean
  isEmpty: boolean
  emptyLabel: string
  /** Set only when the collection holds more rows than the preview shows. */
  viewAllHref?: string | null
  /** The refetch entry of a failed section; the contract page's sections have none. */
  onRetry?: () => void
  /** The order hub frames each section as a card; the contract page keeps its sections flat. */
  framed?: boolean
  messages: RelatedSectionMessages
  children: React.ReactNode
}

/**
 * One hub section: a header with its action, then exactly one of loading, error, empty or rows,
 * ending with the 「查看全部」 link when the collection is longer than the preview.
 *
 * This is the shared piece behind the contract detail page (`trade_docs`) and the sales order hub
 * (`order_hub`): the two differ only in their rows, links, wording and shell, so the four states
 * and the "this section failed, the rest did not" behaviour live here once.
 */
export function RelatedSection({
  id,
  title,
  action,
  isLoading,
  failed,
  isEmpty,
  emptyLabel,
  viewAllHref,
  onRetry,
  framed = false,
  messages,
  children,
}: RelatedSectionProps) {
  return (
    <section
      id={id}
      className={cn('space-y-3', framed && 'rounded-lg border bg-card px-4 py-3')}
    >
      <SectionHeader title={title} action={action} />
      {isLoading ? (
        <p className="text-sm text-muted-foreground">{messages.loading}</p>
      ) : failed ? (
        onRetry ? (
          <div className="flex items-center gap-2">
            <p className="text-sm text-destructive">{messages.loadFailed}</p>
            <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
              {messages.retry}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-destructive">{messages.loadFailed}</p>
        )
      ) : isEmpty ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <>
          {children}
          {viewAllHref ? (
            <Link className="text-sm font-medium hover:underline" href={viewAllHref}>
              {messages.viewAll}
            </Link>
          ) : null}
        </>
      )}
    </section>
  )
}
