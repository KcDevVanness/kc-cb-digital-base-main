import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import OrdersTable from '../../../components/OrdersTable'

export default function PlatformOpsOrdersPage() {
  return (
    <Page>
      <PageBody>
        <OrdersTable />
      </PageBody>
    </Page>
  )
}
