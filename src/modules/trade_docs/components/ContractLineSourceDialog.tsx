"use client"

import * as React from 'react'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { SourcePreviewDrawer, type SourcePreviewLine } from '@/lib/source-preview/SourcePreviewDrawer'
import { loadTradeTypeChannelIds, type TradeTypeChannelMap } from '../../internal_sales/lib/tradeTypeChannels'
import {
  CONTRACT_LINE_SOURCE_ROUTES,
  buildSalesSourceListParams,
  isSalesSourceKind,
  readOrderSourceHeadFacts,
  sourceKindsForDirection,
  sourceLineToContractLine,
  tradeTypeFromPartyRoles,
  type ContractLineDraft,
  type ContractLineSourceKind,
  type SourceHeadFacts,
} from '../lib/contractLineSource'
import { loadPartyRoles } from './formOptions'
import { orderPreviewLines, sourcePreviewFields } from './sourcePreview'

/** The head a copied batch came from; the editor turns it into the contract's own anchor fields. */
export type ContractLineSourceHead = {
  kind: ContractLineSourceKind
  id: string
  number: string
  counterparty: string
}

/** The wording of a source kind, so the picker and the copy share one vocabulary. */
const KIND_LABELS: Record<ContractLineSourceKind, { key: string; fallback: string }> = {
  purchase_order: {
    key: 'trade_docs.contracts.form.lines.copy.kind.purchase_order',
    fallback: 'Purchase order',
  },
  internal_sales_order: {
    key: 'trade_docs.contracts.form.lines.copy.kind.internal_sales_order',
    fallback: 'Internal sales order',
  },
  internal_sales_quote: {
    key: 'trade_docs.contracts.form.lines.copy.kind.internal_sales_quote',
    fallback: 'Internal sales quote',
  },
  external_sales_order: {
    key: 'trade_docs.contracts.form.lines.copy.kind.external_sales_order',
    fallback: 'External sales order',
  },
  external_sales_quote: {
    key: 'trade_docs.contracts.form.lines.copy.kind.external_sales_quote',
    fallback: 'External sales quote',
  },
}

function kindLabel(t: TranslateFn, kind: ContractLineSourceKind): string {
  const entry = KIND_LABELS[kind]
  return t(entry.key, entry.fallback)
}

/** The picker label: the document's own number plus who it is with. */
function headLabel(facts: SourceHeadFacts): string {
  return facts.counterparty ? `${facts.number} — ${facts.counterparty}` : facts.number
}

/**
 * 「从订单/报价单复制行」 for a contract.
 *
 * Modelled on the PI/CI dialog (`DocumentsForm`): pick a source kind, pick the source document,
 * confirm — the source's lines are appended to the contract, each freezing a `sourceSnapshot` that
 * names the line it came from, and the head anchor is returned to the editor. The list of sources is
 * aligned with the contract's trade type (see `lib/contractLineSource`); a missing trade-type
 * channel leaves the picker empty instead of widening it to both types.
 *
 * The selected source can be previewed before it is copied (`SourcePreviewDrawer`, the same drawer
 * the internal-sales order shows its source quote in): the head reads out the document's own number,
 * counterparty, trade type, currency, total and date, then its lines exactly as the copy maps them.
 */
