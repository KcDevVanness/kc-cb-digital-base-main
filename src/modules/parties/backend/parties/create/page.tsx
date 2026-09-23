import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { PartyForm } from '../../../components/PartyForm'

export default function CreatePartyPage() {
  return (
    <Page>
      <PageBody>
        <PartyForm mode="create" />
      </PageBody>
    </Page>
  )
}
