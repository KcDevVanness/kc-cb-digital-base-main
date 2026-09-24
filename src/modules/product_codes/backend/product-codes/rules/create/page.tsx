import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import CodeRuleForm from '../../../../components/CodeRuleForm'

export default function CreateProductCodeRulePage() {
  return (
    <Page>
      <PageBody>
        <CodeRuleForm mode="create" />
      </PageBody>
    </Page>
  )
}
