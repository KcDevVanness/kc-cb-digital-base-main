import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import PurchaseOrderForm from '../../../../components/PurchaseOrderForm'

export default function CreatePurchaseOrderPage() {
  return (
    <Page>
      <PageBody>
        <PurchaseOrderForm />
      </PageBody>
    </Page>
  )
}
