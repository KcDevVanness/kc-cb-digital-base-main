// Central place to enable modules and their source.
// - id: module id (plural snake_case; special cases: 'auth')
// - from: '@open-mercato/core' | '@app' | custom alias/path in future
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { ModuleOverrides } from '@open-mercato/shared/modules/overrides'

// - overrides: app-level disable/replace map for installed contributions. Shape and the
//   three firing rules: src/modules/example/references/module-overrides.reference.ts.
export type ModuleEntry = {
  id: string
  from?: '@open-mercato/core' | '@app' | string
  overrides?: ModuleOverrides
}

export const enabledModules: ModuleEntry[] = [
  { id: 'auth', from: '@open-mercato/core' },
  { id: 'directory', from: '@open-mercato/core' },
  { id: 'configs', from: '@open-mercato/core' },
  { id: 'entities', from: '@open-mercato/core' },
  { id: 'query_index', from: '@open-mercato/core' },
  { id: 'api_docs', from: '@open-mercato/core' },
  { id: 'audit_logs', from: '@open-mercato/core' },
  { id: 'notifications', from: '@open-mercato/core' },
  { id: 'dashboards', from: '@open-mercato/core' },
  { id: 'events', from: '@open-mercato/events' },
  { id: 'search', from: '@open-mercato/search' },
  { id: 'attachments', from: '@open-mercato/core' },
  // ERP core business modules — see .ai/specs/2026-09-21-erp-core-module-activation.md
  //
  // App policy: the installed catalog module injects its "Product SEO Helper" widget
  // (`catalog.injection.product-seo`, group label `catalog.widgets.productSeo.groupLabel`)
  // into the product CRUD form. Its `onBeforeSave` hook blocks saving a product whose title
  // is outside 10–60 characters or whose description is empty/under 50 characters, and it
  // marks `description` required. This app does not want SEO helpers, so the widget is
  // disabled here: the registry entry and its `crud-form:catalog.product` table slot are
  // dropped in every bootstrap (server and browser).
  //
  // `catalog.injection.product-seo` is the widget's `metadata.id`, which is what the table slots
  // reference; the entry key is `catalog:product-seo:widget`. The CLI prints
  // "Override did not match any registered entry" for this key — that is a partial-pass warning,
  // NOT a no-op: the entry and both form slots are dropped in the server/browser passes. Verified
  // 2026-09-23, recipe in .ai/lessons/module-override-page-hide-needs-routes-domain.md.
  {
    id: 'catalog',
    from: '@open-mercato/core',
    overrides: {
      widgets: { injection: { 'catalog.injection.product-seo': null } },
      // The app owns its product master (`src/modules/products/**`, see
      // .ai/specs/2026-09-22-products-and-trade-docs.md): the installed catalog's product,
      // variant and category pages are hidden from the navigation so the admin shows exactly
      // one product surface. The module and its API stay enabled on purpose — `sales` document
      // lines still resolve catalog offers/price kinds, `cross_border` receives stock through
      // `catalog_product_variants`, and existing rows keep working. This is a registry-level
      // hide; no installed file is touched.
      //
      // `config/catalog` is hidden as well (2026-09-23, owner request: fewer entries in the
      // Settings panel). The page manages catalog price kinds and the EU unit-price display
      // toggle, and no app-owned surface reads either one: the app's price vocabulary is
      // `products_prices.price_tier`, `purchasing`/`sourcing` carry their own
      // `supplier_cost`/`company_offer` codes in their own tables, and `catalog_price_kinds` is
      // empty (the module's `seedDefaults` never ran for this tenant). Hiding is `navHidden`,
      // not `null`, for two reasons: the catalog search presenter resolves
      // `catalog:catalog_price_kind` hits to this URL (`catalog/search.ts`), and re-enabling the
      // entry is deleting this one line. The page keeps working by URL while hidden — the
      // price-kind API and the `unit_price_display_enabled` PUT are untouched.
      //
      // Hidden means `navHidden`, not `null`: `catalog.product.low_stock` notifies with
      // `linkHref: /backend/catalog/products/{sourceEntityId}`, so the URL must stay resolvable.
      //
      // The domain is `routes.pages`, keyed by page pathname. A top-level `pages` key is NOT
      // a wired domain: the dispatcher only walks `DOMAIN_KEYS`, so it was read by nothing and
      // hid nothing, silently (see `@open-mercato/shared/modules/overrides`).
      routes: {
        pages: {
          '/backend/config/catalog': { metadata: { navHidden: true } },
          '/backend/catalog/products': { metadata: { navHidden: true } },
          '/backend/catalog/products/create': { metadata: { navHidden: true } },
          '/backend/catalog/products/[id]': { metadata: { navHidden: true } },
          '/backend/catalog/products/[productId]/variants/create': { metadata: { navHidden: true } },
          '/backend/catalog/products/[productId]/variants/[variantId]': { metadata: { navHidden: true } },
          '/backend/catalog/categories': { metadata: { navHidden: true } },
          '/backend/catalog/categories/create': { metadata: { navHidden: true } },
          '/backend/catalog/categories/[id]/edit': { metadata: { navHidden: true } },
        },
      },
    },
  },
  // App policy for the installed ERP business modules (`customers`, `sales`, `wms`,
  // `currencies`, `dictionaries`, `feature_toggles`): they stay ENABLED — their entities,
  // commands, events, API routes and ACL are the data layer the app-owned modules build on —
  // but their authored admin UI is hidden, because the app ships its own surfaces
  // (`src/modules/products|purchasing|trade_docs|platform_ops|cross_border|sourcing`).
  //
  // One mode only: `{ metadata: { navHidden: true } }` on every page. Domain is always
  // `routes.pages`, keyed by page pathname; a top-level `pages` key is read by nothing (the
  // dispatcher walks its fixed `DOMAIN_KEYS`), so it hides nothing and warns about nothing.
  //   `buildAdminNav` drops a `navHidden` entry before it splits entries into the
  //   main / settings / profile sidebars, so no sidebar and no menu shows the page, while the
  //   URL keeps resolving.
  // `null` is NOT an option for these modules: it removes the route manifest entry, so the URL
  // 404s. Those URLs are deep-link targets of subsystems that stay ENABLED — the installed
  // notification types (`sales.order.created` → `/backend/sales/orders/{id}`,
  // `catalog.product.low_stock` → `/backend/catalog/products/{id}`, `customers.deal.won`,
  // `wms.inventory.low_stock`, …), the row/action links of the official lists that remain
  // reachable, message-object hrefs and the catalog search presenter. Removing the route turns
  // every one of those clicks into a 404, including notifications already stored in the
  // database (their `linkHref` is frozen at emit time). Page-level ACL is unchanged either way:
  // each page still carries its own `requireFeatures` metadata.
  // Override metadata is additive: `resolveDeclaredPageRouteMetadata` drops undeclared keys, so
  // an existing title/group/icon survives the `navHidden` override.
  {
    id: 'customers',
    from: '@open-mercato/core',
    overrides: {
      routes: {
        pages: {
          '/backend/calendar': { metadata: { navHidden: true } },
          '/backend/config/customers': { metadata: { navHidden: true } },
          '/backend/config/customers/deals': { metadata: { navHidden: true } },
          '/backend/config/customers/pipeline-stages': { metadata: { navHidden: true } },
          '/backend/customer-tasks': { metadata: { navHidden: true } },
          '/backend/customers/companies': { metadata: { navHidden: true } },
          '/backend/customers/deals': { metadata: { navHidden: true } },
          '/backend/customers/deals/map': { metadata: { navHidden: true } },
          '/backend/customers/deals/pipeline': { metadata: { navHidden: true } },
          '/backend/customers/people': { metadata: { navHidden: true } },
          '/backend/customers/companies/[id]': { metadata: { navHidden: true } },
          '/backend/customers/companies-v2/[id]': { metadata: { navHidden: true } },
          '/backend/customers/companies/create': { metadata: { navHidden: true } },
          '/backend/customers/deals/[id]': { metadata: { navHidden: true } },
          '/backend/customers/deals/create': { metadata: { navHidden: true } },
          '/backend/customers/people/[id]': { metadata: { navHidden: true } },
          '/backend/customers/people-v2/[id]': { metadata: { navHidden: true } },
          '/backend/customers/people/create': { metadata: { navHidden: true } },
        },
      },
    },
  },
  {
    id: 'sales',
    from: '@open-mercato/core',
    overrides: {
      routes: {
        pages: {
          '/backend/config/sales': { metadata: { navHidden: true } },
          '/backend/sales/channels': { metadata: { navHidden: true } },
          '/backend/sales/channels/offers': { metadata: { navHidden: true } },
          '/backend/sales/orders': { metadata: { navHidden: true } },
          '/backend/sales/quotes': { metadata: { navHidden: true } },
          '/backend/sales/channels/[channelId]/edit': { metadata: { navHidden: true } },
          '/backend/sales/channels/[channelId]/offers/[offerId]/edit': { metadata: { navHidden: true } },
          '/backend/sales/channels/[channelId]/offers/create': { metadata: { navHidden: true } },
          '/backend/sales/channels/create': { metadata: { navHidden: true } },
          '/backend/sales/documents/[id]': { metadata: { navHidden: true } },
          '/backend/sales/documents/create': { metadata: { navHidden: true } },
          '/backend/sales/orders/[id]': { metadata: { navHidden: true } },
          '/backend/sales/quotes/[id]': { metadata: { navHidden: true } },
        },
      },
    },
  },
  {
    id: 'wms',
    from: '@open-mercato/core',
    overrides: {
      routes: {
        pages: {
          '/backend/config/wms': { metadata: { navHidden: true } },
          '/backend/wms': { metadata: { navHidden: true } },
          '/backend/wms/inventory': { metadata: { navHidden: true } },
          '/backend/wms/locations': { metadata: { navHidden: true } },
          '/backend/wms/lots': { metadata: { navHidden: true } },
          '/backend/wms/movements': { metadata: { navHidden: true } },
          '/backend/wms/reservations': { metadata: { navHidden: true } },
          '/backend/wms/warehouses': { metadata: { navHidden: true } },
          '/backend/wms/zones': { metadata: { navHidden: true } },
          '/backend/wms/location/[id]': { metadata: { navHidden: true } },
          '/backend/wms/lot/[id]': { metadata: { navHidden: true } },
          '/backend/wms/sku/[id]': { metadata: { navHidden: true } },
        },
      },
    },
  },
  {
    id: 'currencies',
    from: '@open-mercato/core',
    overrides: {
      routes: {
        pages: {
          '/backend/config/currency-fetching': { metadata: { navHidden: true } },
          '/backend/currencies': { metadata: { navHidden: true } },
          '/backend/exchange-rates': { metadata: { navHidden: true } },
          '/backend/currencies/[id]': { metadata: { navHidden: true } },
          '/backend/currencies/create': { metadata: { navHidden: true } },
          '/backend/exchange-rates/[id]': { metadata: { navHidden: true } },
          '/backend/exchange-rates/create': { metadata: { navHidden: true } },
        },
      },
    },
  },
  // EXCEPTION to the hide-installed-admin-UI policy: the dictionary library has no app-owned
  // replacement, and every main-data picker in the app (currency, unit of measure, country, ports,
  // carriers, payment terms, platforms, quotation sections) reads a dictionary this page maintains.
  // Left visible on purpose, in the settings sidebar under the installed "Module Configs" group and
  // gated on its own `dictionaries.view` + `dictionaries.manage` features.
  //
  // The page body is the app's own: `src/modules/dictionaries/backend/config/dictionaries/page.tsx`
  // shadows the installed page file (an app module directory under `src/modules/<id>` wins over the
  // package for the same logical file path), because the installed manager listed every
  // organization's dictionaries under identical names without ever naming the organization. Nested
  // ACL, navigation, API and the entries editor stay installed. See
  // src/modules/dictionaries/README.md.
  { id: 'dictionaries', from: '@open-mercato/core' },
  {
    id: 'feature_toggles',
    from: '@open-mercato/core',
    overrides: {
      routes: {
        pages: {
          '/backend/feature-toggles/global': { metadata: { navHidden: true } },
          '/backend/feature-toggles/overrides': { metadata: { navHidden: true } },
          '/backend/feature-toggles/global/[id]': { metadata: { navHidden: true } },
          '/backend/feature-toggles/global/[id]/edit': { metadata: { navHidden: true } },
          '/backend/feature-toggles/global/create': { metadata: { navHidden: true } },
        },
      },
    },
  },
  // App-owned currency policy — ordered after `customers`/`currencies` on purpose: its
  // seedDefaults reconciles the FX master and the currency dictionary after they seed theirs.
  // It was the last entry before the later app modules were appended; the ordering that matters
  // is "after customers/currencies", not "last".
  // See src/modules/currency_policy/lib/policy.ts and docs/dev/currency-policy.md
  { id: 'currency_policy', from: '@app' },
  // App-owned hardening — blocks out-of-scope writes on the installed auth admin commands
  // (`auth.users.create`, `auth.role-acl.update`, `auth.user-acl.update`).
  // See .ai/specs/2026-09-21-auth-scope-guard-hardening.md and src/modules/scope_guards/README.md
  { id: 'scope_guards', from: '@app' },
]

