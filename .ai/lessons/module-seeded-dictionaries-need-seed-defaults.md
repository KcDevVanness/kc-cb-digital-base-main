---
title: "A module's seeded dictionaries reach existing orgs only after seed:defaults"
modules: ["product_codes", "purchasing", "dictionaries"]
areas: ["module-data", "debugging"]
topics: ["dictionary", "seeding", "seed-defaults", "existing-tenant", "pickers", "empty-dropdown"]
---

# A module's seeded dictionaries reach existing orgs only after seed:defaults

**Context**: The supplier form's 默认品牌 field (`/backend/purchasing/suppliers/create`) rendered an
**empty dropdown**. The field is a `combobox` whose options come from the `product_brand` dictionary
(`purchasing/lib/brandOptions.ts`), and that dictionary did not exist in the deployment at all: a
`select … from dictionaries where key like 'product_%'` returned nothing, and
`product_codes_rules` was empty too — the whole code-generation feature was inert while its code,
UI and migrations were all in place.

**Problem**: `setup.ts` → `seedDefaults` is a **seed-time** declaration, like `defaultRoleFeatures`.
The CLI runs it on `yarn mercato init` / `yarn mercato seed:defaults` (which iterates **every**
organization, filtered by `--module <id>`), and tenant bootstrap runs it for a tenant it is creating
— but nothing back-fills an organization that already existed when the module was appended to
`src/modules.ts`. The failure is silent and misread as a UI bug: a dictionary-backed picker with no
entries renders as an empty list, and a seeded default row that is missing (a code rule) makes the
feature it drives unreachable. The module's own `seedDefaults` is insert-only and idempotent, so
re-running it is always safe.

**Rule**: Treat seeded dictionaries, seeded rules and `defaultRoleFeatures` as **data a code change
does not migrate**; `setup.ts` is not a migration.
- After enabling a module (or shipping a new seeded list) run
  `yarn mercato seed:defaults --module <id>` for existing organizations, and verify with a query on
  `dictionaries` / `dictionary_entries` (or the module's own seeded table) — not by re-reading the
  seed code.
- Record that repair command in the module README's 验证 section, next to the
  `auth sync-role-acls` note, so the next operator does not have to rediscover it.
- Diagnose an empty dictionary picker by checking the dictionary rows first; the picker is the
  messenger, not the bug.
- Keep the *write* side honest too: when a stored value must be a dictionary value, enforce it in the
  command (`assertDictionaryValue`, or the module's own `assertCurrencyInDictionary`-style helper) so
  an API caller cannot save a record the picker can never show again. The UI restriction alone is an
  illusion the next `POST` breaks.

**Applies to**: `src/modules/*/setup.ts` (`seedDefaults`), `src/modules.ts` `enabledModules`,
`dictionaries` lookups in app modules, and every README that documents a module's seeding steps.
