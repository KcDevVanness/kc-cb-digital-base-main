import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import SupplierProductForm from '../../../../../components/SupplierProductForm'

export default function EditSupplierProductPage({ params }: { params?: { id?: string } }) {
  const productId = params?.id
  if (!productId) return null

  return (
    <Page>
      <PageBody>
        <SupplierProductForm mode="edit" productId={productId} />
      </PageBody>
    </Page>
  )
}
