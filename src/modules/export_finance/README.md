# `export_finance` — 出口收汇与出口退税档案

The finance half of the 订单档案: what the business's Excel tracked by hand after the goods left.

**Two anchors, deliberately different:**

| Anchor | Entity | Unique key | Answers |
|---|---|---|---|
| **Order** (采购单) | `export_finance_collections` (+ `export_finance_collection_documents`) | `(tenant, organization, purchase_order_id)` | 是否已收款 / 涉外收入证明 |
| **Container** (发运单/柜) | `export_finance_refunds` (+ `export_finance_refund_documents`) | `(tenant, organization, shipment_id)` | 退税状态 / 退税金额 / 税金额备注 / 报告草单 / 出口退税资料整理 |

The refund is filed per container because that is the customs declaration unit; one container may
carry several orders (拼柜), so the **per-order** refund figure is derived at read time:

```
share_i = HALF_UP(refundAmount × orderTotal_i / Σ orderTotal, 2)
```

with the rounding remainder on the largest share (ties → lowest `number`). When `Σ orderTotal = 0`
no allocation is produced. Allocations always sum to the container amount.

The order's refund **status** is the least advanced of its containers:
`unknown(0) < not_started(1) < applied(2) < completed(3)`.

## What this module owns

- The two anchors above and their document tables (`data/entities.ts`).
- Upsert commands (`collections.save`, `refunds.save`) keyed by the anchor, with `updatedAt`
  optimistic locking; `refunds.save` refuses a shipment that is missing or `cancelled` (409).
- Six document commands (`collection-documents.{create,update,delete}`,
  `refund-documents.{create,update,delete}`) behind four CRUD routes.
- Two **read-only** projections, `lib/orderFileProjection.ts` and `lib/containerFileProjection.ts`,
  served by `GET /api/export_finance/order-files` and `GET /api/export_finance/container-files`
  (JSON or CSV), which assemble the 订单档案 from `purchasing`, `cross_border`, `trade_docs` and
  this module.

## What it deliberately does not do

- It never writes a peer module's table and declares no cross-module ORM relation: peer data is
  read with scoped raw SQL (`em.getKysely()`), and peer references are scalar ids plus snapshots.
- It does not store the derived business status, the per-order allocation, or the aggregated
  refund status — they are computed per request, so they cannot drift from their sources.
- It does not duplicate the order↔container link: `cross_border_shipment_allocations` (the
  existing 拼柜 relation) is the only one, read-only.

## Surfaces

| Surface | What ships |
|---|---|
| Backend pages | `/backend/export-finance/orders` (订单档案 list, business/finance tabs, CSV export) and `/backend/export-finance/orders/[id]` (order file detail); `/backend/export-finance/containers` (柜档案 list, CSV export) and `/backend/export-finance/containers/[id]` (container file detail). All four carry `pageGroupKey: export_finance.nav.group` — the sidebar group 「财务」 / "Finance" (`src/modules.ts` puts it third in `nav.groupOrder`, after 采购 and 外贸). |
| API | `GET\|PUT /api/export_finance/collections` and `GET\|PUT /api/export_finance/refunds` — `GET` is the anchor read, `PUT` runs `collections.save` / `refunds.save`; `GET\|POST\|PUT\|DELETE /api/export_finance/collection-documents` and `…/refund-documents` — `GET` is the list, the three write verbs are the six document commands; `GET /api/export_finance/order-files` and `GET /api/export_finance/container-files` — the two projections, JSON by default, `?format=csv` for the export (the order file also takes `?view=business\|finance`). |
| Commands | `export_finance.collections.save`, `export_finance.refunds.save`, `export_finance.collection-documents.{create,update,delete}`, `export_finance.refund-documents.{create,update,delete}` |
| Events | `export_finance.collections.updated`, `export_finance.refunds.updated` — the upsert commands emit only the `updated` form, and both are `clientBroadcast`; `export_finance.{collection,refund}-documents.{created,updated,deleted}` for the document CRUD. All fire after the write committed. |
| Components | `components/OrderFilesTable.tsx`, `components/OrderFileDetail.tsx`, `components/ContainerFilesTable.tsx`, `components/ContainerFileDetail.tsx`, `components/labels.ts` (status labels) |
| ACL | `acl.ts` — `export_finance.orders.view`, `export_finance.cabinets.view`, and `export_finance.manage` (declared `dependsOn` both `*.view`). The `GET` halves of the API carry a `*.view`; every write verb carries `export_finance.manage`. |
| Migration | `migrations/Migration20260922082558_export_finance.ts` — the four tables, their four scope indexes, both anchor unique keys (`(tenant, organization, purchase_order_id)` / `(tenant, organization, shipment_id)`) and both cascading FKs; written by `yarn db:generate`, applied with `yarn db:migrate`. |

## Features

| Feature | Grants |
|---|---|
| `export_finance.orders.view` | the order file list/detail and the collection read routes |
| `export_finance.cabinets.view` | the container file list/detail and the refund read routes |
| `export_finance.manage` | every write: both anchors (`collections.save`, `refunds.save`) and both document families (the six document commands) |

`setup.ts` grants `superadmin`/`admin` the three (`export_finance.*`); `employee` is deliberately left
ungranted, so a tenant decides for itself whether a warehouse or purchasing role may read collection and
tax-refund figures. Run `yarn mercato auth sync-role-acls` after changing them.

## Money

Every amount is quantized through `trade_docs/lib/money.ts` (BigInt `HALF_UP`), with the currency
scale from `trade_docs/lib/currencyScale.ts`. `Number.toFixed` is never used: `(1.005).toFixed(2)`
is `"1.00"` and would understate a refund.

See `.ai/specs/2026-09-22-order-file-and-export-finance.md` for the field-by-field mapping of the
35-field order file.

The collection and refund records carry a **picked** currency: both surfaces offer the app's currency
dictionary (`currency_policy/lib/clientOptions.ts` → `GET /api/currency_policy/currencies`) and merge the
record's own code into the list, so opening a 收汇/退税 shows the currency it already holds instead of a
silent `CNY` fallback. The API still accepts any ISO-shaped code (`data/validators.ts`), so an older
record whose currency left the policy list keeps working.

## Verification

```bash
yarn generate && yarn typecheck
yarn jest --config jest.config.cjs src/modules/export_finance
# API smoke (dev server running, authenticated):
#   GET  /api/export_finance/order-files?view=business|finance  → 200, the assembled 订单档案
#   GET  /api/export_finance/order-files?view=finance&format=csv → 200 text/csv attachment
#   PUT  /api/export_finance/collections { purchaseOrderId, collectionStatus } → 200, upsert by anchor
#   PUT  the same anchor again with a stale updatedAt           → 409
#   PUT  /api/export_finance/refunds { shipmentId } for a missing/cancelled shipment → 409
#   POST /api/export_finance/collection-documents               → 201; DELETE → row soft-deleted
#   GET  /api/export_finance/container-files without export_finance.cabinets.view → 403
```

## Rollback

Remove the registry line from `src/modules.ts` (`{ id: 'export_finance', from: '@app' }`) and run
`yarn generate`: pages, routes, commands, events and ACL entries disappear. The four tables and their
data stay. Migrations here are forward-only — the generated `Migration*` classes define `up()` only,
and the toolchain ships `db:generate` / `db:migrate` / `db:greenfield` (there is no `db:migrate:down`),
so a data rollback means restoring the database, or rebuilding it with `yarn db:greenfield` (which
drops every public table — a whole-database reset, not a per-module undo). No installed file was
modified by this module.
