import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { OurPartyEditForm } from '../../../../components/OurPartyForm'

export default function EditOurPartyPage({ params }: { params?: { id?: string } }) {
  const profileId = params?.id
  if (!profileId) return null

  return (
    <Page>
      <PageBody>
        <OurPartyEditForm profileId={profileId} />
      </PageBody>
    </Page>
  )
}
