import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ExpenseForm from '../../../../../components/ExpenseForm'

export default function EditExpensePage({ params }: { params?: { id?: string } }) {
  const expenseId = params?.id
  if (!expenseId) return null

  return (
    <Page>
      <PageBody>
        <ExpenseForm mode="edit" expenseId={expenseId} />
      </PageBody>
    </Page>
  )
}
