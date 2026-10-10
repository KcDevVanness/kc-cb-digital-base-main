"use client"

import * as React from 'react'
import { FileText } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@open-mercato/ui/primitives/drawer'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import { LoadingMessage } from '@open-mercato/ui/backend/detail/LoadingMessage'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/** One read-only label/value pair of the source document's head. */
export type SourcePreviewField = { label: string; value: React.ReactNode }

/** One read-only line of the source document, already formatted for display. */
export type SourcePreviewLine = {
  key: string
  name: React.ReactNode
  /** Secondary text under the name, e.g. `SKU · 规格`. */
  meta?: string
  /** Trailing text, e.g. `2 × ¥37.00`. */
  amount?: React.ReactNode
}

export type SourcePreviewDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Drawer title, e.g. 「来源单据预览」. */
  title: string
  /** The source document's own identity under the title, e.g. its number. */
  subtitle?: string
  /** The source is being read. */
  busy?: boolean
  /** Read failure; replaces the body content. */
  error?: string | null
  fields?: SourcePreviewField[]
  lines?: SourcePreviewLine[]
  /** Extra actions beside Close, e.g. a link to the source document's own page. */
  actions?: React.ReactNode
}

/**
 * Read-only preview of a document whose lines are about to be copied into another one.
 *
 * The app's copy-from-elsewhere features (contract ← order/quote, PI/CI ← order, PI/CI ← contract)
 * all offer the same affordance: 「预览」 reads the source — head fields plus its lines — without
 * touching the form being edited, so the operator confirms the copy against the document itself
 * instead of a picker label. Every copy surface composes its own domain data into this shell; the
 * drawer itself owns only the states and the layout, matching the internal-sales source-quote
 * drawer the pattern started with (`QuoteLoadPanel`).
 */
export function SourcePreviewDrawer({
  open,
  onOpenChange,
  title,
  subtitle,
  busy = false,
  error = null,
  fields,
  lines,
  actions,
}: SourcePreviewDrawerProps) {
  const t = useT()
  const rows = lines ?? []
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent closeAriaLabel={t('common.close', 'Close')}>
        <DrawerHeader leading={<FileText aria-hidden="true" className="size-4" />}>
          <DrawerTitle>{title}</DrawerTitle>
          {subtitle ? <DrawerDescription>{subtitle}</DrawerDescription> : null}
        </DrawerHeader>
        <DrawerBody>
          {busy ? (
            <LoadingMessage label={t('ui.sourcePreview.loading', 'Loading the source document…')} />
          ) : error ? (
            <ErrorMessage label={error} />
          ) : (
            <div className="flex flex-col gap-5">
              {fields && fields.length > 0 ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  {fields.map((field) => (
                    <div key={field.label} className="flex min-w-0 flex-col gap-0.5">
                      <dt className="text-xs text-muted-foreground">{field.label}</dt>
                      <dd className="text-sm font-medium break-words">{field.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {/* A caller that maps head fields only (the hub's row preview) passes no `lines` at
                  all — that is not the same as "this document has no lines", so the section and its
                  empty sentence stay out of the drawer entirely. */}
              {lines ? (
                <section className="flex flex-col gap-2">
                  <SectionHeader title={t('ui.sourcePreview.lines', 'Lines')} />
                  {rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t('ui.sourcePreview.noLines', 'This document has no lines.')}
                    </p>
                  ) : (
                    <ul className="flex flex-col divide-y divide-border">
                      {rows.map((line) => (
                        <li key={line.key} className="flex flex-col gap-1 py-2">
                          <span className="text-sm font-medium">{line.name}</span>
                          {line.meta ? (
                            <span className="text-xs text-muted-foreground">{line.meta}</span>
                          ) : null}
                          {line.amount ? (
                            <span className="text-sm text-muted-foreground">{line.amount}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}
            </div>
          )}
        </DrawerBody>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="outline">{t('common.close', 'Close')}</Button>
          </DrawerClose>
          {actions}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
