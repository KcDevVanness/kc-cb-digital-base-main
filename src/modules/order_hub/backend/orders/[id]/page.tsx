import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import OrderDetail from '../../../components/OrderDetail'

/**
 * The order hub — the one filling surface for a company order, at `/backend/orders/<id>`.
 *
 * The component derives the trade type from the document's own channel marker (falling back to
 * `internal`), so both sales types render on this one URL; the old per-trade-type detail URLs
 * redirect here.
 */
export default function OrderDetailPage({ params }: { params?: { id?: string } }) {
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
