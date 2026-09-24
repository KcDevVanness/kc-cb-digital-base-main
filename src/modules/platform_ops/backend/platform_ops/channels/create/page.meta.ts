export const metadata = {
  requireAuth: true,
  requireFeatures: ['platform_ops.channels.manage'],
  pageTitle: 'Create Channel',
  pageTitleKey: 'platform_ops.channels.form.createTitle',
  pageGroup: 'Platform Ops',
  pageGroupKey: 'platform_ops.nav.group',
  pageOrder: 231,
  breadcrumb: [
    { label: 'Platform Channels', labelKey: 'platform_ops.channels.page.title', href: '/backend/platform_ops/channels' },
    { label: 'Create', labelKey: 'platform_ops.channels.form.createTitle' },
  ],
}

export default metadata
