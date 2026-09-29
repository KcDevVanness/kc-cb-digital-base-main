"use client"

import * as React from 'react'
import { Plus } from 'lucide-react'
import type { CrudFormGroupComponentProps } from '@open-mercato/ui/backend/CrudForm'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { Button } from '@open-mercato/ui/primitives/button'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { COUNTERPARTY_KIND_BY_DIRECTION, COUNTERPARTY_KIND_BY_INVOICE_DIRECTION } from '../data/validators'
import {
  loadCounterpartyDetail,
  loadCustomerCounterpartyOptions,
  loadSupplierCounterpartyOptions,
  type CounterpartyDetail,
} from './formOptions'
import { CustomerQuickCreateDialog } from './CustomerQuickCreateDialog'

/**
 * The counterparty picker of every trade document.
 *
 * A bare group rather than a `CrudField`, because the field contract passes no sibling values to an
 * option loader: the direction decides the namespace (`purchase ⇒ supplier`, `sales ⇒ customer`;
 * an invoice's `inbound`/`outbound`), the options come from exactly that namespace, and switching the
 * direction clears the picked counterparty and its printed block — the two namespaces must not mix.
 *
 * Picking a record fills the printed head (name/address/contact) and offers its bank accounts
 * (default first) from the owning module's own detail route, so the paper and the master agree; the
 * four text fields stay editable afterwards for documents that predate the master data.
 */
export type CounterpartyPickerProps = CrudFormGroupComponentProps & {
  t: TranslateFn
  /** Which direction vocabulary the sibling `direction` field speaks. */
  directionKind: 'trade' | 'invoice'
  /** Invoices print a name only, so they hide the bank-account selector. */
  showBankAccount?: boolean
  idPrefix?: string
}

const KIND_BY_DIRECTION = {
  trade: COUNTERPARTY_KIND_BY_DIRECTION,
  invoice: COUNTERPARTY_KIND_BY_INVOICE_DIRECTION,
} as const

function bankAccountLabel(account: CounterpartyDetail['bankAccounts'][number]): string {
  const label = [account.beneficiaryBank, account.accountNumber].filter((part) => part.length > 0).join(' — ')
  return account.isDefault ? `${label} ★` : label
}

