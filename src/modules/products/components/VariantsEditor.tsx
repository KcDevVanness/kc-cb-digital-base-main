"use client"

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { CrudFormGroupComponentProps } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Radio, RadioGroup } from '@open-mercato/ui/primitives/radio'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { PRODUCT_STATUSES, readVariantRows, type ProductVariantRowValues } from './productFormValues'

/**
 * The SKUs of a product — 编码 / 名称 / 条码 / 默认 / 状态.
 *
 * A child grid rather than five flat fields: a product carries 0..n SKUs, the whole set is submitted
 * with the product and exactly one row may be the default (what a later stock receipt resolves to
 * when nothing more specific is chosen). The group component only shapes the array it stores;
 * `CrudForm` still owns validation, the optimistic lock and submission.
 */

const EMPTY_ROW: ProductVariantRowValues = {
  code: '',
  name: '',
  barcode: '',
  status: 'active',
  isDefault: false,
}

function isVariantStatus(value: unknown): value is (typeof PRODUCT_STATUSES)[number] {
  return typeof value === 'string' && (PRODUCT_STATUSES as readonly string[]).includes(value)
}

/**
 * The first thing wrong with a row, if anything.
 *
 * The duplicate check exists so the operator sees it while typing instead of after a round trip; the
 * server re-checks both rules, because a form is not a guarantee.
 */
function variantRowError(row: ProductVariantRowValues, duplicateCodes: Set<string>, t: TranslateFn): string | null {
  const code = row.code.trim()
  const name = row.name.trim()
  // A row the operator opened and left untouched is not an error — it is dropped on submit.
  if (code.length === 0 && name.length === 0 && row.barcode.trim().length === 0) return null
  if (code.length > 0 && duplicateCodes.has(code)) return t('products.variants.error.duplicateCode', { code })
  if (code.length === 0) return t('products.variants.error.codeRequired')
  if (name.length === 0) return t('products.variants.error.nameRequired')
  return null
}

export default function VariantsEditor({ values, setValue, errors }: CrudFormGroupComponentProps) {
  const t = useT()
  const rows = readVariantRows(values.variants)
  const sectionError = errors.variants

  const duplicateCodes = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      const code = row.code.trim()
      if (code.length === 0) continue
      counts.set(code, (counts.get(code) ?? 0) + 1)
    }
    return new Set([...counts].filter(([, count]) => count > 1).map(([code]) => code))
  }, [rows])

  const updateRow = React.useCallback(
    (index: number, patch: Partial<ProductVariantRowValues>) => {
      setValue('variants', rows.map((row, position) => (position === index ? { ...row, ...patch } : row)))
    },
    [rows, setValue],
  )

  const addRow = React.useCallback(() => {
    // The first SKU of a product is the default one: a receipt with nothing more specific to go on
    // resolves to it, and starting from "none selected" would only add a click on the common path.
    setValue('variants', [...rows, { ...EMPTY_ROW, isDefault: rows.length === 0 }])
  }, [rows, setValue])

  const removeRow = React.useCallback(
    (index: number) => {
      // No promotion to default: removing the default row leaves the product without one, which is
      // what the operator asked for.
      setValue('variants', rows.filter((_, position) => position !== index))
    },
    [rows, setValue],
  )

  const setDefaultRow = React.useCallback(
    (index: number) => {
      setValue('variants', rows.map((row, position) => ({ ...row, isDefault: position === index })))
    },
    [rows, setValue],
  )

  const defaultIndex = rows.findIndex((row) => row.isDefault)

  return (
    <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{t('products.variants.title', 'Variants / SKU')}</h3>
          <p className="max-w-prose text-xs text-muted-foreground">
            {t(
              'products.variants.description',
              'The sellable units of this product. A code is unique inside the organization (soft-deleted SKUs keep theirs) and the default variant is what a stock receipt books against when nothing more specific is chosen.',
            )}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={addRow}>
          <Plus className="size-4" aria-hidden="true" />
          {t('products.variants.add', 'Add SKU')}
        </Button>
      </div>

      {sectionError ? (
        <p className="text-xs text-status-error-text" role="alert">
          {sectionError}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('products.variants.empty', 'No SKUs yet.')}</p>
      ) : (
        <RadioGroup
          value={defaultIndex >= 0 ? String(defaultIndex) : ''}
          onValueChange={(next) => setDefaultRow(Number(next))}
          className="gap-3"
        >
          {rows.map((row, index) => {
            const rowError = variantRowError(row, duplicateCodes, t)
            const rowId = (suffix: string) => `product-variant-${row.id ?? index}-${suffix}`
            return (
              <div key={row.id ?? `row-${index}`} className="rounded-md border bg-background p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {`${t('products.variants.rowTitle', 'SKU')} ${index + 1}`}
                  </p>
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="lg"
                    aria-label={t('products.variants.remove', 'Remove this SKU')}
                    onClick={() => removeRow(index)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </IconButton>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12">
                  <div className="space-y-1.5 lg:col-span-3">
                    <FieldLabel htmlFor={rowId('code')} required>
                      {t('products.variants.field.code', 'Code')}
                    </FieldLabel>
                    <Input
                      id={rowId('code')}
                      size="sm"
                      value={row.code}
                      onChange={(event) => updateRow(index, { code: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5 lg:col-span-4">
                    <FieldLabel htmlFor={rowId('name')} required>
                      {t('products.variants.field.name', 'Name')}
                    </FieldLabel>
                    <Input
                      id={rowId('name')}
                      size="sm"
                      value={row.name}
                      onChange={(event) => updateRow(index, { name: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5 lg:col-span-2">
                    <FieldLabel htmlFor={rowId('barcode')}>{t('products.variants.field.barcode', 'Barcode')}</FieldLabel>
                    <Input
                      id={rowId('barcode')}
                      size="sm"
                      value={row.barcode}
                      onChange={(event) => updateRow(index, { barcode: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5 lg:col-span-2">
                    <FieldLabel htmlFor={rowId('status')}>{t('products.variants.field.status', 'Status')}</FieldLabel>
                    <Select
                      value={row.status}
                      onValueChange={(next) => updateRow(index, { status: isVariantStatus(next) ? next : 'active' })}
                    >
                      <SelectTrigger id={rowId('status')} className="w-full" size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRODUCT_STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>
                            {t(`products.variants.status.${status}`, status)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end lg:col-span-1">
                    <label className="flex items-center gap-2 pb-1 text-sm">
                      <Radio
                        value={String(index)}
                        aria-label={`${t('products.variants.field.isDefault', 'Default')} ${index + 1}`}
                      />
                      {t('products.variants.field.isDefault', 'Default')}
                    </label>
                  </div>
                </div>
                {rowError ? (
                  <p className="mt-2 text-xs text-status-error-text" role="alert">
                    {rowError}
                  </p>
                ) : null}
              </div>
            )
          })}
        </RadioGroup>
      )}

      <p className="text-xs text-muted-foreground">
        {t('products.variants.defaultHint', 'At most one SKU can be the default; leaving none selected is fine.')}
      </p>
    </div>
  )
}
