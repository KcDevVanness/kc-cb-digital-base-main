"use client"

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  CrudForm,
  type CrudField,
  type CrudFieldOption,
  type CrudFormGroup,
  type CrudFormGroupComponentProps,
} from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { Button } from '@open-mercato/ui/primitives/button'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { loadUnitOptions } from '../lib/unitOptions'
import { readErrorStatus } from '../lib/errorStatus'
import { PRODUCT_PRICE_TIERS, type ProductPriceTier } from '../lib/tiers'
import { useCurrencyOptions } from '../../currency_policy/lib/clientOptions'
import VariantsEditor from './VariantsEditor'
import {
  attachVariantIds,
  buildProductPayload,
  buildProductPriceRowsPayload,
  createEmptyPriceRow,
  DIMENSION_UNIT_CLEAR,
  DIMENSION_UNITS,
  EMPTY_PRODUCT_VALUES,
  isProductPriceTier,
  readDimensions,
  readPriceRows,
  readVariantRows,
  toProductFormValues,
  toProductPriceRowValues,
  type ProductDimensions,
  type ProductFormValues,
  type ProductPriceRowValues,
} from './productFormValues'

const PRODUCTS_API_PATH = 'products/items'
const PRICES_API_PATH = 'products/prices'
const LIST_HREF = '/backend/products/items'
const ENTITY_ID = 'products:product'
/** Prices are written by their own endpoint and gated by their own feature. */
const FEATURE_PRICE_MANAGE = 'products.prices.manage'

