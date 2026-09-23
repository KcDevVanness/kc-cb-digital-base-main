"use client"

import * as React from 'react'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { Trash2, Upload, Plus } from 'lucide-react'
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
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
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
import { loadCurrencyOptions } from './PurchaseOrderForm'
import { SUPPLIER_PRODUCT_PRICE_KIND_ORDER, type SupplierProductPriceKind } from '../lib/priceKinds'

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
  isPriceKind,
  readImageIds,
  readPacking,
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
    ? t('purchasing.supplierProducts.price.kind.supplierCost', '供应商供货价')
    : t('purchasing.supplierProducts.price.kind.companyOffer', '本公司报价')
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
 * The item's whole price list: one row per kind × currency × minimum quantity.
 *
 * Rows are the form's `prices` value, so a rejected save keeps whatever the operator typed and a
 * retry only has to press save again. A row is never deleted here — switching it off submits it as
 * `isActive: false`, which is what keeps a historical price explainable instead of gone.
 */
function SupplierProductPriceRows({ values, setValue, errors, t }: CrudFormGroupComponentProps & { t: TranslateFn }) {
  const rows = React.useMemo(
    () => (Array.isArray(values.prices) ? (values.prices as SupplierProductPriceRowValues[]) : []),
    [values.prices],
  )
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

  const kindOptions = React.useMemo<CrudFieldOption[]>(
    () => SUPPLIER_PRODUCT_PRICE_KIND_ORDER.map((kind) => ({ value: kind, label: priceKindLabel(t, kind) })),
    [t],
  )

  const updateRow = React.useCallback(
    (index: number, patch: Partial<SupplierProductPriceRowValues>) => {
      setValue(
        'prices',
        rows.map((row, position) => (position === index ? { ...row, ...patch } : row)),
      )
    },
    [rows, setValue],
  )

  return (
    <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{t('purchasing.supplierProducts.price.title', '价格 Prices')}</h3>
          <p className="text-xs text-muted-foreground">
            {t(
              'purchasing.supplierProducts.price.hint',
              '每条 = 价格类型 × 币种 × 起订量；原「PK 单价」= 供应商供货价，原「KC 单价」= 本公司报价。移除的行会被停用，不会删除。',
            )}
          </p>
        </div>
        <Button type="button" variant="outline" disabled={rows.length >= 24} onClick={() => setValue('prices', [...rows, createEmptyPriceRow()])}>
          <Plus className="size-4" aria-hidden="true" />
          {t('purchasing.supplierProducts.price.add', '新增价格')}
        </Button>
      </div>

      {priceError ? (
        <p className="text-xs text-status-error-text" role="alert">
          {errors[priceError]}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('purchasing.supplierProducts.price.empty', '还没有价格：点「新增价格」录入供应商供货价或本公司报价。')}
        </p>
      ) : null}

      {rows.map((row, index) => {
        const fieldId = (suffix: string) => `supplier-product-price-${row.key}-${suffix}`
        const kindId = fieldId('kind')
        const currencyId = fieldId('currency')
        const minQuantityId = fieldId('minQuantity')
        const unitPriceId = fieldId('unitPrice')
        const activeId = fieldId('active')
        return (
          <div key={row.key} className="rounded-md border bg-background p-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="space-y-1.5 md:col-span-3">
                <FieldLabel htmlFor={kindId} required>
                  {t('purchasing.supplierProducts.price.field.kind', '价格类型 Price kind')}
                </FieldLabel>
                <Select
                  value={row.priceKind}
                  onValueChange={(next) => updateRow(index, { priceKind: isPriceKind(next) ? next : 'supplier_cost' })}
                >
                  <SelectTrigger id={kindId} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {kindOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-3">
                <FieldLabel htmlFor={currencyId} required>
                  {t('purchasing.supplierProducts.price.field.currency', '币种 Currency')}
                </FieldLabel>
                <Select
                  value={row.currencyCode.trim().toUpperCase() || undefined}
                  onValueChange={(next) => updateRow(index, { currencyCode: next })}
                >
                  <SelectTrigger id={currencyId} className="w-full">
                    <SelectValue placeholder={t('purchasing.supplierProducts.price.field.currency', '币种 Currency')} />
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
                <FieldLabel htmlFor={minQuantityId}>
                  {t('purchasing.supplierProducts.price.field.minQuantity', '起订量 Min qty')}
                </FieldLabel>
                <Input
                  id={minQuantityId}
                  value={row.minQuantity}
                  inputMode="numeric"
                  onChange={(event) => updateRow(index, { minQuantity: event.target.value })}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <FieldLabel htmlFor={unitPriceId} required>
                  {t('purchasing.supplierProducts.price.field.unitPrice', '单价 Unit price')}
                </FieldLabel>
                <Input
                  id={unitPriceId}
                  value={row.unitPrice}
                  inputMode="decimal"
                  onChange={(event) => updateRow(index, { unitPrice: event.target.value })}
                />
              </div>
              <div className="flex items-end justify-between gap-2 md:col-span-2">
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    id={activeId}
                    checked={row.isActive}
                    onCheckedChange={(next) => updateRow(index, { isActive: next === true })}
                  />
                  {t('purchasing.supplierProducts.price.field.active', '启用')}
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={t('purchasing.supplierProducts.price.remove', '移除该价格行')}
                  onClick={() => setValue('prices', rows.filter((_, position) => position !== index))}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * The product photos (REQ-SPL-014).
 *
 * Create-then-bind like every other attachment in this app: the file is uploaded against the saved
 * row (`entityId` + row id) and the returned id is appended to the row's `imageAttachmentIds`,
 * which the form then saves. So a failed upload leaves the row exactly as it was, and the list is
 * behind the row's optimistic lock — two editors cannot silently drop each other's photo.
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
  const imageIds = readImageIds(values.imageAttachmentIds)

  const handleFiles = React.useCallback(
    async (files: FileList | null) => {
      const file = files?.[0]
      if (inputRef.current) inputRef.current.value = ''
      if (!file) return
      if (!productId) {
        flash(t('purchasing.supplierProducts.form.images.saveFirst', '请先保存商品，再上传图片'), 'error')
        return
      }
      if (imageIds.length >= MAX_IMAGES) {
        flash(
          t('purchasing.supplierProducts.form.images.tooMany', '最多 {count} 张商品图片', { count: MAX_IMAGES }),
          'error',
        )
        return
      }
      setUploading(true)
      try {
        const body = new FormData()
        body.set('entityId', ATTACHMENT_ENTITY_ID)
        body.set('recordId', productId)
        body.set('file', file)
        const upload = await apiCall<{ item?: { id?: string } }>('/api/attachments', { method: 'POST', body }, { fallback: null })
        const attachmentId = upload.ok && typeof upload.result?.item?.id === 'string' ? upload.result.item.id : ''
        if (!attachmentId) {
          flash(t('purchasing.supplierProducts.form.images.uploadFailed', '图片上传失败'), 'error')
          return
        }
        // Bound in the form's own state, then saved with the row: the operator sees the thumbnail
        // immediately and a rejected row save never leaves a half-bound list behind.
        setValue('imageAttachmentIds', [...imageIds, attachmentId])
        flash(t('purchasing.supplierProducts.form.images.uploaded', '图片已上传，保存后生效'), 'success')
      } catch {
        flash(t('purchasing.supplierProducts.form.images.uploadFailed', '图片上传失败'), 'error')
      } finally {
        setUploading(false)
      }
    },
    [imageIds, productId, setValue, t],
  )

  return (
    <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{t('purchasing.supplierProducts.form.images.title', '商品图片 Photos')}</h3>
          <p className="text-xs text-muted-foreground">
            {productId
              ? t('purchasing.supplierProducts.form.images.hint', '最多 {count} 张；保存商品后图片列表才生效。', { count: MAX_IMAGES })
              : t('purchasing.supplierProducts.form.images.saveFirst', '请先保存商品，再上传图片')}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={uploading || !productId || imageIds.length >= MAX_IMAGES}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-4" aria-hidden="true" />
          {uploading
            ? t('purchasing.supplierProducts.form.images.uploading', '上传中…')
            : t('purchasing.supplierProducts.form.images.upload', '上传图片')}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label={t('purchasing.supplierProducts.form.images.upload', '上传图片')}
          onChange={(event) => void handleFiles(event.target.files)}
        />
      </div>

      {imageIds.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('purchasing.supplierProducts.form.images.empty', '还没有图片')}</p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {imageIds.map((attachmentId) => (
            <li key={attachmentId} className="relative">
              {/*
                `unoptimized` on purpose: the file is served by the attachments route, which
                authorizes the caller — the optimizer would fetch it server-side without the
                session and get a 401 instead of an image.
              */}
              <Image
                src={`/api/attachments/file/${encodeURIComponent(attachmentId)}`}
                alt={t('purchasing.supplierProducts.form.images.alt', '商品图片')}
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
                aria-label={t('purchasing.supplierProducts.form.images.remove', '移除该图片')}
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

function useSupplierProductFields(t: TranslateFn, opts: { supplierEditable: boolean }): CrudField[] {
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
        label: t('purchasing.supplierProducts.form.field.supplierSku', '供应商货号 Supplier code'),
        description: t(
          'purchasing.supplierProducts.form.help.supplierSku',
          '本供应商下的唯一货号；一个货号永不复用（含已删除行）。',
        ),
        type: 'text',
        required: true,
        maxLength: 120,
      },
      {
        id: 'name',
        label: t('purchasing.supplierProducts.form.field.name', '商品名称（供应商原始名）Name (supplier)'),
        description: t(
          'purchasing.supplierProducts.form.help.name',
          '供应商产品表上的原始商品名，照录不改；同步为商品时不覆盖我们自己的中文品名。',
        ),
        type: 'text',
        required: true,
        maxLength: 300,
      },
      {
        id: 'nameZh',
        label: t('purchasing.supplierProducts.form.field.nameZh', '中文品名 Name (Chinese)'),
        description: t(
          'purchasing.supplierProducts.form.help.nameZh',
          '我们自己定义的中文名；同步为商品时写入商品主数据的商品名称。',
        ),
        type: 'text',
        maxLength: 300,
      },
      {
        id: 'nameEn',
        label: t('purchasing.supplierProducts.form.field.nameEn', '英文品名 Name (English)'),
        description: t(
          'purchasing.supplierProducts.form.help.nameEn',
          '我们自己定义的英文名；用于出口单据，并写入商品主数据的英文名。',
        ),
        type: 'text',
        maxLength: 300,
      },
      {
        id: 'hsCode',
        label: t('purchasing.supplierProducts.form.field.hsCode', 'HS CODE 海关编码'),
        description: t(
          'purchasing.supplierProducts.form.help.hsCode',
          'Harmonized System Code — 海关商品编码。按文本保存，保留前导零与分组点（如 8471.30.0000），不要当数字填。',
        ),
        type: 'text',
        maxLength: 32,
      },
      {
        id: 'declarationElements',
        label: t('purchasing.supplierProducts.form.field.declarationElements', '申报要素 Declaration elements'),
        description: t(
          'purchasing.supplierProducts.form.help.declarationElements',
          '报关申报要素（品名/品牌/型号/材质/用途/规格…），报关单按此填报，照录不改。',
        ),
        type: 'textarea',
        rows: 3,
        maxLength: 2000,
      },
      {
        id: 'unit',
        label: t('purchasing.supplierProducts.form.field.unit', '单位 Unit of measure'),
        description: t(
          'purchasing.supplierProducts.form.help.unit',
          '下拉来自字典 supplier_product_unit（可在「字典库」维护）；字典里没有的编码仍可直接输入。',
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
        label: t('purchasing.supplierProducts.form.field.moqQuantity', 'MOQ 最小起订量'),
        description: t(
          'purchasing.supplierProducts.form.help.moqQuantity',
          'Minimum Order Quantity — 供应商最小起订量。',
        ),
        type: 'number',
      },
      {
        id: 'cartonQuantity',
        label: t('purchasing.supplierProducts.form.field.cartonQuantity', 'Qty/Box 每箱数量'),
        description: t(
          'purchasing.supplierProducts.form.help.cartonQuantity',
          'Quantity per box — 每箱装箱数量（件/箱），发运分摊与装箱核算按此换算。',
        ),
        type: 'number',
      },
      {
        id: 'unitNetWeight',
        label: t('purchasing.supplierProducts.form.field.unitNetWeight', '单件净重 Unit N.W (kg)'),
        description: t('purchasing.supplierProducts.form.help.unitNetWeight', '单件净重，单位 kg。'),
        type: 'number',
      },
      {
        id: 'cartonGrossWeight',
        label: t('purchasing.supplierProducts.form.field.cartonGrossWeight', 'G.W 毛重（整箱 kg）'),
        description: t(
          'purchasing.supplierProducts.form.help.cartonGrossWeight',
          'Gross Weight — 整箱毛重（含包装），单位 kg；订舱与报关按此申报。',
        ),
        type: 'number',
      },
      {
        id: 'cartonNetWeight',
        label: t('purchasing.supplierProducts.form.field.cartonNetWeight', 'N.W 净重（整箱 kg）'),
        description: t(
          'purchasing.supplierProducts.form.help.cartonNetWeight',
          'Net Weight — 整箱净重（不含包装），单位 kg。',
        ),
        type: 'number',
      },
      {
        id: 'itemNo',
        label: t('purchasing.supplierProducts.form.field.itemNo', '原始货号 Item no.'),
        description: t(
          'purchasing.supplierProducts.form.help.itemNo',
          '供应商原始表格上的商品编号；与供应商货号不同时两个都保留展示。',
        ),
        type: 'text',
        maxLength: 120,
      },
      {
        id: 'description',
        label: t('purchasing.supplierProducts.form.field.description', '规格描述 Spec / description'),
        description: t(
          'purchasing.supplierProducts.form.help.description',
          '供应商原始规格描述；同步为商品时写入商品主数据的规格说明。',
        ),
        type: 'textarea',
        rows: 4,
        maxLength: 2000,
      },
      {
        id: 'status',
        label: t('purchasing.supplierProducts.form.field.status', '状态 Status'),
        type: 'select',
        options: [
          { value: 'active', label: t('purchasing.supplierProducts.status.active', 'Active') },
          { value: 'inactive', label: t('purchasing.supplierProducts.status.inactive', 'Inactive') },
        ],
      },
      {
        id: 'notes',
        label: t('purchasing.supplierProducts.form.field.notes', '备注 Notes'),
        description: t('purchasing.supplierProducts.form.help.notes', '内部备注，不打印在单据上。'),
        type: 'textarea',
        rows: 3,
        maxLength: 2000,
      },
    ]
  }, [opts.supplierEditable, t])
}

/**
 * The form's groups, ordered so the two columns read as "what the item is" (column 1) and "what we
 * pay, pack and shipped it as" (column 2).
 *
 * ERP-generic fields live in 商品标识 / 报关信息 / 价格 / 包装与重量; the fields that are transcriptions
 * of the supplier's own workbook live in 供应商原始资料. Keeping that split explicit is what lets a
 * buyer who never saw the workbook find a field by meaning instead of by column order.
 */
function useSupplierProductGroups(t: TranslateFn, opts: { productId: string | null }): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'goods',
        column: 1,
        title: t('purchasing.supplierProducts.form.group.goods', '商品标识 Goods identity'),
        fields: ['supplierId', 'supplierName', 'supplierSku', 'name', 'nameZh', 'nameEn'],
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
        title: t('purchasing.supplierProducts.form.group.customs', '报关信息 Customs & unit'),
        fields: ['hsCode', 'declarationElements', 'unit'],
      },
      {
        id: 'prices',
        column: 2,
        bare: true,
        component: (context) => <SupplierProductPriceRows {...context} t={t} />,
      },
      {
        id: 'packing',
        column: 2,
        title: t('purchasing.supplierProducts.form.group.packing', '包装与重量 Packing & weights（整箱）'),
        fields: ['cartonQuantity', 'cartonGrossWeight', 'cartonNetWeight', 'unitNetWeight', 'moqQuantity'],
      },
      {
        id: 'outerPacking',
        column: 2,
        bare: true,
        component: (context) => (
          <PackingEditor
            {...context}
            fieldId="outerPacking"
            label={t('purchasing.supplierProducts.form.field.outerPacking', '外箱尺寸 L×W×H (cm)')}
            t={t}
          />
        ),
      },
      {
        id: 'innerPacking',
        column: 2,
        bare: true,
        component: (context) => (
          <PackingEditor
            {...context}
            fieldId="innerPacking"
            label={t('purchasing.supplierProducts.form.field.innerPacking', '内盒尺寸 L×W×H (cm)')}
            t={t}
          />
        ),
      },
      {
        id: 'supplierSheet',
        column: 2,
        title: t('purchasing.supplierProducts.form.group.supplierSheet', '供应商原始资料 Supplier sheet'),
        fields: ['itemNo', 'description', 'notes'],
      },
      {
        id: 'settings',
        column: 2,
        title: t('purchasing.supplierProducts.form.group.settings', '状态 Status'),
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
  const searchParams = useSearchParams()
  const fields = useSupplierProductFields(t, { supplierEditable: true })
  // No id yet: the photo uploader is disabled until the row exists (create-then-bind).
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

  const handleSubmit = React.useCallback(async (values: SupplierProductFormValues) => {
    let createdId: string | null = null
    try {
      const created = await createCrud<{ id?: string }>(API_PATH, {
        ...buildSupplierProductPayload(values),
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
    await saveSupplierProductPrices(createdId, values.prices, t)
  }, [t])

  return (
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
  )
}

function SupplierProductEditForm({ productId }: { productId: string }) {
  const t = useT()
  const fields = useSupplierProductFields(t, { supplierEditable: false })
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