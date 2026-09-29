import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import PackingListDetail from '../../../../components/PackingListDetail'

export default function PackingListDetailPage({ params }: { params?: { id?: string } }) {
  const documentId = params?.id
  if (!documentId) return null

  return (
    <Page>
      <PageBody>
        <PackingListDetail documentId={documentId} />
      </PageBody>
    </Page>
  )
}
