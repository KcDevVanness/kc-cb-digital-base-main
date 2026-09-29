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
import {
  readChannelId,
  tradeTypeFromChannelId,
  type SalesTradeType,
} from '../../internal_sales/lib/tradeType'
import {
  loadTradeTypeChannelIds,
  type TradeTypeChannelMap,
} from '../../internal_sales/lib/tradeTypeChannels'
import {
  CONTRACT_LINE_SOURCE_KINDS,
  CONTRACT_LINE_SOURCE_ROUTES,
  buildSalesSourceListParams,
  isSalesSourceKind,
  sourceKindsForDirection,
  sourceLineToContractLine,
  tradeTypeFromPartyRoles,
  type ContractLineDraft,
  type ContractLineSourceKind,
} from '../lib/contractLineSource'
import { loadPartyRoles, readText, snapshotText } from './formOptions'

/** The head a copied batch came from; the editor turns it into the contract's own anchor fields. */
export type ContractLineSourceHead = {
  kind: ContractLineSourceKind
  id: string
  number: string
  counterparty: string
}

type HeadReading = { option: ComboboxOption; number: string; counterparty: string }

/**
 * Reads one list row as a picker option.
 *
 * For a sales source whose trade type could not be resolved from the counterparty, every option is
 * suffixed with its own type (`对内`/`对外`) — read off the document's `channelId` — so the
 * operator cannot confuse the two families even though both are listed.
 */
function readHead(
  item: Record<string, unknown>,
  kind: ContractLineSourceKind,
  resolvedType: SalesTradeType | null,
  channels: TradeTypeChannelMap,
  t: TranslateFn,
): HeadReading {
  const route = CONTRACT_LINE_SOURCE_ROUTES[kind]
  const id = String(item.id ?? '')
  const number = readText(item, route.headNumberKey) || id.slice(0, 8)
  // The sales list projects the buyer inside the frozen snapshot (not as a top-level column), while
  // the purchasing list carries the supplier name directly.
  const counterparty =
    route.family === 'sales'
      ? snapshotText(item.customerSnapshot ?? item.customer_snapshot)
      : readText(item, 'supplierName', 'supplier_name')
  let label = counterparty ? `${number} — ${counterparty}` : number
  if (route.family === 'sales' && !resolvedType) {
    const type = tradeTypeFromChannelId(readChannelId(item), channels)
    if (type) label = `${label} · ${t(`trade_docs.contracts.form.lines.copy.tradeType.${type}`)}`
  }
  return { option: { value: id, label }, number, counterparty }
}

