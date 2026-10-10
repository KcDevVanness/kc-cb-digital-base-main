"use client"

import * as React from 'react'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'

/**
 * The header-field editor a related-record row opens in place.
 *
 * The dialog belongs to the app rather than to any module because every hub that lists *another*
 * module's records needs the same surface: a block row shows only its display columns, and
 * correcting a typo in the record's header must not mean leaving the page that shows the whole
 * relationship. The caller hands over the owning module's own `PUT` path, the writable header
 * fields that route accepts and the values read off the re-read row, so the write stays the
 * module's: its update schema and its command are still the gate, and nothing here can reach a line
 * set, a status or an amount.
 *
 * The form is embedded and its own footer suppressed, so the dialog owns the action row and 取消 /
 * 保存 sit together regardless of the CrudForm chrome. The save is a partial update carrying the
 * row's `updatedAt` as the optimistic-lock expectation; a version that moved on comes back as a 409
 * conflict, which raises the conflict bar and leaves the dialog — and what the operator typed —
 * exactly as it was, instead of overwriting the edit already made.
 */
export type QuickEditDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Dialog heading, already translated by the caller (each hub names the record it edits). */
  title: string
  /** The owning module's CRUD path relative to `/api` (e.g. `trade_docs/contracts`). */
  apiPath: string
  recordId: string
  /** The re-read row's `updatedAt`; when present the save is guarded by the optimistic lock. */
  updatedAt?: string | null
  fields: CrudField[]
  initialValues: Record<string, unknown>
  /** i18n key flashed once the write lands (e.g. `order_hub.detail.edit.saved`). */
  savedMessageKey: string
  onSaved: () => void | Promise<void>
}

/**
 * Resolves the wording of a field definition.
 *
 * A module's factory owns the words it prints but has no translator in scope at module level, so it
 * hands over i18n keys and they are resolved here. `t` answers with the key it was given when the
 * dictionary holds no entry for it, so a definition that already carries a translated string — or an
 * option label a dictionary loader produced — passes through untouched.
 */
function resolveFieldLabels(fields: CrudField[], t: TranslateFn): CrudField[] {
  return fields.map((field) => {
    const label = t(field.label)
    if (field.type === 'custom') return { ...field, label }
    return field.options
      ? { ...field, label, options: field.options.map((option) => ({ ...option, label: t(option.label) })) }
      : { ...field, label }
  })
}

export function QuickEditDialog({
  open,
  onOpenChange,
  title,
  apiPath,
  recordId,
  updatedAt,
  fields,
  initialValues,
  savedMessageKey,
  onSaved,
}: QuickEditDialogProps) {
  const t = useT()
  const formId = `quick-edit-${recordId}`
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const resolvedFields = React.useMemo(() => resolveFieldLabels(fields, t), [fields, t])

  // ⌘/Ctrl+Enter submits through the form element (by its id) rather than reaching into CrudForm,
  // and the footer's 保存 button submits the same element, so both paths share one save.
  const submitForm = React.useCallback(() => {
    contentRef.current?.querySelector('form')?.requestSubmit()
  }, [])
  const handleKeyDown = useDialogKeyHandler({
    onConfirm: submitForm,
    onCancel: () => onOpenChange(false),
    disabled: isSaving,
  })

  const handleSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      setIsSaving(true)
      try {
        await updateCrud(apiPath, { id: recordId, ...values })
        flash(t(savedMessageKey), 'success')
        onOpenChange(false)
        await onSaved()
      } catch (error) {
        // A stale `updatedAt` arrives as a 409: raise the conflict bar first (it offers the reload
        // that re-reads the row) and leave the dialog and its input in place. Anything else is a
        // write failure, reported with the server's own message.
        if (surfaceRecordConflict(error, t)) return
        flash(error instanceof Error && error.message ? error.message : t('ui.forms.flash.saveError'), 'error')
      } finally {
        setIsSaving(false)
      }
    },
    [apiPath, onOpenChange, onSaved, recordId, savedMessageKey, t],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent ref={contentRef} onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {/* Keyed by the record: reopening for another row rebuilds the form from that row instead of
            carrying the previous row's field edits (and their "already edited" markers) over. */}
        <CrudForm<Record<string, unknown>>
          key={recordId}
          embedded
          hideFooterActions
          formId={formId}
          optimisticLockUpdatedAt={updatedAt ?? null}
          fields={resolvedFields}
          initialValues={initialValues}
          onSubmit={handleSubmit}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t('ui.actions.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={isSaving}>
            {isSaving ? t('ui.forms.actions.saving') : t('ui.actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default QuickEditDialog
