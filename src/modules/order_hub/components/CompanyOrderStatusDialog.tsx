'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { companyOrderStatusOptions } from '../data/validators'

/**
 * The whole edit surface a **collaborating** organization gets on a company order (REQ-016):
 * `status` and `notes`, nothing else.
 *
 * The reduced surface is the server's rule, not this dialog's: `order_hub.orders.update` refuses any
 * other key from a collaborator with 422 `collaborator_field_not_allowed`, so this form simply does
 * not offer them. It carries the version the hub rendered with, so a concurrent change lands on the
 * platform's conflict bar (refresh) rather than overwriting it — and the refresh re-reads the head.
 */
const ORDERS_API_PATH = 'order_hub/orders'

export type CompanyOrderStatusDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyOrderId: string
  /** The version the hub rendered with; the update command locks on it. */
  companyOrderUpdatedAt: string | null
  initialStatus: string
  initialNotes: string | null
  onSaved: () => Promise<void> | void
}

export function CompanyOrderStatusDialog({
  open,
  onOpenChange,
  companyOrderId,
  companyOrderUpdatedAt,
  initialStatus,
  initialNotes,
  onSaved,
}: CompanyOrderStatusDialogProps) {
  const t = useT()
  const [status, setStatus] = React.useState(initialStatus)
  const [notes, setNotes] = React.useState(initialNotes ?? '')
  const [isSaving, setIsSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)

  // Re-seed from the head the hub last read whenever the dialog opens (or the head changes after a
  // conflict refresh), so the form never saves values from a stale render.
  React.useEffect(() => {
    if (!open) return
    setStatus(initialStatus)
    setNotes(initialNotes ?? '')
    setSaveError(null)
  }, [initialNotes, initialStatus, open])

  const handleSave = React.useCallback(async () => {
    setIsSaving(true)
    setSaveError(null)
    try {
      // An empty textarea is an explicit clear, not "leave alone": the operator opened the dialog on
      // the stored value, so emptying it means "no notes".
      await updateCrud(
        ORDERS_API_PATH,
        {
          id: companyOrderId,
          status,
          notes: notes.trim().length > 0 ? notes : null,
          ...(companyOrderUpdatedAt ? { updatedAt: companyOrderUpdatedAt } : {}),
        },
        { errorMessage: t('order_hub.companyOrders.statusEdit.saveFailed') },
      )
      flash(t('order_hub.companyOrders.statusEdit.saved'), 'success')
      onOpenChange(false)
      await onSaved()
    } catch (error) {
      if (
        surfaceRecordConflict(error, t, {
          onRefresh: () => {
            void onSaved()
          },
        })
      ) {
        return
      }
      setSaveError(
        error instanceof Error && error.message ? error.message : t('order_hub.companyOrders.statusEdit.saveFailed'),
      )
    } finally {
      setIsSaving(false)
    }
  }, [companyOrderId, companyOrderUpdatedAt, notes, onOpenChange, onSaved, status, t])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !isSaving) {
            event.preventDefault()
            void handleSave()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('order_hub.companyOrders.statusEdit.title')}</DialogTitle>
          <DialogDescription>{t('order_hub.companyOrders.statusEdit.body')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <FieldLabel htmlFor="company-order-collaborator-status">
              {t('order_hub.companyOrders.form.status')}
            </FieldLabel>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="company-order-collaborator-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {companyOrderStatusOptions(initialStatus).map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`order_hub.companyOrders.status.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="company-order-collaborator-notes">
              {t('order_hub.companyOrders.form.notes')}
            </FieldLabel>
            <Textarea
              id="company-order-collaborator-notes"
              value={notes}
              rows={4}
              maxLength={2000}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
          {saveError ? (
            <p className="text-sm text-destructive" role="alert">
              {saveError}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t('ui.actions.cancel')}
          </Button>
          <Button type="button" disabled={isSaving} onClick={() => void handleSave()}>
            {t('order_hub.companyOrders.form.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default CompanyOrderStatusDialog
