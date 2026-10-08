import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import OrderDetail from '../../../../components/OrderDetail'

/**
 * The sales order hub: the order's own facts plus one section per downstream module, each with a
 * prefilled create entry.
 *
 * One implementation serves both entries (`/backend/internal-sales/**` and the external re-export):
 * the component derives the trade type from the pathname, so every link it emits stays inside the
 * entry the operator opened.
 */
export default function InternalSalesOrderDetailPage({ params }: { params?: { id?: string } }) {
  const orderId = params?.id
  if (!orderId) return null

  return (
    <Page>
      <PageBody>
        <OrderDetail orderId={orderId} />
      </PageBody>
    </Page>
  )
}
