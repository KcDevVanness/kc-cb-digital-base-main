import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import OrderFileDetail from '../../../../components/OrderFileDetail'

export default function ExportFinanceOrderFilePage({ params }: { params?: { id?: string } }) {
  const purchaseOrderId = params?.id
  if (!purchaseOrderId) return null

  return (
    <Page>
      <PageBody>
        <OrderFileDetail purchaseOrderId={purchaseOrderId} />
      </PageBody>
    </Page>
  )
}
