import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ProductCategoryForm from '../../../../components/ProductCategoryForm'

export default function CreateProductCategoryPage() {
  return (
    <Page>
      <PageBody>
        <ProductCategoryForm mode="create" />
      </PageBody>
    </Page>
  )
}
