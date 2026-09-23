"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {
  CrudForm,
  type CrudField,
  type CrudFieldOption,
  type CrudFormGroup,
} from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { pushWithFlash } from '@open-mercato/ui/backend/utils/flash'
import { toUtcDateInputValue } from '@open-mercato/ui/primitives/date-format'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  ORDERS_API_PATH,
  ORDERS_LINES_API_PATH,
  ORDERS_LIST_HREF,
  PurchaseOrderLinesEditor,
  buildPurchaseOrderPayload,
  isSupplierProductMismatch,
  loadCurrencyOptions,
  loadSupplierOptions,
  toPurchaseOrderRecord,
  trimDecimalZeros,
  type PurchaseOrderFormValues,
  type PurchaseOrderLineValues,
  type PurchaseOrderRecord,
} from './PurchaseOrderForm'
import {
  findOptionSnapshot,
  loadCustomerOptions,
  loadOwnerOptions,
  loadProductCategoryOptions,
} from './orderFormOptions'

const LINES_PAGE_SIZE = 200

/**
 * The header metadata a non-draft order still accepts — everything else carries the price the
 * order was placed at. Mirrors `POST_PLACEMENT_UPDATE_FIELDS` in `commands/orders.ts`: the update
 * command rejects any other key with a 409, so a locked save sends exactly this set.
 */
const POST_PLACEMENT_FIELDS = [
  'businessNumber',
  'productCategory',
  'ownerUserId',
  'ownerSnapshot',
  'customerId',
  'customerSnapshot',
  'expectedShipAt',
  'notes',
] as const

/** A line as `/api/purchasing/purchase-orders/lines` projects it, as the editor reads it. */
function toLineValues(item: Record<string, unknown>): PurchaseOrderLineValues {
  const supplierProductId = typeof item.supplierProductId === 'string' ? item.supplierProductId : ''
  const supplierSku = typeof item.supplierSku === 'string' ? item.supplierSku : ''
  return {
    key: typeof item.id === 'string' && item.id.length ? item.id : String(item.lineNumber ?? ''),
    productId: typeof item.productId === 'string' ? item.productId : '',
    catalogProductId: typeof item.catalogProductId === 'string' ? item.catalogProductId : '',
    supplierProductId,
    supplierProductMode: supplierProductId.length > 0,
    // A library line is identified by the supplier's item number, a master line by its title: the
    // label only seeds the picker's display for a value that is not on the first page of options.
    productLabel: supplierSku || (typeof item.productTitle === 'string' ? item.productTitle : ''),
    // The stored decimals carry their column's scale (`10.0000`); the editor's number inputs read
    // better without it, and dropping trailing zeros cannot move the value.
    quantity: trimDecimalZeros(typeof item.quantity === 'string' ? item.quantity : ''),
    unitPrice: trimDecimalZeros(typeof item.unitPrice === 'string' ? item.unitPrice : ''),
    taxRate: trimDecimalZeros(typeof item.taxRate === 'string' ? item.taxRate : ''),
    priceIncludesTax: item.priceIncludesTax !== false,
    note: typeof item.note === 'string' ? item.note : '',
  }
}

/**
 * Keeps the last loaded page of picker options, so the submit handler can freeze the picked
 * person's display snapshot the same way the create form does — the write command never reads
 * another module's tables to resolve a name.
 */
async function rememberPickerOptions(
  store: React.RefObject<Record<string, CrudFieldOption[]>>,
  fieldId: string,
  load: () => Promise<CrudFieldOption[]>,
): Promise<CrudFieldOption[]> {
  const options = await load()
  store.current[fieldId] = options
  return options
}

