export const metadata = {
  requireAuth: true,
  requireFeatures: ['export_finance.cabinets.view'],
  pageTitle: 'Container file',
  pageTitleKey: 'export_finance.cabinets.page.title',
  pageGroup: 'Finance',
  pageGroupKey: 'export_finance.nav.group',
  pageOrder: 411,
  breadcrumb: [
    {
      label: 'Container file',
      labelKey: 'export_finance.cabinets.page.title',
      href: '/backend/export-finance/containers',
    },
  ],
}

export default metadata
