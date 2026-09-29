import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import PackingListForm from '../../../../components/PackingListForm'

export default function CreatePackingListPage() {
  return (
    <Page>
      <PageBody>
        <PackingListForm mode="create" />
      </PageBody>
    </Page>
  )
}
