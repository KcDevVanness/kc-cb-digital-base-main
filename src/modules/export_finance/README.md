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
- Six document commands and four CRUD routes.
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

## Features

| Feature | Grants |
|---|---|
| `export_finance.orders.view` | the order file list/detail and the collection read routes |
| `export_finance.cabinets.view` | the container file list/detail and the refund read routes |
| `export_finance.manage` | every write: both anchors and all four document families |

`setup.ts` grants `superadmin`/`admin` the three; run `yarn mercato auth sync-role-acls` after
changing them.

## Money

Every amount is quantized through `trade_docs/lib/money.ts` (BigInt `HALF_UP`), with the currency
scale from `trade_docs/lib/currencyScale.ts`. `Number.toFixed` is never used: `(1.005).toFixed(2)`
is `"1.00"` and would understate a refund.

See `.ai/specs/2026-09-22-order-file-and-export-finance.md` for the field-by-field mapping of the
35-field order file.
