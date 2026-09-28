import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ExpenseForm from '../../../../components/ExpenseForm'

export default function CreateExpensePage() {
  return (
    <Page>
      <PageBody>
        <ExpenseForm mode="create" />
      </PageBody>
    </Page>
  )
}
