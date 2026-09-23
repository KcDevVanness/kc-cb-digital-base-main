---
title: "A new module's features reach existing roles only after auth sync-role-acls"
modules: ["auth", "sourcing", "export_finance"]
areas: ["architecture", "framework-context"]
topics: ["acl", "roles", "seed-defaults", "feature-gates", "tenant-setup"]
---

# A new module's features reach existing roles only after auth sync-role-acls

**Context**: Adding the app-owned `sourcing` module (four new feature ids, granted to `superadmin` and `admin` in `setup.ts`'s `defaultRoleFeatures`) to a tenant that already existed. Every `/api/sourcing/*` and `/backend/sourcing/*` request returned 403 `{"error":"Forbidden","requiredFeatures":["sourcing.quotes.view"]}` for a user whose role the code says should have `sourcing.*`.

**Problem**: `defaultRoleFeatures` is a **seed-time** declaration. `yarn mercato auth setup` / tenant creation applies it to the roles it creates, and `yarn mercato auth seed-roles` seeds role rows — but neither rewrites the ACL rows of roles that already exist in a live tenant. So a module that ships after a tenant was created is invisible to that tenant's roles until the rows are updated, and the failure looks like a permission bug in the new code.

Confirmed again while adding `export_finance` (three features): the sync applied `export_finance.*` to `superadmin`/`admin` in the existing tenant (`auth:setup] Seeded default role features … "export_finance.*"`), and every acceptance call made with a **superadmin** session passed *before* the sync too — a superadmin's bypass means such a run proves nothing about the grant.

1. **`is_super_admin: true` hides the problem.** A superadmin role carries a bypass flag, so a module that "works" while you test as superadmin can still be 403 for every normal role. The existing `products.*` grants in that tenant had never been exercised by a non-superadmin for exactly this reason.
2. **The resolved grant list is cached in the running process.** After `yarn mercato auth sync-role-acls` updates `role_acls.features_json` (verified directly with a query), requests kept failing with the *old* list — the dispatcher's `[api] Forbidden - missing required features` log line showed `grantedFeatures` without the new entries. Restarting the dev server (or waiting for a process restart) is what makes the new grants visible.

**Rule**: Treat role ACL rows as data that a code change does not migrate.
- After adding features to a module, run `yarn mercato auth sync-role-acls` for existing tenants (it merges every module's `defaultRoleFeatures` into the existing role rows) and verify with a query on `role_acls.features_json` — not with a superadmin session.
- Restart the app after the sync: the feature list is resolved per process, so in-flight servers keep answering from the pre-sync state.
- Reproduce the new surface with a **non-superadmin** role; a superadmin bypass proves nothing about the feature wiring.
- When a route gate denies, the dispatcher logs the resolved `grantedFeatures` for that request — read that log line instead of re-deriving the ACL in a script.

**Applies to**: any app or installed module adding features (`acl.ts` / `setup.ts`), tenant bootstrap and seeding flows, and every verification run that claims a new surface is reachable.
