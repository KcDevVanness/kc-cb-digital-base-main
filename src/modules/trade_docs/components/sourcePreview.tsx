import * as React from 'react'
import { type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { MoneyAmount } from '@/lib/money/MoneyAmount'
import type { SourcePreviewField, SourcePreviewLine } from '@/lib/source-preview/SourcePreviewDrawer'
import { type SourceHeadFacts } from '../lib/contractLineSource'
import { readText, snapshotText } from './formOptions'

/** What a read-only preview shows when the projection carries nothing. */
const EMPTY_CELL = '—'

/**
 * The head half of a source-document preview: the document's identity plus whatever the list
 * projection knows about it. Facts the row does not carry are omitted rather than rendered blank.
 * Every copy-from surface builds its fields through this, so the preview of a contract, an order and
 * a quote reads the same way.
 */
export function sourcePreviewFields(
  facts: SourceHeadFacts | null,
  t: TranslateFn,
  fallbackId: string,
  tradeTypeLabel?: string,
): SourcePreviewField[] {
  const fields: SourcePreviewField[] = [
    {
      label: t('ui.sourcePreview.number', 'Number'),
      value: facts?.number || fallbackId.slice(0, 8) || EMPTY_CELL,
    },
    { label: t('ui.sourcePreview.counterparty', 'Counterparty'), value: facts?.counterparty || EMPTY_CELL },
  ]
  if (tradeTypeLabel) {
    fields.push({ label: t('ui.sourcePreview.tradeType', 'Trade type'), value: tradeTypeLabel })
  }
  if (facts?.currencyCode) {
    fields.push({ label: t('ui.sourcePreview.currency', 'Currency'), value: facts.currencyCode })
  }
  if (facts?.amount) {
    fields.push({
      label: t('ui.sourcePreview.amount', 'Amount'),
      value: facts.currencyCode ? (
        <MoneyAmount currencyCode={facts.currencyCode} amount={facts.amount} />
      ) : (
        facts.amount
      ),
    })
  }
  if (facts?.placedAt) {
    fields.push({ label: t('ui.sourcePreview.date', 'Date'), value: facts.placedAt.slice(0, 10) })
  }
  return fields
}

/** `quantity × unit price`, the unit price through the money component when the currency is known. */
function previewLineAmount(quantity: string, unitPrice: string, currencyCode: string): React.ReactNode {
  const price = unitPrice.trim() || '0'
  return (
    <>
      {`${quantity.trim() || '0'} × `}
      {currencyCode ? <MoneyAmount currencyCode={currencyCode} amount={price} kind="price" /> : price}
    </>
  )
}

/** `SKU · unit`-style secondary text, dropped entirely when every part is empty. */
function previewLineMeta(parts: string[]): string | undefined {
  const joined = parts.filter((part) => part.trim().length > 0).join(' · ')
  return joined.length > 0 ? joined : undefined
}

/**
 * One order/quote line as a preview row: a purchase line keeps the title/SKU/unit of its own
 * snapshot columns, a sales line falls back to `catalogSnapshot` when it was never bound to a live
 * product — the same shapes the copy itself maps.
 */
export function orderPreviewLines(
  items: Record<string, unknown>[],
  family: 'purchase_order' | 'sales',
  currencyCode: string,
  emptyLabel: string,
): SourcePreviewLine[] {
  return items.map((item, index) => {
    const id = readText(item, 'id')
    const snapshot = item.catalogSnapshot ?? item.catalog_snapshot
    if (family === 'purchase_order') {
      const sku = readText(item, 'productSku', 'product_sku') || readText(item, 'supplierSku', 'supplier_sku')
      return {
        key: id || `line-${index}`,
        name: readText(item, 'productTitle', 'product_title') || sku || emptyLabel,
        meta: previewLineMeta([sku, readText(item, 'productUnit', 'product_unit')]),
        amount: previewLineAmount(readText(item, 'quantity'), readText(item, 'unitPrice', 'unit_price'), currencyCode),
      }
    }
    const sku = readText(item, 'sku') || snapshotText(snapshot, 'sku')
    return {
      key: id || `line-${index}`,
      name: readText(item, 'name') || snapshotText(snapshot, 'name') || sku || emptyLabel,
      meta: previewLineMeta([
        sku,
        readText(item, 'quantityUnit', 'quantity_unit') || snapshotText(snapshot, 'unit'),
      ]),
      amount: previewLineAmount(
        readText(item, 'quantity'),
        readText(item, 'unitPriceNet', 'unit_price_net'),
        currencyCode,
      ),
    }
  })
}

/** One contract line as a preview row — what 「从合同引用商品行」 is about to bring in. */
export function contractPreviewLines(
  items: Record<string, unknown>[],
  currencyCode: string,
  emptyLabel: string,
): SourcePreviewLine[] {
  return items.map((item, index) => {
    const sku = readText(item, 'sku')
    return {
      key: readText(item, 'id') || `line-${index}`,
      name: readText(item, 'name') || sku || emptyLabel,
      meta: previewLineMeta([sku, readText(item, 'model'), readText(item, 'spec')]),
      amount: previewLineAmount(readText(item, 'quantity'), readText(item, 'unitPrice', 'unit_price'), currencyCode),
    }
  })
}
