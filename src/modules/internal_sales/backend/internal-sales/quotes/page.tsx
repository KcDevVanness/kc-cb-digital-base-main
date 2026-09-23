import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import InternalSalesTable from '../../../components/InternalSalesTable'

export default function InternalSalesQuoteListPage() {
  return (
    <Page>
      <PageBody>
        <InternalSalesTable kind="quote" />
      </PageBody>
    </Page>
  )
}
