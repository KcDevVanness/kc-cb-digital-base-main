import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ProductForm from '../../../../components/ProductForm'

export default function CreateProductsItemPage() {
  return (
    <Page>
      <PageBody>
        <ProductForm mode="create" />
      </PageBody>
    </Page>
  )
}
