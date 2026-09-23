import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ProductTypeForm from '../../../../components/ProductTypeForm'

export default function CreateProductTypePage() {
  return (
    <Page>
      <PageBody>
        <ProductTypeForm mode="create" />
      </PageBody>
    </Page>
  )
}