/**
 * 「从订单/报价单复制行」 for a contract.
 *
 * Modelled on the PI/CI dialog (`DocumentsForm`): pick a source family, pick the source document,
 * confirm — the source's lines are appended to the contract, each freezing a `sourceSnapshot` that
 * names the line it came from, and the head anchor is returned to the editor. The list of sources is
 * aligned with the contract's trade type (see `lib/contractLineSource`); a missing trade-type
 * channel leaves the picker empty instead of widening it to both types.
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
  const allowedKinds = React.useMemo(() => sourceKindsForDirection(direction), [direction])
  const [kind, setKind] = React.useState<ContractLineSourceKind>(allowedKinds[0] ?? 'purchase_order')
  const [sourceId, setSourceId] = React.useState('')
  const [isCopying, setIsCopying] = React.useState(false)
  /** The counterparty's `parties` roles; `null` while unknown and after a failed/absent read. */
  const [partyRoles, setPartyRoles] = React.useState<string[] | null>(null)
  const [channels, setChannels] = React.useState<TradeTypeChannelMap>({})
  const [channelsLoaded, setChannelsLoaded] = React.useState(false)
  /** The channel read itself failed (permission/transport) rather than merely being unseeded. */
  const [channelsFailed, setChannelsFailed] = React.useState(false)
  /** Display fields of the picked head, cached while the operator browses the suggestions. */
  const headCache = React.useRef(new Map<string, { number: string; counterparty: string }>())

  const route = CONTRACT_LINE_SOURCE_ROUTES[kind]
  const salesTradeType = tradeTypeFromPartyRoles(partyRoles)
  const salesSourcesBlocked =
    route.family === 'sales' && channelsLoaded && buildSalesSourceListParams(salesTradeType, channels, '') === null

  // Each opening starts clean: the first family the direction allows, no stale source selected.
  React.useEffect(() => {
    if (!open) return
    setKind(allowedKinds[0] ?? 'purchase_order')
    setSourceId('')
    headCache.current.clear()
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
      kind === 'sales_quote' ? 'quote' : 'order',
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
      const read = (item: Record<string, unknown>): HeadReading =>
        readHead(item, kind, salesTradeType, channels, t)
      if (activeRoute.family === 'purchase_order') {
        const payload = await fetchCrudList<Record<string, unknown>>(activeRoute.headApiPath, {
          pageSize: 100,
          sortField: 'created_at',
          sortDir: 'desc',
          ...(term ? { search: term } : {}),
        })
        return (payload.items ?? [])
          .map((item) => {
            const reading = read(item)
            headCache.current.set(reading.option.value, {
              number: reading.number,
              counterparty: reading.counterparty,
            })
            return reading.option
          })
          .filter((option) => option.value.length > 0)
      }
      // A resolved trade type with no channel id, or an organization with no trade-type channels at
      // all, offers nothing — never a silently widened list of every sales document.
      const params = buildSalesSourceListParams(salesTradeType, channels, term)
      if (!channelsLoaded || !params) return []
      const payload = await fetchCrudList<Record<string, unknown>>(activeRoute.headApiPath, params)
      return (payload.items ?? [])
        .map((item) => {
          const reading = read(item)
          headCache.current.set(reading.option.value, {
            number: reading.number,
            counterparty: reading.counterparty,
          })
          return reading.option
        })
        .filter((option) => option.value.length > 0)
    },
    [channels, channelsLoaded, kind, salesTradeType, t],
  )

  const handleCopy = React.useCallback(async () => {
    const id = sourceId.trim()
    if (!id) {
      flash(t('trade_docs.contracts.form.lines.copy.sourceRequired'), 'error')
      return
    }
    const activeRoute = CONTRACT_LINE_SOURCE_ROUTES[kind]
    setIsCopying(true)
    try {
      const payload = await fetchCrudList<Record<string, unknown>>(activeRoute.lineApiPath, {
        [activeRoute.lineParentParam]: id,
        pageSize: 100,
      })
      const copiedAt = new Date().toISOString()
      const rows = (payload.items ?? []).map((item) => sourceLineToContractLine(item, kind, copiedAt))
      if (rows.length === 0) {
        flash(t('trade_docs.contracts.form.lines.copy.empty'), 'error')
        return
      }
      const cached = headCache.current.get(id)
      onAppend(rows, {
        kind,
        id,
        number: cached?.number ?? '',
        counterparty: cached?.counterparty ?? '',
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
  }, [kind, onAppend, onOpenChange, sourceId, t])

  return (
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
              }}
            >
              <SelectTrigger id="contract-copy-source-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTRACT_LINE_SOURCE_KINDS.filter((value) => allowedKinds.includes(value)).map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`trade_docs.contracts.form.lines.copy.kind.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              seedOptions={
                sourceId && headCache.current.get(sourceId)
                  ? [
                      {
                        value: sourceId,
                        label: [headCache.current.get(sourceId)?.number, headCache.current.get(sourceId)?.counterparty]
                          .filter((part): part is string => Boolean(part))
                          .join(' — '),
                      },
                    ]
                  : undefined
              }
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
            disabled={isCopying || sourceId.trim().length === 0}
            onClick={() => void handleCopy()}
          >
            {t('trade_docs.contracts.form.lines.copy.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
