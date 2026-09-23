---
title: "A derived status column is only as reachable as its writers' ordering"
modules: ["export_finance", "cross_border", "purchasing"]
areas: ["module-data", "debugging"]
topics: ["derived-columns", "status-vocabulary", "cross-module-reads", "acceptance-criteria", "milestones", "projection"]
---

# A derived status column is only as reachable as its writers' ordering

**Context**: The order-file projection (`export_finance`) derives 订单状态 from two modules instead of storing it:
`cancelled > closed > received > shipped (order status `shipped` or a departed shipment) > factory_pickup (the order is
`placed` **and** at least one of its containers has the `picked_up` milestone) > placed > draft`. The approved plan's
acceptance step read "place → milestone `picked_up` → `factory_pickup`; then `depart` → `shipped`".

**Problem**: `factory_pickup` cannot occur. `cross_border` refuses every milestone unless the shipment is already
`in_transit` (`Milestones can only be recorded while a shipment is in transit (currently draft)`, 422), and the very
command that makes it `in_transit` (`cross_border.shipments.depart`) also sets `departed_at` and transitions the
purchase order to `shipped`. So by the time a `picked_up` row can exist, the derived value has already moved past
`factory_pickup` — the plan's walk is unexecutable, no matter how the precedence table is ordered. The values are all
correct; the *ordering of the writers* makes one combination of them unreachable.

Why it is easy to miss: each module is consistent on its own (milestones are a monotonic in-transit log; `depart` is the
one place that flips the commercial status), and the derived rule reads as a plain maximum over booleans. Only walking
the producing commands in order — not the enum, not the projection — reveals the dead state.

Evidence (acceptance run against the dev server): `POST /api/cross_border/shipments/milestones` on a `draft` shipment
answers 422; after `POST /api/cross_border/shipments/depart` the same call answers 201 and the order file still reports
`shipped`, because `depart` has already marked the order shipped.

**Rule**: Before shipping a derived/aggregated column, enumerate its states and prove each one is reachable **through the
real write paths**, in the order the writers fire.
- Walk the producing commands (`grep` the transitions, not the projection) and check that the combination exists; a
  boolean table is not a reachability proof.
- If a state is unreachable, do not silently reorder precedence to hide it: either extend the producing command (an
  approval-level change to another module's state machine) or drop the state from the vocabulary and record why.
- When an approved acceptance step is unexecutable, report the discrepancy with the API response that proves it instead
  of asserting the plan's expected value.
- Unit-test the derivation *and* assert the ordering assumption in an integration path, so a later change to the writer
  (allowing the milestone earlier, or not flipping the order on depart) is caught.

**Applies to**: derived statuses, cross-module projections and dashboards, business-facing status vocabularies, and any
acceptance criterion that names a lifecycle walk.
