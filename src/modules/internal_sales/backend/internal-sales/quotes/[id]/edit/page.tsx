import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import InternalSalesForm from '../../../../../components/InternalSalesForm'

export default function EditInternalSalesQuotePage({ params }: { params?: { id?: string } }) {
  const documentId = params?.id
  if (!documentId) return null

  return (
    <Page>
      <PageBody>
        <InternalSalesForm kind="quote" mode="edit" documentId={documentId} />
      </PageBody>
    </Page>
  )
}
