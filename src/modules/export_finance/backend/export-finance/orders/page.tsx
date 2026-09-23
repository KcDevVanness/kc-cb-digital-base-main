import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import OrderFilesTable from '../../../components/OrderFilesTable'

export default function ExportFinanceOrdersPage() {
  return (
    <Page>
      <PageBody>
        <OrderFilesTable />
      </PageBody>
    </Page>
  )
}
