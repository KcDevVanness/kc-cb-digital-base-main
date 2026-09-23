"use client"

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
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
import { PRODUCT_VARIANT_STATUSES } from '../data/validators'
import { PRODUCT_VARIANT_FORM_FIELDS, type ProductVariantFormField } from '../lib/variantFields'

/**
 * The SKUs of a product — 编码 / 名称 / 条码 / 默认 / 状态.
 *
 * A child grid rather than five flat fields, for the same reason the price grid is one: a product
 * carries 0..n SKUs, the whole set is submitted with the product and exactly one row may be the
 * default (the one a later stock receipt resolves to when nothing more specific is chosen).
 *
 * The editor is a `CrudForm` custom field: the form still owns validation, the optimistic lock and
 * submission; this component only shapes the array it stores. Which columns exist comes from
 * `lib/variantFields.ts` — the row body is built by iterating that list, so a new column is added in
 * one place and the `Record<ProductVariantFormField, …>` below stops compiling until it is drawn.
 */
export type ProductVariantStatus = (typeof PRODUCT_VARIANT_STATUSES)[number]

export type ProductVariantRowValues = {
  id?: string
  code: string
  name: string
  barcode: string
  status: ProductVariantStatus
  isDefault: boolean
}

const EMPTY_ROW: ProductVariantRowValues = {
  code: '',
  name: '',
  barcode: '',
  status: 'active',
  isDefault: false,
}

function isVariantStatus(value: unknown): value is ProductVariantStatus {
  return typeof value === 'string' && (PRODUCT_VARIANT_STATUSES as readonly string[]).includes(value)
}

export function readVariantRows(value: unknown): ProductVariantRowValues[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>
    return {
      ...(typeof row.id === 'string' && row.id.length > 0 ? { id: row.id } : {}),
      code: typeof row.code === 'string' ? row.code : '',
      name: typeof row.name === 'string' ? row.name : '',
      barcode: typeof row.barcode === 'string' ? row.barcode : '',
      status: isVariantStatus(row.status) ? row.status : 'active',
      isDefault: row.isDefault === true,
    }
  })
}

/**
 * The submitted set.
 *
 * A row the operator opened and left untouched is dropped instead of sent: it has no code and no
 * name, so the API would reject the whole product for a row nobody meant to create. A row that has
 * anything in it is submitted as-is, and the server's validation message is what the operator acts
 * on — silently dropping a half-typed row would hide their input instead.
 */
export function buildProductVariantsPayload(rows: ProductVariantRowValues[]): Array<Record<string, unknown>> {
  return rows
    .filter((row) => row.code.trim().length > 0 || row.name.trim().length > 0)
    .map((row) => ({
      ...(row.id ? { id: row.id } : {}),
      code: row.code.trim(),
      name: row.name.trim(),
      barcode: row.barcode.trim().length > 0 ? row.barcode.trim() : null,
      status: row.status,
      isDefault: row.isDefault === true,
    }))
}

type VariantCellContext = {
  row: ProductVariantRowValues
  index: number
  rowId: (field: ProductVariantFormField) => string
  disabled: boolean
  t: TranslateFn
  onChange: (patch: Partial<ProductVariantRowValues>) => void
}

type VariantCellDefinition = {
  /** Layout for this cell inside the row grid. */
  className: string
  render: (context: VariantCellContext) => React.ReactNode
}

