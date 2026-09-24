import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import QuoteReviewPanel from '../../../../components/QuoteReviewPanel'

export default function SourcingQuoteReviewPage({ params }: { params?: { id?: string } }) {
  const quoteId = params?.id
  if (!quoteId) return null

  return (
    <Page>
      <PageBody>
        <QuoteReviewPanel quoteId={quoteId} />
      </PageBody>
    </Page>
  )
}
