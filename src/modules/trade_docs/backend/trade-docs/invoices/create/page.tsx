import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import InvoiceForm from '../../../../components/InvoiceForm'

export default function CreateTradeDocInvoicePage() {
  return (
    <Page>
      <PageBody>
        <InvoiceForm mode="create" />
      </PageBody>
    </Page>
  )
}
