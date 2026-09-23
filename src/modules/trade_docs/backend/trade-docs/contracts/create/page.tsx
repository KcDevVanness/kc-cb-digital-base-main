import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ContractForm from '../../../../components/ContractForm'

export default function CreateTradeDocContractPage() {
  return (
    <Page>
      <PageBody>
        <ContractForm mode="create" />
      </PageBody>
    </Page>
  )
}
