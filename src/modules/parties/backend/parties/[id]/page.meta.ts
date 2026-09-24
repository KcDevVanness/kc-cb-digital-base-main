export const metadata = {
  requireAuth: true,
  requireFeatures: ['parties.view'],
  pageTitle: 'Party',
  pageTitleKey: 'parties.form.detailTitle',
  pageGroup: 'Parties',
  pageGroupKey: 'parties.nav.group',
  pageOrder: 213,
  // Reached from the list; the dynamic segment keeps it out of the sidebar anyway.
  navHidden: true,
  breadcrumb: [
    { label: 'Trading parties', labelKey: 'parties.page.title', href: '/backend/parties' },
    { label: 'Details', labelKey: 'parties.form.detailTitle' },
  ],
}

export default metadata
