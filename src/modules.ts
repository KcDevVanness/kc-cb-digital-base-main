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
  {
    id: 'catalog',
    from: '@open-mercato/core',
    overrides: {
      widgets: { injection: { 'catalog.injection.product-seo': null } },
    },
  },
  { id: 'customers', from: '@open-mercato/core' },
  { id: 'sales', from: '@open-mercato/core' },
  { id: 'wms', from: '@open-mercato/core' },
  { id: 'currencies', from: '@open-mercato/core' },
  { id: 'dictionaries', from: '@open-mercato/core' },
  { id: 'feature_toggles', from: '@open-mercato/core' },
  // App-owned currency policy — last on purpose: its seedDefaults reconciles the FX
  // master and the currency dictionary after `customers`/`currencies` seed theirs.
  // See src/modules/currency_policy/lib/policy.ts and docs/dev/currency-policy.md
  { id: 'currency_policy', from: '@app' },
  // App-owned hardening — blocks out-of-scope writes on the installed auth admin commands
  // (`auth.users.create`, `auth.role-acl.update`, `auth.user-acl.update`).
  // See .ai/specs/2026-09-21-auth-scope-guard-hardening.md and src/modules/scope_guards/README.md
  { id: 'scope_guards', from: '@app' },
]

// App-owned purchasing module — supplier master first, then purchase orders and stage
// payments. See .ai/specs/2026-09-21-purchasing-module.md
enabledModules.push({ id: 'purchasing', from: '@app' })

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
