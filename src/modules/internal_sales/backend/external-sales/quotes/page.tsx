import { redirect } from 'next/navigation'

/**
 * The per-type quote menus are gone: both trade types live in the sales-quote workbench
 * (`/backend/quotes`), whose type column separates them. This URL stays resolvable for stored
 * notification and bookmark links, landing on that workbench pre-filtered to the external type.
 */
export default function ExternalSalesQuoteListPage() {
  redirect('/backend/quotes?type=external')
}
