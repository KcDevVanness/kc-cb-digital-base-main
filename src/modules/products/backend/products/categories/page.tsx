import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ProductTaxonomyPage from '../../../components/ProductTaxonomyPage'

/**
 * Legacy URL, kept routed so stored notification and bookmark links keep working.
 *
 * It renders the merged taxonomy page on the product-category tab instead of redirecting, because a
 * server redirect would drop the `?flash=`/`?type=` pair the shared post-save redirect appends.
 */
export default function ProductsCategoriesPage() {
  return (
    <Page>
      <PageBody>
        <ProductTaxonomyPage defaultTab="categories" />
      </PageBody>
    </Page>
  )
}
