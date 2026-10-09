'use client'

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
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { createCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { relatedOrganizationEntries } from '@/lib/orgs/organizationOptions'
import { parseOrganizationSwitcherScope } from '../../dictionaries/lib/dictionariesLibraryApi'

/**
 * 「协作组织」 — the owner organization's set of collaborating organizations (REQ-014).
 *
 * The option list is the **top-bar organization switcher's own payload**, minus the root's own
 * organization: the same source, and therefore the same visibility rule, the product-distribution
 * dialog and the internal-sales buyer picker use. The save is a whole-set replace carrying the root
 * version the hub rendered with, so a root changed in another tab answers 409 and lands on the
 * platform's conflict bar instead of silently overwriting the other operator's set.
 *
 * The picker is a convenience, never the gate: `order_hub.orders.collaborators.replace` re-validates
 * ownership, the organizations' existence and the version server-side.
 */
const COLLABORATORS_API_PATH = 'order_hub/orders/collaborators'
const ORGANIZATION_SWITCHER_API_PATH = '/api/directory/organization-switcher'

export type CompanyOrderCollaboratorsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyOrderId: string
  /** The root's own organization: never a collaborator of itself, so never offered. */
  ownerOrganizationId: string
  /** The version the hub rendered with; the replace command locks on it. */
  companyOrderUpdatedAt: string | null
  /** Called after a successful replace so the hub re-reads the root. */
  onSaved: () => Promise<void> | void
}

export function CompanyOrderCollaboratorsDialog({
  open,
  onOpenChange,
  companyOrderId,
  ownerOrganizationId,
  companyOrderUpdatedAt,
  onSaved,
}: CompanyOrderCollaboratorsDialogProps) {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [selected, setSelected] = React.useState<string[]>([])
  const [isSaving, setIsSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)

  const loadFailedMessage = t('order_hub.companyOrders.collaborators.loadFailed')

  // The candidate organizations: the switcher's tree, with the root's own organization excluded.
  const organizationsQuery = useQuery({
    queryKey: ['order-hub-collaborator-options', ownerOrganizationId, scopeVersion],
    enabled: open,
    queryFn: async () => {
      const call = await apiCall<unknown>(ORGANIZATION_SWITCHER_API_PATH, undefined, { fallback: null })
      const nodes = call.ok ? parseOrganizationSwitcherScope(call.result).organizations : []
      return relatedOrganizationEntries(nodes, ownerOrganizationId)
    },
  })

  // The stored set is re-read on every open (and on every conflict refresh): seeding from a stale
  // local copy is exactly how someone else's collaborator gets dropped by a whole-set replace.
  const storedQuery = useQuery({
    queryKey: ['order-hub-collaborators', companyOrderId, scopeVersion, reloadToken],
    enabled: open && companyOrderId.length > 0,
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(COLLABORATORS_API_PATH, {
        companyOrderId,
        pageSize: 200,
      })
      return (payload.items ?? [])
        .map((item) => String(item.organizationId ?? ''))
        .filter((id) => id.length > 0)
    },
  })

  React.useEffect(() => {
    if (!open) return
    if (!storedQuery.data) return
    setSelected(storedQuery.data)
    setSaveError(null)
  }, [open, storedQuery.data])

  const candidates = organizationsQuery.data ?? []
  const toggle = React.useCallback((organizationId: string) => {
    setSelected((current) =>
      current.includes(organizationId)
        ? current.filter((id) => id !== organizationId)
        : [...current, organizationId],
    )
  }, [])

  const isLoading = organizationsQuery.isLoading || storedQuery.isLoading
  const loadFailed = organizationsQuery.isError || storedQuery.isError

  const handleSave = React.useCallback(async () => {
    setIsSaving(true)
    setSaveError(null)
    try {
      await createCrud(
        COLLABORATORS_API_PATH,
        {
          companyOrderId,
          organizationIds: selected,
          ...(companyOrderUpdatedAt ? { updatedAt: companyOrderUpdatedAt } : {}),
        },
        { errorMessage: t('order_hub.companyOrders.collaborators.saveFailed') },
      )
      flash(t('order_hub.companyOrders.collaborators.saved'), 'success')
      onOpenChange(false)
      await onSaved()
    } catch (error) {
      // A stale root version keeps the dialog open on the platform's conflict bar, whose refresh
      // re-reads both the stored set and the root.
      if (
        surfaceRecordConflict(error, t, {
          onRefresh: () => {
            setReloadToken((token) => token + 1)
            void onSaved()
          },
        })
      ) {
        return
      }
      setSaveError(error instanceof Error && error.message ? error.message : loadFailedMessage)
    } finally {
      setIsSaving(false)
    }
  }, [companyOrderId, companyOrderUpdatedAt, loadFailedMessage, onOpenChange, onSaved, selected, t])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !isSaving && !isLoading) {
            event.preventDefault()
            void handleSave()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('order_hub.companyOrders.collaborators.title')}</DialogTitle>
          <DialogDescription>{t('order_hub.companyOrders.collaborators.body')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t('order_hub.companyOrders.collaborators.loading')}</p>
          ) : loadFailed ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{loadFailedMessage}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void organizationsQuery.refetch()
                  void storedQuery.refetch()
                }}
              >
                {t('order_hub.companyOrders.collaborators.reload')}
              </Button>
            </div>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('order_hub.companyOrders.collaborators.empty')}</p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
              {candidates.map((candidate) => (
                <label
                  key={candidate.id}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1.5 text-sm hover:bg-muted/50"
                >
                  <Checkbox
                    checked={selected.includes(candidate.id)}
                    onCheckedChange={() => toggle(candidate.id)}
                    disabled={isSaving}
                  />
                  <span className="truncate">{candidate.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        {saveError ? (
          <Alert status="error" size="sm">
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t('ui.actions.cancel')}
          </Button>
          <Button type="button" disabled={isSaving || isLoading || loadFailed} onClick={() => void handleSave()}>
            {t('order_hub.companyOrders.collaborators.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default CompanyOrderCollaboratorsDialog
