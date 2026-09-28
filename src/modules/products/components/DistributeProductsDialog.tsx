"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import {
  useOrganizationScopeDetail,
  useOrganizationScopeVersion,
} from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { relatedOrganizationEntries } from '@/lib/orgs/organizationOptions'
import { parseOrganizationSwitcherScope } from '../../dictionaries/lib/dictionariesLibraryApi'

/**
 * 分发到分公司 — copy the selected products (or every non-deleted product of the current
 * organization) into other organizations
 * (`.ai/specs/2026-09-28-product-distribution-to-branches.md`).
 *
 * The target list is the top-bar switcher's own payload minus the current organization: the same
 * source, and therefore the same visibility rule, the internal-sales buyer picker uses. The write
 * re-validates every target against the caller's writable organization set, so this picker is a
 * convenience, never the gate.
 *
 * The dialog stays open after a run and shows the per-product outcome — counts plus the SKUs the
 * target organization already owns (`sku_taken`) — because a silently skipped row is the one thing
 * an operator must not miss.
 */

type DistributeResult = {
  created: number
  updated: number
  skipped: Array<{ sku: string; organizationId: string; reason: string }>
}

export type DistributeProductsDialogProps = {
  open: boolean
  /** Products to distribute; omitted (or empty) = every non-deleted product of the current organization. */
  productIds?: string[]
  onOpenChange: (open: boolean) => void
  /** Called after a successful run so the host list can refresh. */
  onDistributed?: () => void
}

export default function DistributeProductsDialog({
  open,
  productIds,
  onOpenChange,
  onDistributed,
}: DistributeProductsDialogProps) {
  const t = useT()
  const { organizationId } = useOrganizationScopeDetail()
  const scopeVersion = useOrganizationScopeVersion()
  const [selected, setSelected] = React.useState<string[]>([])
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<DistributeResult | null>(null)

  // A fresh open starts clean: the previous run's selection and outcome must not linger.
  React.useEffect(() => {
    if (!open) return
    setSelected([])
    setError(null)
    setResult(null)
  }, [open])

  const organizationsQuery = useQuery({
    queryKey: ['products-distribute-organizations', scopeVersion],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      const call = await apiCall<Record<string, unknown>>('/api/directory/organization-switcher')
      if (!call.ok) {
        throw new Error(t('products.items.distribute.orgLoadFailed', 'Could not load your organizations.'))
      }
      return parseOrganizationSwitcherScope(call.result).organizations
    },
  })

  const targets = React.useMemo(
    () => relatedOrganizationEntries(organizationsQuery.data ?? [], organizationId),
    [organizationsQuery.data, organizationId],
  )

  const singleProduct = (productIds?.length ?? 0) > 0

  const toggleTarget = React.useCallback((id: string) => {
    setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))
  }, [])

  const submit = React.useCallback(async () => {
    if (submitting || selected.length === 0) return
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const response = await createCrud<DistributeResult>(
        'products/items/distribute',
        {
          ...(singleProduct ? { productIds } : {}),
          organizationIds: selected,
        },
        { errorMessage: t('products.items.distribute.failed', 'Could not distribute the products.') },
      )
      setResult(response.result ?? null)
      onDistributed?.()
    } catch (submitError: unknown) {
      setError(
        submitError instanceof Error && submitError.message
          ? submitError.message
          : t('products.items.distribute.failed', 'Could not distribute the products.'),
      )
    } finally {
      setSubmitting(false)
    }
  }, [onDistributed, productIds, selected, singleProduct, submitting, t])

  // Cmd/Ctrl+Enter runs the distribution — the confirm gesture every dialog in this app supports;
  // Escape closes.
  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => {
      void submit()
    },
    onCancel: () => onOpenChange(false),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('products.items.distribute.title', 'Distribute to organizations')}</DialogTitle>
          <DialogDescription>
            {singleProduct
              ? t(
                  'products.items.distribute.description.one',
                  'The selected organization receives this product (fields, variants and a first price set). Running it again updates the fields — prices belong to the receiving organization.',
                )
              : t(
                  'products.items.distribute.description.all',
                  'The selected organizations receive every active product of this organization. Running it again updates the fields — prices belong to the receiving organization.',
                )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-sm font-medium">{t('products.items.distribute.targets', 'Target organizations')}</p>
          {organizationsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">{t('ui.dataTable.loading', 'Loading…')}</p>
          ) : organizationsQuery.error ? (
            <p className="text-sm text-status-error-text">
              {organizationsQuery.error instanceof Error && organizationsQuery.error.message
                ? organizationsQuery.error.message
                : t('products.items.distribute.orgLoadFailed', 'Could not load your organizations.')}
            </p>
          ) : targets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t(
                'products.items.distribute.empty',
                'No organization can receive products: you can only write into organizations your role grants, and never into the current one.',
              )}
            </p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
              {targets.map((target) => (
                <label
                  key={target.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-muted"
                >
                  <Checkbox
                    checked={selected.includes(target.id)}
                    onCheckedChange={() => toggleTarget(target.id)}
                    disabled={submitting}
                  />
                  <span className="truncate">{target.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {error ? (
          <Alert status="error" size="sm">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {result ? (
          <Alert status={result.skipped.length > 0 ? 'warning' : 'success'} size="sm">
            <AlertDescription>
              <span className="block">
                {t('products.items.distribute.result', 'New {{created}} · updated {{updated}}')
                  .replace('{{created}}', String(result.created))
                  .replace('{{updated}}', String(result.updated))}
              </span>
              {result.skipped.length > 0 ? (
                <ul className="mt-1 list-disc pl-4">
                  {result.skipped.map((row) => (
                    <li key={`${row.organizationId}:${row.sku}`}>
                      {t('products.items.distribute.skipped', '{{sku}} — skipped: the organization already owns this SKU')
                        .replace('{{sku}}', row.sku)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('products.items.distribute.close', 'Close')}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={submitting || selected.length === 0}>
            {submitting
              ? t('products.items.distribute.submitting', 'Distributing…')
              : t('products.items.distribute.submit', 'Distribute')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
