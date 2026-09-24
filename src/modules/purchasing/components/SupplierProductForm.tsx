"use client"

import * as React from 'react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { Trash2, Upload } from 'lucide-react'
import {
  CrudForm,
  type CrudField,
  type CrudFieldOption,
  type CrudFormGroup,
  type CrudFormGroupComponentProps,
} from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { Button } from '@open-mercato/ui/primitives/button'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
// The unit vocabulary is seeded by this module and read through the app's one client loader; the
// currency picker is this module's own loader (the same one the supplier and order forms use).
import { loadUnitOptions } from '../../products/lib/unitOptions'
import { loadCodeListOptions } from '../lib/codeListOptions'
import { PRODUCT_BRAND_DICTIONARY_KEY } from '../../product_codes/lib/dictionaryValues'
import SupplierProductCodePanel from './SupplierProductCodePanel'
import { loadCurrencyOptions } from './PurchaseOrderForm'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import { netUnitPrice, type SupplierProductPriceKind } from '../lib/priceKinds'

const API_PATH = 'purchasing/supplier-products'
const PRICES_API_PATH = 'purchasing/supplier-products/prices'
const SUPPLIERS_API_PATH = 'purchasing/suppliers'
const LIST_HREF = '/backend/purchasing/supplier-products'
const ENTITY_ID = 'purchasing:purchasing_supplier_product'
/** The attachments module keys files by this entity id + the row id (create-then-bind). */
const ATTACHMENT_ENTITY_ID = 'purchasing:purchasing_supplier_product'
/** The API caps a library row's photo list at 12; the uploader stops there instead of failing. */
const MAX_IMAGES = 12

import {
  buildSupplierProductPayload,
  buildSupplierProductPriceRowsPayload,
  createEmptyPriceRow,
  EMPTY_VALUES,
  readImageIds,
  readPacking,
  splitSupplierProductPriceRows,
  toProductPriceRowValues,
  toSupplierProductFormValues,
  type PackingValues,
  type SupplierProductFormValues,
  type SupplierProductPriceRowValues,
} from '../lib/supplierProductFormValues'
/**
 * CrudForm swallows a loader rejection, so a picker that cannot load would go blank with no
 * explanation; the failure is surfaced as a flash instead (silent for 401/403, where the page
 * itself already reports the permission problem).
 */
function reportSupplierLoadFailure(errorMessage: string, status: number | null): CrudFieldOption[] {
  if (status !== 401 && status !== 403) flash(errorMessage, 'error')
  return []
}

async function loadSupplierOptions(errorMessage: string): Promise<CrudFieldOption[]> {
  try {
    const payload = await fetchCrudList<Record<string, unknown>>(SUPPLIERS_API_PATH, {
      // 100 is the supplier list's `pageSize` cap — a larger value answers 400, not a bigger page.
      pageSize: 100,
      sortField: 'name',
      sortDir: 'asc',
      isActive: true,
    })
    return (payload.items ?? [])
      .map((item) => {
        const value = String(item.id ?? '')
        if (!value) return null
        const name = typeof item.name === 'string' && item.name.length > 0 ? item.name : String(item.code ?? '')
        const code = typeof item.code === 'string' ? item.code : ''
        return { value, label: code ? `${code} — ${name}` : name }
      })
      .filter((option): option is CrudFieldOption => option !== null)
  } catch (error) {
    const status = typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : null
    return reportSupplierLoadFailure(errorMessage, status)
  }
}

function priceKindLabel(t: TranslateFn, kind: SupplierProductPriceKind): string {
  return kind === 'supplier_cost'
    ? t('purchasing.supplierProducts.price.kind.supplierCost', 'Supplier supply price')
    : t('purchasing.supplierProducts.price.kind.companyOffer', 'Our offer')
}

/**
 * The price rows' currency picker: this module's own dictionary loader (the same one the supplier
 * and order forms use), so all three list the seeded dictionary with this module's message.
 */
function useCurrencyOptions(t: TranslateFn): CrudFieldOption[] {
  const [options, setOptions] = React.useState<CrudFieldOption[]>([])
  React.useEffect(() => {
    let cancelled = false
    const failureMessage = t('purchasing.supplierProducts.form.currencyLoadFailed', 'Currencies could not be loaded')
    loadCurrencyOptions(failureMessage)
      .then((next) => {
        if (!cancelled) setOptions(next)
      })
      .catch(() => {
        if (!cancelled) flash(failureMessage, 'error')
      })
    return () => {
      cancelled = true
    }
  }, [t])
  return options
}

/**
 * The item's 供货价 — one price, one currency — plus the rows the form no longer maintains.
 *
 * The stored set keeps the table's generality (`kind × currency × minimum quantity`, REQ-SPL-013):
 * another currency, a ladder step or a withdrawn price can exist as a row. The business quotes one
 * price per supplier item, so the form edits exactly the **base** row the list column and the
 * promotion resolve (`lib/priceKinds.ts` `pickBasePriceRow`, REQ-SPL-025) and shows everything else
 * read-only, submitted back untouched so a save never rewrites history. Clearing the amount
 * withdraws the price: the row is deactivated, never deleted, and comes back below as a withdrawn
 * row.
 */
