"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { useBackHref } from '@/lib/navigation/returnTo'
import {
  loadPartyOptions,
  loadShipmentCostTypeOptions,
  loadShipmentOptions,
  readOptionText,
  SHIPMENT_COSTS_API_PATH,
  SHIPMENT_COSTS_LIST_HREF,
} from './shipmentCostOptions'

/**
 * This file owns the shipment-cost contract shared with the list surface: the record shape, the
 * payload mapper and the field definitions. Keeping them together means the value the list renders
 * and the value the form submits cannot drift apart.
 */

export type ShipmentCostFormValues = {
  id?: string
  shipmentId: string
  costType: string
  allocationBasis: string
  amount: string
  currencyCode: string
  exchangeRate: string
  incurredAt: string
  partyId: string
  attachmentId: string
  note: string
  /**
   * Carries the optimistic-lock version into `CrudForm`, which auto-derives the expected-version
   * header from `initialValues.updatedAt` for update.
   */
  updatedAt?: string | null
}

/** A shipment cost as `/api/finance/shipment-costs` returns it; `id` is always present. */
export type ShipmentCostRecord = Omit<ShipmentCostFormValues, 'id'> & { id: string; shipmentNumber: string | null }

const EMPTY_VALUES: ShipmentCostFormValues = {
  shipmentId: '',
  costType: '',
  allocationBasis: 'amount',
  amount: '',
  currencyCode: 'CNY',
  exchangeRate: '',
  incurredAt: '',
  partyId: '',
  attachmentId: '',
  note: '',
}

const FORM_GROUPS: CrudFormGroup[] = [
  { id: 'cost', column: 1, fields: ['shipmentId', 'costType', 'allocationBasis', 'amount'] },
  { id: 'money', column: 2, fields: ['currencyCode', 'exchangeRate', 'incurredAt', 'partyId'] },
  { id: 'notes', column: 1, fields: ['note'] },
]

/** Maps a list/record payload into the form's initial values (drops `updatedAt` at your peril). */
export function toShipmentCostFormValues(item: Record<string, unknown>): ShipmentCostRecord {
  const updatedAt = item.updatedAt ?? item.updated_at
  return {
    id: readOptionText(item, 'id'),
    shipmentId: readOptionText(item, 'shipmentId', 'shipment_id'),
    shipmentNumber: readOptionText(item, 'shipmentNumber', 'shipment_number') || null,
    costType: readOptionText(item, 'costType', 'cost_type'),
    allocationBasis: readOptionText(item, 'allocationBasis', 'allocation_basis') || 'amount',
    amount: readOptionText(item, 'amount'),
    currencyCode: readOptionText(item, 'currencyCode', 'currency_code') || 'CNY',
    exchangeRate: readOptionText(item, 'exchangeRate', 'exchange_rate'),
    incurredAt: readOptionText(item, 'incurredAt', 'incurred_at'),
    partyId: readOptionText(item, 'partyId', 'party_id'),
    attachmentId: readOptionText(item, 'attachmentId', 'attachment_id'),
    note: readOptionText(item, 'note'),
    updatedAt: typeof updatedAt === 'string' ? updatedAt : null,
  }
}

/**
 * Builds the create/update payload. Optional text is sent as `null` rather than an empty string so
 * a cleared field stays cleared in the database instead of becoming an empty value.
 */
export function buildShipmentCostPayload(values: ShipmentCostFormValues): Record<string, unknown> {
  const note = values.note.trim()
  const exchangeRate = values.exchangeRate.trim()
  return {
    shipmentId: values.shipmentId.trim(),
    costType: values.costType.trim(),
    allocationBasis: values.allocationBasis === 'quantity' ? 'quantity' : 'amount',
    amount: values.amount.trim(),
    currencyCode: values.currencyCode.trim().toUpperCase() || 'CNY',
    exchangeRate: exchangeRate.length ? exchangeRate : null,
    incurredAt: values.incurredAt.trim().length ? values.incurredAt.trim() : null,
    partyId: values.partyId.trim().length ? values.partyId.trim() : null,
    attachmentId: values.attachmentId.trim().length ? values.attachmentId.trim() : null,
    note: note.length ? note : null,
  }
}

