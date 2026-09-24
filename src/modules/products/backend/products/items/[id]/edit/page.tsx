import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ProductForm from '../../../../../components/ProductForm'

export default function EditProductsItemPage({ params }: { params?: { id?: string } }) {
  const productId = params?.id
  if (!productId) return null

  return (
    <Page>
      <PageBody>
        <ProductForm mode="edit" productId={productId} />
      </PageBody>
    </Page>
  )
}