function LabelledInput({
  id,
  label,
  required,
  value,
  disabled,
  onChange,
}: {
  id: string
  label: string
  required?: boolean
  value: string
  disabled: boolean
  onChange: (next: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <Input id={id} size="sm" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

/**
 * One renderer per whitelisted field, keyed by the field id. The exhaustive `Record` is the reason a
 * column cannot be added to `lib/variantFields.ts` without being drawn here: the map would be missing
 * a key and the module would not compile.
 */
const VARIANT_CELLS: Record<ProductVariantFormField, VariantCellDefinition> = {
  code: {
    className: '',
    render: ({ row, rowId, disabled, t, onChange }) => (
      <LabelledInput
        id={rowId('code')}
        label={t('products.variants.field.code')}
        required
        value={row.code}
        disabled={disabled}
        onChange={(code) => onChange({ code })}
      />
    ),
  },
  name: {
    className: '',
    render: ({ row, rowId, disabled, t, onChange }) => (
      <LabelledInput
        id={rowId('name')}
        label={t('products.variants.field.name')}
        required
        value={row.name}
        disabled={disabled}
        onChange={(name) => onChange({ name })}
      />
    ),
  },
  barcode: {
    className: '',
    render: ({ row, rowId, disabled, t, onChange }) => (
      <LabelledInput
        id={rowId('barcode')}
        label={t('products.variants.field.barcode')}
        value={row.barcode}
        disabled={disabled}
        onChange={(barcode) => onChange({ barcode })}
      />
    ),
  },
  status: {
    className: '',
    render: ({ row, rowId, disabled, t, onChange }) => (
      <div className="space-y-1.5">
        <FieldLabel htmlFor={rowId('status')}>{t('products.variants.field.status')}</FieldLabel>
        <Select
          value={row.status}
          disabled={disabled}
          onValueChange={(next) => onChange({ status: isVariantStatus(next) ? next : 'active' })}
        >
          <SelectTrigger id={rowId('status')} className="w-full" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRODUCT_VARIANT_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {t(`products.variants.status.${status}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    ),
  },
  isDefault: {
    className: 'flex items-end',
    render: ({ index, disabled, t }) => (
      <label className="flex items-center gap-2 pb-1 text-sm">
        <Radio
          value={String(index)}
          disabled={disabled}
          aria-label={`${t('products.variants.field.isDefault')} ${index + 1}`}
        />
        {t('products.variants.field.isDefault')}
      </label>
    ),
  },
}

/**
 * The first thing wrong with a row, if anything.
 *
 * The duplicate check exists so the operator sees it while typing instead of after a round trip; the
 * server re-checks both rules (and the code against every SKU of the organization), because a form is
 * not a guarantee.
 */
function variantRowError(row: ProductVariantRowValues, duplicateCodes: Set<string>, t: TranslateFn): string | null {
  const code = row.code.trim()
  const name = row.name.trim()
  // A row the operator opened and has not started is not an error — it is dropped on submit — so the
  // messages below speak only about a row that actually holds something.
  if (code.length === 0 && name.length === 0 && row.barcode.trim().length === 0) return null
  if (code.length > 0 && duplicateCodes.has(code)) {
    return t('products.variants.error.duplicateCode', { code })
  }
  if (code.length === 0) return t('products.variants.error.codeRequired')
  if (name.length === 0) return t('products.variants.error.nameRequired')
  return null
}

export function VariantsEditor({ value, setValue, error, disabled = false }: CrudCustomFieldRenderProps) {
  const t = useT()
  const rows = readVariantRows(value)

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
      setValue(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)))
    },
    [rows, setValue],
  )

  const addRow = React.useCallback(() => {
    // The first SKU of a product is the default one: a receipt with nothing more specific to go on
    // resolves to it, and starting from "none selected" would only add a click on the common path.
    setValue([...rows, { ...EMPTY_ROW, isDefault: rows.length === 0 }])
  }, [rows, setValue])

  const removeRow = React.useCallback(
    (index: number) => {
      // No promotion to default: unlike the bank block this is not a document that needs exactly one.
      // Removing the default row leaves the product without one, which is what the operator asked for.
      setValue(rows.filter((_, position) => position !== index))
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
    <div className="space-y-3">
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t('products.variants.empty')}</p> : null}

      {rows.length > 0 ? (
        <RadioGroup
          value={defaultIndex >= 0 ? String(defaultIndex) : ''}
          onValueChange={(next) => setDefaultRow(Number(next))}
          className="gap-3"
        >
          {rows.map((row, index) => {
            const rowError = variantRowError(row, duplicateCodes, t)
            return (
              <div key={row.id ?? `row-${index}`} className="rounded-md border bg-background p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {`${t('products.variants.rowTitle')} ${index + 1}`}
                  </p>
                  <IconButton
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    aria-label={t('products.variants.remove')}
                    onClick={() => removeRow(index)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </IconButton>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {PRODUCT_VARIANT_FORM_FIELDS.map((field) => (
                    <div key={field} className={VARIANT_CELLS[field].className}>
                      {VARIANT_CELLS[field].render({
                        row,
                        index,
                        rowId: (target) => `product-variant-${index}-${target}`,
                        disabled,
                        t,
                        onChange: (patch) => updateRow(index, patch),
                      })}
                    </div>
                  ))}
                </div>
                {rowError ? <p className="mt-2 text-xs text-destructive">{rowError}</p> : null}
              </div>
            )
          })}
        </RadioGroup>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={addRow}>
          <Plus className="size-4" aria-hidden="true" />
          {t('products.variants.add')}
        </Button>
        <span className="text-xs text-muted-foreground">{t('products.variants.defaultHint')}</span>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

export default VariantsEditor
