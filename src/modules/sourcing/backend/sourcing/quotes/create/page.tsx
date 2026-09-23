import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import QuoteCreatePanel from '../../../../components/QuoteCreatePanel'

export default function CreateSourcingQuotePage() {
  return (
    <Page>
      <PageBody>
        <QuoteCreatePanel initialMode="import" />
      </PageBody>
    </Page>
  )
}
