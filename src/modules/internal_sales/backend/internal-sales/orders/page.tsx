import { redirect } from 'next/navigation'

/**
 * The order list entry is gone: the company-order workbench is the only order entry and the only
 * filling surface. This URL stays resolvable for stored notification and bookmark links, landing on
 * the workbench pre-filtered to this trade type.
 */
export default function InternalSalesOrderListPage() {
  redirect('/backend/orders?type=internal')
}
