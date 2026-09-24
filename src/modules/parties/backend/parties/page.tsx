import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import PartiesTable from '../../components/PartiesTable'

export default function PartiesListPage() {
  return (
    <Page>
      <PageBody>
        <PartiesTable />
      </PageBody>
    </Page>
  )
}
