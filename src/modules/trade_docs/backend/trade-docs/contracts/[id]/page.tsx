import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ContractDetail from '../../../../components/ContractDetail'

export default function TradeDocContractDetailPage({ params }: { params?: { id?: string } }) {
  const contractId = params?.id
  if (!contractId) return null

  return (
    <Page>
      <PageBody>
        <ContractDetail contractId={contractId} />
      </PageBody>
    </Page>
  )
}
