"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { toPartyFormValues, type PartyRecord } from './PartyForm'

const LIST_HREF = '/backend/parties'

function DetailRow({ label, value }: { label: string; value: string | null }) {
  const t = useT()
  return (
    <div className="grid grid-cols-1 gap-1 py-1 sm:grid-cols-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm sm:col-span-2">
        {value && value.trim().length > 0
          ? value
          : <span className="text-muted-foreground">{t('parties.detail.empty')}</span>}
      </dd>
    </div>
  )
}

export default function PartyDetail({ partyId }: { partyId: string }) {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()

  const { data, isLoading, error } = useQuery({
    queryKey: ['parties-detail', partyId, scopeVersion],
    queryFn: async () => {
      const payload = await readApiResultOrThrow<{ item?: Record<string, unknown> }>(
        `/api/parties/${encodeURIComponent(partyId)}`,
        undefined,
        { errorMessage: t('parties.form.loadFailed') },
      )
      return toPartyFormValues(payload.item ?? {})
    },
  })

  if (isLoading) return <LoadingMessage label={t('parties.form.loadFailed')} />

  if (error) {
    const status = (error as { status?: number }).status
    if (status === 404) {
      return <RecordNotFoundState label={t('parties.form.loadFailed')} backHref={LIST_HREF} />
    }
    return <ErrorMessage label={error instanceof Error && error.message ? error.message : t('parties.form.loadFailed')} />
  }

  if (!data) return null
  const party: PartyRecord = data

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold">{party.name}</h1>
                <StatusBadge variant={party.status === 'inactive' ? 'neutral' : 'success'} dot>
                  {party.status === 'inactive'
                    ? t('parties.list.status.inactive')
                    : t('parties.list.status.active')}
                </StatusBadge>
              </div>
              <p className="text-sm text-muted-foreground">{party.code}</p>
            </div>
            <Button asChild>
              <Link href={`${LIST_HREF}/${party.id}/edit`}>{t('parties.actions.edit')}</Link>
            </Button>
          </div>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">{t('parties.detail.section.identity')}</h2>
            <Separator />
            <dl>
              <DetailRow label={t('parties.form.field.code')} value={party.code} />
              <DetailRow label={t('parties.form.field.name')} value={party.name} />
              <DetailRow label={t('parties.form.field.countryCode')} value={party.countryCode} />
              <DetailRow label={t('parties.form.field.status')} value={
                party.status === 'inactive' ? t('parties.list.status.inactive') : t('parties.list.status.active')
              } />
            </dl>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">{t('parties.detail.section.contact')}</h2>
            <Separator />
            <dl>
              <DetailRow label={t('parties.form.field.contactName')} value={party.contactName} />
              <DetailRow label={t('parties.form.field.contactPhone')} value={party.contactPhone} />
              <DetailRow label={t('parties.form.field.email')} value={party.email} />
              <DetailRow label={t('parties.form.field.addressLine1')} value={party.addressLine1} />
              <DetailRow label={t('parties.form.field.addressLine2')} value={party.addressLine2} />
              <DetailRow label={t('parties.form.field.city')} value={party.city} />
            </dl>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">{t('parties.detail.section.roles')}</h2>
            <Separator />
            {party.roles.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('parties.detail.empty')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {party.roles.map((role) => (
                  <span
                    key={role}
                    className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
                  >
                    {t(`parties.form.roles.${role}`)}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">{t('parties.detail.section.bank')}</h2>
            <Separator />
            {party.bankAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('parties.form.bank.empty')}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {party.bankAccounts.map((account) => (
                  <div key={account.id ?? account.accountNumber} className="flex flex-col gap-1 rounded-md border border-border p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{account.beneficiaryBank}</span>
                      {account.isDefault ? (
                        <StatusBadge variant="info" dot>
                          {t('parties.detail.bank.default')}
                        </StatusBadge>
                      ) : null}
                    </div>
                    <dl>
                      <DetailRow label={t('parties.form.bank.accountNumber')} value={account.accountNumber} />
                      <DetailRow label={t('parties.form.bank.swiftCode')} value={account.swiftCode} />
                      <DetailRow label={t('parties.form.bank.bankAddress')} value={account.bankAddress} />
                    </dl>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </PageBody>
    </Page>
  )
}
