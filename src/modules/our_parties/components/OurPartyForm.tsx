"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  CrudForm,
  type CrudField,
  type CrudFieldOption,
  type CrudFormGroup,
} from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { parseOrganizationSwitcherScope } from '../../dictionaries/lib/dictionariesLibraryApi'
import { findOrganizationName, organizationChainEntries } from '@/lib/orgs/organizationOptions'
import { useOrganizationNames } from '@/lib/orgs/useOrganizationNames'
import {
  BankAccountsEditor,
  readBankAccountRows,
  type PartyBankAccountValue,
} from '../../parties/components/BankAccountsEditor'

const API_PATH = 'our_parties/profiles'
const ORGANIZATION_SWITCHER_URL = '/api/directory/organization-switcher'
const LIST_HREF = '/backend/our-parties'
const ORGANIZATION_QUERY_KEY = 'our-parties-chain'
const ORGANIZATION_QUERY_STALE_MS = 60_000

export type OurPartyProfileRecord = {
  id: string
  organizationId: string
  addressLine1: string
  addressLine2: string
  city: string
  countryCode: string
  contactName: string
  contactPhone: string
  email: string
  notes: string
  bankAccounts: PartyBankAccountValue[]
  /** Optimistic-lock version, carried into `CrudForm`'s initial values. */
  updatedAt: string
}

const EMPTY_PROFILE_VALUES: OurPartyFormValues = {
  organizationId: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  countryCode: '',
  contactName: '',
  contactPhone: '',
  email: '',
  notes: '',
  bankAccounts: [],
  updatedAt: '',
}

export type OurPartyFormValues = {
  organizationId: string
  addressLine1: string
  addressLine2: string
  city: string
  countryCode: string
  contactName: string
  contactPhone: string
  email: string
  notes: string
  bankAccounts: PartyBankAccountValue[]
  updatedAt: string
}

const PROFILE_GROUPS: CrudFormGroup[] = [
  { id: 'identity', column: 1, fields: ['organizationId'] },
  { id: 'address', column: 1, fields: ['addressLine1', 'addressLine2', 'city', 'countryCode'] },
  { id: 'contact', column: 2, fields: ['contactName', 'contactPhone', 'email', 'notes'] },
  { id: 'bank', column: 2, fields: ['bankAccounts'] },
]

export function toOurPartyFormValues(item: Record<string, unknown>): OurPartyProfileRecord {
  const updatedAt = item.updatedAt ?? item.updated_at
  return {
    id: String(item.id ?? ''),
    organizationId: String(item.organizationId ?? item.organization_id ?? ''),
    addressLine1: typeof item.addressLine1 === 'string' ? item.addressLine1 : '',
    addressLine2: typeof item.addressLine2 === 'string' ? item.addressLine2 : '',
    city: typeof item.city === 'string' ? item.city : '',
    countryCode: typeof item.countryCode === 'string' ? item.countryCode : '',
    contactName: typeof item.contactName === 'string' ? item.contactName : '',
    contactPhone: typeof item.contactPhone === 'string' ? item.contactPhone : '',
    email: typeof item.email === 'string' ? item.email : '',
    notes: typeof item.notes === 'string' ? item.notes : '',
    bankAccounts: readBankAccountRows(item.bankAccounts),
    updatedAt: typeof updatedAt === 'string' ? updatedAt : '',
  }
}

export function buildOurPartyPayload(values: OurPartyFormValues): Record<string, unknown> {
  const trimmedOrNull = (value: string): string | null => {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  return {
    addressLine1: trimmedOrNull(values.addressLine1),
    addressLine2: trimmedOrNull(values.addressLine2),
    city: trimmedOrNull(values.city),
    countryCode: trimmedOrNull(values.countryCode),
    contactName: trimmedOrNull(values.contactName),
    contactPhone: trimmedOrNull(values.contactPhone),
    email: trimmedOrNull(values.email),
    notes: trimmedOrNull(values.notes),
    bankAccounts: values.bankAccounts.map((row) => ({
      ...(row.id ? { id: row.id } : {}),
      beneficiaryBank: row.beneficiaryBank.trim(),
      accountNumber: row.accountNumber.trim(),
      swiftCode: row.swiftCode.trim().length > 0 ? row.swiftCode.trim() : null,
      bankAddress: row.bankAddress.trim().length > 0 ? row.bankAddress.trim() : null,
      isDefault: row.isDefault === true,
    })),
  }
}

/**
 * The organizations this picker may name — every node the top-bar switcher payload carries
 * (the caller's own company, its ancestors as context and everything below it; see
 * `organizationChainEntries`). Fetched once per scope version, like every other scope-dependent read.
 */
function useOrganizationChain(): { entries: Array<{ id: string; name: string }>; loading: boolean } {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: [ORGANIZATION_QUERY_KEY, scopeVersion],
    staleTime: ORGANIZATION_QUERY_STALE_MS,
    queryFn: async () => {
      const call = await apiCall<Record<string, unknown>>(ORGANIZATION_SWITCHER_URL)
      if (!call.ok) return []
      // The server refuses a subject organization outside the caller's scope, so the write form
      // offers only the nodes the caller may act in (the document picker keeps the full chain).
      return organizationChainEntries(parseOrganizationSwitcherScope(call.result).organizations, {
        selectableOnly: true,
      })
    },
  })
  return { entries: query.data ?? [], loading: query.isLoading }
}

/** Organizations that already own a profile — a second profile for one company is a 409. */
function useTakenOrganizationIds(): Set<string> {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['our-parties-taken-organizations', scopeVersion],
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(API_PATH, { pageSize: 200 })
      return new Set((payload.items ?? []).map((item) => String(item.organizationId ?? '')))
    },
  })
  return query.data ?? new Set<string>()
}