// App-owned purchasing module — supplier master, the supplier product library (the
// buyer-facing 产品明细表 with its price list), purchase orders and stage payments. See
// .ai/specs/2026-09-21-purchasing-module.md and .ai/specs/2026-09-22-supplier-product-library.md
enabledModules.push({
  id: 'purchasing',
  from: '@app',
  // Sidebar group order is a single app-wide decision: the six business-role groups come first,
  // every installed group keeps its existing position after them.
  overrides: { nav: { groupOrder: ['purchasing.nav.group', 'cross_border.nav.group', 'export_finance.nav.group', 'products.nav.group', 'parties.nav.group', 'platform_ops.nav.group'] } },
})

// App-owned cross-border module — consignments (shipments) that combine purchase orders, their
// in-transit milestones, and export documents. See .ai/specs/2026-09-21-cross-border-shipments.md
enabledModules.push({ id: 'cross_border', from: '@app' })

// Integration foundation for the marketplace/platform connectors (Phase 4 of
// docs/plans/cross-border-erp.md): `integrations` owns external-id mapping and the provider
// registry, `data_sync` owns streaming import/export runs, cursors and progress.
enabledModules.push({ id: 'integrations', from: '@open-mercato/core' })
enabledModules.push({ id: 'data_sync', from: '@open-mercato/core' })

