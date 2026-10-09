import { redirect } from 'next/navigation'

/**
 * The order hub now lives in `order_hub` at `/backend/orders/<id>`, the one filling surface for the
 * order. This URL stays resolvable for stored notification and bookmark links.
 */
export default function InternalSalesOrderDetailPage({ params }: { params?: { id?: string } }) {
  const orderId = params?.id
  if (!orderId) return null
  redirect(`/backend/orders/${encodeURIComponent(orderId)}`)
}
