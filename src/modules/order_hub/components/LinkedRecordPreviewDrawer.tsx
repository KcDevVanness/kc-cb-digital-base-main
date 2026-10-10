'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SourcePreviewDrawer } from '@/lib/source-preview/SourcePreviewDrawer'
import { withReturnTo } from '@/lib/navigation/returnTo'
import {
  linkedRecordPreviewSource,
  type LinkedRecordPreviewTarget,
} from './linkedRecordPreviewSources'

/**
 * The read-only preview a hub block row opens when the operator clicks a document's number.
 *
 * Clicking a row used to leave the page (it opened the document's own edit/detail page); the hub now
 * previews instead — a right-side drawer that reads the one record on demand and renders its head
 * fields, with 「编辑」 as its own action for when the operator really means to change something.
 * The read is per kind (see `linkedRecordPreviewSources`), so the drawer stays a shell: it owns the
 * query state, the fallback cell and the edit link, and nothing about any one module's fields.
 */

export type LinkedRecordPreviewDrawerProps = {
  target: LinkedRecordPreviewTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The page the record's own page should come back to — the hub the row was clicked on. */
  returnTo: string
}

export default function LinkedRecordPreviewDrawer({
  target,
  open,
  onOpenChange,
  returnTo,
}: LinkedRecordPreviewDrawerProps) {
  const t = useT()

  const query = useQuery({
    queryKey: ['order-hub-preview', target?.kind ?? 'none', target?.refId ?? 'none'],
    enabled: open && target !== null,
    // One read when the drawer opens; a permission answer is final and a failure gets a manual retry.
    retry: false,
    queryFn: () => {
      if (!target) throw new Error('no preview target')
      return linkedRecordPreviewSource(target.kind).read(target)
    },
  })

  const record = query.data ?? null
  const fields = React.useMemo(() => {
    if (!record || !target) return undefined
    const missing = <span className="text-xs text-muted-foreground">{t('order_hub.workbench.cell.notApplicable')}</span>
    return linkedRecordPreviewSource(target.kind)
      .fields(record, t)
      .map((field) => ({ ...field, value: field.value ?? missing }))
  }, [record, t, target])

  return (
    <SourcePreviewDrawer
      open={open && target !== null}
      onOpenChange={onOpenChange}
      title={
        record && target
          ? linkedRecordPreviewSource(target.kind).title(record, target, t)
          : t('order_hub.preview.title')
      }
      subtitle={
        record && target
          ? linkedRecordPreviewSource(target.kind).subtitle?.(record, target, t) ?? undefined
          : target?.label ?? undefined
      }
      busy={query.isLoading}
      error={query.isError ? t('order_hub.preview.loadFailed') : null}
      fields={fields}
      actions={
        target ? (
          <>
            {query.isError ? (
              <Button type="button" variant="outline" onClick={() => void query.refetch()}>
                {t('order_hub.preview.retry')}
              </Button>
            ) : null}
            <Button asChild>
              <Link href={withReturnTo(linkedRecordPreviewSource(target.kind).openHref(target), returnTo)}>
                {t('order_hub.preview.edit')}
              </Link>
            </Button>
          </>
        ) : null
      }
    />
  )
}
