import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ContainerFilesTable from '../../../components/ContainerFilesTable'

export default function ExportFinanceContainersPage() {
  return (
    <Page>
      <PageBody>
        <ContainerFilesTable />
      </PageBody>
    </Page>
  )
}
