import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import DocumentsForm from '../../../../components/DocumentsForm'

export default function CreateTradeDocProformaPage() {
  return (
    <Page>
      <PageBody>
        <DocumentsForm kind="proforma" />
      </PageBody>
    </Page>
  )
}
