import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ShipmentCostsTable from '../../../components/ShipmentCostsTable'

export default function FinanceShipmentCostsPage() {
  return (
    <Page>
      <PageBody>
        <ShipmentCostsTable />
      </PageBody>
    </Page>
  )
}
