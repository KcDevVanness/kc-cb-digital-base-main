---
title: "A per-user ACL is an absolute override, not an extra grant"
modules: ["auth", "platform"]
areas: ["architecture", "testing"]
topics: ["acl", "rbac", "authorization", "integration-tests", "multi-tenancy"]
---

# A per-user ACL is an absolute override, not an extra grant

**Context**: Writing integration tests for organization-scope guards, the fixture gave the
branch administrator under test a per-user ACL (`organizations: null`, one feature) and the
next requests from that same user were rejected by the route's feature gate with
`{"error":"Forbidden","requiredFeatures":["auth.acl.manage"]}` — its own admin features had
disappeared. The guard under test looked broken; the fixture was.

**Problem**: `rbacService.loadAcl` treats `user_acls` as authoritative: once a row exists for
the user it is not merged with the role ACLs, so an override listing a subset of features
silently revokes everything else. Test fixtures that make the actor its own target
self-downgrade mid-suite; in operations the same write quietly strips an administrator, and
the symptom (sudden 403s) points nowhere near the ACL row that caused it.

**Rule**: Keep the actor and the ACL target separate in tests — create a second user in the
same organization and write the override there. When an override is intentional, always send
the features the user must keep, and remember that narrowing a **role** ACL is allowed by
design (requested values are validated, so a subset stays legal) while narrowing a **user**
ACL is a revocation. Re-read `loadAcl` before reasoning about "why does this user lack a
feature" — a user ACL row is the first suspect.

**Applies to**: `src/modules/*/__integration__/*.spec.ts`,
`node_modules/@open-mercato/core/src/modules/auth/services/rbacService.ts`,
`node_modules/@open-mercato/core/src/modules/auth/api/users/acl/route.ts`,
`src/modules/scope_guards/__integration__/scope-guards.spec.ts`,
`.ai/specs/2026-09-21-auth-scope-guard-hardening.md`.
