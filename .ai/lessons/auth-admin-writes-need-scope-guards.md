---
title: "Auth admin writes skip organization-scope checks; app-side guards must cover them"
modules: ["auth", "scope_guards", "directory"]
areas: ["architecture", "umes"]
topics: ["data-scoping", "acl", "organization-tree", "authorization", "multi-tenancy"]
---

# Auth admin writes skip organization-scope checks; app-side guards must cover them

**Context**: Live probing of a one-tenant/multi-organization setup (HQ organization plus a
branch organization, branch admin scoped to its own organization) showed three write paths
that ignore the actor's organization scope: `POST /api/auth/users` with an out-of-scope
`organizationId` returns **201**; `PUT /api/auth/roles/acl` rewrites another organization's
role (**200**, target narrowed); and `directory.organizations.manage` lets a restricted admin
rename a sibling organization and adopt it via `childIds`, after which the switcher offers it
and its data becomes readable (visible range expands through `descendant_ids`).

**Problem**: The installed checks are partial, and each gap fails silently. User destination
validation requires `payload.id`, which does not exist on create. ACL writes validate only
the **requested** values, never the target ACL's existing grant. Organization writes validate
the tenant only. A reviewer reading a diff sees a permission-checked route; the hole is in
what the check does not cover.

**Rule**: Treat the app-owned `scope_guards` module as the authority for these boundaries and
keep it wired: interceptors on `auth.users.create` (destination organization),
`auth.role-acl.update` and `auth.user-acl.update` (existing organization ownership). Judge the
organization axis only, so narrowing/reclaiming stays possible; deny whenever `auth.tenantId`
cannot be resolved or scope resolution throws. Never grant
`directory.organizations.manage` outside HQ — organization-tree shape *is* visibility, so the
feature is an escalation path until the missing check is added (separate spec). Configure
branch roles from `docs/dev/multi-company-org-model.md` and re-run the scope-guard integration
spec after touching any auth or directory route.

**Applies to**: `src/modules/scope_guards/**`, `src/modules.ts`,
`node_modules/@open-mercato/core/src/modules/auth/api/users/route.ts`,
`.../auth/api/{roles,users}/acl/route.ts`, `.../auth/lib/grantChecks.ts`,
`.../directory/commands/organizations.ts`, `.../directory/utils/organizationScope.ts`,
`docs/dev/multi-company-org-model.md`,
`.ai/specs/2026-09-21-auth-scope-guard-hardening.md`.
