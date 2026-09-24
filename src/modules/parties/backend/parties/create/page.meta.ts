export const metadata = {
  requireAuth: true,
  requireFeatures: ['parties.manage'],
  pageTitle: 'New party',
  pageTitleKey: 'parties.form.createTitle',
  pageGroup: 'Parties',
  pageGroupKey: 'parties.nav.group',
  pageOrder: 211,
  // Reached from the list; a create form is not a navigation destination of its own.
  navHidden: true,
  breadcrumb: [
    { label: 'Trading parties', labelKey: 'parties.page.title', href: '/backend/parties' },
    { label: 'Create', labelKey: 'parties.form.createTitle' },
  ],
}

export default metadata
