---
title: "A fixture organization has no seeded dictionaries, and the write contracts validate against them"
modules: ["finance", "purchasing", "platform", "dictionaries"]
areas: ["testing", "module-data"]
topics: ["integration-harness", "fixtures", "dictionary", "seed-defaults", "acl-feature-ids", "assertion-scale"]
---

# A fixture organization has no seeded dictionaries, and the write contracts validate against them

**Context**: `src/modules/finance/__integration__/finance-flow.spec.ts` (FLOW-G1) creates its own
organization, role and user through the harness fixtures, then drives supplier → purchase order →
shipment → receipt → landed cost → collection. The first four failures were all fixture gaps, each
with a distinct signature:

| Response | Cause |
|---|---|
| `403 Forbidden, requiredFeatures: ["wms.manage_warehouses"]` | the role's feature list was **guessed**; the real ids are `wms.manage_warehouses` / `wms.manage_locations` (see `wms/acl.ts`), not `wms.warehouses.manage` |
| `400 Currency dictionary is not configured yet.` | `purchasing` validates the currency against the `currency` dictionary, and a fixture org has none |
| `400 Dictionary shipment_cost_type is not configured for this organization yet` | the module's `setup.ts` seeds its dictionaries on `seed:defaults`, which never runs for a fixture org |
| `Expected: 200, Received: 201` | the framework's command routes answer 201; the exact code is not the contract being tested |

**Problem**: `createOrganizationFixture` makes an organization row, nothing more. Every contract
that validates a stored code against a dictionary (`currency`, `shipment_cost_type`,
`finance_expense_type`, product statuses…) and every feature id on a route is therefore a fixture
obligation, and each omission surfaces as a 400/403 in the *middle* of a long chain — after the
slow part (build + boot) has already been paid.

**Rule**: In an app-owned integration spec, (1) take feature ids from the module's own `acl.ts`
(and the route's `metadata`), never from the naming pattern of a sibling feature — the ACL route
accepts unknown ids silently and the failure only appears at the protected call; (2) seed exactly
the dictionaries the chain writes through, using the module's own seed constants so the fixture and
the tenant onboarding cannot drift; (3) assert command-route calls as "a 2xx carrying this payload"
rather than a pinned 200/201, and pin exact codes only for the CRUD/GET contracts under test;
(4) compare `numeric` columns as numbers — the raw value comes back as `10` or `10.0000` depending
on the driver, so `'10.0000'` is a driver assertion, not a business one.

**Applies to**: any `src/modules/*/__integration__/**` spec that builds its own organization,
`@open-mercato/core/helpers/integration/*Fixtures`, module `setup.ts` seed lists, route `metadata`
feature ids, `docs/dev/parallel-development.md`.
