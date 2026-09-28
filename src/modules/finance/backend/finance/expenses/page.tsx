import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ExpensesTable from '../../../components/ExpensesTable'

export default function FinanceExpensesPage() {
  return (
    <Page>
      <PageBody>
        <ExpensesTable />
      </PageBody>
    </Page>
  )
}
