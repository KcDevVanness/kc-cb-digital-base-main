"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { QuoteImportWizard } from './QuoteImportWizard'

/**
 * The two ways a quotation starts: typed by hand, or imported from a workbook.
 *
 * Manual entry creates the quotation first and then posts its lines one by one (the line commands
 * are the aggregate's write path); the import path hands over to the wizard, which creates the
 * quotation itself when it needs one. Both end on the review console, where the same approval and
 * promotion path runs — so a hand-typed list is not a second-class citizen.
 */

const MAX_MANUAL_LINES = 50

type SupplierRow = { id: string; name: string }

type ManualLine = {
  key: string
  sectionLabel: string
  itemNo: string
  productName: string
  derivedSku: string
  unitCost: string
  moqQuantity: string
}

function emptyLine(): ManualLine {
  return {
    key: Math.random().toString(36).slice(2),
    sectionLabel: '',
    itemNo: '',
    productName: '',
    derivedSku: '',
    unitCost: '',
    moqQuantity: '',
  }
}

export function QuoteCreatePanel({ initialMode = 'import' }: { initialMode?: 'manual' | 'import' }) {
  const t = useT()
  const router = useRouter()
  const [mode, setMode] = React.useState<'manual' | 'import'>(initialMode)
  const [supplierId, setSupplierId] = React.useState('')
  const [currencyCode, setCurrencyCode] = React.useState('CNY')
  const [quoteDate, setQuoteDate] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [lines, setLines] = React.useState<ManualLine[]>([emptyLine()])
  const [saving, setSaving] = React.useState(false)

  // The list links here with `#manual` or `#import`; module pages are not given `searchParams`,
  // and a hash is the one intent carrier that works without server plumbing.
  React.useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    if (hash === 'manual' || hash === 'import') setMode(hash)
  }, [])

  const suppliersQuery = useQuery({
    queryKey: ['sourcing-supplier-options'],
    queryFn: () => fetchCrudList<SupplierRow>('purchasing/suppliers', { pageSize: 200, isActive: 'true', sortField: 'name', sortDir: 'asc' }),
    staleTime: 60_000,
  })
  const suppliers = suppliersQuery.data?.items ?? []

  const updateLine = React.useCallback((key: string, patch: Partial<ManualLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }, [])

  const handleSave = React.useCallback(async () => {
    const usable = lines.filter((line) => line.itemNo.trim().length > 0 || line.productName.trim().length > 0)
    if (usable.length === 0) {
      flash(t('sourcing.lines.empty', 'No data rows were parsed'), 'error')
      return
    }
    setSaving(true)
    try {
      const created = await apiCall<{ id: string }>('/api/sourcing/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId: supplierId || null,
          quoteDate: quoteDate || null,
          currencyCode,
          sourceKind: 'manual',
          notes: notes.trim() || null,
        }),
      })
      if (!created.ok || !created.result?.id) {
        flash(t('sourcing.errors.saveFailed', 'Saving failed'), 'error')
        return
      }
      const quoteId = created.result.id
      for (const line of usable) {
        const response = await apiCall('/api/sourcing/quote-lines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quoteId,
            sectionLabel: line.sectionLabel.trim() || null,
            itemNo: line.itemNo.trim() || null,
            productName: line.productName.trim() || null,
            derivedSku: (line.derivedSku.trim() || line.itemNo.trim()) || null,
            unitCost: line.unitCost.trim() || null,
            moqQuantity: line.moqQuantity.trim() || null,
          }),
        })
        if (!response.ok) {
          flash(t('sourcing.errors.saveFailed', 'Saving failed'), 'error')
          router.push(`/backend/sourcing/quotes/${quoteId}`)
          return
        }
      }
      flash(t('sourcing.lines.actions.saved', 'Saved {count} lines', { count: usable.length }), 'success')
      router.push(`/backend/sourcing/quotes/${quoteId}`)
    } finally {
      setSaving(false)
    }
  }, [currencyCode, lines, notes, quoteDate, router, supplierId, t])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={mode === 'manual' ? 'default' : 'secondary'} onClick={() => setMode('manual')}>
          {t('sourcing.quotes.actions.create', 'New quotation')}
        </Button>
        <Button variant={mode === 'import' ? 'default' : 'secondary'} onClick={() => setMode('import')}>
          {t('sourcing.quotes.actions.import', 'Import Excel')}
        </Button>
      </div>

      {mode === 'import' ? (
        <QuoteImportWizard
          defaultSupplierId={supplierId || null}
          defaultCurrencyCode={currencyCode}
          // Navigation waits for the review step: the operator confirms the column mapping first,
          // and only then lands on the console that shows the resulting lines.
          onReviewReady={(id) => router.push(`/backend/sourcing/quotes/${id}`)}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sourcing-supplier">{t('sourcing.quotes.list.columns.supplier', 'Supplier')}</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger id="sourcing-supplier">
                  <SelectValue placeholder={t('sourcing.lines.noValue', '—')} />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sourcing-quote-date">{t('sourcing.quotes.list.columns.quoteDate', 'Quote date')}</Label>
              <Input id="sourcing-quote-date" type="date" value={quoteDate} onChange={(event) => setQuoteDate(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sourcing-currency">{t('sourcing.quotes.list.columns.currency', 'Currency')}</Label>
              <Input
                id="sourcing-currency"
                value={currencyCode}
                maxLength={3}
                onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sourcing-notes">{t('sourcing.quotes.list.columns.notes', 'Notes')}</Label>
              <Input id="sourcing-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {lines.map((line) => (
              <div key={line.key} className="grid grid-cols-1 gap-2 rounded-md border border-border p-2 md:grid-cols-12">
                <Input
                  className="md:col-span-2"
                  value={line.itemNo}
                  placeholder={t('sourcing.lines.column.itemNo', 'Item No.')}
                  aria-label={t('sourcing.lines.column.itemNo', 'Item No.')}
                  onChange={(event) => updateLine(line.key, { itemNo: event.target.value })}
                />
                <Input
                  className="md:col-span-4"
                  value={line.productName}
                  placeholder={t('sourcing.lines.column.productName', 'Product')}
                  aria-label={t('sourcing.lines.column.productName', 'Product')}
                  onChange={(event) => updateLine(line.key, { productName: event.target.value })}
                />
                <Input
                  className="md:col-span-2"
                  value={line.derivedSku}
                  placeholder={t('sourcing.lines.column.sku', 'SKU')}
                  aria-label={t('sourcing.lines.column.sku', 'SKU')}
                  onChange={(event) => updateLine(line.key, { derivedSku: event.target.value })}
                />
                <Input
                  className="md:col-span-1"
                  value={line.unitCost}
                  placeholder={t('sourcing.lines.column.unitCost', 'Unit cost')}
                  aria-label={t('sourcing.lines.column.unitCost', 'Unit cost')}
                  onChange={(event) => updateLine(line.key, { unitCost: event.target.value })}
                />
                <Input
                  className="md:col-span-1"
                  value={line.moqQuantity}
                  placeholder={t('sourcing.lines.column.moq', 'MOQ')}
                  aria-label={t('sourcing.lines.column.moq', 'MOQ')}
                  onChange={(event) => updateLine(line.key, { moqQuantity: event.target.value })}
                />
                <Input
                  className="md:col-span-1"
                  value={line.sectionLabel}
                  placeholder={t('sourcing.lines.column.section', 'Section')}
                  aria-label={t('sourcing.lines.column.section', 'Section')}
                  onChange={(event) => updateLine(line.key, { sectionLabel: event.target.value })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="md:col-span-1"
                  aria-label={t('sourcing.quotes.actions.delete', 'Delete')}
                  disabled={lines.length === 1}
                  onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={lines.length >= MAX_MANUAL_LINES}
                onClick={() => setLines((current) => [...current, emptyLine()])}
              >
                <Plus className="size-4" aria-hidden="true" />
                {t('sourcing.lines.column.row', 'Row')}
              </Button>
              <Button onClick={() => { void handleSave() }} disabled={saving}>
                {t('sourcing.lines.actions.save', 'Save changes')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default QuoteCreatePanel
