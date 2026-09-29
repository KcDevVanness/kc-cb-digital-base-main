import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import QuoteReviewPanel from '../../../../components/QuoteReviewPanel'
import VersionComparePanel from '../../../../components/VersionComparePanel'

export default function SourcingQuoteReviewPage({ params }: { params?: { id?: string } }) {
  const quoteId = params?.id
  if (!quoteId) return null

  return (
    <Page>
      <PageBody>
        <QuoteReviewPanel quoteId={quoteId} />
        <VersionComparePanel quoteId={quoteId} />
      </PageBody>
    </Page>
  )
}
