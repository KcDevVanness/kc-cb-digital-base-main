"use client"

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import ProductCategoriesTable from './ProductCategoriesTable'
import ProductTypesTable from './ProductTypesTable'

/**
 * The one operator surface for both product taxonomies (`.ai/specs/2026-09-23-product-taxonomy-consolidation.md`).
 *
 * `产品品类` is the module's only hierarchy; `产品线` is the flat label axis. They share this page because
 * they answer the same operator question — which is exactly why the two separate pages were indistinguishable.
 * Each tab's own table still renders its heading and one-line definition, so the page adds only the tab strip
 * and the sentence that tells the two apart.
 */

/** Canonical path: tab switches always land here, so an alias visit canonicalizes on first interaction. */
export const PRODUCT_TAXONOMY_HREF = '/backend/products/taxonomy'

const CATEGORIES_TAB = 'categories'
const LINES_TAB = 'lines'

export type ProductTaxonomyTab = typeof CATEGORIES_TAB | typeof LINES_TAB

/**
 * `defaultTab` pins the tab for the legacy aliases (`/backend/products/types`, `/backend/products/categories`),
 * which are still routed so stored notification and bookmark links keep working.
 */
export default function ProductTaxonomyPage({ defaultTab }: { defaultTab?: ProductTaxonomyTab } = {}) {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab: ProductTaxonomyTab =
    defaultTab ?? (searchParams.get('tab') === LINES_TAB ? LINES_TAB : CATEGORIES_TAB)

  /**
   * A legacy alias renders this page directly (a server redirect would drop the shared post-save
   * `?flash=`/`?type=` pair), so the URL is normalized here instead: the tab lands in `?tab=` and the
   * sidebar highlight moves back to the single taxonomy entry, while every existing query parameter —
   * flash included — is carried over.
   */
  React.useEffect(() => {
    if (pathname === PRODUCT_TAXONOMY_HREF) return
    const params = new URLSearchParams(searchParams.toString())
    if (tab === LINES_TAB) params.set('tab', LINES_TAB)
    else params.delete('tab')
    const query = params.toString()
    router.replace(query.length > 0 ? `${PRODUCT_TAXONOMY_HREF}?${query}` : PRODUCT_TAXONOMY_HREF, {
      scroll: false,
    })
  }, [pathname, router, searchParams, tab])

  const handleTabChange = React.useCallback((next: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next === CATEGORIES_TAB) params.delete('tab')
    else params.set('tab', next)
    const query = params.toString()
    router.replace(query.length > 0 ? `${PRODUCT_TAXONOMY_HREF}?${query}` : PRODUCT_TAXONOMY_HREF, {
      scroll: false,
    })
  }, [router, searchParams])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t('products.taxonomy.page.description')}</p>
      <Tabs value={tab} onValueChange={handleTabChange} variant="underline">
        <TabsList aria-label={t('products.taxonomy.page.title')}>
          <TabsTrigger value={CATEGORIES_TAB}>{t('products.taxonomy.tab.categories')}</TabsTrigger>
          <TabsTrigger value={LINES_TAB}>{t('products.taxonomy.tab.lines')}</TabsTrigger>
        </TabsList>
        <TabsContent value={CATEGORIES_TAB}>
          <ProductCategoriesTable />
        </TabsContent>
        <TabsContent value={LINES_TAB}>
          <ProductTypesTable />
        </TabsContent>
      </Tabs>
    </div>
  )
}
