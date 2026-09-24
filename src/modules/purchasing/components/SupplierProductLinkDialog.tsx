"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Button } from '@open-mercato/ui/primitives/button'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { loadOwnedProductOptions } from './orderFormOptions'

/**
 * 关联已有商品 — pick the product master row this library item is the supplier's version of.
 *
 * This is the action that exists because SKU matching cannot serve every row: our own product SKU
 * and the supplier's code are different facts, and when they differ the only alternatives used to
 * be "change one of them" or "create a duplicate product". Picking by hand is the third one, and it
 * is deliberately the *only* thing it does — the link action writes `product_id` and nothing else
 * (no field or price write-back), so linking can never overwrite a product manager's work.
 *
 * The search hits the product master's own list route through the module's shared option loader
 * (`orderFormOptions.loadOwnedProductOptions`), so this picker and the purchase order's line picker
 * offer exactly the same records with the same labels.
 */
export type SupplierProductLinkDialogProps = {
  open: boolean
  /** `供应商货号 — 品名` of the library row being linked, so the dialog names its subject. */
  rowLabel: string
  /** The product this row already points at; marked in the list, and the reason the action is 换绑. */
  currentProductId: string | null
  onOpenChange: (open: boolean) => void
  onSubmit: (productId: string) => Promise<void>
}

export default function SupplierProductLinkDialog({
  open,
  rowLabel,
  currentProductId,
  onOpenChange,
  onSubmit,
}: SupplierProductLinkDialogProps) {
  const t = useT()
  const { organizationId } = useOrganizationScopeDetail()
  const [search, setSearch] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  // A fresh open must not inherit the previous row's query.
  React.useEffect(() => {
    if (open) setSearch('')
  }, [open])

  const optionsQuery = useQuery({
    queryKey: ['purchasing-supplier-product-link-options', search.trim(), organizationId ?? null],
    enabled: open,
    queryFn: () =>
      loadOwnedProductOptions(
        t('purchasing.supplierProducts.link.loadFailed', 'Could not load the product master.'),
        t(
          'purchasing.supplierProducts.link.forbidden',
          'Your role cannot read the product master (products.items.view), so there is nothing to pick here.',
        ),
        search,
        organizationId,
      ),
  })

  const options = optionsQuery.data ?? []

  const submit = React.useCallback(
    async (productId: string) => {
      if (submitting) return
      setSubmitting(true)
      try {
        await onSubmit(productId)
        onOpenChange(false)
      } finally {
        setSubmitting(false)
      }
    },
    [onOpenChange, onSubmit, submitting],
  )

  // Cmd/Ctrl+Enter picks the first result — the same confirm gesture every dialog in this app
  // supports; Escape closes.
  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => {
      const first = options[0]
      if (first) void submit(first.value)
    },
    onCancel: () => onOpenChange(false),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('purchasing.supplierProducts.link.title', 'Link to an existing product')}</DialogTitle>
          <DialogDescription>
            {t(
              'purchasing.supplierProducts.link.description',
              'Pick the product master record this supplier item is the supplier’s version of. Only the link is written — the product’s fields and prices stay as they are.',
            )}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{rowLabel}</p>
        <Input
          autoFocus
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('purchasing.supplierProducts.link.searchPlaceholder', 'Search by SKU or name')}
          leftIcon={<Search className="size-4" />}
          aria-label={t('purchasing.supplierProducts.link.searchPlaceholder', 'Search by SKU or name')}
        />
        <div className="max-h-72 overflow-y-auto rounded-md border">
          {optionsQuery.isLoading ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t('ui.dataTable.loading', 'Loading…')}
            </p>
          ) : optionsQuery.error ? (
            <p className="px-3 py-6 text-center text-sm text-destructive">
              {optionsQuery.error instanceof Error && optionsQuery.error.message
                ? optionsQuery.error.message
                : t('purchasing.supplierProducts.link.loadFailed', 'Could not load the product master.')}
            </p>
          ) : options.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t(
                'purchasing.supplierProducts.link.empty',
                'No product matches. Create the product record first (建商品档案), then link it.',
              )}
            </p>
          ) : (
            <ul className="divide-y">
              {options.map((option) => (
                <li key={option.value}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    onClick={() => void submit(option.value)}
                    disabled={submitting}
                  >
                    <span className="truncate">{option.label}</span>
                    {option.value === currentProductId ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t('purchasing.supplierProducts.link.current', 'Currently linked')}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('ui.forms.actions.cancel', 'Cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
