import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import SupplierProductForm from '../../../../components/SupplierProductForm'

export default function CreateSupplierProductPage() {
  return (
    <Page>
      <PageBody>
        <SupplierProductForm mode="create" />
      </PageBody>
    </Page>
  )
}
