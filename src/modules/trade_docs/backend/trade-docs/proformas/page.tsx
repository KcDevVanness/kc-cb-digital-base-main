import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import DocumentsTable from '../../../components/DocumentsTable'

export default function TradeDocsProformasPage() {
  return (
    <Page>
      <PageBody>
        <DocumentsTable kind="proforma" />
      </PageBody>
    </Page>
  )
}
