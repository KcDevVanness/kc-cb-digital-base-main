"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { FileUploadArea } from '@open-mercato/ui/primitives/file-upload'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import {
  SUPPLIER_PRODUCT_IMPORT_FIELDS,
  type SupplierProductImportField,
} from '../lib/supplierProductExcelImport/aliases'
import { buildColumns, type DetectedColumn } from '../lib/supplierProductExcelImport/columns'
import { buildImportRows } from '../lib/supplierProductExcelImport/rows'

/**
 * Excel 导入 — bring a supplier's own product sheet into the library in three steps.
 *
 * The server does the reading and the row building; this component only carries the operator's
 * decisions across the wire (the file, the mapping, the confirmed rows) and shows what came back. The
 * mapping is rebuilt from the pure module in `lib/supplierProductExcelImport/` on every change, so switching
 * a column re-renders the preview locally — no second upload, no second parse.
 *
 * The supplier is chosen before the file, because the attachment has to be filed under a record the
 * attachments contract can verify (`entityId=purchasing:purchasing_supplier`, `recordId=<supplierId>`),
 * and the parse route refuses a file bound to anything else.
 */

const SUPPLIER_ATTACHMENT_ENTITY_ID = 'purchasing:purchasing_supplier'
const SUPPLIERS_API_PATH = 'purchasing/suppliers'
const EXCEL_IMPORT_PARSE_URL = '/api/purchasing/supplier-products/excel-import/parse'
const EXCEL_IMPORT_URL = '/api/purchasing/supplier-products/excel-import'
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
/** How many sheet rows the preview draws — the whole file is still imported. */
const PREVIEW_ROW_LIMIT = 50
/** Radix `Select` cannot hold an empty string as an item value. */
const IGNORE_TARGET = '__ignore__'

type WizardStep = 'upload' | 'mapping' | 'result'

type ParseResponse = {
  sheetName: string
  headerRowIndex: number
  headerCells: string[]
  matchedTargets: number
  columns: DetectedColumn[]
  rows: string[][]
}

type ImportResult = { created: number; failed: { row: number; reason: string }[] }

/** The field labels the mapping table offers: the library form's own wording, one key per field. */
const FIELD_LABEL_KEYS: Record<SupplierProductImportField, { key: string; fallback: string }> = {
  supplierSku: { key: 'purchasing.supplierProducts.form.field.supplierSku', fallback: 'Product SKU' },
  itemNo: { key: 'purchasing.supplierProducts.form.field.itemNo', fallback: 'Supplier item no.' },
  brandValue: { key: 'purchasing.supplierProducts.form.field.brandValue', fallback: 'Brand (code prefix)' },
  name: { key: 'purchasing.supplierProducts.form.field.name', fallback: 'Product name (as printed)' },
  nameZh: { key: 'purchasing.supplierProducts.form.field.nameZh', fallback: 'Chinese name' },
  nameEn: { key: 'purchasing.supplierProducts.form.field.nameEn', fallback: 'English name' },
  description: { key: 'purchasing.supplierProducts.form.field.description', fallback: 'Spec description' },
  declarationElements: {
    key: 'purchasing.supplierProducts.form.field.declarationElements',
    fallback: 'Declaration elements',
  },
  unit: { key: 'purchasing.supplierProducts.form.field.unit', fallback: 'Unit' },
  hsCode: { key: 'purchasing.supplierProducts.form.field.hsCode', fallback: 'HS code' },
  moqQuantity: { key: 'purchasing.supplierProducts.form.field.moqQuantity', fallback: 'MOQ' },
  cartonQuantity: { key: 'purchasing.supplierProducts.form.field.cartonQuantity', fallback: 'Qty per carton' },
  unitNetWeight: { key: 'purchasing.supplierProducts.form.field.unitNetWeight', fallback: 'Unit N.W. (kg)' },
  unitGrossWeight: { key: 'purchasing.supplierProducts.form.field.unitGrossWeight', fallback: 'Unit G.W. (kg)' },
  unitVolume: { key: 'purchasing.supplierProducts.form.field.unitVolume', fallback: 'Unit volume (cm³)' },
  discountPercent: {
    key: 'purchasing.supplierProducts.import.field.discountPercent',
    fallback: 'Discount (%)',
  },
}

/**
 * The create contract's own required columns (`supplierProductCreateSchema`): a row without a
 * 商品 SKU (`supplierSku`) or a 品名 (`name`) is refused by the contract. The wizard checks them
 * before submitting — a sheet that only carries the supplier's own 货号 would otherwise answer with
 * the same two failures on every row. 供应商货号 (`itemNo`) is deliberately not required: it is the
 * supplier's printed number, not this library's key.
 */