// App-owned platform-ops module — marketplace channels, order mirrors, settlements and the
// reconciliation queue. See .ai/specs/2026-09-21-platform-ops.md
enabledModules.push({ id: 'platform_ops', from: '@app' })

// App-owned products module — the business product master (types, category tree, products and
// the three price tiers). See .ai/specs/2026-09-22-products-and-trade-docs.md
enabledModules.push({ id: 'products', from: '@app' })

// App-owned sourcing module — supplier quotations (imported from supplier workbooks or typed by
// hand), reusable column-mapping profiles, and the promotion of selected lines into the product
// master; the promotion also feeds the supplier library through `purchasing`'s commands. See
// .ai/specs/2026-09-22-supplier-quotation-import.md
enabledModules.push({ id: 'sourcing', from: '@app' })

// App-owned internal-sales surface — its own create/edit pages for quotes and orders, with lines
// that reference the app-owned product master; the installed `sales` chain (numbering, statuses,
// shipments, invoices) stays the engine underneath. See
// .ai/specs/2026-09-22-products-and-trade-docs.md (Phase 6).
enabledModules.push({ id: 'internal_sales', from: '@app' })

// App-owned trade docs module — purchase/sales contracts and inbound/outbound invoices with the
// dual amount calibers. See .ai/specs/2026-09-22-products-and-trade-docs.md
enabledModules.push({ id: 'trade_docs', from: '@app' })

