import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import SuppliersTable from '../../../components/SuppliersTable'

export default function PurchasingSuppliersPage() {
  return (
    <Page>
      <PageBody>
        <SuppliersTable />
      </PageBody>
    </Page>
  )
}
