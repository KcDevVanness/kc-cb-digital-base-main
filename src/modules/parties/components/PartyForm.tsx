"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFieldOption, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { buildCountryOptions, resolveCountryName } from '@open-mercato/shared/lib/location/countries'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { BankAccountsEditor, readBankAccountRows, type PartyBankAccountValue } from './BankAccountsEditor'

const API_PATH = 'parties'
const LIST_HREF = '/backend/parties'

export const PARTY_ROLE_OPTIONS = [
  'buyer',
  'consignee',
  'branch',
  'forwarder',
  'broker',
  'bank',
  'certifier',
] as const

export type PartyFormValues = {
  id?: string
  code: string
  name: string
  countryCode: string
  status: string
  contactName: string
  contactPhone: string
  email: string
  addressLine1: string
  addressLine2: string
  city: string
  roles: string[]
  bankAccounts: PartyBankAccountValue[]
  /**
   * Carries the optimistic-lock version into `CrudForm`, which auto-derives the expected-version
   * header from `initialValues.updatedAt` for update.
   */
  updatedAt?: string | null
}

export type PartyRecord = Omit<PartyFormValues, 'id'> & { id: string }

const EMPTY_PARTY_VALUES: PartyFormValues = {
  code: '',
  name: '',
  countryCode: '',
  status: 'active',
  contactName: '',
  contactPhone: '',
  email: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  roles: [],
  bankAccounts: [],
}

const PARTY_GROUPS: CrudFormGroup[] = [
  { id: 'identity', column: 1, fields: ['code', 'name', 'countryCode', 'status'] },
  { id: 'contact', column: 2, fields: ['contactName', 'contactPhone', 'email', 'addressLine1', 'addressLine2', 'city'] },
  { id: 'roles', column: 1, fields: ['roles'] },
  { id: 'bank', column: 1, fields: ['bankAccounts'] },
]

function readText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value
  }
  return ''
}

/**
 * Maps a detail payload into the form's initial values.
 *
 * Exported as a pure function because two things depend on it staying lossless: `CrudForm` derives
 * the expected-version header from `initialValues.updatedAt` (dropping it silently disables
 * optimistic locking), and the child rows must survive the round trip so an edit does not wipe roles
 * or the bank block.
 */
export function toPartyFormValues(item: Record<string, unknown>): PartyRecord {
  const status = readText(item, 'status')
  const updatedAt = item.updatedAt ?? item.updated_at
  const roles = Array.isArray(item.roles)
    ? item.roles.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : []
  return {
    id: readText(item, 'id'),
    code: readText(item, 'code'),
    name: readText(item, 'name'),
    countryCode: readText(item, 'countryCode', 'country_code'),
    status: status.length > 0 ? status : 'active',
    contactName: readText(item, 'contactName', 'contact_name'),
    contactPhone: readText(item, 'contactPhone', 'contact_phone'),
    email: readText(item, 'email'),
    addressLine1: readText(item, 'addressLine1', 'address_line1'),
    addressLine2: readText(item, 'addressLine2', 'address_line2'),
    city: readText(item, 'city'),
    roles,
    bankAccounts: readBankAccountRows(item.bankAccounts),
    updatedAt: typeof updatedAt === 'string' ? updatedAt : null,
  }
}

/** Empty text clears a nullable column on the server, so every blank becomes an explicit `null`. */
function orNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function buildPartyPayload(values: PartyFormValues): Record<string, unknown> {
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    countryCode: orNull(values.countryCode.toUpperCase()),
    status: values.status,
    contactName: orNull(values.contactName),
    contactPhone: orNull(values.contactPhone),
    email: orNull(values.email),
    addressLine1: orNull(values.addressLine1),
    addressLine2: orNull(values.addressLine2),
    city: orNull(values.city),
    roles: values.roles,
    bankAccounts: values.bankAccounts.map((row) => ({
      ...(row.id ? { id: row.id } : {}),
      beneficiaryBank: row.beneficiaryBank.trim(),
      accountNumber: row.accountNumber.trim(),
      swiftCode: orNull(row.swiftCode),
      bankAddress: orNull(row.bankAddress),
      isDefault: row.isDefault,
    })),
  }
}

