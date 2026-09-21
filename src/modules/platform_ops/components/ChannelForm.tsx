"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFieldOption, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'

/**
 * This file owns the channel contract shared with the list surface: the record shape, the
 * payload mapper, the field definitions and the currency option loader. Keeping them here means
 * the value the list renders and the value the form submits cannot drift apart.
 */

export const CHANNELS_API_PATH = 'platform_ops/channels'
export const CHANNELS_LIST_HREF = '/backend/platform_ops/channels'

const CURRENCY_DICTIONARY_URL = '/api/customers/dictionaries/currency'

export type ChannelFormValues = {
  id?: string
  name: string
  code: string
  platform: string
  externalAccountId: string
  currencyCode: string
  isActive: boolean
  notes: string
  /**
   * Carries the optimistic-lock version into `CrudForm`, which auto-derives the
   * expected-version header from `initialValues.updatedAt` for update.
   */
  updatedAt?: string | null
}

/** Channel as returned by `/api/platform_ops/channels`; `id` is always present on a persisted row. */
export type ChannelRecord = Omit<ChannelFormValues, 'id'> & { id: string }

const EMPTY_CHANNEL_VALUES: ChannelFormValues = {
  name: '',
  code: '',
  platform: '',
  externalAccountId: '',
  currencyCode: '',
  isActive: true,
  notes: '',
}

const CHANNEL_GROUPS: CrudFormGroup[] = [
  { id: 'details', column: 1, fields: ['name', 'code', 'platform', 'externalAccountId'] },
  { id: 'settings', column: 2, fields: ['currencyCode', 'isActive', 'notes'] },
]

function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

/**
 * Maps a list/record payload into the form's initial values.
 *
 * Exported as a pure function so the optimistic-lock wiring stays testable: `CrudForm`
 * auto-derives the expected-version header from `initialValues.updatedAt`, so dropping
 * `updatedAt` here silently disables optimistic locking for the edit form.
 */
export function toChannelFormValues(item: Record<string, unknown>): ChannelRecord {
  const isActive = item.isActive ?? item.is_active
  const updatedAt = item.updatedAt ?? item.updated_at
  return {
    id: readText(item, 'id'),
    name: readText(item, 'name'),
    code: readText(item, 'code'),
    platform: readText(item, 'platform'),
    externalAccountId: readText(item, 'externalAccountId', 'external_account_id'),
    currencyCode: readText(item, 'currencyCode', 'currency_code'),
    isActive: isActive === undefined ? true : Boolean(isActive),
    notes: readText(item, 'notes'),
    updatedAt: typeof updatedAt === 'string' ? updatedAt : null,
  }
}

/**
 * Builds the create/update payload; keys are dropped to the contract field set.
 *
 * Optional text is sent as `null` rather than an empty string so a cleared field stays a
 * cleared field in the database instead of becoming an empty value the list has to special-case.
 */
export function buildChannelPayload(values: ChannelFormValues): Record<string, unknown> {
  const externalAccountId = values.externalAccountId.trim()
  const notes = values.notes.trim()
  return {
    name: values.name.trim(),
    code: values.code.trim(),
    platform: values.platform.trim(),
    externalAccountId: externalAccountId.length ? externalAccountId : null,
    currencyCode: values.currencyCode.trim().toUpperCase(),
    isActive: Boolean(values.isActive),
    notes: notes.length ? notes : null,
  }
}

/**
 * Options come from the seeded currency dictionary — the same store every platform currency
 * picker reads — so the select can only offer codes the rest of the app understands. The FX
 * master is deliberately not used here: it drives exchange rates, not pickers.
 */
async function loadCurrencyOptions(errorMessage: string): Promise<CrudFieldOption[]> {
  const payload = await readApiResultOrThrow<{ entries?: Array<{ value?: string; label?: string }> }>(
    CURRENCY_DICTIONARY_URL,
    undefined,
    { errorMessage },
  )
  return (payload.entries ?? [])
    .map((entry) => {
      const value = typeof entry.value === 'string' ? entry.value.trim().toUpperCase() : ''
      if (!value) return null
      const label = typeof entry.label === 'string' && entry.label.trim().length ? entry.label.trim() : value
      return { value, label: `${value} — ${label}` }
    })
    .filter((option): option is CrudFieldOption => option !== null)
    .sort((left, right) => left.value.localeCompare(right.value))
}

