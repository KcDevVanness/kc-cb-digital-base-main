import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ProductCategoryForm from '../../../../../components/ProductCategoryForm'

export default function EditProductCategoryPage({ params }: { params?: { id?: string } }) {
  const categoryId = params?.id
  if (!categoryId) return null

  return (
    <Page>
      <PageBody>
        <ProductCategoryForm mode="edit" categoryId={categoryId} />
      </PageBody>
    </Page>
  )
}
