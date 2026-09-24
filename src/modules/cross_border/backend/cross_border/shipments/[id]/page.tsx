import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ShipmentDetail from '../../../../components/ShipmentDetail'

export default function ShipmentDetailPage({ params }: { params?: { id?: string } }) {
  const shipmentId = params?.id
  if (!shipmentId) return null

  return (
    <Page>
      <PageBody>
        <ShipmentDetail shipmentId={shipmentId} />
      </PageBody>
    </Page>
  )
}
