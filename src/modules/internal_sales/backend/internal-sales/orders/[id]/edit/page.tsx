import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import InternalSalesForm from '../../../../../components/InternalSalesForm'

export default function EditInternalSalesOrderPage({ params }: { params?: { id?: string } }) {
  const documentId = params?.id
  if (!documentId) return null

  return (
    <Page>
      <PageBody>
        <InternalSalesForm kind="order" mode="edit" documentId={documentId} />
      </PageBody>
    </Page>
  )
}
