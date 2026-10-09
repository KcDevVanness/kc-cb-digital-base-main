import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import CompanyOrderForm from '../../../../components/CompanyOrderForm'

export default function EditCompanyOrderPage({ params }: { params?: { id?: string } }) {
  const orderId = params?.id
  if (!orderId) return null

  return (
    <Page>
      <PageBody>
        <CompanyOrderForm mode="edit" id={orderId} />
      </PageBody>
    </Page>
  )
}
