import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ProductTypeForm from '../../../../../components/ProductTypeForm'

export default function EditProductTypePage({ params }: { params?: { id?: string } }) {
  const typeId = params?.id
  if (!typeId) return null

  return (
    <Page>
      <PageBody>
        <ProductTypeForm mode="edit" typeId={typeId} />
      </PageBody>
    </Page>
  )
}