function PurchaseOrderEditFormBody({
  order,
  initialLines,
  onReload,
}: {
  order: PurchaseOrderRecord
  initialLines: PurchaseOrderLineValues[]
  onReload: () => Promise<void>
}) {
  const t = useT()
  const router = useRouter()
  // A placed order is a commitment: the commercial terms freeze and only the header metadata
  // stays editable, exactly as the update command enforces it.
  const locked = order.status !== 'draft'
  const detailHref = `${ORDERS_LIST_HREF}/${encodeURIComponent(order.id)}`
  const pickerOptionsRef = React.useRef<Record<string, CrudFieldOption[]>>({})

  const initialValues = React.useMemo<PurchaseOrderFormValues>(() => ({
    businessNumber: order.businessNumber ?? '',
    productCategory: order.productCategory ?? '',
    ownerUserId: order.ownerUserId ?? '',
    // The list projection returns the resolved display name, not the stored snapshot JSON: seed the
    // snapshot from the name so saving an order whose picker was never touched keeps the name the
    // page shows instead of blanking the frozen display data.
    ownerSnapshot: order.ownerSnapshot ?? (order.ownerName ? { name: order.ownerName } : null),
    customerId: order.customerId ?? '',
    customerSnapshot: order.customerSnapshot ?? (order.customerName ? { name: order.customerName } : null),
    supplierId: order.supplierId,
    currencyCode: order.currencyCode,
    depositPercent: order.depositPercent ?? '',
    depositAmount: order.depositAmount ?? '',
    expectedShipAt: toUtcDateInputValue(order.expectedShipAt) ?? '',
    notes: order.notes ?? '',
    lines: initialLines,
  }), [initialLines, order])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'businessNumber',
      label: t('purchasing.orders.form.field.businessNumber'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'productCategory',
      label: t('purchasing.orders.form.field.productCategory'),
      type: 'select',
      layout: 'half',
      loadOptions: () => rememberPickerOptions(pickerOptionsRef, 'productCategory', () =>
        loadProductCategoryOptions(t('purchasing.orders.form.optionsLoadFailed'))),
    },
    {
      id: 'supplierId',
      label: t('purchasing.orders.form.field.supplier'),
      type: 'select',
      required: true,
      layout: 'half',
      readOnly: locked,
      loadOptions: (query) => loadSupplierOptions(t('purchasing.orders.form.loadFailed'), query),
    },
    {
      id: 'ownerUserId',
      label: t('purchasing.orders.form.field.owner'),
      type: 'select',
      layout: 'half',
      loadOptions: (query) => rememberPickerOptions(pickerOptionsRef, 'ownerUserId', () =>
        loadOwnerOptions(t('purchasing.orders.form.optionsLoadFailed'), query)),
    },
    {
      id: 'customerId',
      label: t('purchasing.orders.form.field.customer'),
      type: 'select',
      layout: 'half',
      loadOptions: () => rememberPickerOptions(pickerOptionsRef, 'customerId', () =>
        loadCustomerOptions(t('purchasing.orders.form.optionsLoadFailed'))),
    },
    {
      id: 'currencyCode',
      label: t('purchasing.orders.form.field.currency'),
      type: 'select',
      required: true,
      layout: 'half',
      readOnly: locked,
      loadOptions: () => loadCurrencyOptions(t('purchasing.orders.form.loadFailed')),
    },
    {
      id: 'expectedShipAt',
      label: t('purchasing.orders.form.field.expectedShipAt'),
      type: 'date',
      layout: 'half',
    },
    {
      id: 'depositPercent',
      label: t('purchasing.orders.form.field.depositPercent'),
      type: 'number',
      layout: 'half',
      readOnly: locked,
    },
    {
      id: 'depositAmount',
      label: t('purchasing.orders.form.field.depositAmount'),
      type: 'number',
      layout: 'half',
      readOnly: locked,
    },
    {
      id: 'notes',
      label: t('purchasing.orders.form.field.notes'),
      type: 'textarea',
      layout: 'half',
    },
  ], [locked, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'header',
      column: 1,
      fields: [
        'businessNumber',
        'productCategory',
        'supplierId',
        'ownerUserId',
        'customerId',
        'currencyCode',
        'expectedShipAt',
        'depositPercent',
        'depositAmount',
        'notes',
      ],
    },
    {
      id: 'lines',
      column: 1,
      bare: true,
      // The lines are part of the frozen terms. A locked order still shows them — dimmed and inert,
      // the same treatment CrudForm gives a read-only form — because the editor is the only surface
      // that renders a line's product, quantity and price together.
      component: (context) => locked ? (
        <div
          className="pointer-events-none select-none opacity-70"
          onFocusCapture={(event) => {
            if (event.target instanceof HTMLElement) event.target.blur()
          }}
          onKeyDownCapture={(event) => event.preventDefault()}
        >
          <PurchaseOrderLinesEditor {...context} t={t} />
        </div>
      ) : (
        <PurchaseOrderLinesEditor {...context} t={t} />
      ),
    },
  ], [locked, t])

  const handleSubmit = React.useCallback(async (values: PurchaseOrderFormValues) => {
    // A picker the operator did not touch keeps the snapshot the order was filed with: the picked
    // person may not be on the loaded page any more, and the name recorded at filing time is the
    // one the order owns. The list projection returns the resolved display name rather than the
    // stored snapshot JSON, so an untouched picker falls back to that name instead of clearing it —
    // a save must never blank the order's frozen display data. A changed picker resolves against
    // the options it was chosen from.
    const ownerSnapshot = values.ownerUserId === (order.ownerUserId ?? '')
      ? (order.ownerSnapshot ?? (order.ownerName ? { name: order.ownerName } : null))
      : findOptionSnapshot(pickerOptionsRef.current.ownerUserId ?? [], values.ownerUserId)
    const customerSnapshot = values.customerId === (order.customerId ?? '')
      ? (order.customerSnapshot ?? (order.customerName ? { name: order.customerName } : null))
      : findOptionSnapshot(pickerOptionsRef.current.customerId ?? [], values.customerId)
    const full = buildPurchaseOrderPayload({ ...values, ownerSnapshot, customerSnapshot })
    const body = locked
      ? Object.fromEntries(POST_PLACEMENT_FIELDS.map((key) => [key, full[key]]))
      : full
    try {
      await updateCrud(ORDERS_API_PATH, { id: order.id, ...body, updatedAt: order.updatedAt })
    } catch (error) {
      // A 409 is either the version check or a rejected locked field; both belong on the shared
      // conflict bar, which also offers the refresh that reloads the current version.
      if (surfaceRecordConflict(error, t, { onRefresh: () => void onReload() })) throw error
      // A line whose library row belongs to another supplier is the one failure the operator can
      // fix in this form, so it is named instead of being folded into the generic save error.
      flash(
        isSupplierProductMismatch(error)
          ? t('purchasing.errors.supplierProductMismatch')
          : t('purchasing.orders.form.saveFailed'),
        'error',
      )
      throw error
    }
    pushWithFlash(router, detailHref, t('purchasing.orders.form.saved'), 'success')
  }, [detailHref, locked, onReload, order, router, t])

  return (
    <CrudForm<PurchaseOrderFormValues>
      title={t('purchasing.orders.edit.title')}
      titleHeadingLevel={1}
      backHref={detailHref}
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      submitLabel={t('purchasing.orders.form.save')}
      cancelHref={detailHref}
      optimisticLockUpdatedAt={order.updatedAt}
      onSubmit={handleSubmit}
      contentHeader={locked ? (
        <p className="rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {t('purchasing.orders.form.lockedHint')}
        </p>
      ) : undefined}
    />
  )
}