function useChannelFields(t: TranslateFn): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'name',
      label: t('platform_ops.channels.form.field.name'),
      type: 'text',
      required: true,
    },
    {
      id: 'code',
      label: t('platform_ops.channels.form.field.code'),
      type: 'text',
      required: true,
    },
    {
      id: 'platform',
      label: t('platform_ops.channels.form.field.platform'),
      type: 'text',
      required: true,
    },
    {
      id: 'externalAccountId',
      label: t('platform_ops.channels.form.field.externalAccountId'),
      type: 'text',
    },
    {
      id: 'currencyCode',
      label: t('platform_ops.channels.form.field.currencyCode'),
      type: 'select',
      required: true,
      loadOptions: () => loadCurrencyOptions(t('platform_ops.channels.form.loadFailed')),
    },
    {
      id: 'isActive',
      label: t('platform_ops.channels.form.field.isActive'),
      type: 'checkbox',
    },
    {
      id: 'notes',
      label: t('platform_ops.channels.form.field.notes'),
      type: 'textarea',
    },
  ], [t])
}

function ChannelCreateForm() {
  const t = useT()
  const fields = useChannelFields(t)
  const successRedirect = React.useMemo(
    () => withFlash(CHANNELS_LIST_HREF, t('platform_ops.channels.form.saved'), 'success'),
    [t],
  )

  const handleSubmit = React.useCallback(async (values: ChannelFormValues) => {
    try {
      await createCrud(CHANNELS_API_PATH, buildChannelPayload(values))
    } catch (error) {
      flash(t('platform_ops.channels.form.saveFailed'), 'error')
      throw error
    }
  }, [t])

  return (
    <CrudForm<ChannelFormValues>
      title={t('platform_ops.channels.form.createTitle')}
      titleHeadingLevel={1}
      backHref={CHANNELS_LIST_HREF}
      fields={fields}
      groups={CHANNEL_GROUPS}
      initialValues={EMPTY_CHANNEL_VALUES}
      submitLabel={t('platform_ops.channels.form.save')}
      cancelHref={CHANNELS_LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={handleSubmit}
    />
  )
}

function ChannelEditForm({ channelId }: { channelId: string }) {
  const t = useT()
  const fields = useChannelFields(t)
  const [initial, setInitial] = React.useState<ChannelRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  const successRedirect = React.useMemo(
    () => withFlash(CHANNELS_LIST_HREF, t('platform_ops.channels.form.saved'), 'success'),
    [t],
  )

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const payload = await fetchCrudList<Record<string, unknown>>(CHANNELS_API_PATH, { ids: channelId, pageSize: 1 })
        const item = payload?.items?.[0]
        if (!item) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        if (!cancelled) setInitial(toChannelFormValues(item))
      } catch (loadError: unknown) {
        if (!cancelled) {
          if ((loadError as { status?: number }).status === 404) {
            setIsNotFound(true)
          } else {
            setError(t('platform_ops.channels.form.loadFailed'))
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [channelId, t])

  const fallbackInitialValues = React.useMemo<ChannelFormValues>(
    () => ({ ...EMPTY_CHANNEL_VALUES, id: channelId, updatedAt: null }),
    [channelId],
  )

  const handleSubmit = React.useCallback(async (values: ChannelFormValues) => {
    try {
      await updateCrud(CHANNELS_API_PATH, {
        id: initial?.id || channelId,
        ...buildChannelPayload(values),
        updatedAt: initial?.updatedAt ?? null,
      })
    } catch (updateError) {
      flash(t('platform_ops.channels.form.saveFailed'), 'error')
      throw updateError
    }
  }, [initial, channelId, t])

  if (isNotFound) {
    return (
      <RecordNotFoundState
        label={t('platform_ops.channels.form.loadFailed')}
        backHref={CHANNELS_LIST_HREF}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<ChannelFormValues>
      title={t('platform_ops.channels.form.editTitle')}
      titleHeadingLevel={1}
      backHref={CHANNELS_LIST_HREF}
      fields={fields}
      groups={CHANNEL_GROUPS}
      initialValues={initial ?? fallbackInitialValues}
      submitLabel={t('platform_ops.channels.form.save')}
      cancelHref={CHANNELS_LIST_HREF}
      successRedirect={successRedirect}
      isLoading={loading}
      onSubmit={handleSubmit}
    />
  )
}

export default function ChannelForm({ mode, channelId }: { mode: 'create' | 'edit'; channelId?: string }) {
  if (mode === 'edit') {
    if (!channelId) return null
    return <ChannelEditForm channelId={channelId} />
  }
  return <ChannelCreateForm />
}
