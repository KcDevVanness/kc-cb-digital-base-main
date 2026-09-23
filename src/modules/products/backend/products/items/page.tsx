import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ProductsTable from '../../../components/ProductsTable'

export default function ProductsItemsPage() {
  return (
    <Page>
      <PageBody>
        <ProductsTable />
      </PageBody>
    </Page>
  )
}
