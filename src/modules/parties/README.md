# `parties` — trading-party master

App-owned counterparty master: buyers, branches (分公司) and service providers (货代 / 报关行 / 银行 /
认证机构) with the block the business prints on its paperwork.

Spec: [`.ai/specs/2026-09-22-app-owned-party-master.md`](../../../.ai/specs/2026-09-22-app-owned-party-master.md)
Decisions: [`docs/dev/business-architecture.md`](../../../docs/dev/business-architecture.md)

## What it owns

| Table | Entity id | Contents |
|---|---|---|
| `parties_parties` | `parties:party` | identity (code, 客户名称, country, status), 联系与地址 block |
| `parties_roles` | `parties:party_role` | what the party *is*: `buyer` \| `consignee` \| `branch` \| `forwarder` \| `broker` \| `bank` \| `certifier`; `attributes` JSONB reserved (Q-P-004) |
| `parties_bank_accounts` | `parties:party_bank_account` | 银行 / 银行账号 / SWIFT CODE / 银行地址, exactly one row marked default |

## Surfaces

| Surface | What ships |
|---|---|
| Backend pages | `/backend/parties` (list), `/backend/parties/create`, `/backend/parties/[id]` (detail), `/backend/parties/[id]/edit` |
| API | `GET\|POST\|PUT\|DELETE /api/parties` — list / create / update (id in body) / delete (`?id=`); `GET /api/parties/[id]` (party + roles + bank block, the edit form's read); `GET /api/parties/options` (picker source, `?search=` by code, `?ids=`) |
| Commands | `parties.parties.create`, `parties.parties.update`, `parties.parties.delete` |
| Events | `parties.party.created`, `parties.party.updated`, `parties.party.deleted` — all `clientBroadcast`, so open lists and pickers refresh without polling |
| ACL | `parties.view` — list, detail and options; `parties.manage` — create, update, delete and the create/edit pages |
| Migrations | `migrations/Migration20260922090832_parties.ts` — the three tables, their indexes and both cascading FKs; written by `yarn db:generate`, applied with `yarn db:migrate` |

## Invariants

- **Scope** — every row carries `tenant_id` + `organization_id` taken from the session; reads expand
  to the caller's readable organizations (`filterIds`), writes act in the selected one. A missing
  organization fails closed with `organization_scope_required`.
- **`code` is unique per organization** — including soft-deleted rows, so a removed party's code stays
  reserved. It is the only plaintext *identifying* column, so it is the whole search surface and the
  only identifying sort key; the other sortable columns are the non-identifying plaintext ones
  (`country_code`, `status`, `created_at`, `updated_at`, `id`).
- **Encrypted at rest** (`encryption.ts`) — `name`, contact person/phone/email, both address lines,
  city, and the entire bank block. Consequence: no unique index, sort, or LIKE on those columns; the
  list search filters `code`, and `search.ts` excludes them from provider text.
  Existing tenants need `yarn mercato entities seed-encryption --tenant <id>` to materialize the map.
- **One default bank account per party**, enforced by the command (`Only one bank account can be the
  default`) plus the partial unique index in the reviewed migration; the first row added becomes the
  default.
- **Children are replaced, not merged** — `roles[]` / `bankAccounts[]` in an update payload are the new
  truth: named ids update, unnamed rows are hard-deleted (they are value objects, referenced nowhere
  else). Omitting the key leaves the children untouched.
- **Optimistic locking** — `updated_at` is the version; update/delete reject a stale version with 409.
- **No `customers` data is read, copied or deleted** (greenfield decision, 2026-09-22).
- **Country is picked, not typed** — the form's `countryCode` is a searchable combobox over the
  shared ISO-3166 registry (`@open-mercato/shared/lib/location/countries`), labelled with the country
  name in the operator's locale. The stored value stays the alpha-2 code, so the API contract,
  validators and existing rows are unchanged; a code the registry does not know still renders as
  itself instead of blanking the field.

## Consumed by

- `trade_docs` — contract/invoice counterparty picker reads `/api/parties/options` (Phase 3 of the
  spec; before that it read `customers/companies`).

## Verification

```bash
yarn generate && yarn typecheck
# API smoke (dev server running, authenticated):
#   POST /api/parties with { code, name, roles: ['buyer'], bankAccounts: [{ beneficiaryBank, accountNumber, isDefault: true }] }
#   GET  /api/parties?search=<code>            → the row, decrypted
#   GET  /api/parties/<id>                     → the aggregate (roles + bankAccounts + updatedAt)
#   PUT  /api/parties with body { id } and header
#        x-om-ext-optimistic-lock-expected-updated-at: <stale>  → 409
#   DELETE /api/parties?id=<id>                → soft-deleted, the code stays reserved
#   POST with a duplicate code                 → 409
#   POST with two default bank rows            → 400
#   GET  /api/parties (and /api/parties/options) without parties.view → 403
```

## Rollback

Remove the registry line from `src/modules.ts` and run `yarn generate`: routes, pages, ACL and search
entries disappear. Tables and data stay until an explicit data change; no installed file was modified
by this module.