export default function PurchaseOrderEditForm({ orderId }: { orderId: string }) {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [order, setOrder] = React.useState<PurchaseOrderRecord | null>(null)
  const [lines, setLines] = React.useState<PurchaseOrderLineValues[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setNotFound(false)
    try {
      const [orderPayload, linePayload] = await Promise.all([
        fetchCrudList<Record<string, unknown>>(ORDERS_API_PATH, { ids: orderId, pageSize: 1 }),
        fetchCrudList<Record<string, unknown>>(ORDERS_LINES_API_PATH, { orderId, pageSize: LINES_PAGE_SIZE }),
      ])
      const item = orderPayload.items?.[0]
      if (!item) {
        setOrder(null)
        setLines([])
        setNotFound(true)
        return
      }
      setOrder(toPurchaseOrderRecord(item))
      setLines((linePayload.items ?? []).map(toLineValues))
    } catch {
      setLoadError(t('purchasing.orders.form.loadFailed'))
    } finally {
      setLoading(false)
    }
    // `scopeVersion` is not read inside the callback on purpose: it is the organization-scope
    // generation, and bumping it must rebuild this callback so the effect below refetches after
    // an organization switch. The rule cannot see that intent, so the dependency is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate scope-change refetch
  }, [orderId, scopeVersion, t])

  React.useEffect(() => {
    void load()
  }, [load])

  if (loading && !order) return <LoadingMessage label={t('purchasing.orders.form.loadFailed')} />

  if (notFound) {
    return <RecordNotFoundState label={t('purchasing.orders.form.loadFailed')} backHref={ORDERS_LIST_HREF} />
  }

  if (loadError || !order) {
    return <ErrorMessage label={loadError ?? t('purchasing.orders.form.loadFailed')} />
  }

  return <PurchaseOrderEditFormBody order={order} initialLines={lines} onReload={load} />
}
