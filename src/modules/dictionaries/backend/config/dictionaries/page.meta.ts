/**
 * Metadata for the app-owned dictionary page body (`page.tsx`, which shadows the installed page).
 *
 * Re-exported rather than copied: navigation placement, the `dictionaries.view` +
 * `dictionaries.manage` gates, the page title, the breadcrumb and the settings page context stay
 * owned by the installed module, so an upgrade that changes them is picked up here for free. Only
 * the page body is app-owned.
 */
export { metadata } from '@open-mercato/core/modules/dictionaries/backend/config/dictionaries/page.meta'
