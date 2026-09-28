import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ShipmentCostForm from '../../../../../components/ShipmentCostForm'

export default function EditShipmentCostPage({ params }: { params?: { id?: string } }) {
  const costId = params?.id
  if (!costId) return null

  return (
    <Page>
      <PageBody>
        <ShipmentCostForm mode="edit" costId={costId} />
      </PageBody>
    </Page>
  )
}
