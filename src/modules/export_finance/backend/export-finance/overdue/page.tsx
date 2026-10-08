import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import OverdueWorklist from '../../../components/OverdueWorklist'

export default function ExportFinanceOverduePage() {
  return (
    <Page>
      <PageBody>
        <OverdueWorklist />
      </PageBody>
    </Page>
  )
}
