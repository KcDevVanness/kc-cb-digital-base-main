import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import PackingListForm from '../../../../../components/PackingListForm'

export default function EditPackingListPage({ params }: { params?: { id?: string } }) {
  const documentId = params?.id
  if (!documentId) return null

  return (
    <Page>
      <PageBody>
        <PackingListForm mode="edit" documentId={documentId} />
      </PageBody>
    </Page>
  )
}
