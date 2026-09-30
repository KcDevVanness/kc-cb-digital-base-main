export const metadata = {
  requireAuth: true,
  requireFeatures: ['our_parties.manage'],
  pageTitle: 'New our entity',
  pageTitleKey: 'our_parties.form.createTitle',
  pageGroup: 'Our entities',
  pageGroupKey: 'our_parties.nav.group',
  pageOrder: 231,
  // Reached from the list; the create form is not a navigation destination of its own.
  navHidden: true,
  breadcrumb: [
    { label: 'Our entities', labelKey: 'our_parties.page.title', href: '/backend/our-parties' },
    { label: 'New', labelKey: 'our_parties.form.createTitle' },
  ],
}

export default metadata
