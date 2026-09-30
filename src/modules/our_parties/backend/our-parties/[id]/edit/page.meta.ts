export const metadata = {
  requireAuth: true,
  requireFeatures: ['our_parties.manage'],
  pageTitle: 'Edit our entity',
  pageTitleKey: 'our_parties.form.editTitle',
  pageGroup: 'Our entities',
  pageGroupKey: 'our_parties.nav.group',
  pageOrder: 232,
  // Reached from the list; the edit form is not a navigation destination of its own.
  navHidden: true,
  breadcrumb: [
    { label: 'Our entities', labelKey: 'our_parties.page.title', href: '/backend/our-parties' },
    { label: 'Edit', labelKey: 'our_parties.form.editTitle' },
  ],
}

export default metadata
