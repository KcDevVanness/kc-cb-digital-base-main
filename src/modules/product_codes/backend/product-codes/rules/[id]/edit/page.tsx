import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import CodeRuleForm from '../../../../../components/CodeRuleForm'

export default function EditProductCodeRulePage({ params }: { params?: { id?: string } }) {
  const ruleId = params?.id
  if (!ruleId) return null

  return (
    <Page>
      <PageBody>
        <CodeRuleForm mode="edit" ruleId={ruleId} />
      </PageBody>
    </Page>
  )
}
