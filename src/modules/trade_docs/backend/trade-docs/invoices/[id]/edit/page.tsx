import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import InvoiceForm from '../../../../../components/InvoiceForm'

export default function EditTradeDocInvoicePage({ params }: { params?: { id?: string } }) {
  const invoiceId = params?.id
  if (!invoiceId) return null

  return (
    <Page>
      <PageBody>
        <InvoiceForm mode="edit" invoiceId={invoiceId} />
      </PageBody>
    </Page>
  )
}
