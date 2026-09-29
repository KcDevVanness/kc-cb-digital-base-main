import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import DocumentsForm from '../../../../../components/DocumentsForm'

export default function EditTradeDocProformaPage({ params }: { params?: { id?: string } }) {
  const documentId = params?.id
  if (!documentId) return null

  return (
    <Page>
      <PageBody>
        <DocumentsForm kind="proforma" documentId={documentId} />
      </PageBody>
    </Page>
  )
}