function SupplierProductPriceGroup({ values, setValue, errors, t }: CrudFormGroupComponentProps & { t: TranslateFn }) {
  const rows = React.useMemo(
    () => (Array.isArray(values.prices) ? (values.prices as SupplierProductPriceRowValues[]) : []),
    [values.prices],
  )
  const { primary, extras } = React.useMemo(() => splitSupplierProductPriceRows(rows), [rows])
  const dictionaryOptions = useCurrencyOptions(t)
  const priceError = Object.keys(errors).find((key) => key === 'prices' || key.startsWith('prices.') || key.startsWith('rows.'))

  // A currency already on a row survives even when the dictionary does not offer it, so opening a
  // record can never silently blank its currency.
  const currencyOptions = React.useMemo<CrudFieldOption[]>(() => {
    const merged = new Map<string, CrudFieldOption>(
      dictionaryOptions.map((option): [string, CrudFieldOption] => [option.value, option]),
    )
    for (const row of rows) {
      const code = row.currencyCode.trim().toUpperCase()
      if (code && !merged.has(code)) merged.set(code, { value: code, label: code })
    }
    return [...merged.values()].sort((left, right) => left.value.localeCompare(right.value))
  }, [dictionaryOptions, rows])

  const currencyCode = (primary?.currencyCode ?? 'CNY').trim().toUpperCase()
  const unitPrice = primary?.unitPrice ?? ''
  /**
   * The trigger renders this label itself rather than letting the select mirror the chosen item:
   * the dictionary arrives after the field is on screen, and a value that mounts before its item
   * would otherwise leave the box looking unset on a brand-new record.
   */
  const currencyLabel =
    currencyOptions.find((option) => option.value === currencyCode)?.label ?? (currencyCode || 'CNY')

  // The field writes the primary row, or starts one on the base identity when the item has none yet:
  // a row with no amount is dropped from the payload, so typing a currency alone creates nothing.
  const patchPrimary = React.useCallback(
    (patch: Partial<SupplierProductPriceRowValues>) => {
      if (primary) {
        setValue(
          'prices',
          rows.map((row) => (row === primary ? { ...row, ...patch } : row)),
        )
        return
      }
      setValue('prices', [...rows, { ...createEmptyPriceRow(), ...patch }])
    },
    [primary, rows, setValue],
  )

  // The group component's `values` is loosely typed, and CrudForm's number field yields a number once
  // edited — the same tolerance the other numeric fields here apply.
  const rawDiscount = values.discountPercent
  const discountText = typeof rawDiscount === 'number' ? String(rawDiscount) : typeof rawDiscount === 'string' ? rawDiscount : ''
  const discountError = errors.discountPercent
  const discountId = 'supplier-product-price-discount'
  const discountHelpId = `${discountId}-help`
  const discountValue = Number.parseFloat(discountText.trim())
  const hasDiscount = Number.isFinite(discountValue) && discountValue > 0

  const currencyId = 'supplier-product-price-currency'
  const unitPriceId = 'supplier-product-price-unit-price'
  const unitPriceHelpId = `${unitPriceId}-help`

  return (
    <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
      <div>
        <h3 className="text-sm font-medium">{t('purchasing.supplierProducts.price.title', 'Prices')}</h3>
        <p className="text-xs text-muted-foreground">
          {t(
            'purchasing.supplierProducts.price.hint',
            'One supply price per item: what the supplier charges us, in its own currency. The discount below is the supplier’s rate for this item and the net amount is derived. Our own offer is maintained on the product record (internal settlement price). Clearing the amount withdraws the price — it is deactivated, never deleted.',
          )}
        </p>
      </div>

      {priceError ? (
        <p className="text-xs text-status-error-text" role="alert">
          {errors[priceError]}
        </p>
      ) : null}

      <div className="@container">
        <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-12">
          <div className="col-span-2 space-y-1.5 @md:col-span-1 @3xl:col-span-3">
            <FieldLabel htmlFor={currencyId}>{t('purchasing.supplierProducts.price.field.currency', 'Currency')}</FieldLabel>
            <Select
              value={currencyCode || undefined}
              onValueChange={(next) => patchPrimary({ currencyCode: next })}
            >
              <SelectTrigger id={currencyId} className="w-full">
                <SelectValue placeholder={t('purchasing.supplierProducts.price.field.currency', 'Currency')}>
                  {currencyLabel}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {currencyOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5 @md:col-span-1 @3xl:col-span-3">
            <FieldLabel htmlFor={unitPriceId}>{t('purchasing.supplierProducts.price.field.unitPrice', 'Unit price')}</FieldLabel>
            <Input
              id={unitPriceId}
              value={unitPrice}
              inputMode="decimal"
              aria-describedby={unitPriceHelpId}
              onChange={(event) => patchPrimary({ unitPrice: event.target.value })}
            />
            <p id={unitPriceHelpId} className="text-xs text-muted-foreground">
              {t(
                'purchasing.supplierProducts.price.help.unitPrice',
                'The supplier’s price for one unit, before the discount.',
              )}
            </p>
          </div>
          <div className="space-y-1.5 @3xl:col-span-3">
            <FieldLabel htmlFor={discountId}>
              {t('purchasing.supplierProducts.price.field.discount', 'Discount (%)')}
            </FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                id={discountId}
                value={discountText}
                inputMode="numeric"
                className="w-24"
                aria-describedby={discountHelpId}
                onChange={(event) => setValue('discountPercent', event.target.value)}
              />
              <span className="text-sm text-muted-foreground" aria-hidden="true">
                %
              </span>
            </div>
            {discountError ? (
              <p className="text-xs text-status-error-text" role="alert">
                {discountError}
              </p>
            ) : null}
          </div>
        </div>

        <p id={discountHelpId} className="mt-2 max-w-prose text-xs text-muted-foreground">
          {t(
            'purchasing.supplierProducts.price.help.discount',
            'The supplier’s discount off this item’s supply price — a whole number of percent (0–100; blank = none). The net amount is derived — it is what the product record receives as its cost price.',
          )}
        </p>

        {/*
          The item's 折后价, recomputed as the operator types: the same helper computes the number the
          promotion writes into the product record, so the preview cannot disagree with the write.
        */}
        {hasDiscount ? (
          <p className="mt-2 text-xs text-muted-foreground tabular-nums">
            {(() => {
              const net = netUnitPrice(unitPrice, discountText)
              if (!net) {
                return t(
                  'purchasing.supplierProducts.price.netNeedsAmount',
                  'Enter the unit price to see the net amount.',
                )
              }
              return t('purchasing.supplierProducts.price.net', 'Net after discount: {amount}', {
                amount: formatCurrency(net, currencyCode || 'CNY') ?? net,
              })
            })()}
          </p>
        ) : null}
      </div>

      {primary ? null : (
        <p className="text-sm text-muted-foreground">
          {t(
            'purchasing.supplierProducts.price.empty',
            'No supply price yet — type the amount the supplier quoted.',
          )}
        </p>
      )}

      {extras.length > 0 ? (
        <div className="space-y-1.5 rounded-md border bg-background p-3">
          <p className="text-xs font-medium">{t('purchasing.supplierProducts.price.others.title', 'Other price rows (read-only)')}</p>
          <p className="text-xs text-muted-foreground">
            {t(
              'purchasing.supplierProducts.price.others.hint',
              'Another currency or ladder step, a withdrawn price, or a legacy offer row. Kept for traceability and submitted back unchanged.',
            )}
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground tabular-nums">
            {extras.map((row) => (
              <li key={row.key} className="flex flex-wrap items-baseline gap-x-3">
                <span>{priceKindLabel(t, row.priceKind)}</span>
                <span>{row.currencyCode.trim().toUpperCase()}</span>
                <span>
                  {t('purchasing.supplierProducts.price.others.minQuantity', 'Min qty {count}', {
                    count: row.minQuantity,
                  })}
                </span>
                <span className="text-foreground">
                  {formatCurrency(row.unitPrice, row.currencyCode.trim().toUpperCase() || 'CNY') ?? row.unitPrice}
                </span>
                <span>
                  {row.isActive
                    ? t('purchasing.supplierProducts.price.others.active', 'Active')
                    : t('purchasing.supplierProducts.price.others.inactive', 'Withdrawn')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/**
 * A photo the operator picked before the row existed. The file cannot be uploaded yet (attachments
 * are keyed by `entityId` + row id), so it is held with a local preview and uploaded by the create
 * form's submit, right after the row is created.
 */
type PendingImage = { key: string; file: File; previewUrl: string }

type PendingImagesStore = {
  images: PendingImage[]
  add: (file: File) => void
  remove: (key: string) => void
}

/**
 * Present only on the create form. The photo group reads it to stage a pick instead of refusing it;
 * on the edit form (and anywhere else) the store is absent and the upload happens immediately.
 */
const PendingImagesContext = React.createContext<PendingImagesStore | null>(null)

function pendingImageKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `photo-${Date.now()}-${Math.round(performance.now())}`
}

/** Uploads one file against the saved row and returns its attachment id, or null when it failed. */
async function uploadSupplierProductImage(productId: string, file: File): Promise<string | null> {
  const body = new FormData()
  body.set('entityId', ATTACHMENT_ENTITY_ID)
  body.set('recordId', productId)
  body.set('file', file)
  const upload = await apiCall<{ item?: { id?: string } }>('/api/attachments', { method: 'POST', body }, { fallback: null })
  const attachmentId = upload.ok && typeof upload.result?.item?.id === 'string' ? upload.result.item.id : ''
  return attachmentId || null
}

/**
 * The product photos (REQ-SPL-014).
 *
 * Create-then-bind like every other attachment in this app: the file is uploaded against the saved
 * row (`entityId` + row id) and the returned id is appended to the row's `imageAttachmentIds`,
 * which the form then saves. So a failed upload leaves the row exactly as it was, and the list is
 * behind the row's optimistic lock — two editors cannot silently drop each other's photo.
 *
 * On the **create** form the row does not exist yet, so a pick is staged locally (thumbnail from a
 * blob URL) and uploaded by the submit handler once the row has an id. Refusing the pick until the
 * operator saved first made a single "add an item with photos" task into two visits to the form.
 *
 * Unlinking removes the id only; the uploaded file stays in the attachments module (its history and
 * its ACL stay intact), which also means re-adding a photo is a re-upload, not a resurrection.
 */
function SupplierProductImages({
  values,
  setValue,
  productId,
  t,
}: CrudFormGroupComponentProps & { productId: string | null; t: TranslateFn }) {
  const [uploading, setUploading] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const pendingStore = React.useContext(PendingImagesContext)
  const imageIds = readImageIds(values.imageAttachmentIds)
  const pending = pendingStore?.images ?? []
  const totalCount = imageIds.length + pending.length

  const handleFiles = React.useCallback(
    async (files: FileList | null) => {
      const file = files?.[0]
      if (inputRef.current) inputRef.current.value = ''
      if (!file) return
      if (totalCount >= MAX_IMAGES) {
        flash(
          t('purchasing.supplierProducts.form.images.tooMany', 'At most {count} photos', { count: MAX_IMAGES }),
          'error',
        )
        return
      }
      if (!productId) {
        // No row yet: stage the pick, the create form uploads it after the row is written.
        if (pendingStore) {
          pendingStore.add(file)
          return
        }
        flash(t('purchasing.supplierProducts.form.images.saveFirst', 'Save the item first, then upload photos'), 'error')
        return
      }
      setUploading(true)
      try {
        const attachmentId = await uploadSupplierProductImage(productId, file)
        if (!attachmentId) {
          flash(t('purchasing.supplierProducts.form.images.uploadFailed', 'The photo could not be uploaded'), 'error')
          return
        }
        // Bound in the form's own state, then saved with the row: the operator sees the thumbnail
        // immediately and a rejected row save never leaves a half-bound list behind.
        setValue('imageAttachmentIds', [...imageIds, attachmentId])
        flash(t('purchasing.supplierProducts.form.images.uploaded', 'Photo uploaded; save the item to apply it'), 'success')
      } catch {
        flash(t('purchasing.supplierProducts.form.images.uploadFailed', 'The photo could not be uploaded'), 'error')
      } finally {
        setUploading(false)
      }
    },
    [imageIds, pendingStore, productId, setValue, t, totalCount],
  )

  const hint = productId
    ? t('purchasing.supplierProducts.form.images.hint', 'Up to {count} photos; the list applies once you save the item.', { count: MAX_IMAGES })
    : pendingStore
      ? t(
          'purchasing.supplierProducts.form.images.pendingHint',
          'Up to {count} photos; the picked files are uploaded when you save the item.',
          { count: MAX_IMAGES },
        )
      : t('purchasing.supplierProducts.form.images.saveFirst', 'Save the item first, then upload photos')

  return (
    <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{t('purchasing.supplierProducts.form.images.title', 'Photos')}</h3>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={uploading || (!productId && !pendingStore) || totalCount >= MAX_IMAGES}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-4" aria-hidden="true" />
          {uploading
            ? t('purchasing.supplierProducts.form.images.uploading', 'Uploading…')
            : t('purchasing.supplierProducts.form.images.upload', 'Upload photo')}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label={t('purchasing.supplierProducts.form.images.upload', 'Upload photo')}
          onChange={(event) => void handleFiles(event.target.files)}
        />
      </div>

      {totalCount === 0 ? (
        <p className="text-sm text-muted-foreground">{t('purchasing.supplierProducts.form.images.empty', 'No photos yet')}</p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {pending.map((entry) => (
            <li key={entry.key} className="relative">
              {/*
                A blob URL from the operator's own disk, not a served asset: `next/image` cannot
                optimize it (and would need the session the attachments route authorizes), so the
                preview is a plain img on purpose.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={entry.previewUrl}
                alt={t('purchasing.supplierProducts.form.images.alt', 'Product photo')}
                width={96}
                height={96}
                className="size-24 rounded-md border object-cover"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute -right-2 -top-2"
                aria-label={t('purchasing.supplierProducts.form.images.remove', 'Remove this photo')}
                onClick={() => pendingStore?.remove(entry.key)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
          {imageIds.map((attachmentId) => (
            <li key={attachmentId} className="relative">
              {/*
                `unoptimized` on purpose: the file is served by the attachments route, which
                authorizes the caller — the optimizer would fetch it server-side without the
                session and get a 401 instead of an image.
              */}
              <Image
                src={`/api/attachments/file/${encodeURIComponent(attachmentId)}`}
                alt={t('purchasing.supplierProducts.form.images.alt', 'Product photo')}
                width={96}
                height={96}
                unoptimized
                className="size-24 rounded-md border object-cover"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute -right-2 -top-2"
                aria-label={t('purchasing.supplierProducts.form.images.remove', 'Remove this photo')}
                onClick={() => setValue('imageAttachmentIds', imageIds.filter((id) => id !== attachmentId))}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PackingEditor({
  fieldId,
  label,
  values,
  setValue,
  t,
}: CrudFormGroupComponentProps & { fieldId: string; label: string; t: TranslateFn }) {
  const current = React.useMemo(() => readPacking(values[fieldId]), [fieldId, values])
  const parts: Array<{ part: keyof PackingValues; label: string }> = [
    { part: 'length', label: t('purchasing.supplierProducts.form.field.length', 'Length') },
    { part: 'width', label: t('purchasing.supplierProducts.form.field.width', 'Width') },
    { part: 'height', label: t('purchasing.supplierProducts.form.field.height', 'Height') },
  ]

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-sm font-medium">
        {label}
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {t('purchasing.supplierProducts.form.field.cm', 'cm')}
        </span>
      </p>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {parts.map((part) => {
          const inputId = `supplier-product-${fieldId}-${part.part}`
          return (
            <div key={part.part} className="space-y-1.5">
              <FieldLabel htmlFor={inputId}>{part.label}</FieldLabel>
              <Input
                id={inputId}
                value={current[part.part]}
                inputMode="decimal"
                onChange={(event) => setValue(fieldId, { ...current, [part.part]: event.target.value })}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function useSupplierProductFields(
  t: TranslateFn,
  opts: { supplierEditable: boolean; productId: string | null; masterProductId: string | null },
): CrudField[] {
  return React.useMemo<CrudField[]>(() => {
    const supplierFields: CrudField[] = opts.supplierEditable
      ? [
          {
            id: 'supplierId',
            label: t('purchasing.supplierProducts.form.field.supplier', 'Supplier'),
            type: 'select',
            required: true,
            loadOptions: () => loadSupplierOptions(t('purchasing.supplierProducts.form.supplierLoadFailed', 'Suppliers could not be loaded')),
          },
        ]
      : [
          {
            id: 'supplierName',
            label: t('purchasing.supplierProducts.form.field.supplier', 'Supplier'),
            type: 'text',
            readOnly: true,
          },
        ]

    return [
      ...supplierFields,
      {
        id: 'supplierSku',
        label: t('purchasing.supplierProducts.form.field.supplierSku', 'Product SKU (ours)'),
        description: t(
          'purchasing.supplierProducts.form.help.supplierSku',
          'Our code for this item: unique within the supplier, written into the product master\u2019s SKU on 建商品档案, and never reused \u2014 including by a deleted row.',
        ),
        // The generator, the category picker and the breakdown of the stored characters belong to this
        // field, not to a block beside it: one task, one place (owner 2026-09-24).
        type: 'custom',
        required: true,
        component: (props) => (
          <SupplierProductCodePanel
            {...props}
            t={t}
            rowId={opts.productId}
            masterProductId={opts.masterProductId}
          />
        ),
      },
      {
        id: 'brandValue',
        label: t('purchasing.supplierProducts.form.field.brandValue', 'Brand (code prefix)'),
        description: t(
          'purchasing.supplierProducts.form.help.brandValue',
          'The brand this row\u2019s codes are generated under; blank falls back to the supplier\u2019s default brand.',
        ),
        type: 'combobox',
        allowCustomValues: false,
        // The list is the `product_brand` code list; a value the dictionary no longer carries still
        // renders as itself, so opening a row can never blank its brand.
        loadOptions: () => loadCodeListOptions(PRODUCT_BRAND_DICTIONARY_KEY),
        resolveLabel: (value) => value,
      },
      {
        id: 'name',
        label: t('purchasing.supplierProducts.form.field.name', 'Name (as printed by the supplier)'),
        description: t(
          'purchasing.supplierProducts.form.help.name',
          'The supplier’s own product name, transcribed as printed. Syncing does not overwrite our Chinese name with it.',
        ),
        type: 'text',
        required: true,
        maxLength: 300,
      },
      {
        id: 'nameZh',
        label: t('purchasing.supplierProducts.form.field.nameZh', 'Chinese name (ours)'),
        description: t(
          'purchasing.supplierProducts.form.help.nameZh',
          'Our own Chinese name; becomes the product master’s name when the row is synced.',
        ),
        type: 'text',
        maxLength: 300,
      },
      {
        id: 'nameEn',
        label: t('purchasing.supplierProducts.form.field.nameEn', 'English name (ours)'),
        description: t(
          'purchasing.supplierProducts.form.help.nameEn',
          'Our own English name; used on export documents and written to the master’s English name.',
        ),
        type: 'text',
        maxLength: 300,
      },
      {
        id: 'hsCode',
        label: t('purchasing.supplierProducts.form.field.hsCode', 'HS code'),
        description: t(
          'purchasing.supplierProducts.form.help.hsCode',
          'Harmonized System Code — stored as text so leading zeros and dotted groups (8471.30.0000) survive. Do not treat it as a number.',
        ),
        type: 'text',
        maxLength: 32,
      },
      {
        id: 'declarationElements',
        label: t('purchasing.supplierProducts.form.field.declarationElements', 'Declaration elements'),
        description: t(
          'purchasing.supplierProducts.form.help.declarationElements',
          'Declaration elements (name, brand, model, material, use, spec…), copied verbatim onto customs paperwork.',
        ),
        type: 'textarea',
        rows: 3,
        maxLength: 2000,
      },
      {
        id: 'unit',
        label: t('purchasing.supplierProducts.form.field.unit', 'Unit of measure'),
        description: t(
          'purchasing.supplierProducts.form.help.unit',
          'Options come from the supplier_product_unit dictionary (maintained under Dictionaries); a code it does not list can still be typed.',
        ),
        type: 'combobox',
        allowCustomValues: true,
        maxLength: 24,
        // No query argument means "show the whole list on focus"; a missing dictionary yields no
        // options and the field stays free text, so it can never block a save the API accepts.
        loadOptions: () => loadUnitOptions(),
        // A stored code the dictionary no longer lists still renders as itself, so opening a row
        // can never blank its unit.
        resolveLabel: (value) => value,
      },
      {
        id: 'moqQuantity',
        label: t('purchasing.supplierProducts.form.field.moqQuantity', 'MOQ (minimum order quantity)'),
        description: t(
          'purchasing.supplierProducts.form.help.moqQuantity',
          'Minimum Order Quantity — the smallest quantity the supplier will take.',
        ),
        type: 'number',
      },
      {
        id: 'cartonQuantity',
        label: t('purchasing.supplierProducts.form.field.cartonQuantity', 'Qty/Box (units per carton)'),
        description: t(
          'purchasing.supplierProducts.form.help.cartonQuantity',
          'Quantity per box — how many units a carton holds; shipment allocation converts through it.',
        ),
        type: 'number',
      },
      {
        id: 'unitGrossWeight',
        label: t('purchasing.supplierProducts.form.field.unitGrossWeight', 'Unit gross weight (kg)'),
        description: t(
          'purchasing.supplierProducts.form.help.unitGrossWeight',
          'Gross weight of one unit including its packaging — the G.W. column on the supplier’s sheet, in kg. Optional.',
        ),
        type: 'number',
      },
      {
        id: 'unitNetWeight',
        label: t('purchasing.supplierProducts.form.field.unitNetWeight', 'Unit net weight (kg)'),
        description: t(
          'purchasing.supplierProducts.form.help.unitNetWeight',
          'Net weight of one unit, packaging excluded — the N.W. column on the supplier’s sheet, in kg. Optional.',
        ),
        type: 'number',
      },
      {
        id: 'unitVolume',
        label: t('purchasing.supplierProducts.form.field.unitVolume', 'Unit volume (cm³)'),
        description: t(
          'purchasing.supplierProducts.form.help.unitVolume',
          'Volume of one unit in cm³, as the supplier prints it. Optional; not derived from the product size.',
        ),
        type: 'number',
      },
      {
        id: 'itemNo',
        label: t('purchasing.supplierProducts.form.field.itemNo', 'Item no. (supplier’s own)'),
        description: t(
          'purchasing.supplierProducts.form.help.itemNo',
          'Record the code the supplier prints, when they have one. Reference only — it never matches or generates a code.',
        ),
        type: 'text',
        maxLength: 120,
      },
      {
        id: 'description',
        label: t('purchasing.supplierProducts.form.field.description', 'Spec / description'),
        description: t(
          'purchasing.supplierProducts.form.help.description',
          'The supplier’s own spec text; becomes the master’s spec summary on sync.',
        ),
        type: 'textarea',
        rows: 4,
        maxLength: 2000,
      },
      {
        id: 'status',
        label: t('purchasing.supplierProducts.form.field.status', 'Status'),
        type: 'select',
        options: [
          { value: 'active', label: t('purchasing.supplierProducts.status.active', 'Active') },
          { value: 'inactive', label: t('purchasing.supplierProducts.status.inactive', 'Inactive') },
        ],
      },
      {
        id: 'notes',
        label: t('purchasing.supplierProducts.form.field.notes', 'Notes'),
        description: t('purchasing.supplierProducts.form.help.notes', 'Internal note; never printed on a document.'),
        type: 'textarea',
        rows: 3,
        maxLength: 2000,
      },
    ]
  }, [opts.masterProductId, opts.productId, opts.supplierEditable, t])
}

/**
 * The form's groups, ordered so the two columns read as "what the item is" (column 1) and "what we
 * pay, pack and shipped it as" (column 2).
 *
 * The price list is the one group that cannot live in the sidebar: `CrudForm` draws a `column: 2`
 * group into a `3fr` rail — 389px on a 1440px viewport — and the row's five controls came out 73px
 * and 45px wide there, with the kind select truncated to 「供应」. Every other rows editor in this app
 * is a column-1 group for the same reason (purchase orders, contracts, invoices, internal sales,
 * shipment allocations). The row itself is container-responsive, so it also survives the single
 * column the form falls back to below `lg`.
 *
 * ERP-generic fields live in 商品标识 / 报关信息 / 价格 / 装箱、重量与体积; the fields that are
 * transcriptions of the supplier's own workbook live in 供应商原始资料. Keeping that split explicit is
 * what lets a buyer who never saw the workbook find a field by meaning instead of by column order.
 */
function useSupplierProductGroups(
  t: TranslateFn,
  opts: { productId: string | null },
): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'goods',
        column: 1,
        title: t('purchasing.supplierProducts.form.group.goods', 'Goods identity'),
        fields: ['supplierId', 'supplierName', 'name', 'nameZh', 'nameEn'],
      },
      {
        // The three that work together get their own card: 品牌（编码前缀）→ 类别 → 生成 → 商品 SKU.
        // Beside the identity fields they read as unrelated, and the generated value looked like it
        // belonged to another form (owner 2026-09-24: 「这三个功能模块，用一个卡片放置一起…让人清楚
        // 他们是一起联动」). The SKU field itself carries the generator inside it.
        id: 'code',
        column: 1,
        title: t('purchasing.supplierProducts.form.group.code', 'Product SKU and brand'),
        fields: ['brandValue', 'supplierSku'],
      },
      {
        id: 'images',
        column: 1,
        bare: true,
        component: (context) => <SupplierProductImages {...context} productId={opts.productId} t={t} />,
      },
      {
        id: 'customs',
        column: 1,
        title: t('purchasing.supplierProducts.form.group.customs', 'Customs & unit'),
        fields: ['hsCode', 'declarationElements', 'unit'],
      },
      {
        id: 'prices',
        column: 1,
        bare: true,
        component: (context) => <SupplierProductPriceGroup {...context} t={t} />,
      },
      {
        id: 'packing',
        column: 2,
        title: t('purchasing.supplierProducts.form.group.packing', 'Packing, weights & volume'),
        fields: ['cartonQuantity', 'unitGrossWeight', 'unitNetWeight', 'unitVolume', 'moqQuantity'],
      },
      {
        id: 'innerPacking',
        column: 2,
        bare: true,
        component: (context) => (
          <PackingEditor
            {...context}
            fieldId="innerPacking"
            label={t('purchasing.supplierProducts.form.field.innerPacking', 'Product size L×W×H (cm)')}
            t={t}
          />
        ),
      },
      {
        id: 'supplierSheet',
        column: 2,
        title: t('purchasing.supplierProducts.form.group.supplierSheet', 'As printed by the supplier'),
        fields: ['itemNo', 'description', 'notes'],
      },
      {
        id: 'settings',
        column: 2,
        title: t('purchasing.supplierProducts.form.group.settings', 'Status'),
        fields: ['status'],
      },
    ],
    [opts.productId, t],
  )
}

/**
 * Writes the item's whole price set after the row itself was saved.
 *
 * The row is already persisted at this point, so a price failure is reported on its own key and
 * rethrown: the form keeps the operator's rows (nothing is cleared) and re-submitting retries both
 * writes — the row update is idempotent, the price submission is a full replacement.
 */
async function saveSupplierProductPrices(
  supplierProductId: string,
  rows: SupplierProductPriceRowValues[],
  t: TranslateFn,
): Promise<void> {
  try {
    await updateCrud(PRICES_API_PATH, {
      supplierProductId,
      rows: buildSupplierProductPriceRowsPayload(rows),
    })
  } catch (priceError) {
    flash(t('purchasing.supplierProducts.form.priceSaveFailed', 'Saving the price list failed'), 'error')
    throw priceError
  }
}

function SupplierProductCreateForm() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const fields = useSupplierProductFields(t, { supplierEditable: true, productId: null, masterProductId: null })
  // No id yet: the photo group stages the picks and this form uploads them once the row exists.
  const groups = useSupplierProductGroups(t, { productId: null })
  // The library list links here with `?supplierId=` when the operator came from a supplier row,
  // so the picker starts on that supplier instead of asking again.
  const initialValues = React.useMemo<SupplierProductFormValues>(
    () => ({ ...EMPTY_VALUES, supplierId: searchParams?.get('supplierId') ?? '' }),
    [searchParams],
  )
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('purchasing.supplierProducts.form.saved', 'Product saved'), 'success'),
    [t],
  )

  // Photos picked before the row existed (see PendingImagesContext): the previews live here so the
  // operator sees them immediately, and the files are uploaded right after the row is created.
  const [pendingImages, setPendingImages] = React.useState<PendingImage[]>([])
  const pendingImagesStore = React.useMemo<PendingImagesStore>(
    () => ({
      images: pendingImages,
      add: (file) =>
        setPendingImages((current) => [
          ...current,
          { key: pendingImageKey(), file, previewUrl: URL.createObjectURL(file) },
        ]),
      remove: (key) =>
        setPendingImages((current) => {
          const hit = current.find((entry) => entry.key === key)
          if (hit) URL.revokeObjectURL(hit.previewUrl)
          return current.filter((entry) => entry.key !== key)
        }),
    }),
    [pendingImages],
  )

  const handleSubmit = React.useCallback(async (values: SupplierProductFormValues) => {
    const payload = buildSupplierProductPayload(values)
    let createdId: string | null = null
    try {
      const created = await createCrud<{ id?: string }>(API_PATH, {
        ...payload,
        supplierId: values.supplierId,
      })
      createdId = typeof created.result?.id === 'string' ? created.result.id : null
    } catch (error) {
      flash(t('purchasing.supplierProducts.form.saveFailed', 'Saving failed'), 'error')
      throw error
    }
    if (!createdId) {
      // Without an id there is nothing to hang the price rows on; reporting "saved" would be a lie
      // the operator cannot see through, and the row is already in the list.
      flash(t('purchasing.supplierProducts.form.saveFailed', 'Saving failed'), 'error')
      throw new Error(t('purchasing.supplierProducts.form.saveFailed', 'Saving failed'))
    }

    // The row exists from here on: every remaining failure is a "saved, but fix this on the row"
    // case, so the operator is sent to the row's own edit page instead of a form that would create
    // a second row on the next save.
    const editHref = `${LIST_HREF}/${encodeURIComponent(createdId)}/edit`

    const staged = pendingImagesStore.images
    if (staged.length > 0) {
      const uploadedIds: string[] = []
      let failed = 0
      for (const entry of staged) {
        try {
          const attachmentId = await uploadSupplierProductImage(createdId, entry.file)
          if (attachmentId) uploadedIds.push(attachmentId)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (uploadedIds.length > 0) {
        // Bound with a versioned update: the row was just created by this client, and the lock
        // keeps a concurrent editor from losing the list they see.
        try {
          const fresh = await fetchCrudList<Record<string, unknown>>(API_PATH, { id: createdId, pageSize: 1 })
          const version = fresh.items?.[0]?.updated_at
          await updateCrud(API_PATH, {
            id: createdId,
            ...payload,
            imageAttachmentIds: uploadedIds,
            updatedAt: typeof version === 'string' ? version : null,
          })
        } catch {
          failed += uploadedIds.length
        }
      }
      staged.forEach((entry) => URL.revokeObjectURL(entry.previewUrl))
      setPendingImages([])
      if (failed > 0) {
        flash(
          t(
            'purchasing.supplierProducts.form.images.stagedFailed',
            'The item was saved, but {count} photo(s) could not be attached — add them on this page.',
            { count: failed },
          ),
          'error',
        )
        router.push(editHref)
        return
      }
    }

    try {
      await saveSupplierProductPrices(createdId, values.prices, t)
    } catch {
      // The price list is written by its own request; its failure is already reported, and the row
      // exists — so the operator finishes on the row instead of re-submitting this form.
      router.push(editHref)
      return
    }
  }, [pendingImagesStore, router, t])

  return (
    <PendingImagesContext.Provider value={pendingImagesStore}>
      <CrudForm<SupplierProductFormValues>
        entityId={ENTITY_ID}
        title={t('purchasing.supplierProducts.form.createTitle', 'New supplier product')}
        titleHeadingLevel={1}
        backHref={LIST_HREF}
        fields={fields}
        groups={groups}
        initialValues={initialValues}
        submitLabel={t('purchasing.supplierProducts.form.save', 'Save')}
        cancelHref={LIST_HREF}
        successRedirect={successRedirect}
        onSubmit={handleSubmit}
      />
    </PendingImagesContext.Provider>
  )
}

function SupplierProductEditForm({ productId }: { productId: string }) {
  const t = useT()
  const [masterProductId, setMasterProductId] = React.useState<string | null>(null)
  const fields = useSupplierProductFields(t, { supplierEditable: false, productId, masterProductId })
  const groups = useSupplierProductGroups(t, { productId })
  const [initial, setInitial] = React.useState<SupplierProductFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('purchasing.supplierProducts.form.saved', 'Product saved'), 'success'),
    [t],
  )

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const payload = await fetchCrudList<Record<string, unknown>>(API_PATH, { id: productId, pageSize: 1 })
        const item = payload?.items?.[0]
        if (!item) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        const values = toSupplierProductFormValues(item)
        // The master link decides whether the code may still be retired: once promoted, the master's
        // SKU must not diverge from the library row's.
        if (!cancelled) {
          const link = item.productId ?? item.product_id
          setMasterProductId(typeof link === 'string' && link.length > 0 ? link : null)
        }
        // The price list is a separate read: losing it must not hide the item itself, so a failure
        // degrades to "no rows loaded" plus a message the operator can act on.
        let prices: SupplierProductPriceRowValues[] = []
        try {
          const pricePayload = await fetchCrudList<Record<string, unknown>>(PRICES_API_PATH, {
            supplierProductId: productId,
            pageSize: 100,
          })
          prices = (pricePayload.items ?? []).map(toProductPriceRowValues)
        } catch {
          if (!cancelled) {
            flash(t('purchasing.supplierProducts.form.priceLoadFailed', 'The price list could not be loaded'), 'error')
          }
        }
        if (!cancelled) setInitial({ ...values, prices })
      } catch (loadError: unknown) {
        if (!cancelled) {
          if ((loadError as { status?: number }).status === 404) setIsNotFound(true)
          else setError(t('purchasing.supplierProducts.form.loadFailed', 'The product could not be loaded'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [productId, t])

  const fallbackInitialValues = React.useMemo<SupplierProductFormValues>(
    () => ({ ...EMPTY_VALUES, id: productId, updatedAt: null }),
    [productId],
  )

  const handleSubmit = React.useCallback(async (values: SupplierProductFormValues) => {
    const id = initial?.id || productId
    try {
      await updateCrud(API_PATH, {
        id,
        ...buildSupplierProductPayload(values),
        updatedAt: initial?.updatedAt ?? null,
      })
    } catch (updateError) {
      flash(t('purchasing.supplierProducts.form.saveFailed', 'Saving failed'), 'error')
      throw updateError
    }
    await saveSupplierProductPrices(id, values.prices, t)
  }, [initial, productId, t])

  const handleDelete = React.useCallback(async () => {
    await deleteCrud(API_PATH, { id: initial?.id || productId })
  }, [initial, productId])

  if (isNotFound) {
    return (
      <RecordNotFoundState
        label={t('purchasing.supplierProducts.form.loadFailed', 'The product could not be loaded')}
        backHref={LIST_HREF}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<SupplierProductFormValues>
      entityId={ENTITY_ID}
      title={t('purchasing.supplierProducts.form.editTitle', 'Edit supplier product')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      fields={fields}
      groups={groups}
      initialValues={initial ?? fallbackInitialValues}
      submitLabel={t('purchasing.supplierProducts.form.save', 'Save')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      isLoading={loading}
      onSubmit={handleSubmit}
      onDelete={handleDelete}
      deleteRedirect={LIST_HREF}
    />
  )
}

export default function SupplierProductForm({
  mode,
  productId,
}: {
  mode: 'create' | 'edit'
  productId?: string
}) {
  if (mode === 'edit') {
    if (!productId) return null
    return <SupplierProductEditForm productId={productId} />
  }
  return <SupplierProductCreateForm />
} 