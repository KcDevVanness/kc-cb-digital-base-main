import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ContractForm from '../../../../../components/ContractForm'

export default function EditTradeDocContractPage({ params }: { params?: { id?: string } }) {
  const contractId = params?.id
  if (!contractId) return null

  return (
    <Page>
      <PageBody>
        <ContractForm mode="edit" contractId={contractId} />
      </PageBody>
    </Page>
  )
}
