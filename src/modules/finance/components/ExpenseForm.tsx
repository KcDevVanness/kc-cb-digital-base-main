"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { loadChannelOptions, loadExpenseTypeOptions, EXPENSES_API_PATH, EXPENSES_LIST_HREF } from './expenseOptions'
import { loadPartyOptions, readOptionText } from './shipmentCostOptions'

/**
 * This file owns the period-expense contract shared with the list surface: the record shape, the
 * payload mapper and the field definitions.
 */

export type ExpenseFormValues = {
  id?: string
  expenseType: string
  periodStart: string
  periodEnd: string
  amount: string
  currencyCode: string
  exchangeRate: string
  channelId: string
  partyId: string
  attachmentId: string
  note: string
  /** Carries the optimistic-lock version into `CrudForm` for update. */
  updatedAt?: string | null
}

/** A period expense as `/api/finance/expenses` returns it; `id` is always present. */
export type ExpenseRecord = Omit<ExpenseFormValues, 'id'> & { id: string }

const EMPTY_VALUES: ExpenseFormValues = {
  expenseType: '',
  periodStart: '',
  periodEnd: '',
  amount: '',
  currencyCode: 'CNY',
  exchangeRate: '',
  channelId: '',
  partyId: '',
  attachmentId: '',
  note: '',
}

const FORM_GROUPS: CrudFormGroup[] = [
  { id: 'expense', column: 1, fields: ['expenseType', 'amount', 'currencyCode', 'exchangeRate'] },
  { id: 'period', column: 2, fields: ['periodStart', 'periodEnd', 'channelId', 'partyId'] },
  { id: 'notes', column: 1, fields: ['note'] },
]

/** Maps a list/record payload into the form's initial values (drops `updatedAt` at your peril). */
export function toExpenseFormValues(item: Record<string, unknown>): ExpenseRecord {
  const updatedAt = item.updatedAt ?? item.updated_at
  return {
    id: readOptionText(item, 'id'),
    expenseType: readOptionText(item, 'expenseType', 'expense_type'),
    periodStart: (readOptionText(item, 'periodStart', 'period_start') || '').slice(0, 10),
    periodEnd: (readOptionText(item, 'periodEnd', 'period_end') || '').slice(0, 10),
    amount: readOptionText(item, 'amount'),
    currencyCode: readOptionText(item, 'currencyCode', 'currency_code') || 'CNY',
    exchangeRate: readOptionText(item, 'exchangeRate', 'exchange_rate'),
    channelId: readOptionText(item, 'channelId', 'channel_id'),
    partyId: readOptionText(item, 'partyId', 'party_id'),
    attachmentId: readOptionText(item, 'attachmentId', 'attachment_id'),
    note: readOptionText(item, 'note'),
    updatedAt: typeof updatedAt === 'string' ? updatedAt : null,
  }
}

/**
 * Builds the create/update payload. Optional text is sent as `null` rather than an empty string so
 * a cleared field stays cleared in the database.
 */
export function buildExpensePayload(values: ExpenseFormValues): Record<string, unknown> {
  const note = values.note.trim()
  const exchangeRate = values.exchangeRate.trim()
  return {
    expenseType: values.expenseType.trim(),
    periodStart: values.periodStart.trim(),
    periodEnd: values.periodEnd.trim(),
    amount: values.amount.trim(),
    currencyCode: values.currencyCode.trim().toUpperCase() || 'CNY',
    exchangeRate: exchangeRate.length ? exchangeRate : null,
    channelId: values.channelId.trim().length ? values.channelId.trim() : null,
    partyId: values.partyId.trim().length ? values.partyId.trim() : null,
    attachmentId: values.attachmentId.trim().length ? values.attachmentId.trim() : null,
    note: note.length ? note : null,
  }
}