// App-owned export finance module — 收汇档案 per purchase order and 出口退税档案 per container,
// plus the read-only order-file/container-file projections served to the business and finance
// views. Reads the purchasing / cross_border / trade_docs tables read-only.
// See .ai/specs/2026-09-22-order-file-and-export-finance.md
enabledModules.push({ id: 'export_finance', from: '@app' })

// App-owned trading-party master — buyers, branches and service providers with their bank block.
// See .ai/specs/2026-09-22-app-owned-party-master.md
enabledModules.push({ id: 'parties', from: '@app' })

// App-owned storage-operations CLI — `audit`, `migrate`, `verify`, `rollback`, `prune-local` for the
// local → object-storage move. No entity, no route, no page: it is an operator tool that drives the
// installed attachments driver factory (see .ai/specs/2026-09-23-local-to-s3-storage-migration.md,
// Phase 1). It is enabled unconditionally because it only reads/writes when an operator runs it.
enabledModules.push({ id: 'storage_ops', from: '@app' })

// Optional S3-compatible object storage provider, gated by the flag the shipped `.env` block
// documents ("When true, `storage_s3` is added to enabledModules in modules.ts"). Phase 0 of
// .ai/specs/2026-09-23-local-to-s3-storage-migration.md installs and credentials it while both
// attachment partitions keep `storage_driver: 'local'`, so the eventual cutover is a partition
// config change instead of a dependency install + image rebuild.
//
// Registration matters for correctness, not just for the settings UI: the module registers its
// `s3` driver at import time, and with the module off `StorageDriverFactory.resolveForAttachment`
// silently falls back to the local driver for an unknown key
// (`@open-mercato/core/modules/attachments/lib/drivers/driverFactory.ts:69`) — so a partition
// configured `s3` would read and write local disk with S3-shaped paths. `storage_ops` preflight
// asserts the resolved driver key matches the partition, which is only meaningful when this entry
// is present.
//
// Keep this flag identical at generate/build time and at runtime: module loading comes from the
// generated registry baked by `yarn generate`/`yarn build`, while the partition settings page
// gates its S3 option on the request-time `process.env`. Build-false + runtime-true is the
// dangerous combination (UI offers S3, no driver registered). Production images carry no `.env`,
// so the deployment environment must inject it — see docs/deploy/storage.md.
if (parseBooleanWithDefault(process.env.OM_ENABLE_STORAGE_S3, false)) {
  enabledModules.push({ id: 'storage_s3', from: '@open-mercato/storage-s3' })
}

