"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { QuoteChangesPanel } from './QuoteChangesPanel'
import QuotesTable from './QuotesTable'

/**
 * The quotation workspace: the documents themselves and what changed between them.
 *
 * Two tabs, one page — the archive and its analysis belong together, and the analysis is useless
 * without the documents next to it. The intent lives in the URL hash (this module's convention for
 * "where in the console am I"), so a link into the changes view still works after a reload.
 */

const TABS = ['quotations', 'changes'] as const
type Tab = (typeof TABS)[number]

const TAB_KEYS: Record<Tab, string> = {
  quotations: 'sourcing.quotes.tabs.quotations',
  changes: 'sourcing.quotes.tabs.changes',
}

export function SourcingQuotesTabs() {
  const t = useT()
  const [tab, setTab] = React.useState<Tab>('quotations')

  React.useEffect(() => {
    const fromHash = (): void => {
      const raw = window.location.hash.replace('#', '')
      if ((TABS as readonly string[]).includes(raw)) setTab(raw as Tab)
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    return () => window.removeEventListener('hashchange', fromHash)
  }, [])

  const selectTab = React.useCallback((next: Tab) => {
    setTab(next)
    window.location.hash = next
  }, [])

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
      event.preventDefault()
      const index = TABS.indexOf(tab)
      const nextIndex = event.key === 'ArrowRight' ? (index + 1) % TABS.length : (index - 1 + TABS.length) % TABS.length
      selectTab(TABS[nextIndex])
    },
    [selectTab, tab],
  )

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label={t('sourcing.quotes.tabs.label', 'Quotation views')}
        className="flex items-center gap-1 border-b border-border"
        onKeyDown={onKeyDown}
      >
        {TABS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            id={`sourcing-quotes-tab-${candidate}`}
            aria-selected={tab === candidate}
            aria-controls={`sourcing-quotes-panel-${candidate}`}
            tabIndex={tab === candidate ? 0 : -1}
            onClick={() => selectTab(candidate)}
            className={
              tab === candidate
                ? 'border-b-2 border-primary px-3 py-2 text-sm font-medium text-foreground'
                : 'border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground'
            }
          >
            {t(TAB_KEYS[candidate], candidate)}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`sourcing-quotes-panel-${tab}`}
        aria-labelledby={`sourcing-quotes-tab-${tab}`}
        tabIndex={0}
      >
        {tab === 'quotations' ? <QuotesTable /> : <QuoteChangesPanel />}
      </div>
    </div>
  )
}

export default SourcingQuotesTabs
