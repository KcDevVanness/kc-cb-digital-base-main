---
title: "Currency pickers read the seeded currency dictionary, not the FX master"
modules: ["currency_policy", "customers", "currencies", "dictionaries"]
areas: ["module-data", "framework-context"]
topics: ["currency", "dictionary", "seeding", "seed-defaults", "module-order", "data-scoping"]
---

# Currency pickers read the seeded currency dictionary, not the FX master

**Context**: The CRM deal form and the sales document form failed with
`尚未配置币种字典 / Currency dictionary is not configured yet.` while the `currencies` table was
simply empty and no `currency` dictionary row existed. Two different stores hold "currencies",
and only one of them feeds the UI.

**Problem**: `GET /api/customers/dictionaries/currency` resolves a **dictionary** row
(`dictionaries.key = 'currency' | 'currencies'`, entries in `dictionary_entries`) — that is what
`useCurrencyDictionary()` feeds into `DealForm`, `DealCurrencyField`, `AnnualRevenueField` and
`SalesDocumentForm`. The FX master (`currencies` table, `currencies` module) is a different
store: it drives exchange rates, `is_base` reporting and `/api/currencies/currencies/options`.
The dictionary is written by `customers.seedDefaults` (`seedCurrencyDictionary`), which seeds
**every** ISO 4217 code from `Intl.supportedValuesOf('currency')`, and the master is written by
`currencies.seedDefaults` — both only on `mercato init` / `mercato seed:defaults`, never on
tenant creation. Neither module offers a seam to narrow the list, so an app-side restriction
must run *after* them: `seed:defaults` iterates modules in `enabledModules` order, not by
`requires`.

**Rule**: To limit which currencies a deployment offers, own a reconcile module that (1) is
listed **last** in `src/modules.ts` `enabledModules`, (2) writes both stores for the scope —
dictionary entries are what the UI shows, master rows carry `is_base`/`is_active` — and (3) is
re-runnable through its own CLI so an existing scope can be repaired without a full init.
Never delete out-of-policy master rows (exchange rates and documents reference them); set
`is_active = false` and keep the row. A dictionary label is the whole option text in the sales
form but is prefixed with `CODE – ` by the CRM form, so store the plain name.

**Applies to**: `src/modules/currency_policy/**`, `src/modules.ts`, `customers` and `currencies`
`setup.ts` seeds, `dictionaries` currency lookups, `docs/dev/currency-policy.md`.
