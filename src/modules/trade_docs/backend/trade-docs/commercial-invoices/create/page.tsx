import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import DocumentsForm from '../../../../components/DocumentsForm'

export default function CreateTradeDocCommercialInvoicePage() {
  return (
    <Page>
      <PageBody>
        <DocumentsForm kind="commercial" />
      </PageBody>
    </Page>
  )
}
