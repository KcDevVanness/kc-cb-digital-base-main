import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import DocumentsForm from '../../../../../components/DocumentsForm'

export default function EditTradeDocCommercialInvoicePage({ params }: { params?: { id?: string } }) {
  const documentId = params?.id
  if (!documentId) return null

  return (
    <Page>
      <PageBody>
        <DocumentsForm kind="commercial" documentId={documentId} />
      </PageBody>
    </Page>
  )
}
