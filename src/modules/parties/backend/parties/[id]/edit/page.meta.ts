export const metadata = {
  requireAuth: true,
  requireFeatures: ['parties.manage'],
  pageTitle: 'Edit party',
  pageTitleKey: 'parties.form.editTitle',
  pageGroup: 'Parties',
  pageGroupKey: 'parties.nav.group',
  pageOrder: 212,
  // Reached from the list; the edit form is not a navigation destination of its own.
  navHidden: true,
  breadcrumb: [
    { label: 'Trading parties', labelKey: 'parties.page.title', href: '/backend/parties' },
    { label: 'Edit', labelKey: 'parties.form.editTitle' },
  ],
}

export default metadata
