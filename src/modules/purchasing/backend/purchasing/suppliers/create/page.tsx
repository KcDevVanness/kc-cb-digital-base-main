import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import SupplierForm from '../../../../components/SupplierForm'

export default function CreatePurchasingSupplierPage() {
  return (
    <Page>
      <PageBody>
        <SupplierForm mode="create" />
      </PageBody>
    </Page>
  )
}
