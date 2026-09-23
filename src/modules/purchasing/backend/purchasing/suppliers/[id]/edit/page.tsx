import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import SupplierForm from '../../../../../components/SupplierForm'

export default function EditPurchasingSupplierPage({ params }: { params?: { id?: string } }) {
  const supplierId = params?.id
  if (!supplierId) return null

  return (
    <Page>
      <PageBody>
        <SupplierForm mode="edit" supplierId={supplierId} />
      </PageBody>
    </Page>
  )
}
