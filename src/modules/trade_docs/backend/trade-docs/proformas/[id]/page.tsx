import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import DocumentDetail from '../../../../components/DocumentDetail'

export default function TradeDocProformaDetailPage({ params }: { params?: { id?: string } }) {
  const documentId = params?.id
  if (!documentId) return null

  return (
    <Page>
      <PageBody>
        <DocumentDetail kind="proforma" documentId={documentId} />
      </PageBody>
    </Page>
  )
}