function useShipmentCostFields(t: TranslateFn): CrudField[] {
  return React.useMemo<CrudField[]>(
    () => [
      {
        id: 'shipmentId',
        label: t('finance.shipmentCosts.form.field.shipment'),
        type: 'combobox',
        required: true,
        description: t('finance.shipmentCosts.form.field.shipmentHelp'),
        loadOptions: () => loadShipmentOptions(t('finance.shipmentCosts.form.loadShipmentsFailed')),
        resolveLabel: (value) => value,
      },
      {
        id: 'costType',
        label: t('finance.shipmentCosts.form.field.costType'),
        type: 'select',
        required: true,
        description: t('finance.shipmentCosts.form.field.costTypeHelp'),
        loadOptions: () => loadShipmentCostTypeOptions(),
      },
      {
        id: 'allocationBasis',
        label: t('finance.shipmentCosts.form.field.allocationBasis'),
        type: 'select',
        required: true,
        description: t('finance.shipmentCosts.form.field.allocationBasisHelp'),
        options: [
          { value: 'amount', label: t('finance.shipmentCosts.form.basis.amount') },
          { value: 'quantity', label: t('finance.shipmentCosts.form.basis.quantity') },
        ],
      },
      {
        id: 'amount',
        label: t('finance.shipmentCosts.form.field.amount'),
        type: 'text',
        required: true,
        description: t('finance.shipmentCosts.form.field.amountHelp'),
      },
      {
        id: 'currencyCode',
        label: t('finance.shipmentCosts.form.field.currency'),
        type: 'text',
        required: true,
        description: t('finance.shipmentCosts.form.field.currencyHelp'),
        maxLength: 3,
      },
      {
        id: 'exchangeRate',
        label: t('finance.shipmentCosts.form.field.exchangeRate'),
        type: 'text',
        description: t('finance.shipmentCosts.form.field.exchangeRateHelp'),
      },
      {
        id: 'incurredAt',
        label: t('finance.shipmentCosts.form.field.incurredAt'),
        type: 'date',
      },
      {
        id: 'partyId',
        label: t('finance.shipmentCosts.form.field.party'),
        type: 'combobox',
        description: t('finance.shipmentCosts.form.field.partyHelp'),
        loadOptions: () => loadPartyOptions(t('finance.shipmentCosts.form.loadPartiesFailed')),
        resolveLabel: (value) => value,
      },
      {
        id: 'note',
        label: t('finance.shipmentCosts.form.field.note'),
        type: 'textarea',
        rows: 3,
      },
    ],
    [t],
  )
}

function ShipmentCostCreateForm() {
  const t = useT()
  const fields = useShipmentCostFields(t)
  const backHref = useBackHref(SHIPMENT_COSTS_LIST_HREF)
  const successRedirect = React.useMemo(
    () => withFlash(SHIPMENT_COSTS_LIST_HREF, t('finance.shipmentCosts.form.saved'), 'success'),
    [t],
  )
  const handleSubmit = React.useCallback(
    async (values: ShipmentCostFormValues) => {
      try {
        await createCrud(SHIPMENT_COSTS_API_PATH, buildShipmentCostPayload(values))
      } catch (error) {
        flash(t('finance.shipmentCosts.form.saveFailed'), 'error')
        throw error
      }
    },
    [t],
  )

  return (
    <CrudForm<ShipmentCostFormValues>
      title={t('finance.shipmentCosts.form.createTitle')}
      titleHeadingLevel={1}
      backHref={backHref}
      fields={fields}
      groups={FORM_GROUPS}
      initialValues={EMPTY_VALUES}
      submitLabel={t('finance.shipmentCosts.form.save')}
      cancelHref={backHref}
      successRedirect={successRedirect}
      onSubmit={handleSubmit}
    />
  )
}

function ShipmentCostEditForm({ costId }: { costId: string }) {
  const t = useT()
  const fields = useShipmentCostFields(t)
  const backHref = useBackHref(SHIPMENT_COSTS_LIST_HREF)
  const [initial, setInitial] = React.useState<ShipmentCostRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  const successRedirect = React.useMemo(
    () => withFlash(SHIPMENT_COSTS_LIST_HREF, t('finance.shipmentCosts.form.saved'), 'success'),
    [t],
  )

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const payload = await fetchCrudList<Record<string, unknown>>(SHIPMENT_COSTS_API_PATH, { ids: costId, pageSize: 1 })
        const item = payload?.items?.[0]
        if (!item) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        if (!cancelled) setInitial(toShipmentCostFormValues(item))
      } catch (loadError: unknown) {
        if (!cancelled) {
          if ((loadError as { status?: number }).status === 404) setIsNotFound(true)
          else setError(t('finance.shipmentCosts.form.loadFailed'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [costId, t])

  const fallbackInitialValues = React.useMemo<ShipmentCostFormValues>(
    () => ({ ...EMPTY_VALUES, id: costId, updatedAt: null }),
    [costId],
  )

  const handleSubmit = React.useCallback(
    async (values: ShipmentCostFormValues) => {
      try {
        await updateCrud(SHIPMENT_COSTS_API_PATH, {
          id: initial?.id || costId,
          ...buildShipmentCostPayload(values),
          updatedAt: initial?.updatedAt ?? null,
        })
      } catch (updateError) {
        flash(t('finance.shipmentCosts.form.saveFailed'), 'error')
        throw updateError
      }
    },
    [costId, initial, t],
  )

  if (isNotFound) {
    return <RecordNotFoundState label={t('finance.shipmentCosts.form.loadFailed')} backHref={backHref} />
  }
  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<ShipmentCostFormValues>
      title={t('finance.shipmentCosts.form.editTitle')}
      titleHeadingLevel={1}
      backHref={backHref}
      fields={fields}
      groups={FORM_GROUPS}
      initialValues={initial ?? fallbackInitialValues}
      submitLabel={t('finance.shipmentCosts.form.save')}
      cancelHref={backHref}
      successRedirect={successRedirect}
      isLoading={loading}
      onSubmit={handleSubmit}
    />
  )
}

export default function ShipmentCostForm({ mode, costId }: { mode: 'create' | 'edit'; costId?: string }) {
  if (mode === 'edit') {
    if (!costId) return null
    return <ShipmentCostEditForm costId={costId} />
  }
  return <ShipmentCostCreateForm />
}
