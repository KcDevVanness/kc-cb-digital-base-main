export const metadata = {
  requireAuth: true,
  requireFeatures: ['platform_ops.settlements.view'],
  pageTitle: 'Settlement',
  pageTitleKey: 'platform_ops.settlements.detail.title',
  pageGroup: 'Platform Ops',
  pageGroupKey: 'platform_ops.nav.group',
  pageOrder: 241,
  breadcrumb: [
    { label: 'Platform Settlements', labelKey: 'platform_ops.settlements.page.title', href: '/backend/platform_ops/settlements' },
  ],
}

export default metadata
