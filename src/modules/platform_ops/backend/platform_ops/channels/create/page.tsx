import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ChannelForm from '../../../../components/ChannelForm'

export default function CreatePlatformOpsChannelPage() {
  return (
    <Page>
      <PageBody>
        <ChannelForm mode="create" />
      </PageBody>
    </Page>
  )
}
