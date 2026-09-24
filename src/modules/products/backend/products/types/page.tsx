import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ProductTaxonomyPage from '../../../components/ProductTaxonomyPage'

/**
 * Legacy URL, kept routed so stored notification and bookmark links keep working.
 *
 * It renders the merged taxonomy page on the product-line tab instead of redirecting, because a
 * server redirect would drop the `?flash=`/`?type=` pair the shared post-save redirect appends.
 */
export default function ProductsTypesPage() {
  return (
    <Page>
      <PageBody>
        <ProductTaxonomyPage defaultTab="lines" />
      </PageBody>
    </Page>
  )
}