function useOurPartyFields(
  t: TranslateFn,
  mode: 'create' | 'edit',
  organizationOptions: CrudFieldOption[],
  organizationLabel: string,
): CrudField[] {
  return React.useMemo<CrudField[]>(
    () => [
      mode === 'create'
        ? {
            id: 'organizationId',
            label: t('our_parties.form.organization'),
            type: 'select',
            required: true,
            layout: 'half',
            description: t('our_parties.form.organizationHelp'),
            options: organizationOptions,
          }
        : {
            id: 'organizationId',
            label: t('our_parties.form.organization'),
            type: 'text',
            layout: 'half',
            disabled: true,
            description: t('our_parties.form.organizationImmutable'),
            defaultValue: organizationLabel,
          },
      {
        id: 'addressLine1',
        label: t('our_parties.form.addressLine1'),
        type: 'text',
        layout: 'half',
      },
      { id: 'addressLine2', label: t('our_parties.form.addressLine2'), type: 'text', layout: 'half' },
      { id: 'city', label: t('our_parties.form.city'), type: 'text', layout: 'half' },
      {
        id: 'countryCode',
        label: t('our_parties.form.countryCode'),
        type: 'text',
        layout: 'half',
        description: t('our_parties.form.countryCodeHelp'),
      },
      { id: 'contactName', label: t('our_parties.form.contactName'), type: 'text', layout: 'half' },
      { id: 'contactPhone', label: t('our_parties.form.contactPhone'), type: 'text', layout: 'half' },
      { id: 'email', label: t('our_parties.form.email'), type: 'text', layout: 'half' },
      { id: 'notes', label: t('our_parties.form.notes'), type: 'textarea', layout: 'full' },
      {
        id: 'bankAccounts',
        label: t('our_parties.form.bankAccounts'),
        type: 'custom',
        layout: 'full',
        description: t('our_parties.form.bankAccountsHelp'),
        component: BankAccountsEditor,
      },
    ],
    [mode, organizationLabel, organizationOptions, t],
  )
}

export function OurPartyCreateForm() {
  const t = useT()
  const { entries, loading } = useOrganizationChain()
  const taken = useTakenOrganizationIds()
  const options = React.useMemo<CrudFieldOption[]>(
    () =>
      entries
        .filter((entry) => !taken.has(entry.id))
        .map((entry) => ({ value: entry.id, label: entry.name })),
    [entries, taken],
  )
  const fields = useOurPartyFields(t, 'create', options, '')

  const handleSubmit = React.useCallback(
    async (values: OurPartyFormValues) => {
      try {
        await createCrud(API_PATH, { organizationId: values.organizationId, ...buildOurPartyPayload(values) })
      } catch (error) {
        flash(t('our_parties.form.saveFailed'), 'error')
        throw error
      }
    },
    [t],
  )

  return (
    <CrudForm<OurPartyFormValues>
      title={t('our_parties.form.createTitle')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      fields={fields}
      groups={PROFILE_GROUPS}
      initialValues={EMPTY_PROFILE_VALUES}
      submitLabel={t('our_parties.form.save')}
      cancelHref={LIST_HREF}
      successRedirect={LIST_HREF}
      onSubmit={handleSubmit}
      isLoading={loading}
    />
  )
}

/** The detail route returns the aggregate (bank block), which the factory list cannot. */
async function fetchProfile(id: string, errorMessage: string): Promise<OurPartyProfileRecord> {
  const payload = await readApiResultOrThrow<{ item?: Record<string, unknown> }>(
    `/api/${API_PATH}/${encodeURIComponent(id)}`,
    undefined,
    { errorMessage },
  )
  return toOurPartyFormValues(payload.item ?? {})
}

export function OurPartyEditForm({ profileId }: { profileId: string }) {
  const t = useT()
  const organizationNames = useOrganizationNames()
  const [initial, setInitial] = React.useState<OurPartyProfileRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const profile = await fetchProfile(profileId, t('our_parties.form.loadFailed'))
        if (!cancelled) setInitial(profile)
      } catch (loadError: unknown) {
        if (!cancelled) {
          if ((loadError as { status?: number }).status === 404) {
            setIsNotFound(true)
          } else {
            setError(t('our_parties.form.loadFailed'))
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
  }, [profileId, t])

  const organizationLabel = organizationNames(initial?.organizationId) ?? initial?.organizationId ?? ''
  const fields = useOurPartyFields(t, 'edit', [], organizationLabel)

  const handleSubmit = React.useCallback(
    async (values: OurPartyFormValues) => {
      if (!initial) return
      try {
        await updateCrud(API_PATH, {
          id: initial.id,
          updatedAt: initial.updatedAt,
          ...buildOurPartyPayload(values),
        })
      } catch (error) {
        flash(t('our_parties.form.saveFailed'), 'error')
        throw error
      }
    },
    [initial, t],
  )

  if (loading) return <LoadingMessage label={t('our_parties.form.loading')} />
  if (isNotFound) return <RecordNotFoundState label={t('our_parties.form.loadFailed')} backHref={LIST_HREF} />
  if (error || !initial) return <ErrorMessage label={error ?? t('our_parties.form.loadFailed')} />

  return (
    <CrudForm<OurPartyFormValues>
      title={organizationLabel || t('our_parties.form.editTitle')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      fields={fields}
      groups={PROFILE_GROUPS}
      initialValues={{ ...initial }}
      submitLabel={t('our_parties.form.save')}
      cancelHref={LIST_HREF}
      successRedirect={LIST_HREF}
      onSubmit={handleSubmit}
    />
  )
}
