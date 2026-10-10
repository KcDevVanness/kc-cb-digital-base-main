---
title: "A business root the operator clicks must be its own record, not an aggregation of other modules' lists"
modules: ["order_hub"]
areas: ["module-data", "architecture", "backend-ui"]
topics: ["aggregation-vs-entity", "root-record", "link-table", "frozen-snapshot", "owner-feedback", "row-identity"]
---

# A business root the operator clicks must be its own record, not an aggregation of other modules' lists

**Context**: The order workbench (`/backend/orders`) was built twice as an entry/UI layer over three existing
lists (internal sales / external sales / purchase orders): a server route forwarded the caller's credentials to
`/api/sales/orders` and `/api/purchasing/purchase-orders`, merged the pages, and the client rendered rows whose
`id` was the *other module's document id* — so clicking a purchase row left the order context entirely and landed
on `/backend/purchasing/orders/<id>`. After two rounds of entry-layer rework the owner rejected the approach twice
(2026-10-08 and 2026-10-09): "不复用以前的功能进行 UI 上的集合…完全新增一个表进行存放数据，然后通过表的数据关联
的方式达到这个功能模块" and "点击订单工作台的订单 item 而不是直接跳到采购单的模块的 item … 类似于购销合同，进行
关联方式的填入不同功能模块的数据".

**Problem**: An aggregation can mirror *state* but cannot own *identity*: it has nowhere to put the root's own
fields, no place for the association set, no version to lock, no row to undo, and it re-keys every stage count to
whichever peer document happens to be in the window. Each new requirement (associate an existing document, freeze a
snapshot, resolve an old URL, link a child back on create) then gets bolted onto the aggregating route, and the
next requirement breaks it again — which is exactly how "the company order keeps being rebuilt wrong" repeated.

**Rule**: When a business object is the thing the operator opens, creates and associates — give it its own table
plus a module-owned link table (`(root_id, kind, ref_id)` unique) with frozen snapshots of the peers' number /
counterparty / status, written by commands (whole-set replace for dialogs, idempotent add for create-time
plumbing), and make every UI row carry the root's id. Peer modules keep their data and their chains; the root
reaches them by association, exactly like the contract page (`trade_docs_contract_orders`) does. Read the peers
through scoped projections (union over linked children), never by importing their entities or re-listing their
tables.

**Applies to**: `src/modules/order_hub` (`order_hub_company_orders` + `order_hub_company_order_links`,
`order_hub.orders.create|update|delete|links.replace|link-child`, the workbench/hub components, the
`backfill-company-orders` CLI); any future "hub"/"workbench"/"cockpit" surface whose rows are today another
module's documents; specs `.ai/specs/2026-10-09-company-order-root.md` (replaces the aggregation口径 of
`2026-10-08-order-centric-entry.md`).
