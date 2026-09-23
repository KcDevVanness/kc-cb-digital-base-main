---
title: "No input-level component override exists; crud-form/data-table handles are markers"
modules: ["platform"]
areas: ["umes", "backend-ui", "framework-context"]
topics: ["component-override", "component-replacement-handles", "use-registered-component", "lookup-select", "installed-inputs", "page-override"]
---

# No input-level component override exists; crud-form/data-table handles are markers

**Context**: A request to change how every relation field behaves — turn `LookupSelect`'s
"type at least 2 characters before anything is fetched" into a dropdown with a browsable first
page — reads like a UMES component-override job: `src/modules.ts` accepts
`entry.overrides.widgets.components`, and `.ai/guides/extensions.md` lists replace/wrapper/props
modes.

**Problem**: A component override only applies where the component resolves itself through
`useRegisteredComponent(handle, Impl)`. In 0.8.0 that is a closed list: the seven
`section:ui.detail.*` sections, `section:auth.login.form`, the four
`section:customer_accounts.domain-settings:*` sections, the three
`section:customers.*.detailTabs` sections, `dialog:customers.deals.quickDeal`, ten `staff.*`
timesheet/kanban ids, `section:example.overrides.showcase`, and the `page:<path>` handle the
backend catch-all resolves server-side (`src/app/(backend)/backend/[...slug]/page.tsx:117-124`).
`ComponentReplacementHandles` builds exactly `page:`, `data-table:`, `crud-form:`, `section:`
(`@open-mercato/shared/src/modules/widgets/component-registry.ts:142-147`); **no input/field
handle exists**. `CrudForm` and `DataTable` compute `crud-form:<entityId>` /
`data-table:<tableId>` but only emit them as a `data-component-handle` **DOM marker** — neither
calls the hook, so an override registered for them is silently inert. No input component
(`LookupSelect`, `ComboboxInput`, `TagsInput`, `DictionaryEntrySelect`, `primitives/select.tsx`)
imports anything from the registry, and UMES widget injection cannot replace a field either:
`crud-form:<entityId>:fields` contributions are **appended** (`CrudForm` builds
`[...fields, ...injectedCrudFields]`).

**Rule**: before promising an app-side fix to an installed field/input, prove the host resolves a
handle — check `useRegisteredComponent` in the installed file plus the four handle builders. With
no handle, the only app-side levers are a full `page:`/`section:`/`crud-form:` replacement
(reimplementing the screen and carrying upgrade drift) or an app-owned `type: 'custom'` field in a
form the app owns; otherwise the change belongs upstream in `@open-mercato/ui`, and a standalone app
should hand it over as an apply-ready patch rather than fake it locally (worked example:
`.ai/analysis/lookup-select-dropdown/` — component + tests + a harness that applies and runs the
patch against the installed sources). Never register a `crud-form:*`/`data-table:*` component
override expecting an effect.

**Applies to**: `src/modules.ts` (`entry.overrides.widgets.components`),
`src/modules/*/widgets/components.ts`, and any task phrased as "change how this installed control
behaves".
