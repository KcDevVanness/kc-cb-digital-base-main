import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import InternalSalesTable from '../../../components/InternalSalesTable'

export default function InternalSalesOrderListPage() {
  return (
    <Page>
      <PageBody>
        <InternalSalesTable kind="order" />
      </PageBody>
    </Page>
  )
}
