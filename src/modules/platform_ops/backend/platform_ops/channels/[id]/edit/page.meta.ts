export const metadata = {
  requireAuth: true,
  requireFeatures: ['platform_ops.channels.manage'],
  pageTitle: 'Edit Channel',
  pageTitleKey: 'platform_ops.channels.form.editTitle',
  pageGroup: 'Platform Ops',
  pageGroupKey: 'platform_ops.nav.group',
  pageOrder: 232,
  breadcrumb: [
    { label: 'Platform Channels', labelKey: 'platform_ops.channels.page.title', href: '/backend/platform_ops/channels' },
    { label: 'Edit', labelKey: 'platform_ops.channels.form.editTitle' },
  ],
}

export default metadata
