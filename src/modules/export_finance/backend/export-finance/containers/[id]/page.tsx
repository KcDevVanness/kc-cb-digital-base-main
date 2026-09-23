import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ContainerFileDetail from '../../../../components/ContainerFileDetail'

export default function ExportFinanceContainerDetailPage({ params }: { params?: { id?: string } }) {
  const shipmentId = params?.id
  if (!shipmentId) return null

  return (
    <Page>
      <PageBody>
        <ContainerFileDetail shipmentId={shipmentId} />
      </PageBody>
    </Page>
  )
}
