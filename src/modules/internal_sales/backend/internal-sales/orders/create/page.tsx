import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import InternalSalesForm from '../../../../components/InternalSalesForm'

export default function CreateInternalSalesOrderPage() {
  return (
    <Page>
      <PageBody>
        <InternalSalesForm kind="order" mode="create" />
      </PageBody>
    </Page>
  )
}