export function ContractLineSourceDialog({
  open,
  onOpenChange,
  direction,
  counterpartyId,
  onAppend,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  direction: string
  counterpartyId: string
  onAppend: (rows: ContractLineDraft[], head: ContractLineSourceHead) => void
}) {
  const t = useT()
  /** The counterparty's `parties` roles; `null` while unknown and after a failed/absent read. */
  const [partyRoles, setPartyRoles] = React.useState<string[] | null>(null)
  const salesTradeType = tradeTypeFromPartyRoles(partyRoles)
  const allowedKinds = React.useMemo(
    () => sourceKindsForDirection(direction, salesTradeType),
    [direction, salesTradeType],
  )
  const [kind, setKind] = React.useState<ContractLineSourceKind>(allowedKinds[0] ?? 'purchase_order')
  const [sourceId, setSourceId] = React.useState('')
  const [isCopying, setIsCopying] = React.useState(false)
  const [channels, setChannels] = React.useState<TradeTypeChannelMap>({})
  const [channelsLoaded, setChannelsLoaded] = React.useState(false)
  /** The channel read itself failed (permission/transport) rather than merely being unseeded. */
  const [channelsFailed, setChannelsFailed] = React.useState(false)
  /** Display fields of the picked head, cached while the operator browses the suggestions. */
  const headCache = React.useRef(new Map<string, SourceHeadFacts>())
  /** Source lines already read, so preview → copy never fetches the same document twice. */
  const lineCache = React.useRef(new Map<string, Record<string, unknown>[]>())

  const [previewOpen, setPreviewOpen] = React.useState(false)
  const [previewBusy, setPreviewBusy] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [previewItems, setPreviewItems] = React.useState<Record<string, unknown>[] | null>(null)
  /** Guards the preview state against a read that a newer click has superseded. */
  const previewRequest = React.useRef(0)

  const route = CONTRACT_LINE_SOURCE_ROUTES[kind]
  const kindTradeType = route.tradeType
  const salesSourcesBlocked =
    route.family === 'sales' &&
    channelsLoaded &&
    (kindTradeType === null || buildSalesSourceListParams(kindTradeType, channels, '') === null)

  // Each opening starts clean, and a kind the resolved trade type no longer offers (the counterparty
  // read returned after the picker was shown) is replaced by the first one that is allowed.
  React.useEffect(() => {
    if (!open) return
    setKind((current) => (allowedKinds.includes(current) ? current : (allowedKinds[0] ?? 'purchase_order')))
    setSourceId('')
    headCache.current.clear()
    lineCache.current.clear()
    setPreviewOpen(false)
    setPreviewItems(null)
  }, [allowedKinds, open])

  // The counterparty decides the trade type; reload whenever the picker opens for a new party.
  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setPartyRoles(null)
    void loadPartyRoles(t('trade_docs.contracts.form.partyLoadFailed'), counterpartyId)
      .then((roles) => {
        if (!cancelled) setPartyRoles(roles ?? [])
      })
      .catch(() => {
        if (!cancelled) setPartyRoles([])
      })
    return () => {
      cancelled = true
    }
  }, [counterpartyId, open, t])

  // Only a sales source needs the trade-type channels, and only the kind that owns them.
  React.useEffect(() => {
    if (!open || !isSalesSourceKind(kind)) return
    let cancelled = false
    setChannels({})
    setChannelsLoaded(false)
    setChannelsFailed(false)
    void loadTradeTypeChannelIds(
      kind === 'internal_sales_quote' || kind === 'external_sales_quote' ? 'quote' : 'order',
      t('trade_docs.contracts.form.tradeTypeChannelsLoadFailed'),
    )
      .then((map) => {
        if (!cancelled) setChannels(map)
      })
      .catch(() => {
        if (!cancelled) {
          setChannels({})
          setChannelsFailed(true)
        }
      })
      .finally(() => {
        if (!cancelled) setChannelsLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [kind, open, t])

  const loadHeadOptions = React.useCallback(
    async (query?: string): Promise<ComboboxOption[]> => {
      const activeRoute = CONTRACT_LINE_SOURCE_ROUTES[kind]
      const term = query?.trim() ?? ''
      const toOptions = (items: Record<string, unknown>[]): ComboboxOption[] =>
        items
          .map((item) => {
            const facts = readOrderSourceHeadFacts(item, activeRoute.family, activeRoute.headNumberKey)
            headCache.current.set(String(item.id ?? ''), facts)
            return { value: String(item.id ?? ''), label: headLabel(facts) }
          })
          .filter((option) => option.value.length > 0)
      if (activeRoute.family === 'purchase_order') {
        const payload = await fetchCrudList<Record<string, unknown>>(activeRoute.headApiPath, {
          pageSize: 100,
          sortField: 'created_at',
          sortDir: 'desc',
          ...(term ? { search: term } : {}),
        })
        return toOptions(payload.items ?? [])
      }
      // The kind carries its own trade type; a type with no channel id, or an organization with no
      // trade-type channels at all, offers nothing — never a silently widened list of every sales
      // document.
      if (!kindTradeType || !channelsLoaded) return []
      const params = buildSalesSourceListParams(kindTradeType, channels, term)
      if (!params) return []
      const payload = await fetchCrudList<Record<string, unknown>>(activeRoute.headApiPath, params)
      return toOptions(payload.items ?? [])
    },
    [channels, channelsLoaded, kind, kindTradeType],
  )

  /** The source's lines, read once per document and reused by both the preview and the copy. */
  const readSourceItems = React.useCallback(
    async (targetKind: ContractLineSourceKind, id: string) => {
      const key = `${targetKind}:${id}`
      const cached = lineCache.current.get(key)
      if (cached) return cached
      const activeRoute = CONTRACT_LINE_SOURCE_ROUTES[targetKind]
      const payload = await fetchCrudList<Record<string, unknown>>(activeRoute.lineApiPath, {
        [activeRoute.lineParentParam]: id,
        pageSize: 100,
      })
      const items = payload.items ?? []
      lineCache.current.set(key, items)
      return items
    },
    [],
  )

  const handlePreview = React.useCallback(async () => {
    const id = sourceId.trim()
    if (!id) {
      flash(t('trade_docs.contracts.form.lines.copy.sourceRequired'), 'error')
      return
    }
    const request = previewRequest.current + 1
    previewRequest.current = request
    setPreviewOpen(true)
    setPreviewError(null)
    setPreviewItems(null)
    setPreviewBusy(true)
    try {
      const items = await readSourceItems(kind, id)
      if (previewRequest.current !== request) return
      setPreviewItems(items)
    } catch (error) {
      if (previewRequest.current !== request) return
      setPreviewError(
        error instanceof Error && error.message
          ? error.message
          : t('ui.sourcePreview.previewFailed', 'Could not load the source document preview'),
      )
    } finally {
      if (previewRequest.current === request) setPreviewBusy(false)
    }
  }, [kind, readSourceItems, sourceId, t])

  const handleCopy = React.useCallback(async () => {
    const id = sourceId.trim()
    if (!id) {
      flash(t('trade_docs.contracts.form.lines.copy.sourceRequired'), 'error')
      return
    }
    setIsCopying(true)
    try {
      const items = await readSourceItems(kind, id)
      const copiedAt = new Date().toISOString()
      const rows = items.map((item) => sourceLineToContractLine(item, kind, copiedAt))
      if (rows.length === 0) {
        flash(t('trade_docs.contracts.form.lines.copy.empty'), 'error')
        return
      }
      const facts = headCache.current.get(id)
      onAppend(rows, {
        kind,
        id,
        number: facts?.number ?? '',
        counterparty: facts?.counterparty ?? '',
      })
      onOpenChange(false)
      flash(t('trade_docs.contracts.form.lines.copy.done'), 'success')
    } catch (error) {
      flash(
        error instanceof Error && error.message
          ? error.message
          : t('trade_docs.contracts.form.lines.copy.failed'),
        'error',
      )
    } finally {
      setIsCopying(false)
    }
  }, [kind, onAppend, onOpenChange, readSourceItems, sourceId, t])

  const headFacts = headCache.current.get(sourceId) ?? null
  const previewFields = React.useMemo(
    () =>
      sourcePreviewFields(
        headFacts,
        t,
        sourceId,
        kindTradeType
          ? t(`trade_docs.contracts.form.lines.copy.tradeTypeName.${kindTradeType}`)
          : undefined,
      ),
    [headFacts, kindTradeType, sourceId, t],
  )
  const previewLines: SourcePreviewLine[] = React.useMemo(
    () =>
      orderPreviewLines(
        previewItems ?? [],
        route.family,
        headFacts?.currencyCode ?? '',
        t('ui.sourcePreview.unnamedLine', '(Unnamed line)'),
      ),
    [headFacts?.currencyCode, previewItems, route.family, t],
  )

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && sourceId.trim() && !isCopying) {
              event.preventDefault()
              void handleCopy()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('trade_docs.contracts.form.lines.copy.title')}</DialogTitle>
            <DialogDescription>{t('trade_docs.contracts.form.lines.copy.body')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="contract-copy-source-kind">
                {t('trade_docs.contracts.form.lines.copy.sourceKind')}
              </FieldLabel>
              <Select
                value={kind}
                onValueChange={(next) => {
                  setKind(next as ContractLineSourceKind)
                  setSourceId('')
                  headCache.current.clear()
                  lineCache.current.clear()
                }}
              >
                <SelectTrigger id="contract-copy-source-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allowedKinds.map((value) => (
                    <SelectItem key={value} value={value}>
                      {kindLabel(t, value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {route.family === 'sales' && partyRoles !== null ? (
                <p className="text-xs text-muted-foreground">
                  {salesTradeType
                    ? t(
                        'trade_docs.contracts.form.lines.copy.tradeTypeAligned',
                        "Sources are filtered by this contract's trade type: {{type}}.",
                        { type: t(`trade_docs.contracts.form.lines.copy.tradeTypeName.${salesTradeType}`) },
                      )
                    : t('trade_docs.contracts.form.lines.copy.tradeTypeUnresolved')}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="contract-copy-source">
                {t('trade_docs.contracts.form.lines.copy.source')}
              </FieldLabel>
              <ComboboxInput
                value={sourceId}
                onChange={(next) => setSourceId(next)}
                disabled={salesSourcesBlocked || (isSalesSourceKind(kind) && !channelsLoaded)}
                placeholder={t('trade_docs.contracts.form.lines.copy.sourcePlaceholder')}
                seedOptions={headFacts ? [{ value: sourceId, label: headLabel(headFacts) }] : undefined}
                loadSuggestions={loadHeadOptions}
                allowCustomValues={false}
                clearable
              />
              {route.family === 'sales' && channelsFailed ? (
                <p className="text-xs text-destructive">
                  {t('trade_docs.contracts.form.tradeTypeChannelsLoadFailed')}
                </p>
              ) : salesSourcesBlocked ? (
                <p className="text-xs text-muted-foreground">
                  {t('trade_docs.contracts.form.lines.copy.noSources')}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isCopying}>
              {t('ui.actions.cancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isCopying || sourceId.trim().length === 0}
              onClick={() => void handlePreview()}
            >
              {t('ui.actions.preview', 'Preview')}
            </Button>
            <Button
              type="button"
              disabled={isCopying || sourceId.trim().length === 0}
              onClick={() => void handleCopy()}
            >
              {t('trade_docs.contracts.form.lines.copy.confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <SourcePreviewDrawer
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title={t('trade_docs.contracts.form.lines.copy.preview.title')}
        subtitle={headFacts ? headLabel(headFacts) : sourceId.slice(0, 8)}
        busy={previewBusy}
        error={previewError}
        fields={previewFields}
        lines={previewLines}
      />
    </>
  )
}