const REQUIRED_IMPORT_TARGETS: readonly SupplierProductImportField[] = ['supplierSku', 'name']

/** The server's own message when it sent one (a 422 explains the fix), else the caller's fallback. */
function errorMessageOf(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
    const message = payload.error.trim()
    if (message.length > 0) return message
  }
  return fallback
}

function StepIndicator({ step, t }: { step: WizardStep; t: TranslateFn }) {
  const steps: WizardStep[] = ['upload', 'mapping', 'result']
  const labels: Record<WizardStep, string> = {
    upload: t('purchasing.supplierProducts.import.step.upload', 'Upload'),
    mapping: t('purchasing.supplierProducts.import.step.mapping', 'Check the mapping'),
    result: t('purchasing.supplierProducts.import.step.result', 'Result'),
  }
  const current = steps.indexOf(step)
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {steps.map((entry, index) => (
        <li key={entry} className="flex items-center gap-2">
          {index > 0 ? <span className="h-0.5 w-6 bg-border" aria-hidden="true" /> : null}
          <span
            className={cn(
              'flex size-5 items-center justify-center rounded-full text-xs font-semibold',
              index <= current ? 'bg-foreground text-primary-foreground' : 'bg-muted text-muted-foreground',
            )}
            aria-current={entry === step ? 'step' : undefined}
          >
            {index < current ? <Check className="size-3" aria-hidden="true" /> : index + 1}
          </span>
          <span className={cn('text-xs', entry === step ? 'font-medium text-foreground' : 'text-muted-foreground')}>
            {labels[entry]}
          </span>
        </li>
      ))}
    </ol>
  )
}

export type SupplierProductImportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The supplier the library list is currently filtered by, if any — preselected and still changeable. */
  defaultSupplierId?: string | null
  /** Fired when the dialog closes after at least one row was written, so the host refreshes its list. */
  onImported?: () => void
}

