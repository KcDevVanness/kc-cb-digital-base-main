import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ShipmentCostForm from '../../../../components/ShipmentCostForm'

export default function CreateShipmentCostPage() {
  return (
    <Page>
      <PageBody>
        <ShipmentCostForm mode="create" />
      </PageBody>
    </Page>
  )
}
