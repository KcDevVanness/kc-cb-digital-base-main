# `parties` — trading-party master

App-owned counterparty master: buyers, branches (分公司) and service providers (货代 / 报关行 / 银行 /
认证机构) with the block the business prints on its paperwork.

Spec: [`.ai/specs/2026-09-22-app-owned-party-master.md`](../../.ai/specs/2026-09-22-app-owned-party-master.md)
Decisions: [`docs/dev/business-architecture.md`](../../docs/dev/business-architecture.md)

## What it owns

| Table | Entity id | Contents |
|---|---|---|
| `parties_parties` | `parties:party` | identity (code, 客户名称, country, status), 联系与地址 block |
| `parties_roles` | `parties:party_role` | what the party *is*: `buyer` \| `consignee` \| `branch` \| `forwarder` \| `broker` \| `bank` \| `certifier`; `attributes` JSONB reserved (Q-P-004) |
| `parties_bank_accounts` | `parties:party_bank_account` | 银行 / 银行账号 / SWIFT CODE / 银行地址, exactly one row marked default |

Surfaces: `/backend/parties` (list), `/backend/parties/create`, `/backend/parties/[id]/edit`,
`/backend/parties/[id]` (detail); API `/api/parties`, `/api/parties/[id]`, `/api/parties/options`.
ACL: `parties.view`, `parties.manage`.

## Invariants

- **Scope** — every row carries `tenant_id` + `organization_id` taken from the session; reads expand
  to the caller's readable organizations (`filterIds`), writes act in the selected one. A missing
  organization fails closed with `organization_scope_required`.
- **`code` is unique per organization** — including soft-deleted rows, so a removed party's code stays
  reserved. It is the only plaintext identifying column and therefore the only search/sort key.
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
#   PUT  /api/parties/<id> with a stale updatedAt → 409
#   POST with a duplicate code                 → 409
#   POST with two default bank rows            → 400
#   GET  /api/parties with no parties.manage   → 403
```

## Rollback

Remove the registry line from `src/modules.ts` and run `yarn generate`: routes, pages, ACL and search
entries disappear. Tables and data stay until an explicit data change; no installed file was modified
by this module.
