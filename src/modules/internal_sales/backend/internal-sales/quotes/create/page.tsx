import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import InternalSalesForm from '../../../../components/InternalSalesForm'

export default function CreateInternalSalesQuotePage() {
  return (
    <Page>
      <PageBody>
        <InternalSalesForm kind="quote" mode="create" />
      </PageBody>
    </Page>
  )
}
