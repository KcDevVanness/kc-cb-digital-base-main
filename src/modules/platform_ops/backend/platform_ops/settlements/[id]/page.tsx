import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import SettlementDetail from '../../../../components/SettlementDetail'

export default function PlatformOpsSettlementDetailPage({ params }: { params?: { id?: string } }) {
  const settlementId = params?.id
  if (!settlementId) return null

  return (
    <Page>
      <PageBody>
        <SettlementDetail settlementId={settlementId} />
      </PageBody>
    </Page>
  )
}
