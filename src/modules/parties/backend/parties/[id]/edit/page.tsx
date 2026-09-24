import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { PartyForm } from '../../../../components/PartyForm'

export default function EditPartyPage({ params }: { params?: { id?: string } }) {
  const partyId = params?.id
  if (!partyId) return null

  return (
    <Page>
      <PageBody>
        <PartyForm mode="edit" partyId={partyId} />
      </PageBody>
    </Page>
  )
}