export function CounterpartyPicker({
  values,
  setValue,
  t,
  directionKind,
  showBankAccount = true,
  idPrefix = 'counterparty',
}: CounterpartyPickerProps) {
  const { organizationId } = useOrganizationScopeDetail()
  const { payload: chromePayload, isReady: chromeReady } = useBackendChrome()
  const canCreateCustomer = !chromeReady || hasFeature(chromePayload?.grantedFeatures, 'parties.manage')

  const direction = typeof values.direction === 'string' ? values.direction : ''
  const kindByDirection = KIND_BY_DIRECTION[directionKind] as Record<string, 'supplier' | 'customer'>
  const kind = kindByDirection[direction] ?? (directionKind === 'invoice' ? 'supplier' : 'customer')

  const counterpartyId = typeof values.counterpartyId === 'string' ? values.counterpartyId : ''
  const storedName = typeof values.counterpartyName === 'string' ? values.counterpartyName : ''
  const bankAccountId = typeof values.counterpartyBankAccountId === 'string' ? values.counterpartyBankAccountId : ''
  const bankText = typeof values.counterpartyBank === 'string' ? values.counterpartyBank : ''

  const [createOpen, setCreateOpen] = React.useState(false)
  /** Accounts of the last loaded counterparty, so switching accounts needs no second request. */
  const accountsRef = React.useRef<CounterpartyDetail['bankAccounts']>([])
  /** Latest values for the post-await guards — `setValue` has no functional form. */
  const valuesRef = React.useRef(values)
  valuesRef.current = values

  const applyBankAccount = React.useCallback(
    (account: CounterpartyDetail['bankAccounts'][number]) => {
      setValue('counterpartyBankAccountId', account.id)
      setValue(
        'counterpartyBank',
        [account.beneficiaryBank, account.accountNumber, account.swiftCode].filter((part) => part.length > 0).join(' '),
      )
    },
    [setValue],
  )

  const applyDetail = React.useCallback(
    (detail: CounterpartyDetail) => {
      accountsRef.current = detail.bankAccounts
      setValue('counterpartyName', detail.name)
      setValue('counterpartyAddress', detail.address)
      setValue('counterpartyContact', detail.contact)
      const preferred = detail.bankAccounts.find((account) => account.isDefault) ?? detail.bankAccounts[0]
      if (preferred) {
        applyBankAccount(preferred)
        return
      }
      // No account on the master: the printed bank line stays as typed.
      setValue('counterpartyBankAccountId', '')
    },
    [applyBankAccount, setValue],
  )

  const resolveCounterparty = React.useCallback(
    (nextId: string) => {
      void loadCounterpartyDetail(t('trade_docs.counterparty.picker.loadFailed'), kind, nextId)
        .then((detail) => {
          if (!detail) return
          // The pick may have moved on while the detail was in flight; only fill for the current one.
          if (valuesRef.current.counterpartyId !== nextId) return
          applyDetail(detail)
        })
        .catch(() => undefined)
    },
    [applyDetail, kind, t],
  )

  const handleCounterpartyChange = React.useCallback(
    (nextId: string) => {
      const currentId = typeof valuesRef.current.counterpartyId === 'string' ? valuesRef.current.counterpartyId : ''
      // `ComboboxInput` re-fires for the same value after resolving a label: that must not reset the
      // fields the operator may already have edited (see the combobox lesson).
      if (nextId === currentId) return
      setValue('counterpartyId', nextId)
      if (!nextId) {
        accountsRef.current = []
        setValue('counterpartyBankAccountId', '')
        setValue('counterpartyBank', '')
        return
      }
      resolveCounterparty(nextId)
    },
    [resolveCounterparty, setValue],
  )

  const handleBankAccountChange = React.useCallback(
    (nextId: string) => {
      setValue('counterpartyBankAccountId', nextId)
      if (!nextId) return
      const cached = accountsRef.current.find((account) => account.id === nextId)
      if (cached) {
        applyBankAccount(cached)
        return
      }
      const currentId = typeof valuesRef.current.counterpartyId === 'string' ? valuesRef.current.counterpartyId : ''
      if (!currentId) return
      void loadCounterpartyDetail(t('trade_docs.counterparty.picker.loadFailed'), kind, currentId)
        .then((detail) => {
          accountsRef.current = detail?.bankAccounts ?? []
          const account = accountsRef.current.find((row) => row.id === nextId)
          if (account) applyBankAccount(account)
        })
        .catch(() => undefined)
    },
    [applyBankAccount, kind, setValue, t],
  )

  // A direction switch changes the namespace, so the picked id and its printed block cannot carry
  // over; the initial mount is skipped so an edit keeps the stored values.
  const previousKind = React.useRef(kind)
  React.useEffect(() => {
    if (previousKind.current === kind) return
    previousKind.current = kind
    accountsRef.current = []
    setValue('counterpartyId', '')
    setValue('counterpartyBankAccountId', '')
    setValue('counterpartyName', '')
    setValue('counterpartyAddress', '')
    setValue('counterpartyContact', '')
    setValue('counterpartyBank', '')
  }, [kind, setValue])

  const seedOptions = React.useMemo<ComboboxOption[] | undefined>(
    // A stored id stays visible even when the current filter cannot resolve it (deleted master row,
    // narrowed organization, legacy kind); the snapshot name keeps the control readable on edit.
    () => (counterpartyId && storedName ? [{ value: counterpartyId, label: storedName }] : undefined),
    [counterpartyId, storedName],
  )
  const bankSeedOptions = React.useMemo<ComboboxOption[] | undefined>(
    () => (bankAccountId ? [{ value: bankAccountId, label: bankText || bankAccountId }] : undefined),
    [bankAccountId, bankText],
  )

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <FieldLabel htmlFor={`${idPrefix}-id`}>{t('trade_docs.counterparty.picker.label')}</FieldLabel>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <ComboboxInput
              value={counterpartyId}
              onChange={handleCounterpartyChange}
              placeholder={
                kind === 'supplier'
                  ? t('trade_docs.counterparty.picker.selectSupplier')
                  : t('trade_docs.counterparty.picker.selectCustomer')
              }
              seedOptions={seedOptions}
              loadSuggestions={async (query) => {
                const errorMessage = t('trade_docs.counterparty.picker.loadFailed')
                if (kind === 'supplier') {
                  const suppliers = await loadSupplierCounterpartyOptions(errorMessage, query, organizationId)
                  return suppliers.map((option) => ({ value: option.value, label: option.label }))
                }
                const customers = await loadCustomerCounterpartyOptions(errorMessage, query, organizationId)
                return customers.map<ComboboxOption>((option) => ({
                  value: option.value,
                  // The sale side merges two sources (a group branch's print record and an external
                  // customer), so the source leads the label; the supplier list has one source only.
                  label: option.roles.includes('branch')
                    ? `${t('trade_docs.counterparty.picker.branch')}: ${option.label}`
                    : `${t('trade_docs.counterparty.picker.customer')}: ${option.label}`,
                }))
              }}
              allowCustomValues={false}
              clearable
            />
          </div>
          {kind === 'customer' && canCreateCustomer ? (
            <Button type="button" variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {t('trade_docs.counterparty.picker.create')}
            </Button>
          ) : null}
        </div>
        {kind === 'customer' && !canCreateCustomer ? (
          <p className="text-xs text-muted-foreground">{t('trade_docs.counterparty.picker.createHint')}</p>
        ) : null}
      </div>

      {showBankAccount ? (
        <div className="space-y-1.5">
          <FieldLabel htmlFor={`${idPrefix}-bank-account`}>
            {t('trade_docs.counterparty.picker.bankAccount')}
          </FieldLabel>
          <ComboboxInput
            value={bankAccountId}
            onChange={handleBankAccountChange}
            disabled={!counterpartyId}
            placeholder={t('trade_docs.counterparty.picker.bankAccountSelect')}
            seedOptions={bankSeedOptions}
            loadSuggestions={async (query) => {
              const term = query?.trim().toLowerCase() ?? ''
              return accountsRef.current
                .filter((account) => (term.length > 0 ? bankAccountLabel(account).toLowerCase().includes(term) : true))
                .map<ComboboxOption>((account) => ({ value: account.id, label: bankAccountLabel(account) }))
            }}
            allowCustomValues={false}
            clearable
          />
        </div>
      ) : null}

      <CustomerQuickCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(partyId) => {
          // The new record may not be in the picker's option list yet; resolving its detail both
          // selects it and fills the printed block.
          setValue('counterpartyId', partyId)
          resolveCounterparty(partyId)
        }}
      />
    </div>
  )
}
