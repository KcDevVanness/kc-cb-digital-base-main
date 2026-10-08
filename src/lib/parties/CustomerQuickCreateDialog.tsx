"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { buildCountryOptions, resolveCountryName } from '@open-mercato/shared/lib/location/countries'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  buildCustomerQuickCreatePayload,
  customerQuickCreateSchema,
  EMPTY_CUSTOMER_QUICK_CREATE,
  type CustomerQuickCreateValues,
} from '@/lib/parties/customerQuickCreate'

/**
 * Quick-create of an external customer, shared by every app surface that picks a `parties` record.
 *
 * Lives at app level (moved out of `trade_docs`) so the internal-sales order form — and any later
 * host — can offer the same dialog without importing a sibling module's component. It still reads
 * the `trade_docs` catalog for its labels (`trade_docs.counterparty.create.*`): a shared component
 * may render words a module owns, exactly as `@/lib/orders/purchaseOrderStatus` reads the
 * `purchasing` catalog for its labels.
 *
 * The customer master lives in `parties` (角色 `buyer`), the app's counterparty module; this dialog
 * only collects the identity the printed document needs and calls the parties create route, so ACL,
 * scope, validation, uniqueness and the `parties.party.created` event all stay owned by that module.
 * The bank row is optional and single — the full multi-account editor stays on the party's own page.
 */

const API_PATH = 'parties'

export type CustomerQuickCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the new party id after the create landed, so the picker can select it. */
  onCreated: (partyId: string) => void | Promise<void>
}

function useFields(t: TranslateFn): CrudField[] {
  const locale = useLocale()
  const countryOptions = React.useMemo<CrudFieldOption[]>(
    () =>
      buildCountryOptions({
        locale,
        transformLabel: (code, label) => `${label} (${code})`,
      }).map((option) => ({ value: option.code, label: option.label })),
    [locale],
  )
  return React.useMemo<CrudField[]>(
    () => [
      { id: 'code', label: t('trade_docs.counterparty.create.code'), type: 'text', required: true },
      { id: 'name', label: t('trade_docs.counterparty.create.name'), type: 'text', required: true },
      {
        id: 'countryCode',
        label: t('trade_docs.counterparty.create.country'),
        type: 'combobox',
        options: countryOptions,
        allowCustomValues: false,
        clearable: true,
        resolveLabel: (value) => resolveCountryName(value, { locale }),
      },
      { id: 'contactName', label: t('trade_docs.counterparty.create.contactName'), type: 'text' },
      { id: 'contactPhone', label: t('trade_docs.counterparty.create.contactPhone'), type: 'text' },
      { id: 'email', label: t('trade_docs.counterparty.create.email'), type: 'text' },
      { id: 'bankName', label: t('trade_docs.counterparty.create.bankName'), type: 'text' },
      { id: 'bankAccount', label: t('trade_docs.counterparty.create.bankAccount'), type: 'text' },
    ],
    [countryOptions, locale, t],
  )
}

export function CustomerQuickCreateDialog({ open, onOpenChange, onCreated }: CustomerQuickCreateDialogProps) {
  const t = useT()
  const fields = useFields(t)
  const contentRef = React.useRef<HTMLDivElement | null>(null)

  // Re-seeded on every open so a cancelled dialog does not come back half typed; CrudForm treats a
  // new `initialValues` object as a fresh baseline, hence the memo on `open`.
  const initialValues = React.useMemo<CustomerQuickCreateValues>(
    () => ({ ...EMPTY_CUSTOMER_QUICK_CREATE }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate re-seed on dialog open
    [open],
  )

  const handleSubmit = React.useCallback(
    async (values: CustomerQuickCreateValues) => {
      try {
        const response = await createCrud<{ id?: string }>(API_PATH, buildCustomerQuickCreatePayload(values), {
          errorMessage: t('trade_docs.counterparty.create.failed'),
        })
        const createdId = typeof response.result?.id === 'string' ? response.result.id : null
        if (!createdId) {
          flash(t('trade_docs.counterparty.create.failed'), 'error')
          return
        }
        flash(t('trade_docs.counterparty.create.saved'), 'success')
        onOpenChange(false)
        await onCreated(createdId)
      } catch (error) {
        // 409 duplicate code stays in the dialog: the operator edits the code and resubmits.
        const message = error instanceof Error && error.message ? error.message : t('trade_docs.counterparty.create.failed')
        flash(message, 'error')
        throw error
      }
    },
    [onCreated, onOpenChange, t],
  )

  const submitForm = React.useCallback(() => {
    contentRef.current?.querySelector('form')?.requestSubmit()
  }, [])
  const handleDialogKeyDown = useDialogKeyHandler({
    onConfirm: submitForm,
    onCancel: () => onOpenChange(false),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent ref={contentRef} onKeyDown={handleDialogKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('trade_docs.counterparty.create.title')}</DialogTitle>
          <DialogDescription>{t('trade_docs.counterparty.create.description')}</DialogDescription>
        </DialogHeader>
        <CrudForm<CustomerQuickCreateValues>
          embedded
          schema={customerQuickCreateSchema}
          fields={fields}
          initialValues={initialValues}
          submitLabel={t('trade_docs.counterparty.create.submit')}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}