export default function SupplierProductImportDialog({
  open,
  onOpenChange,
  defaultSupplierId,
  onImported,
}: SupplierProductImportDialogProps) {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [step, setStep] = React.useState<WizardStep>('upload')
  const [supplierId, setSupplierId] = React.useState<string>('')
  const [parse, setParse] = React.useState<ParseResponse | null>(null)
  const [attachmentId, setAttachmentId] = React.useState<string>('')
  const [targets, setTargets] = React.useState<(SupplierProductImportField | null)[]>([])
  const [busy, setBusy] = React.useState<'upload' | 'import' | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<ImportResult | null>(null)

  React.useEffect(() => {
    if (open) setSupplierId(defaultSupplierId ?? '')
  }, [defaultSupplierId, open])

  const supplierOptions = useQuery({
    queryKey: ['purchasing-supplier-product-import-suppliers', scopeVersion, open],
    enabled: open,
    queryFn: async () => {
      const payload = await fetchCrudList<Record<string, unknown>>(SUPPLIERS_API_PATH, {
        // 100 is the supplier list's `pageSize` cap; a larger value is a 400, not a bigger page.
        pageSize: 100,
        sortField: 'name',
        sortDir: 'asc',
        isActive: true,
      })
      return (payload.items ?? []).map((item) => ({
        value: String(item.id ?? ''),
        label: typeof item.name === 'string' && item.name.length > 0 ? item.name : String(item.code ?? ''),
      }))
    },
  })

  const columns = React.useMemo(
    () => (parse ? buildColumns(parse.headerCells, targets) : []),
    [parse, targets],
  )
  /** The spreadsheet row number of the first data row, so every built row keeps the gutter's numbering. */
  const firstRowNumber = (parse?.headerRowIndex ?? 0) + 2
  const usedTargets = React.useMemo(
    () => new Set(targets.filter((target): target is SupplierProductImportField => target !== null)),
    [targets],
  )

  const preview = React.useMemo(() => {
    if (!parse) return null
    const built = buildImportRows({ rows: parse.rows, columns, firstRowNumber })
    return { built, rows: built.rows.slice(0, PREVIEW_ROW_LIMIT) }
  }, [columns, firstRowNumber, parse])

  const reset = React.useCallback(() => {
    setStep('upload')
    setSupplierId(defaultSupplierId ?? '')
    setParse(null)
    setAttachmentId('')
    setTargets([])
    setBusy(null)
    setError(null)
    setResult(null)
  }, [defaultSupplierId])

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) {
        // The list behind the dialog must not keep showing the pre-import state.
        if (result && result.created > 0) onImported?.()
        reset()
      }
      onOpenChange(next)
    },
    [onImported, onOpenChange, reset, result],
  )

  const handleFile = React.useCallback(
    async (file: File) => {
      if (!supplierId) {
        setError(t('purchasing.supplierProducts.import.supplier.required', 'Select the supplier before uploading a file.'))
        return
      }
      setBusy('upload')
      setError(null)
      try {
        const body = new FormData()
        body.set('entityId', SUPPLIER_ATTACHMENT_ENTITY_ID)
        body.set('recordId', supplierId)
        body.set('partitionCode', 'privateAttachments')
        body.set('file', file)
        const upload = await apiCall<{ item?: { id?: string } }>('/api/attachments', { method: 'POST', body }, { fallback: null })
        const uploadedId = upload.ok && upload.result?.item?.id ? upload.result.item.id : ''
        if (!uploadedId) {
          setError(errorMessageOf(upload.result, t('purchasing.supplierProducts.import.upload.failed', 'The file could not be uploaded.')))
          return
        }

        const parsed = await apiCall<ParseResponse>(EXCEL_IMPORT_PARSE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ supplierId, attachmentId: uploadedId }),
        })
        if (!parsed.ok || !parsed.result) {
          setError(errorMessageOf(parsed.result, t('purchasing.supplierProducts.import.parse.failed', 'The file could not be parsed.')))
          return
        }

        const outcome = parsed.result
        if (!Array.isArray(outcome.columns) || outcome.columns.length === 0) {
          setError(t('purchasing.supplierProducts.import.parse.noHeader', 'No header row was found: name the columns as the library does (供应商货号, 品名（中文）, 单位, …).'))
          return
        }
        setAttachmentId(uploadedId)
        setParse(outcome)
        setTargets(outcome.columns.map((column) => column.target))
        setStep('mapping')
      } finally {
        setBusy(null)
      }
    },
    [supplierId, t],
  )

  const handleTargetChange = React.useCallback((index: number, value: string) => {
    // The value comes from this component's own options; anything unknown (the ignore sentinel) is "no target".
    const next = SUPPLIER_PRODUCT_IMPORT_FIELDS.find((field) => field === value) ?? null
    setTargets((current) => current.map((target, position) => (position === index ? next : target)))
  }, [])

  const handleImport = React.useCallback(async () => {
    if (!parse || !preview || busy) return
    const built = preview.built
    if (built.rows.length === 0) {
      setError(t('purchasing.supplierProducts.import.submit.nothing', 'Nothing to import yet: map at least one column.'))
      return
    }
    const missing = REQUIRED_IMPORT_TARGETS.filter(
      (field) => !columns.some((column) => column.target === field),
    )
    if (missing.length > 0) {
      setError(
        t('purchasing.supplierProducts.import.mapping.required', 'Map these columns to import: {fields}', {
          fields: missing.map((field) => t(FIELD_LABEL_KEYS[field].key, FIELD_LABEL_KEYS[field].fallback)).join(' / '),
        }),
      )
      return
    }
    setBusy('import')
    setError(null)
    try {
      const response = await apiCall<ImportResult>(EXCEL_IMPORT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId,
          attachmentId,
          rows: built.rows.map(({ row, values }) => ({ row, values })),
        }),
      })
      if (!response.ok || !response.result) {
        setError(errorMessageOf(response.result, t('purchasing.supplierProducts.import.failed', 'The import failed.')))
        return
      }
      setResult(response.result)
      setStep('result')
    } finally {
      setBusy(null)
    }
  }, [attachmentId, busy, columns, parse, preview, supplierId, t])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => {
      if (step === 'mapping') void handleImport()
    },
    onCancel: () => handleOpenChange(false),
  })

  const mappedCount = columns.filter((column) => column.target !== null).length
  const importableRows = preview?.built.rows.length ?? 0
  const missingRequiredTargets = REQUIRED_IMPORT_TARGETS.filter((field) => !usedTargets.has(field))

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent onKeyDown={handleKeyDown} size="xl">
        <DialogHeader>
          <DialogTitle>{t('purchasing.supplierProducts.import.title', 'Import supplier products from Excel')}</DialogTitle>
          <DialogDescription>
            {t(
              'purchasing.supplierProducts.import.description',
              'Pick the supplier, upload its product sheet (.xlsx/.xls/.csv), check the suggested column mapping and import. Prices are not imported yet.',
            )}
          </DialogDescription>
        </DialogHeader>

        <StepIndicator step={step} t={t} />

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {step === 'upload' ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="supplier-product-import-supplier">
                {t('purchasing.supplierProducts.import.supplier.label', 'Supplier')}
              </label>
              <Select value={supplierId || undefined} onValueChange={setSupplierId} disabled={busy !== null}>
                <SelectTrigger id="supplier-product-import-supplier">
                  <SelectValue placeholder={t('purchasing.supplierProducts.import.supplier.placeholder', 'Select a supplier')} />
                </SelectTrigger>
                <SelectContent>
                  {(supplierOptions.data ?? []).map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {supplierOptions.error ? (
                <p className="text-xs text-destructive">
                  {t('purchasing.supplierProducts.import.supplier.loadFailed', 'Could not load the suppliers.')}
                </p>
              ) : null}
            </div>

            <FileUploadArea
              accept=".xlsx,.xls,.csv"
              multiple={false}
              maxSizeBytes={MAX_UPLOAD_BYTES}
              disabled={busy !== null}
              onFilesSelected={(files) => {
                const file = files[0]
                if (file) void handleFile(file)
              }}
              heading={t('purchasing.supplierProducts.import.upload.heading', 'Choose a file or drag & drop it here')}
              description={t('purchasing.supplierProducts.import.upload.description', '.xlsx, .xls and .csv, up to 25 MB.')}
            />

            {busy === 'upload' ? (
              <p className="text-sm text-muted-foreground">
                {t('purchasing.supplierProducts.import.upload.busy', 'Uploading and reading the sheet…')}
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 'mapping' && parse ? (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium">
                {t('purchasing.supplierProducts.import.mapping.title', 'Column mapping')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(
                  'purchasing.supplierProducts.import.mapping.help',
                  'Sheet “{sheet}”, header on row {row}: {mapped} of {total} columns mapped. A column left on “Ignore” is not imported.',
                  { sheet: parse.sheetName, row: parse.headerRowIndex + 1, mapped: mappedCount, total: columns.length },
                )}
              </p>
              {/*
                The create contract's required columns are checked *here*, before submit: a sheet that
                only carries 供应商货号 (the supplier's own item number, mapped to `itemNo`) without the
                library's 商品 SKU / 品名 would otherwise fail on every row with the same two reasons.
              */}
              {missingRequiredTargets.length > 0 ? (
                <p className="text-xs text-status-warning-text" role="alert">
                  {t('purchasing.supplierProducts.import.mapping.required', 'Map these columns to import: {fields}', {
                    fields: missingRequiredTargets
                      .map((field) => t(FIELD_LABEL_KEYS[field].key, FIELD_LABEL_KEYS[field].fallback))
                      .join(' / '),
                  })}
                </p>
              ) : null}
            </div>

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      {t('purchasing.supplierProducts.import.mapping.column', 'Column')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      {t('purchasing.supplierProducts.import.mapping.target', 'Target field')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {columns.map((column) => (
                    <tr key={column.index}>
                      <td className="px-3 py-2 align-middle">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className={cn(column.target === null && 'text-muted-foreground')}>
                            {column.header || `#${column.index + 1}`}
                          </span>
                          {column.matchLevel === 'exact' ? <Badge variant="secondary">{t('purchasing.supplierProducts.import.mapping.exact', 'exact')}</Badge> : null}
                          {column.matchLevel === 'alias' ? <Badge variant="outline">{t('purchasing.supplierProducts.import.mapping.alias', 'alias')}</Badge> : null}
                          {column.unsupported === 'price' ? (
                            <Badge variant="outline">
                              {t('purchasing.supplierProducts.import.mapping.price', 'price column — not imported yet')}
                            </Badge>
                          ) : null}
                          {column.duplicateOf !== undefined ? (
                            <Badge variant="outline">
                              {t('purchasing.supplierProducts.import.mapping.duplicate', 'same field as column {index}, ignored', {
                                index: column.duplicateOf + 1,
                              })}
                            </Badge>
                          ) : null}
                        </span>
                      </td>
                      <td className="w-64 px-3 py-2 align-middle">
                        <Select
                          value={column.target ?? IGNORE_TARGET}
                          onValueChange={(value) => handleTargetChange(column.index, value)}
                          disabled={busy !== null}
                        >
                          <SelectTrigger aria-label={`${t('purchasing.supplierProducts.import.mapping.target', 'Target field')} ${column.header || column.index + 1}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={IGNORE_TARGET}>
                              {t('purchasing.supplierProducts.import.mapping.ignore', 'Ignore (do not import)')}
                            </SelectItem>
                            {SUPPLIER_PRODUCT_IMPORT_FIELDS.map((field) => (
                              <SelectItem
                                key={field}
                                value={field}
                                // One field, one column: the options another column already took are not offered.
                                disabled={usedTargets.has(field) && column.target !== field}
                              >
                                {t(FIELD_LABEL_KEYS[field].key, FIELD_LABEL_KEYS[field].fallback)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <p className="text-sm font-medium">
                {t('purchasing.supplierProducts.import.preview.title', 'Preview (first {count} rows)', {
                  count: preview?.rows.length ?? 0,
                })}
              </p>
              {preview && preview.rows.length > 0 ? (
                <div className="max-h-72 overflow-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted">
                      <tr>
                        <th scope="col" className="px-2 py-1.5 text-left font-medium">
                          #
                        </th>
                        {columns.map((column) => (
                          <th
                            key={column.index}
                            scope="col"
                            className={cn('whitespace-nowrap px-2 py-1.5 text-left font-medium', column.target === null && 'text-muted-foreground')}
                          >
                            {column.header || `#${column.index + 1}`}
                            {column.target === null ? (
                              <span className="ml-1 font-normal">
                                · {t('purchasing.supplierProducts.import.preview.ignored', 'ignored')}
                              </span>
                            ) : null}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {preview.rows.map((built) => {
                        const raw = parse.rows[built.row - firstRowNumber] ?? []
                        return (
                          <tr key={built.row}>
                            <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{built.row}</td>
                            {columns.map((column) => {
                              const normalized = column.target ? built.values[column.target] : undefined
                              const text = column.target ? (normalized ?? '') : (raw[column.index] ?? '')
                              const invalid = column.target
                                ? built.cellErrors.some((cellError) => cellError.field === column.target)
                                : false
                              return (
                                <td
                                  key={column.index}
                                  className={cn(
                                    'whitespace-nowrap px-2 py-1.5',
                                    column.target === null && 'text-muted-foreground',
                                    invalid && 'text-destructive',
                                  )}
                                  title={
                                    invalid
                                      ? t('purchasing.supplierProducts.import.preview.invalid', 'This value cannot be read — the row will fail on import.')
                                      : undefined
                                  }
                                >
                                  {text.length > 0 ? text : '—'}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('purchasing.supplierProducts.import.preview.empty', 'No data rows below the header.')}
                </p>
              )}
              {preview?.built.truncated ? (
                <p className="mt-1 text-xs text-status-warning-text">
                  {t('purchasing.supplierProducts.import.preview.truncated', 'The sheet is larger than one import may carry; only the first rows are imported.')}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={busy !== null}>
                {t('ui.forms.actions.cancel', 'Cancel')}
              </Button>
              <Button type="button" onClick={() => void handleImport()} disabled={busy !== null || mappedCount === 0 || missingRequiredTargets.length > 0}>
                {busy === 'import'
                  ? t('purchasing.supplierProducts.import.submit.busy', 'Importing…')
                  : t('purchasing.supplierProducts.import.submit', 'Import {count} rows', { count: importableRows })}
              </Button>
            </div>
          </div>
        ) : null}

        {step === 'result' && result ? (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium">{t('purchasing.supplierProducts.import.result.title', 'Import result')}</p>
              <p className="text-sm">
                {t('purchasing.supplierProducts.import.result.summary', 'Created {created} rows', { created: result.created })}
              </p>
              {result.failed.length > 0 ? (
                <p className="text-sm text-destructive">
                  {t('purchasing.supplierProducts.import.result.failedSummary', '{count} rows failed', {
                    count: result.failed.length,
                  })}
                </p>
              ) : null}
            </div>
            {result.failed.length > 0 ? (
              <ul className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-3 text-sm">
                {result.failed.map((failure) => (
                  <li key={failure.row}>
                    <span className="font-medium">
                      {t('purchasing.supplierProducts.import.result.failedRow', 'Row {row}', { row: failure.row })}
                    </span>
                    {': '}
                    {failure.reason}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex justify-end">
              <Button type="button" onClick={() => handleOpenChange(false)}>
                {t('purchasing.supplierProducts.import.result.close', 'Close')}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
