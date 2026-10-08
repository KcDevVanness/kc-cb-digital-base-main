import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import InternalSalesTable from '../../components/InternalSalesTable'

/**
 * The sales-quote workbench: both trade types on one list.
 *
 * The two per-type menus are retired (their URLs redirect here with `?type=`), so the type column
 * and the type filter are what tell the two families apart, and every row action follows the row's
 * own trade type rather than an entry's.
 */
export default function SalesQuoteWorkbenchPage() {
  return (
    <Page>
      <PageBody>
        <InternalSalesTable kind="quote" tradeType="both" />
      </PageBody>
    </Page>
  )
}