const enterpriseModulesEnabled = parseBooleanWithDefault(process.env.OM_ENABLE_ENTERPRISE_MODULES, false)
const enterpriseSsoEnabled = parseBooleanWithDefault(process.env.OM_ENABLE_ENTERPRISE_MODULES_SSO, false)
const enterpriseSecurityEnabled = parseBooleanWithDefault(process.env.OM_ENABLE_ENTERPRISE_MODULES_SECURITY, false)
const enterpriseAgentsEnabled = parseBooleanWithDefault(process.env.OM_ENABLE_ENTERPRISE_MODULES_AGENTS, false)

if (enterpriseModulesEnabled) {
  enabledModules.push(
    { id: 'record_locks', from: '@open-mercato/enterprise' },
    { id: 'system_status_overlays', from: '@open-mercato/enterprise' },
  )
}

if (enterpriseModulesEnabled && enterpriseSsoEnabled) {
  enabledModules.push({ id: 'sso', from: '@open-mercato/enterprise' })
}

if (enterpriseModulesEnabled && enterpriseSecurityEnabled) {
  enabledModules.push({ id: 'security', from: '@open-mercato/enterprise' })
}

if (enterpriseModulesEnabled && enterpriseAgentsEnabled) {
  enabledModules.push({ id: 'agent_orchestrator', from: '@open-mercato/enterprise' })
  // Example app module: shows how to declare an Agent Orchestrator agent from a
  // brand-new module. Its source ships in every preset; it imports the
  // orchestrator SDK, so it is only enabled alongside it.
  enabledModules.push({ id: 'agent_examples', from: '@app' })
}
