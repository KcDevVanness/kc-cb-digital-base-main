import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import PurchaseOrderEditForm from '../../../../../components/PurchaseOrderEditForm'

export default function EditPurchaseOrderPage({ params }: { params?: { id?: string } }) {
  const orderId = params?.id
  if (!orderId) return null

  return (
    <Page>
      <PageBody>
        <PurchaseOrderEditForm orderId={orderId} />
      </PageBody>
    </Page>
  )
}
