import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import CompanyOrderForm from '../../../components/CompanyOrderForm'

export default function CreateCompanyOrderPage() {
  return (
    <Page>
      <PageBody>
        <CompanyOrderForm mode="create" />
      </PageBody>
    </Page>
  )
}
