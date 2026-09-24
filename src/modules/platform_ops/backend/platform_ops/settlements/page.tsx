import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import SettlementsTable from '../../../components/SettlementsTable'

export default function PlatformOpsSettlementsPage() {
  return (
    <Page>
      <PageBody>
        <SettlementsTable />
      </PageBody>
    </Page>
  )
}
