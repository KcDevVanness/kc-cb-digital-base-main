"use client"

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Radio, RadioGroup } from '@open-mercato/ui/primitives/radio'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * The bank block of a party: 银行 (Beneficiary Bank), 银行账号 (Beneficiary Number), SWIFT CODE and
 * 银行地址 (Bank add).
 *
 * A child grid rather than four flat fields because buyers change banks, and exactly one row is the
 * default — the account documents print. The editor is a `CrudForm` custom field: the form still owns
 * validation and submission, this component only shapes the array it stores.
 */
export type PartyBankAccountValue = {
  id?: string
  beneficiaryBank: string
  accountNumber: string
  swiftCode: string
  bankAddress: string
  isDefault: boolean
}

const EMPTY_ROW: PartyBankAccountValue = {
  beneficiaryBank: '',
  accountNumber: '',
  swiftCode: '',
  bankAddress: '',
  isDefault: false,
}

/** Normalizes whatever `CrudForm` holds for this field into editable rows. */
export function readBankAccountRows(value: unknown): PartyBankAccountValue[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>
    return {
      id: typeof row.id === 'string' && row.id.length > 0 ? row.id : undefined,
      beneficiaryBank: typeof row.beneficiaryBank === 'string' ? row.beneficiaryBank : '',
      accountNumber: typeof row.accountNumber === 'string' ? row.accountNumber : '',
      swiftCode: typeof row.swiftCode === 'string' ? row.swiftCode : '',
      bankAddress: typeof row.bankAddress === 'string' ? row.bankAddress : '',
      isDefault: row.isDefault === true,
    }
  })
}

export function BankAccountsEditor({ value, setValue, error, disabled }: CrudCustomFieldRenderProps) {
  const t = useT()
  const rows = readBankAccountRows(value)

  const updateRow = React.useCallback(
    (index: number, patch: Partial<PartyBankAccountValue>) => {
      setValue(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)))
    },
    [rows, setValue],
  )

  const addRow = React.useCallback(() => {
    // The first row added is the default: documents need one, and starting from "none selected"
    // forces an extra click on the common path.
    setValue([...rows, { ...EMPTY_ROW, isDefault: rows.length === 0 }])
  }, [rows, setValue])

  const removeRow = React.useCallback(
    (index: number) => {
      const next = rows.filter((_, position) => position !== index)
      const hasDefault = next.some((row) => row.isDefault)
      setValue(hasDefault || next.length === 0 ? next : [{ ...next[0], isDefault: true }, ...next.slice(1)])
    },
    [rows, setValue],
  )

  const setDefaultRow = React.useCallback(
    (index: number) => {
      setValue(rows.map((row, position) => ({ ...row, isDefault: position === index })))
    },
    [rows, setValue],
  )

  const defaultIndex = rows.findIndex((row) => row.isDefault)

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('parties.form.bank.empty')}</p>
      ) : (
        <RadioGroup
          value={defaultIndex >= 0 ? String(defaultIndex) : ''}
          onValueChange={(next) => setDefaultRow(Number(next))}
          className="gap-3"
        >
          {rows.map((row, index) => (
            <div
              key={row.id ?? `row-${index}`}
              className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
            >
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t('parties.form.bank.beneficiaryBank')}
                <Input
                  size="sm"
                  value={row.beneficiaryBank}
                  disabled={disabled}
                  onChange={(event) => updateRow(index, { beneficiaryBank: event.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t('parties.form.bank.accountNumber')}
                <Input
                  size="sm"
                  value={row.accountNumber}
                  disabled={disabled}
                  onChange={(event) => updateRow(index, { accountNumber: event.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t('parties.form.bank.swiftCode')}
                <Input
                  size="sm"
                  value={row.swiftCode}
                  disabled={disabled}
                  onChange={(event) => updateRow(index, { swiftCode: event.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t('parties.form.bank.bankAddress')}
                <Input
                  size="sm"
                  value={row.bankAddress}
                  disabled={disabled}
                  onChange={(event) => updateRow(index, { bankAddress: event.target.value })}
                />
              </label>
              <div className="flex items-center justify-between gap-2 sm:col-span-2">
                <label className="flex items-center gap-2 text-sm">
                  <Radio
                    value={String(index)}
                    disabled={disabled}
                    aria-label={`${t('parties.form.bank.isDefault')} ${index + 1}`}
                  />
                  {t('parties.form.bank.isDefault')}
                </label>
                <IconButton
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  aria-label={t('parties.form.bank.remove')}
                  onClick={() => removeRow(index)}
                >
                  <Trash2 aria-hidden="true" />
                </IconButton>
              </div>
            </div>
          ))}
        </RadioGroup>
      )}
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={addRow}>
          <Plus className="size-4" aria-hidden="true" />
          {t('parties.form.bank.add')}
        </Button>
        <span className="text-xs text-muted-foreground">{t('parties.form.bank.defaultHint')}</span>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
