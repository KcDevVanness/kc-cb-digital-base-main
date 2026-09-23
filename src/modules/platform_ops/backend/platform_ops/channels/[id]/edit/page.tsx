import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ChannelForm from '../../../../../components/ChannelForm'

export default function EditPlatformOpsChannelPage({ params }: { params?: { id?: string } }) {
  const channelId = params?.id
  if (!channelId) return null

  return (
    <Page>
      <PageBody>
        <ChannelForm mode="edit" channelId={channelId} />
      </PageBody>
    </Page>
  )
}
