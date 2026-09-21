# Lessons

This catalog indexes 7 focused lessons without loading their full text. Route the task first, then read only records whose **modules**, standalone-harness **areas**, or **topics** match the work.

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