function usePartyFields(t: TranslateFn): CrudField[] {
  const locale = useLocale()
  /**
   * Countries come from the shared ISO-3166 registry, labelled with the country name in the
   * operator's own locale: a two-letter code is exactly the value nobody should be typing from
   * memory. Free typing is refused because the registry is complete, and a stored code the
   * registry does not know still renders as itself instead of blanking the field.
   */
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
      {
        id: 'code',
        label: t('parties.form.field.code'),
        type: 'text',
        required: true,
      },
      {
        id: 'name',
        label: t('parties.form.field.name'),
        type: 'text',
        required: true,
      },
      {
        id: 'countryCode',
        label: t('parties.form.field.countryCode'),
        type: 'combobox',
        options: countryOptions,
        allowCustomValues: false,
        // The column is nullable, so the picker keeps the clear affordance the text field had.
        clearable: true,
        resolveLabel: (value) => resolveCountryName(value, { locale }),
      },
      {
        id: 'status',
        label: t('parties.form.field.status'),
        type: 'select',
        options: [
          { value: 'active', label: t('parties.list.status.active') },
          { value: 'inactive', label: t('parties.list.status.inactive') },
        ],
      },
      {
        id: 'contactName',
        label: t('parties.form.field.contactName'),
        type: 'text',
      },
      {
        id: 'contactPhone',
        label: t('parties.form.field.contactPhone'),
        type: 'text',
      },
      {
        id: 'email',
        label: t('parties.form.field.email'),
        type: 'text',
      },
      {
        id: 'addressLine1',
        label: t('parties.form.field.addressLine1'),
        type: 'textarea',
      },
      {
        id: 'addressLine2',
        label: t('parties.form.field.addressLine2'),
        type: 'text',
      },
      {
        id: 'city',
        label: t('parties.form.field.city'),
        type: 'text',
      },
      {
        id: 'roles',
        label: t('parties.form.field.roles'),
        type: 'select',
        multiple: true,
        description: t('parties.form.rolesHint'),
        options: PARTY_ROLE_OPTIONS.map((role) => ({
          value: role,
          label: t(`parties.form.roles.${role}`),
        })),
      },
      {
        id: 'bankAccounts',
        label: t('parties.form.group.bank'),
        type: 'custom',
        component: BankAccountsEditor,
      },
    ],
    [countryOptions, locale, t],
  )
}

function PartyCreateForm() {
  const t = useT()
  const fields = usePartyFields(t)
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('parties.form.saved'), 'success'),
    [t],
  )

  const handleSubmit = React.useCallback(
    async (values: PartyFormValues) => {
      try {
        await createCrud(API_PATH, buildPartyPayload(values))
      } catch (error) {
        flash(t('parties.form.saveFailed'), 'error')
        throw error
      }
    },
    [t],
  )

  return (
    <CrudForm<PartyFormValues>
      title={t('parties.form.createTitle')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      fields={fields}
      groups={PARTY_GROUPS}
      initialValues={EMPTY_PARTY_VALUES}
      submitLabel={t('parties.form.save')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={handleSubmit}
    />
  )
}

/** The detail route returns the aggregate (roles, bank block), which the factory list cannot. */
async function fetchParty(id: string, errorMessage: string): Promise<PartyRecord> {
  const payload = await readApiResultOrThrow<{ item?: Record<string, unknown> }>(
    `/api/parties/${encodeURIComponent(id)}`,
    undefined,
    { errorMessage },
  )
  return toPartyFormValues(payload.item ?? {})
}

function PartyEditForm({ partyId }: { partyId: string }) {
  const t = useT()
  const fields = usePartyFields(t)
  const [initial, setInitial] = React.useState<PartyRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('parties.form.saved'), 'success'),
    [t],
  )

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const item = await fetchParty(partyId, t('parties.form.loadFailed'))
        if (!cancelled) setInitial(item)
      } catch (loadError: unknown) {
        if (!cancelled) {
          if ((loadError as { status?: number }).status === 404) {
            setIsNotFound(true)
          } else {
            setError(t('parties.form.loadFailed'))
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [partyId, t])

  const fallbackInitialValues = React.useMemo<PartyFormValues>(
    () => ({ ...EMPTY_PARTY_VALUES, id: partyId, updatedAt: null }),
    [partyId],
  )

  const handleSubmit = React.useCallback(
    async (values: PartyFormValues) => {
      try {
        await updateCrud(API_PATH, {
          id: initial?.id || partyId,
          ...buildPartyPayload(values),
          updatedAt: initial?.updatedAt ?? null,
        })
      } catch (updateError) {
        flash(t('parties.form.saveFailed'), 'error')
        throw updateError
      }
    },
    [initial, partyId, t],
  )

  if (isNotFound) {
    return <RecordNotFoundState label={t('parties.form.loadFailed')} backHref={LIST_HREF} />
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<PartyFormValues>
      title={t('parties.form.editTitle')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      fields={fields}
      groups={PARTY_GROUPS}
      initialValues={initial ?? fallbackInitialValues}
      submitLabel={t('parties.form.save')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      isLoading={loading}
      onSubmit={handleSubmit}
    />
  )
}

export function PartyForm({ mode, partyId }: { mode: 'create' | 'edit'; partyId?: string }) {
  if (mode === 'edit') {
    if (!partyId) return null
    return <PartyEditForm partyId={partyId} />
  }
  return <PartyCreateForm />
}

export default PartyForm