function useExpenseFields(t: TranslateFn): CrudField[] {
  return React.useMemo<CrudField[]>(
    () => [
      {
        id: 'expenseType',
        label: t('finance.expenses.form.field.expenseType'),
        type: 'select',
        required: true,
        description: t('finance.expenses.form.field.expenseTypeHelp'),
        loadOptions: () => loadExpenseTypeOptions(),
      },
      {
        id: 'amount',
        label: t('finance.expenses.form.field.amount'),
        type: 'text',
        required: true,
        description: t('finance.expenses.form.field.amountHelp'),
      },
      {
        id: 'currencyCode',
        label: t('finance.expenses.form.field.currency'),
        type: 'text',
        required: true,
        maxLength: 3,
      },
      {
        id: 'exchangeRate',
        label: t('finance.expenses.form.field.exchangeRate'),
        type: 'text',
        description: t('finance.expenses.form.field.exchangeRateHelp'),
      },
      {
        id: 'periodStart',
        label: t('finance.expenses.form.field.periodStart'),
        type: 'date',
        required: true,
        description: t('finance.expenses.form.field.periodHelp'),
      },
      {
        id: 'periodEnd',
        label: t('finance.expenses.form.field.periodEnd'),
        type: 'date',
        required: true,
      },
      {
        id: 'channelId',
        label: t('finance.expenses.form.field.channel'),
        type: 'combobox',
        description: t('finance.expenses.form.field.channelHelp'),
        loadOptions: () => loadChannelOptions(t('finance.expenses.form.loadChannelsFailed')),
        resolveLabel: (value) => value,
      },
      {
        id: 'partyId',
        label: t('finance.expenses.form.field.party'),
        type: 'combobox',
        description: t('finance.expenses.form.field.partyHelp'),
        loadOptions: () => loadPartyOptions(t('finance.expenses.form.loadPartiesFailed')),
        resolveLabel: (value) => value,
      },
      {
        id: 'note',
        label: t('finance.expenses.form.field.note'),
        type: 'textarea',
        rows: 3,
      },
    ],
    [t],
  )
}

function ExpenseCreateForm() {
  const t = useT()
  const fields = useExpenseFields(t)
  const successRedirect = React.useMemo(
    () => withFlash(EXPENSES_LIST_HREF, t('finance.expenses.form.saved'), 'success'),
    [t],
  )
  const handleSubmit = React.useCallback(
    async (values: ExpenseFormValues) => {
      try {
        await createCrud(EXPENSES_API_PATH, buildExpensePayload(values))
      } catch (error) {
        flash(t('finance.expenses.form.saveFailed'), 'error')
        throw error
      }
    },
    [t],
  )

  return (
    <CrudForm<ExpenseFormValues>
      title={t('finance.expenses.form.createTitle')}
      titleHeadingLevel={1}
      backHref={EXPENSES_LIST_HREF}
      fields={fields}
      groups={FORM_GROUPS}
      initialValues={EMPTY_VALUES}
      submitLabel={t('finance.expenses.form.save')}
      cancelHref={EXPENSES_LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={handleSubmit}
    />
  )
}

function ExpenseEditForm({ expenseId }: { expenseId: string }) {
  const t = useT()
  const fields = useExpenseFields(t)
  const [initial, setInitial] = React.useState<ExpenseRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  const successRedirect = React.useMemo(
    () => withFlash(EXPENSES_LIST_HREF, t('finance.expenses.form.saved'), 'success'),
    [t],
  )

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const payload = await fetchCrudList<Record<string, unknown>>(EXPENSES_API_PATH, { ids: expenseId, pageSize: 1 })
        const item = payload?.items?.[0]
        if (!item) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        if (!cancelled) setInitial(toExpenseFormValues(item))
      } catch (loadError: unknown) {
        if (!cancelled) {
          if ((loadError as { status?: number }).status === 404) setIsNotFound(true)
          else setError(t('finance.expenses.form.loadFailed'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [expenseId, t])

  const fallbackInitialValues = React.useMemo<ExpenseFormValues>(
    () => ({ ...EMPTY_VALUES, id: expenseId, updatedAt: null }),
    [expenseId],
  )

  const handleSubmit = React.useCallback(
    async (values: ExpenseFormValues) => {
      try {
        const payload = buildExpensePayload(values)
        await updateCrud(EXPENSES_API_PATH, {
          id: initial?.id || expenseId,
          ...payload,
          updatedAt: initial?.updatedAt ?? null,
        })
      } catch (updateError) {
        flash(t('finance.expenses.form.saveFailed'), 'error')
        throw updateError
      }
    },
    [expenseId, initial, t],
  )

  if (isNotFound) {
    return <RecordNotFoundState label={t('finance.expenses.form.loadFailed')} backHref={EXPENSES_LIST_HREF} />
  }
  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<ExpenseFormValues>
      title={t('finance.expenses.form.editTitle')}
      titleHeadingLevel={1}
      backHref={EXPENSES_LIST_HREF}
      fields={fields}
      groups={FORM_GROUPS}
      initialValues={initial ?? fallbackInitialValues}
      submitLabel={t('finance.expenses.form.save')}
      cancelHref={EXPENSES_LIST_HREF}
      successRedirect={successRedirect}
      isLoading={loading}
      onSubmit={handleSubmit}
    />
  )
}

export default function ExpenseForm({ mode, expenseId }: { mode: 'create' | 'edit'; expenseId?: string }) {
  if (mode === 'edit') {
    if (!expenseId) return null
    return <ExpenseEditForm expenseId={expenseId} />
  }
  return <ExpenseCreateForm />
}
