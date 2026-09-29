import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import DocumentsTable from '../../../components/DocumentsTable'

export default function TradeDocsCommercialInvoicesPage() {
  return (
    <Page>
      <PageBody>
        <DocumentsTable kind="commercial" />
      </PageBody>
    </Page>
  )
}
