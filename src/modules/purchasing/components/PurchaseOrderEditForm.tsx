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
import { Input } from '@open-mercato/ui/primitives/input'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useReturnHref } from '@/lib/navigation/returnTo'
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
} from './orderFormOptions'

const LINES_PAGE_SIZE = 200

/**
 * A field the operator can no longer change, rendered as its own value in the design system's
 * greyed, inert state — used where the built-in field type would not forward `disabled`
 * (CrudForm's `number` branch). It never writes: the value is display-only, and a locked order's
 * save body carries only the fields it may still change.
 */
function LockedFieldValue({ value }: { value: unknown }) {
  return (
    <Input
      disabled
      readOnly
      value={value === null || value === undefined ? '' : String(value)}
      aria-readonly="true"
    />
  )
}

/**
 * The header metadata a non-draft order still accepts — everything else carries the price the
 * order was placed at. Mirrors `POST_PLACEMENT_UPDATE_FIELDS` in `commands/orders.ts`: the update
 * command rejects any other key with a 409, so a locked save sends exactly this set.
 */
const POST_PLACEMENT_FIELDS = [
  'businessNumber',
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
    catalogProductId: typeof item.catalogProductId === 'string' ? item.catalogProductId : '',
    supplierProductId,
    // A library line is identified by the supplier's item number, a product line by its title: the
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
 * company's display snapshot the same way the create form does — the write command never reads
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
  const backHref = useReturnHref(detailHref)
  const pickerOptionsRef = React.useRef<Record<string, CrudFieldOption[]>>({})

  const initialValues = React.useMemo<PurchaseOrderFormValues>(() => ({
    businessNumber: order.businessNumber ?? '',
    customerId: order.customerId ?? '',
    customerSnapshot: order.customerSnapshot ?? (order.customerName ? { name: order.customerName } : null),
    supplierId: order.supplierId,
    currencyCode: order.currencyCode,
    depositPercent: order.depositPercent ?? '',
    depositAmount: order.depositAmount ?? '',
    expectedShipAt: toUtcDateInputValue(order.expectedShipAt) ?? '',
    notes: order.notes ?? '',
    // Carried through unchanged: the edit form does not re-point an order's source, but the payload
    // must keep the anchor it already has (an omitted key never clears it server-side).
    sourceSalesOrderId: order.sourceSalesOrderId ?? '',
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
      id: 'supplierId',
      label: t('purchasing.orders.form.field.supplier'),
      type: 'select',
      required: true,
      layout: 'half',
      // `readOnly` is a near no-op in CrudForm (it only reaches text-like controls and the single
      // select, and drops the number type entirely — owner 2026-10-10: 不能编辑的填写项需要变灰);
      // `disabled` is the path that renders the design system's greyed, inert state everywhere.
      disabled: locked,
      loadOptions: (query) => loadSupplierOptions(t('purchasing.orders.form.loadFailed'), query),
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
      disabled: locked,
      loadOptions: () => loadCurrencyOptions(t('purchasing.orders.form.loadFailed')),
    },
    {
      id: 'expectedShipAt',
      label: t('purchasing.orders.form.field.expectedShipAt'),
      type: 'date',
      layout: 'half',
    },
    // CrudForm's `number` branch does not forward `disabled`/`readOnly` to its NumberInput, so a
    // locked money field would keep looking editable (owner 2026-10-10: 不能编辑的填写项需要变灰).
    // Locked, the field is a greyed inert value instead; unlocked it stays an ordinary number field.
    locked
      ? {
          id: 'depositPercent',
          label: t('purchasing.orders.form.field.depositPercent'),
          type: 'custom',
          layout: 'half',
          component: (props) => <LockedFieldValue value={props.value} />,
        }
      : {
          id: 'depositPercent',
          label: t('purchasing.orders.form.field.depositPercent'),
          type: 'number',
          layout: 'half',
        },
    locked
      ? {
          id: 'depositAmount',
          label: t('purchasing.orders.form.field.depositAmount'),
          type: 'custom',
          layout: 'half',
          component: (props) => <LockedFieldValue value={props.value} />,
        }
      : {
          id: 'depositAmount',
          label: t('purchasing.orders.form.field.depositAmount'),
          type: 'number',
          layout: 'half',
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
        'supplierId',
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
    // company may not be on the loaded page any more, and the name recorded at filing time is the
    // one the order owns. The list projection returns the resolved display name rather than the
    // stored snapshot JSON, so an untouched picker falls back to that name instead of clearing it —
    // a save must never blank the order's frozen display data. A changed picker resolves against
    // the options it was chosen from.
    const customerSnapshot = values.customerId === (order.customerId ?? '')
      ? (order.customerSnapshot ?? (order.customerName ? { name: order.customerName } : null))
      : findOptionSnapshot(pickerOptionsRef.current.customerId ?? [], values.customerId)
    const full = buildPurchaseOrderPayload({ ...values, customerSnapshot })
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
      backHref={backHref}
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
  const backHref = useReturnHref(ORDERS_LIST_HREF)
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
    return <RecordNotFoundState label={t('purchasing.orders.form.loadFailed')} backHref={backHref} />
  }

  if (loadError || !order) {
    return <ErrorMessage label={loadError ?? t('purchasing.orders.form.loadFailed')} />
  }

  return <PurchaseOrderEditFormBody order={order} initialLines={lines} onReload={load} />
}
