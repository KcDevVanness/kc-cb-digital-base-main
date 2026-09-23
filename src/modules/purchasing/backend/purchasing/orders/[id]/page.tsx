import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import PurchaseOrderDetail from '../../../../components/PurchaseOrderDetail'

export default function PurchaseOrderDetailPage({ params }: { params?: { id?: string } }) {
  const orderId = params?.id
  if (!orderId) return null

  return (
    <Page>
      <PageBody>
        <PurchaseOrderDetail orderId={orderId} />
      </PageBody>
    </Page>
  )
}