/** Four inputs writing one `{length,width,height,unit}` object, rendered between the scalar fields. */
function DimensionsEditor({
  values,
  setValue,
  t,
}: CrudFormGroupComponentProps & { t: TranslateFn }) {
  const current: ProductDimensions = React.useMemo(
    () => readDimensions(values.dimensions) ?? { length: '', width: '', height: '', unit: '' },
    [values.dimensions],
  )
  const inputId = (part: string) => `product-dimensions-${part}`
  const parts: Array<{ part: keyof ProductDimensions; label: string }> = [
    { part: 'length', label: t('products.items.form.field.length', 'Length') },
    { part: 'width', label: t('products.items.form.field.width', 'Width') },
    { part: 'height', label: t('products.items.form.field.height', 'Height') },
  ]
  // A measurement unit is a closed engineering set, not a company vocabulary, so it is a fixed list
  // rather than a dictionary; a record measured in something else keeps it as its own option.
  const unitChoices = React.useMemo(() => {
    const code = current.unit.trim()
    if (!code || (DIMENSION_UNITS as readonly string[]).includes(code)) return [...DIMENSION_UNITS]
    return [...DIMENSION_UNITS, code]
  }, [current.unit])

  return (
    <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
      <h3 className="text-sm font-medium">{t('products.items.form.group.dimensions', 'Product size (cm)')}</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {parts.map((part) => (
          <div key={part.part} className="space-y-1.5">
            <FieldLabel htmlFor={inputId(part.part)}>{part.label}</FieldLabel>
            <Input
              id={inputId(part.part)}
              value={current[part.part]}
              inputMode="decimal"
              onChange={(event) => setValue('dimensions', { ...current, [part.part]: event.target.value })}
            />
          </div>
        ))}
        <div className="space-y-1.5">
          <FieldLabel htmlFor={inputId('unit')}>{t('products.items.form.field.dimensionUnit', 'Unit')}</FieldLabel>
          <Select
            value={current.unit}
            onValueChange={(next) => setValue('dimensions', { ...current, unit: next === DIMENSION_UNIT_CLEAR ? '' : next })}
          >
            <SelectTrigger id={inputId('unit')}>
              <SelectValue placeholder={t('ui.forms.select.emptyOption', '—')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DIMENSION_UNIT_CLEAR}>{t('ui.forms.select.clearOption', '— Clear —')}</SelectItem>
              {unitChoices.map((unit) => (
                <SelectItem key={unit} value={unit}>
                  {unit}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}

/**
 * The server reports price problems against a nested path (`rows.0.unitPrice`), so the section
 * surfaces the first error it owns instead of only an exact `prices` key.
 */
function firstPriceRowError(errors: Record<string, string>): string | null {
  const key = Object.keys(errors).find(
    (candidate) =>
      candidate === 'prices' ||
      candidate === 'rows' ||
      candidate.startsWith('prices.') ||
      candidate.startsWith('rows.'),
  )
  return key ? errors[key] ?? null : null
}

function tierLabel(t: TranslateFn, tier: ProductPriceTier): string {
  return t(`products.priceTier.${tier}`, tier)
}

/**
 * The product's whole price list: three tiers (cost / internal settlement / export) quoted per
 * currency and minimum quantity.
 *
 * Rows are the form's `prices` value, so a save failure keeps whatever the operator typed and a
 * retry only has to press save again. The rows are submitted to the prices endpoint **after** the
 * item write, never merged into the item payload.
 */
function ProductPriceRowsEditor({
  values,
  setValue,
  errors,
  canManagePrices,
  t,
}: CrudFormGroupComponentProps & { canManagePrices: boolean; t: TranslateFn }) {
  const rows = readPriceRows(values.prices)
  const dictionaryOptions = useCurrencyOptions(t('products.items.form.priceLoadFailed', 'Could not load the currency list'))
  const error = firstPriceRowError(errors)

  // A currency already on a row survives even when the dictionary does not offer it (an old quote in
  // a retired code), so opening a record can never silently blank its currency.
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

  const tierOptions = React.useMemo<CrudFieldOption[]>(
    () => PRODUCT_PRICE_TIERS.map((tier) => ({ value: tier, label: tierLabel(t, tier) })),
    [t],
  )

  const updateRow = React.useCallback(
    (index: number, patch: Partial<ProductPriceRowValues>) => {
      setValue('prices', rows.map((row, position) => (position === index ? { ...row, ...patch } : row)))
    },
    [rows, setValue],
  )

  const removeRow = React.useCallback(
    (index: number) => {
      setValue('prices', rows.filter((_, position) => position !== index))
    },
    [rows, setValue],
  )

  const addRow = React.useCallback(() => {
    setValue('prices', [...rows, createEmptyPriceRow()])
  }, [rows, setValue])

  return (
    <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{t('products.items.form.group.prices', 'Prices')}</h3>
          <p className="max-w-prose text-xs text-muted-foreground">
            {t(
              'products.items.form.priceHint',
              'Cost price = what we pay: the supplier’s price for a purchased line, the production cost for a self-made one. Internal settlement price = what we charge the subsidiary; export price = what the subsidiary charges its customers.',
            )}
          </p>
        </div>
        {canManagePrices ? (
          <Button type="button" variant="outline" onClick={addRow}>
            <Plus className="size-4" aria-hidden="true" />
            {t('products.items.form.priceAdd', 'Add price row')}
          </Button>
        ) : null}
      </div>

      {!canManagePrices ? (
        <p className="text-xs text-muted-foreground">
          {t('products.items.form.pricePermissionDenied', 'You cannot maintain prices, so this list is read-only.')}
        </p>
      ) : null}

      {error ? (
        <p className="text-xs text-status-error-text" role="alert">
          {error}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('products.items.form.priceEmpty', 'No price rows yet.')}</p>
      ) : null}

      {rows.map((row, index) => {
        const fieldId = (suffix: string) => `product-price-${row.key}-${suffix}`
        const tierId = fieldId('tier')
        const currencyId = fieldId('currency')
        const minQuantityId = fieldId('minQuantity')
        const unitPriceId = fieldId('unitPrice')
        const startsAtId = fieldId('startsAt')
        const endsAtId = fieldId('endsAt')

        return (
          <div key={row.key} className="rounded-md border bg-background p-3">
            <div className="mb-2 flex items-center justify-between gap-4">
              <p className="text-xs font-medium text-muted-foreground">
                {`${t('products.items.form.priceTitle', 'Price row')} ${index + 1}`}
              </p>
              {canManagePrices ? (
                <IconButton
                  type="button"
                  variant="ghost"
                  size="lg"
                  aria-label={t('products.items.form.priceRemove', 'Remove this price row')}
                  onClick={() => removeRow(index)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="space-y-1.5 md:col-span-3">
                <FieldLabel htmlFor={tierId} required>
                  {t('products.items.form.priceTier', 'Tier')}
                </FieldLabel>
                <Select
                  value={row.tier}
                  disabled={!canManagePrices}
                  onValueChange={(next) => updateRow(index, { tier: isProductPriceTier(next) ? next : 'purchase' })}
                >
                  <SelectTrigger id={tierId} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {tierOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-3">
                <FieldLabel htmlFor={currencyId} required>
                  {t('products.items.form.priceCurrency', 'Currency')}
                </FieldLabel>
                <Select
                  value={row.currencyCode.trim().toUpperCase() || undefined}
                  disabled={!canManagePrices}
                  onValueChange={(next) => updateRow(index, { currencyCode: next })}
                >
                  <SelectTrigger id={currencyId} className="w-full">
                    <SelectValue placeholder={t('products.items.form.priceCurrency', 'Currency')} />
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
              <div className="space-y-1.5 md:col-span-2">
                <FieldLabel htmlFor={minQuantityId}>{t('products.items.form.priceMinQuantity', 'Min qty')}</FieldLabel>
                <Input
                  id={minQuantityId}
                  type="number"
                  min="1"
                  step="1"
                  value={row.minQuantity}
                  disabled={!canManagePrices}
                  onChange={(event) => updateRow(index, { minQuantity: event.target.value })}
                />
              </div>
              <div className="space-y-1.5 md:col-span-4">
                <FieldLabel htmlFor={unitPriceId} required>
                  {t('products.items.form.priceUnitPrice', 'Unit price')}
                </FieldLabel>
                <Input
                  id={unitPriceId}
                  inputMode="decimal"
                  value={row.unitPrice}
                  disabled={!canManagePrices}
                  onChange={(event) => updateRow(index, { unitPrice: event.target.value })}
                />
              </div>
              <div className="space-y-1.5 md:col-span-4">
                <FieldLabel htmlFor={startsAtId}>{t('products.items.form.priceStartsAt', 'Valid from')}</FieldLabel>
                <Input
                  id={startsAtId}
                  type="date"
                  value={row.startsAt}
                  disabled={!canManagePrices}
                  onChange={(event) => updateRow(index, { startsAt: event.target.value })}
                />
              </div>
              <div className="space-y-1.5 md:col-span-4">
                <FieldLabel htmlFor={endsAtId}>{t('products.items.form.priceEndsAt', 'Valid to')}</FieldLabel>
                <Input
                  id={endsAtId}
                  type="date"
                  value={row.endsAt}
                  disabled={!canManagePrices}
                  onChange={(event) => updateRow(index, { endsAt: event.target.value })}
                />
              </div>
              <div className="flex items-end md:col-span-4">
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={row.isActive}
                    disabled={!canManagePrices}
                    onChange={(event) => updateRow(index, { isActive: event.target.checked })}
                  />
                  {t('products.items.form.priceIsActive', 'Active')}
                </label>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function useProductFields(t: TranslateFn): CrudField[] {
  return React.useMemo<CrudField[]>(
    () => [
      {
        id: 'name',
        label: t('products.items.form.field.name', 'Name'),
        type: 'text',
        required: true,
        maxLength: 300,
      },
      {
        id: 'nameEn',
        label: t('products.items.form.field.nameEn', 'Name (EN)'),
        type: 'text',
        maxLength: 300,
      },
      {
        id: 'brand',
        label: t('products.items.form.field.brand', 'Brand'),
        description: t(
          'products.items.form.field.brandHelp',
          'The brand owner for a purchased line, our own brand for a self-made or commission-produced one; leave blank when there is none.',
        ),
        type: 'text',
        maxLength: 120,
      },
      {
        id: 'series',
        label: t('products.items.form.field.series', 'Series'),
        type: 'text',
        maxLength: 120,
      },
      {
        id: 'manufacturerModel',
        label: t('products.items.form.field.manufacturerModel', 'Model'),
        description: t(
          'products.items.form.field.manufacturerModelHelp',
          'The model printed on the contract line, e.g. W5C.',
        ),
        type: 'text',
        maxLength: 120,
      },
      {
        id: 'sku',
        label: t('products.items.form.field.sku', 'SKU'),
        description: t(
          'products.items.form.field.skuHelp',
          'Our code for this item: unique inside the organization while the product exists — deleting the product frees it again.',
        ),
        type: 'text',
        required: true,
        maxLength: 64,
      },
      {
        id: 'hsCode',
        label: t('products.items.form.field.hsCode', 'HS code'),
        type: 'text',
        maxLength: 32,
      },
      {
        id: 'cnCode',
        label: t('products.items.form.field.cnCode', 'CN code'),
        type: 'text',
        maxLength: 32,
      },
      {
        id: 'countryOfOriginCode',
        label: t('products.items.form.field.countryOfOriginCode', 'Country of origin'),
        type: 'text',
        maxLength: 4,
      },
      {
        id: 'specSummary',
        label: t('products.items.form.field.specSummary', 'Spec'),
        description: t(
          'products.items.form.field.specSummaryHelp',
          'Specification printed on contracts and declarations, e.g. White / 1.5L / with filter.',
        ),
        type: 'text',
        maxLength: 500,
      },
      {
        id: 'unit',
        label: t('products.items.form.field.unit', 'Unit'),
        description: t(
          'products.items.form.field.unitHelp',
          'Options come from the unit dictionary; a code it does not list can still be typed.',
        ),
        type: 'combobox',
        allowCustomValues: true,
        maxLength: 24,
        loadOptions: () => loadUnitOptions(),
        // A stored code the dictionary no longer lists still renders as itself.
        resolveLabel: (value) => value,
      },
      {
        id: 'cartonQuantity',
        label: t('products.items.form.field.cartonQuantity', 'Units per carton'),
        type: 'number',
      },
      {
        id: 'netWeight',
        label: t('products.items.form.field.netWeight', 'Net weight (kg)'),
        type: 'number',
      },
      {
        id: 'grossWeight',
        label: t('products.items.form.field.grossWeight', 'Gross weight (kg)'),
        type: 'number',
      },
      {
        id: 'volume',
        label: t('products.items.form.field.volume', 'Volume (cm³)'),
        type: 'number',
      },
      {
        id: 'batteryCapacityMah',
        label: t('products.items.form.field.batteryCapacityMah', 'Battery capacity (mAh)'),
        type: 'number',
      },
      {
        id: 'batteryWh',
        label: t('products.items.form.field.batteryWh', 'Battery energy (Wh)'),
        type: 'number',
      },
      {
        id: 'containsLithiumBattery',
        label: t('products.items.form.field.containsLithiumBattery', 'Contains lithium battery'),
        type: 'checkbox',
      },
      {
        id: 'certifications',
        label: t('products.items.form.field.certifications', 'Certifications'),
        description: t('products.items.form.field.certificationsHelp', 'One certification per line.'),
        type: 'textarea',
        rows: 3,
        maxLength: 2000,
      },
      {
        id: 'notes',
        label: t('products.items.form.field.notes', 'Notes'),
        type: 'textarea',
        rows: 3,
        maxLength: 2000,
      },
      {
        id: 'status',
        label: t('products.items.form.field.status', 'Status'),
        type: 'select',
        options: [
          { value: 'active', label: t('products.items.list.status.active', 'Active') },
          { value: 'inactive', label: t('products.items.list.status.inactive', 'Inactive') },
        ],
      },
    ],
    [t],
  )
}

/**
 * The form's groups, ordered so the two columns read as "what the item is" (column 1) and "what we
 * pack and ship it as" (column 2).
 *
 * The rows editors (variants, prices) are column-1 groups: `CrudForm` draws a `column: 2` group into
 * a narrow rail where a multi-control row is unusable, which is why every other rows editor in this
 * app sits in column 1.
 */
function useProductGroups(
  t: TranslateFn,
  opts: { canManagePrices: boolean },
): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'goods',
        column: 1,
        title: 'products.items.form.group.goods',
        fields: ['name', 'nameEn', 'brand', 'series', 'manufacturerModel'],
      },
      {
        id: 'sku',
        column: 1,
        title: 'products.items.form.group.sku',
        fields: ['sku'],
      },
      {
        id: 'customs',
        column: 1,
        title: 'products.items.form.group.customs',
        fields: ['hsCode', 'cnCode', 'countryOfOriginCode', 'specSummary', 'unit'],
      },
      {
        id: 'variants',
        column: 1,
        bare: true,
        component: (context) => <VariantsEditor {...context} />,
      },
      {
        id: 'prices',
        column: 1,
        bare: true,
        component: (context) => (
          <ProductPriceRowsEditor {...context} canManagePrices={opts.canManagePrices} t={t} />
        ),
      },
      {
        id: 'packing',
        column: 2,
        title: 'products.items.form.group.packing',
        fields: [
          'cartonQuantity',
          'netWeight',
          'grossWeight',
          'volume',
          'batteryCapacityMah',
          'batteryWh',
          'containsLithiumBattery',
          'certifications',
        ],
      },
      {
        id: 'dimensions',
        column: 2,
        bare: true,
        component: (context) => <DimensionsEditor {...context} t={t} />,
      },
      {
        id: 'notes',
        column: 2,
        title: 'products.items.form.group.notes',
        fields: ['notes'],
      },
      {
        id: 'settings',
        column: 2,
        title: 'products.items.form.group.status',
        fields: ['status'],
      },
    ],
    [opts.canManagePrices, t],
  )
}

/**
 * Writes the item's whole price set after the row itself was saved.
 *
 * The row is already persisted at this point, so a price failure is reported on its own key and
 * rethrown: the form keeps the operator's rows (nothing is cleared) and re-submitting retries both
 * writes — the item write is idempotent, the price submission is a full replacement.
 */
async function saveProductPrices(productId: string, rows: ProductPriceRowValues[], t: TranslateFn): Promise<void> {
  try {
    await updateCrud(PRICES_API_PATH, { productId, rows: buildProductPriceRowsPayload(rows) })
  } catch (priceError) {
    flash(t('products.items.form.priceSaveFailed', 'Could not save the prices'), 'error')
    throw priceError
  }
}

function useCanManagePrices(): boolean {
  const { payload, isReady } = useBackendChrome()
  // While the chrome payload loads nothing is hidden, so a permitted operator never sees a control
  // flicker in.
  return !isReady || hasFeature(payload?.grantedFeatures, FEATURE_PRICE_MANAGE)
}

function ProductCreateForm() {
  const t = useT()
  const canManagePrices = useCanManagePrices()
  const fields = useProductFields(t)
  const groups = useProductGroups(t, { canManagePrices })
  /**
   * The product id once the item write has landed. A price failure after that must not send the
   * operator back to a form that would create a second product: from here on the submit updates.
   */
  const createdIdRef = React.useRef<string | null>(null)
  /** The created product's variant ids, learned by a read-back so a retry replaces, never re-inserts. */
  const createdVariantIdsRef = React.useRef<Record<string, string>>({})
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('products.items.form.saved', 'Product saved'), 'success'),
    [t],
  )

  const handleSubmit = React.useCallback(
    async (values: ProductFormValues) => {
      let productId = createdIdRef.current
      const isRetry = productId !== null
      let payload = buildProductPayload(values)
      if (isRetry) {
        const entered = values.variants.filter(
          (row) => row.code.trim().length > 0 || row.name.trim().length > 0 || row.barcode.trim().length > 0,
        )
        if (entered.length === 0) {
          // The first submit let the store derive the default variant from the SKU; a retry with an
          // empty set would delete it, so the key is dropped and the variants stay untouched.
          const withoutVariants = { ...payload }
          delete withoutVariants.variants
          payload = withoutVariants
        } else {
          payload = buildProductPayload({ ...values, variants: attachVariantIds(entered, createdVariantIdsRef.current) })
        }
      }
      try {
        if (productId) {
          await updateCrud(PRODUCTS_API_PATH, { id: productId, ...payload })
        } else {
          const created = await createCrud<{ id?: string }>(PRODUCTS_API_PATH, payload)
          productId = typeof created.result?.id === 'string' ? created.result.id : null
          if (!productId) throw new Error(t('products.items.form.saveFailed', 'Could not save the product'))
          createdIdRef.current = productId
          try {
            const fresh = await fetchCrudList<Record<string, unknown>>(PRODUCTS_API_PATH, {
              ids: productId,
              pageSize: 1,
            })
            const idByCode: Record<string, string> = {}
            for (const row of readVariantRows(fresh.items?.[0]?.variants)) {
              if (row.id) idByCode[row.code] = row.id
            }
            createdVariantIdsRef.current = idByCode
          } catch {
            createdVariantIdsRef.current = {}
          }
        }
      } catch (error) {
        flash(t('products.items.form.saveFailed', 'Could not save the product'), 'error')
        throw error
      }

      if (!canManagePrices) return
      try {
        await saveProductPrices(productId, values.prices, t)
      } catch (priceError) {
        // The item exists and the prices do not: say so, keep the rows on screen and stay put so a
        // corrected re-submit (now an update) writes them.
        flash(
          t(
            'products.items.form.createPricesFailed',
            'The product was saved, but its prices were not. Correct them and save again.',
          ),
          'error',
        )
        throw priceError
      }
    },
    [canManagePrices, t],
  )

  return (
    <CrudForm<ProductFormValues>
      entityId={ENTITY_ID}
      title={t('products.items.form.createTitle', 'New product')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      fields={fields}
      groups={groups}
      initialValues={EMPTY_PRODUCT_VALUES}
      submitLabel={t('products.items.form.save', 'Save')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={handleSubmit}
    />
  )
}

function ProductEditForm({ productId }: { productId: string }) {
  const t = useT()
  const canManagePrices = useCanManagePrices()
  const fields = useProductFields(t)
  const groups = useProductGroups(t, { canManagePrices })
  const [initial, setInitial] = React.useState<ProductFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)

  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('products.items.form.saved', 'Product saved'), 'success'),
    [t],
  )

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      try {
        const payload = await fetchCrudList<Record<string, unknown>>(PRODUCTS_API_PATH, { ids: productId, pageSize: 1 })
        const item = payload?.items?.[0]
        if (!item) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        const values = toProductFormValues(item)
        // The price list is a separate read: losing it must not hide the item itself, so a failure
        // degrades to "no rows loaded" plus a message the operator can act on.
        let prices: ProductPriceRowValues[] = []
        try {
          const pricePayload = await fetchCrudList<Record<string, unknown>>(PRICES_API_PATH, {
            productId,
            pageSize: 100,
          })
          prices = (pricePayload.items ?? []).map(toProductPriceRowValues)
        } catch {
          if (!cancelled) flash(t('products.items.form.priceLoadFailed', 'Could not load the price rows'), 'error')
        }
        if (!cancelled) setInitial({ ...values, prices })
      } catch (loadError: unknown) {
        if (!cancelled) {
          if (readErrorStatus(loadError) === 404) setIsNotFound(true)
          else setError(t('products.items.form.loadFailed', 'Could not load the product'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [productId, reloadToken, t])

  const fallbackInitialValues = React.useMemo<ProductFormValues>(
    () => ({ ...EMPTY_PRODUCT_VALUES, id: productId, updatedAt: null }),
    [productId],
  )

  const handleSubmit = React.useCallback(
    async (values: ProductFormValues) => {
      const id = initial?.id || productId
      try {
        await updateCrud(PRODUCTS_API_PATH, {
          id,
          ...buildProductPayload(values),
          updatedAt: initial?.updatedAt ?? null,
        })
      } catch (updateError) {
        if (surfaceRecordConflict(updateError, t, { onRefresh: () => setReloadToken((value) => value + 1) })) {
          throw updateError
        }
        flash(t('products.items.form.saveFailed', 'Could not save the product'), 'error')
        throw updateError
      }
      if (!canManagePrices) return
      await saveProductPrices(id, values.prices, t)
    },
    [canManagePrices, initial, productId, t],
  )

  const handleDelete = React.useCallback(async () => {
    try {
      await deleteCrud(PRODUCTS_API_PATH, initial?.id || productId)
    } catch (deleteError) {
      if (surfaceRecordConflict(deleteError, t, { onRefresh: () => setReloadToken((value) => value + 1) })) return
      throw deleteError
    }
  }, [initial, productId, t])

  if (isNotFound) {
    return (
      <RecordNotFoundState
        label={t('products.items.form.loadFailed', 'Could not load the product')}
        backHref={LIST_HREF}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<ProductFormValues>
      entityId={ENTITY_ID}
      title={t('products.items.form.editTitle', 'Edit product')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      fields={fields}
      groups={groups}
      initialValues={initial ?? fallbackInitialValues}
      submitLabel={t('products.items.form.save', 'Save')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      isLoading={loading}
      onSubmit={handleSubmit}
      onDelete={handleDelete}
      deleteRedirect={LIST_HREF}
    />
  )
}

export default function ProductForm({ mode, productId }: { mode: 'create' | 'edit'; productId?: string }) {
  if (mode === 'edit') {
    if (!productId) return null
    return <ProductEditForm productId={productId} />
  }
  return <ProductCreateForm />
}
