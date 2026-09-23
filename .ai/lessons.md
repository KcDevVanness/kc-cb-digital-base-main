# Lessons

This catalog indexes 20 focused lessons without loading their full text. Route the task first, then read only records whose **modules**, standalone-harness **areas**, or **topics** match the work.

## How to use this catalog

1. Start with the exact module ID when one is named by the task.
2. Add every matching area from the standalone harness router: `architecture`, `module-data`, `umes`, `backend-ui`, `integration`, `ai-workflow`, `debugging`, `testing`, `framework-context`, or `spec-pr`.
3. Use topics to narrow cross-cutting concerns such as `data-scoping`, `optimistic-locking`, `query-index`, or `generated-files`.
4. Open only the linked lesson records that match; do not bulk-read `.ai/lessons/`.

Useful searches:

```bash
rg -n '\b<module-or-topic>\b' .ai/lessons.md
rg -l '"<area>"|"<module>"|"<topic>"' .ai/lessons/*.md
```

## Adding or updating a lesson

- Copy `.ai/lessons/_template.md` to one focused `.ai/lessons/<kebab-case-slug>.md`; update an existing record instead of duplicating it.
- Preserve the front matter keys `title`, `modules`, `areas`, and `topics`. Use `platform` only when no module or package owns the lesson, and put the primary area first.
- Add or update exactly one catalog row under its primary area below. Keep the title stable when code or specs cite it.
- Put hard boundaries in `AGENTS.md`; lessons explain recurring evidence and the durable rule.
- Run `node scripts/check-lessons.mjs` before committing.

## Catalog

- [Removing a platform locale needs three seams narrowed, not one](lessons/locale-served-set-seams.md) — area:architecture,framework-context; module:platform; topic:i18n,locale-registry,served-locales,dictionary-loader,generate
- [Keep file-agent sandbox sources out of the app's typed build](lessons/agent-sandbox-sources-tsconfig.md) — area:ai-workflow,architecture; module:agent_examples; topic:tsconfig,typecheck,build-gate,sandbox,file-agents
- [Currency pickers read the seeded currency dictionary, not the FX master](lessons/currency-dictionary-seeding.md) — area:module-data,framework-context; module:currency_policy,customers,currencies,dictionaries; topic:currency,dictionary,seeding,seed-defaults,module-order,data-scoping
- [No input-level component override exists; crud-form/data-table handles are markers](lessons/installed-inputs-have-no-component-override.md) — area:umes,backend-ui,framework-context; module:platform; topic:component-override,component-replacement-handles,use-registered-component,lookup-select,installed-inputs,page-override
- [A command interceptor rejection needs an explicit HTTP mapping on custom routes](lessons/interceptor-rejection-http-mapping.md) — area:umes,architecture,framework-context; module:platform,scope_guards; topic:command-interceptor,error-mapping,api-dispatcher,http-status,custom-routes
- [Auth admin writes skip organization-scope checks; app-side guards must cover them](lessons/auth-admin-writes-need-scope-guards.md) — area:architecture,umes; module:auth,scope_guards,directory; topic:data-scoping,acl,organization-tree,authorization,multi-tenancy
- [A per-user ACL is an absolute override, not an extra grant](lessons/per-user-acl-is-an-absolute-override.md) — area:architecture,testing; module:auth,platform; topic:acl,rbac,authorization,integration-tests,multi-tenancy
- [Money-path writes carry exactly one version: the aggregate's](lessons/money-path-writes-carry-one-version.md) — area:module-data,architecture,backend-ui; module:sales,internal_sales; topic:optimistic-locking,crud-form,document-lines,upsert,409,stale-closure
- [Sales lines accept any product uuid; only the installed picker needs the catalog](lessons/sales-lines-accept-any-product-uuid.md) — area:framework-context,architecture,umes; module:sales,products,catalog; topic:product-reference,sales-documents,uom-resolution,component-replacement,injection-points,option-sources
- [Hiding an installed page needs the routes.pages override domain](lessons/module-override-page-hide-needs-routes-domain.md) — area:umes,framework-context,architecture; module:platform; topic:module-overrides,route-overrides,nav-hidden,installed-pages,deep-links,notifications
- [Shipping and stock receipt are variant-level, so a product needs a catalog link](lessons/stock-receipt-needs-variant-resolution.md) — area:module-data,architecture; module:purchasing,cross_border,products,wms; topic:product-reference,variants,inventory-receive,allocation,catalog-link,data-scoping
- [A module's API path segment is its directory name, not its page path](lessons/module-api-path-is-directory-name.md) — area:module-data,framework-context; module:products,trade_docs,purchasing,parties; topic:api-routes,route-generation,generated-files,module-registry,path-naming,debugging
- [Reads expand to descendant organizations; writes act in the selected one](lessons/read-expands-writes-are-selected-org.md) — area:module-data,architecture,backend-ui; module:products,trade_docs,purchasing; topic:data-scoping,organization-tree,pickers,option-sources,write-scope,crud-factory
- [A spreadsheet reader is app-owned, and a legacy .xls never resolves from MIME_BY_EXTENSION](lessons/spreadsheet-reader-and-xls-mime.md) — area:integration,module-data; module:sourcing,attachments; topic:spreadsheet,xls,mime-detection,attachment-upload,external-parser-dependency
- [A new module's features reach existing roles only after auth sync-role-acls](lessons/module-features-need-role-acl-sync.md) — area:architecture,framework-context; module:auth,sourcing,export_finance; topic:acl,roles,seed-defaults,feature-gates,tenant-setup
- [A derived status column is only as reachable as its writers' ordering](lessons/derived-status-needs-a-reachable-write-path.md) — area:module-data,debugging; module:export_finance,cross_border,purchasing; topic:derived-columns,status-vocabulary,cross-module-reads,acceptance-criteria,milestones,projection
- [Demo credentials are a repo-wide contract; a smoke test must restore them](lessons/demo-credentials-must-survive-smoke-tests.md) — area:debugging,testing; module:auth,platform,export_finance; topic:demo-credentials,password-policy,smoke-test,dev-supervisor,audit-gap,env-parity
- [A renderer that navigates only through the one-shot action response dead-ends on repeat clicks](lessons/notification-renderer-navigates-via-one-shot-action.md) — area:backend-ui,umes,debugging; module:notifications,sales,wms; topic:notification-panel,renderer-wrapper,repeat-click,action-idempotency,link-href,deep-links
- [The sidebar group key is the role boundary, and only one module may order the groups](lessons/sidebar-group-is-the-role-boundary.md) — area:backend-ui,architecture; module:sourcing,purchasing,cross_border,export_finance,internal_sales,trade_docs; topic:navigation,page-group-key,menu-taxonomy,sidebar-preferences,module-overrides
- [Next inlines only static process.env reads, so a framework dynamic lookup sees browser defaults](lessons/next-client-env-dynamic-lookup.md) — area:backend-ui,framework-context; module:auth,platform; topic:password-policy,client-env,process-env,next-inlining,auth-forms,ssr-hydration
