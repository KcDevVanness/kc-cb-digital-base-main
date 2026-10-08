import { redirect } from 'next/navigation'

/**
 * The external order list entry is gone (the workbench is the only order entry); this URL stays
 * resolvable for stored notification and bookmark links and lands on the workbench pre-filtered to
 * the external trade type.
 */
export default function ExternalSalesOrderListPage() {
  redirect('/backend/orders?type=external')
}
