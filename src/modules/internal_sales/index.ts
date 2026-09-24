import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'internal_sales',
  title: 'Internal Sales',
  version: '0.1.0',
  description: '自有内部销售单据界面：报价单与销售订单，行引用自建商品主数据（products），底层沿用官方 sales 单据链。',
  author: 'App Team',
  license: 'MIT',
}
