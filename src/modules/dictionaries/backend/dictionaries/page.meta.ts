/**
 * Navigation metadata for the main-menu dictionary entry.
 *
 * Deliberately **not** a re-export of the installed `/backend/config/dictionaries` metadata: that
 * one places the page in the settings sidebar (`pageContext: 'settings'`, `pageGroup: 'Module
 * Configs'`), which stays exactly as it is. This file describes the app's own destination — a main
 * sidebar item under 「基础数据」 — while keeping the installed feature gates, so both entries answer
 * to the same permission.
 *
 * `icon` must name an icon the installed registry carries (`@open-mercato/ui`'s
 * `lucideRegistry.generated`): an unknown name renders nothing, silently. `book` is registered.
 */
export const metadata = {
  requireAuth: true,
  requireFeatures: ['dictionaries.view', 'dictionaries.manage'],
  pageTitle: 'Dictionaries',
  pageTitleKey: 'dictionaries.masterData.nav.title',
  pageGroup: 'Master data',
  pageGroupKey: 'master_data.nav.group',
  pageOrder: 100,
  icon: 'book',
  breadcrumb: [
    { label: 'Dictionaries', labelKey: 'dictionaries.masterData.nav.title' },
  ],
}

export default metadata
