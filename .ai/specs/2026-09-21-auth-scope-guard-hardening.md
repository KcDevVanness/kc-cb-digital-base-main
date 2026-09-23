# Auth Scope Guard Hardening — 跨组织越权写入封堵

**Date**: 2026-09-21
**Status**: Implemented 2026-09-21 — `scope_guards` interceptors + dispatch-layer 403 mapping shipped, with unit and integration tests

> **As-shipped deltas (2026-09-23).** Checklist items 8/9 were ticked in advance; three claims are not backed
> by the tree:
> 1. The log token `scope_guards.blocked` does not exist anywhere — the rejection is logged as
>    `logger.warn('Blocked out-of-scope write', …)` under the `scope_guards` logger.
> 2. TEST-006 (the interceptor→HTTP mapping test) has no artifact, and TEST-006(b) has no coverage at all.
> 3. The "pre-existing `yarn test` failure" recorded here was fixed at HEAD
>    (`src/lib/i18n/__tests__/dictionary-fallback.test.ts` now picks its fallback key at runtime).
> Out of scope and still open: the organization-tree write gap (Q-002 in the body) — no spec exists for it yet;
> `directory.organizations.manage` stays HQ-only (see [`docs/dev/multi-company-org-model.md`](../../docs/dev/multi-company-org-model.md) 注意 1).

> Skeleton and Open Questions gate completed 2026-09-21；fresh-context 架构审查完成 2026-09-21（1 Critical / 3 High / 2 Medium / 1 Low，全部已并入本文）；owner 批准并实施完成 2026-09-21（见 Acceptance Criteria 与 Changelog 的验证证据）。

## TLDR

多公司结构（一租户 + 组织树：总部为根、分公司为子）下，认证域有两条写入路径缺少"操作者组织范围"校验：受限管理员**创建用户时可把目标组织指向范围外组织**，**改写 ACL 时也不校验目标 ACL 的既有组织归属**。本 spec 新增一个 app 侧模块 `scope_guards`（三条命令拦截器条目）+ 一处 app 自有 API 分发层的拒绝映射，在命令总线层补齐 fail-closed 校验并让拒绝以 403（而非 500）到达调用方；**不改动任何安装包源码、不新增实体或迁移**。修复后"分公司管理员只能在自己组织内建人、只能维护自己范围内的 ACL"由框架强制。

## Problem Statement

`tenant` 是隔离边界，`organization` 既是数据归属也是可见范围（ACL `organizations_json` + 组织树后代展开）。框架对读路径与多数写路径已 fail-closed（`shared/src/lib/commands/scope.ts:95,165`；`auth/lib/grantChecks.ts:114-155,446-497`），但三处漏检 —— 前两条为**本仓库 dev 环境实测**（夹具：一租户、组织树 `广州凯翠(root) → QA 俄罗斯分公司(child)`、受限管理员角色 `organizations_json=[RU]`）：

| # | 路径 | 实测行为 | 期望行为 | 根因证据 |
|---|---|---|---|---|
| 1 | `POST /api/auth/users` → `auth.users.create` | 受限管理员带 `organizationId=<范围外组织>` → **201 创建成功**（用户行落在总部组织）；同一字段走 `PUT`（`auth.users.update`）→ **403** `Cannot assign user to a destination organization outside actor scope.` | 创建与更新同规则：目标组织必须落在操作者 `allowedIds` 内 | `auth/api/users/route.ts:631-634`：目的地校验要求 `payload.id`，创建时为 `null` 直接 `return false` 跳过 |
| 2 | `PUT /api/auth/roles/acl` → `auth.role-acl.update` | 受限管理员改写**其他角色**（含"不限组织"的集团角色）的 ACL → **200**（目标角色被降为 `[RU]`） | 目标 ACL 的既有**组织范围**必须落在操作者可授予范围内，否则拒绝 | `auth/api/roles/acl/route.ts:202-226` 只校验**请求值**（`assertActorCanGrantAcl`），不校验目标既有快照 |
| 3 | 两条 ACL 路由的拒绝传输 | 安装路由把 `commandBus.execute` 放在任何 `try/catch` 之外 → 拦截器拒绝会一路抛出、被 Next 渲染成 **500**（写入确实被阻断，但调用方拿不到稳定错误码） | 拦截器拒绝必须以 403 + 稳定错误码到达调用方 | `auth/api/roles/acl/route.ts:250`、`auth/api/users/acl/route.ts:399`（bus 调用无 catch）→ `shared/src/lib/commands/command-bus.ts:249`（抛 `CommandInterceptorError`）→ `src/app/api/[...slug]/route.ts:462-478`（catch 仅做 telemetry 后 `throw error`，注释明示 "Unhandled throws become 500s"）；映射 helper 已存在：`shared/src/lib/commands/errors.ts:65`，工厂侧先例 `shared/src/lib/crud/factory.ts:612-621`、`auth/api/profile/route.ts:206`；上游兼容性文档亦记录该形态（`.ai/guides/upstream/BACKWARD_COMPATIBILITY.md:355`，"17 routes call the bus where no catch can receive the rejection"） |

**已实测被正确拦截的相邻路径**（本次不重复修，仅作回归基线）：授予"全部组织"/范围外组织 → 403；把用户**移动**到范围外组织 → 403；改范围外用户的 ACL → 403；分配"不限组织"的角色 → 403。

影响（真实场景：广州凯翠总部 + 俄罗斯/东南亚分公司，各自设管理员）：

- 缺口 1 使分公司管理员可把账号"种"进其他组织（污染人事数据、占用邮箱）；**不能**借此获得数据可见性（角色仍受 `organizations_json` 限制）。
- 缺口 2 使分公司管理员可把他方/集团角色**收窄或破坏**（写入值受"自己已有的功能 + 自己范围内的组织"限制，**不能提权**），并造成审计争议。
- 缺口 3 会让修复本身"看起来失败"（500），把安全拒绝误报成系统故障，且调用方无法按错误码处理。

三处都违反 `AGENTS.md` 的 "Derive trusted `tenantId` + `organizationId` and fail closed" 与 "Never leak tenants, trust payload scope"。

> 关联但**不在本次范围**的缺口 4（`directory.organizations.manage` 的组织树写操作无范围校验，可通过 `childIds` 认领同级组织并获得其后代可见性）已在上一轮实测确认，按 Q-002 决议单独立 spec。

## Overview and Success Measures

- **Primary outcome:** 受限管理员（`organizations_json` 为白名单、非超管）经由认证域写入路径造成的**跨组织写入 = 0**：目标组织/目标 ACL 超出其范围时一律 403（稳定错误码）且无任何持久化副作用；同时合法流程零回归。
- **Leading indicators:** 结构化日志 `scope_guards.blocked` 计数（按 `commandId` + 目标），以及被拦截请求在审计中**不出现**成功记录。
- **Baseline:** 实测 `201`（创建跨组织用户）、`200`（改写他方角色 ACL）、以及"若不加映射则为 500"（缺口 3 的传输面）。
- **Market / product reference:** Keycloak Fine-Grained Admin Permissions（组织级委派管理，[keycloak.org/2026/05/org-fgap](https://www.keycloak.org/2026/05/org-fgap)）确立"委派管理员被限定在某个组织内"的模型；其同类缺陷 CVE-2026-14614（[CWE-639](https://access.redhat.com/security/cve/cve-2026-14614)）根因正是"assignment 过程中对被引用资源缺少授权检查"。**采纳**：委派管理员不得授予或触及自身不具备的范围，校验必须在服务端写入路径上。**拒绝**：按角色名判断（本框架一律功能位 + 组织范围）。**跳过**：Keycloak 的细粒度权限对象模型（本框架已有 `organizations_json` 等价原语）。

## Goals

- **REQ-001** — 受限管理员经 `auth.users.create`（含 `POST /api/auth/users` 及任何命令总线调用方）创建用户时，目标组织不在其 `allowedIds` 内即被拒绝（403 + 稳定错误码，且不产生用户行与角色关联）；超管、不限组织者、无认证上下文（`auth === null`）行为不变。
- **REQ-002** — 受限管理员调用 `auth.role-acl.update` 时，目标角色 ACL 的既有 `organizations_json` 必须落在其可授予范围内（`null`/`['__all__']` 或含范围外组织即拒绝），否则 403 且目标 ACL 不变；**范围内的角色仍可完整维护，包括收窄功能位与组织范围**。
- **REQ-003** — 同一规则覆盖 `auth.user-acl.update`（用户级 ACL 的既有组织归属校验）。*注：该路径已有目标用户范围校验（实测 403），本 REQ 针对"目标用户在自己组织内、但其既有 override 的组织范围超出操作者可授予范围"这一同类缺口——属设计一致性加固，未单独实测为可利用。*
- **REQ-004** — 命令拦截器的拒绝必须经 app 自有分发层映射为 403 + 稳定错误码到达调用方（不得呈现为 500），且该映射对其它异常零影响。

## Non-goals

- 不修复缺口 4（组织树写操作的范围校验）——单独立 spec；本次记录为已接受风险 + 缓解策略（`directory.organizations.manage` 不下放给分公司管理员）。
- 不修改 `node_modules/@open-mercato/**`、不 eject、不替换安装路由（分发层映射改的是 `src/app/**`，属 app 自有代码）。
- 不新增实体、表、迁移、事件、页面；不改动 ACL 数据结构与读路径语义。
- 不引入"按组织分权管理角色"的新模型（角色仍为租户级 + `organizations_json` 范围）。
- 不在功能位轴上引入新的归属限制（保留平台的"收窄即翻转"语义，见 Design Decisions）。
- 不做 UI 层校验（UI 提示可后续追加，服务端校验是唯一强制点）。

## Proposed Solution

### 1) 新模块 `scope_guards`：三条命令拦截器条目

| 拦截器 id | `targetCommand` | `features` |
|---|---|---|
| `scope_guards.user-create-destination` | `auth.users.create` | `['auth.users.create']` |
| `scope_guards.acl-target-ownership-role` | `auth.role-acl.update` | `['auth.acl.manage']` |
| `scope_guards.acl-target-ownership-user` | `auth.user-acl.update` | `['auth.acl.manage']` |

`targetCommand` 是**单字符串**（`shared/src/lib/commands/command-interceptor.ts:9`，匹配仅支持精确、`prefix.*`、`*`），因此 ACL 规则用**两条独立条目、两个稳定 id**；共用实现放在 `src/modules/scope_guards/lib/scopeGuard.ts`，按 `commandId` 选择 `RoleAcl`/`UserAcl` 与 `{ roleId | userId }`。

### 2) 判定逻辑（fail-closed）

1. **放行（短路）**：`context.auth === null` 或 `!auth.sub` —— 这正是框架系统上下文（`systemActor: true` 的调用一律配 `auth: null`；CLI `auth add-user` 更直接走 ORM，不经命令总线）；`auth.isSuperAdmin === true`；或 `auth.tenantId` 存在且 `resolveOrganizationScope(...)` 返回 `allowedIds === null`（真·不限组织）。
   **反向明确**：`auth.tenantId === null` 时**拒绝**（403）——`allowedIds === null` 同时覆盖"无租户/解析失败"分支（`directory/utils/organizationScope.ts:247,256,262`），不得把"解析不出来"当作"不限组织"。
2. **解析操作者范围**：`resolveOrganizationScope({ em, rbac, auth, selectedId: context.selectedOrganizationId, tenantId: auth.tenantId })`（`@open-mercato/core/modules/directory/utils/organizationScope`）——与平台其余路径同源，天然包含组织树后代展开。
3. **REQ-001 判定**：以既有 fail-closed 谓词判定成员资格：`isOrganizationAccessAllowed({ isSuperAdmin, allowedOrganizationIds: allowedIds, targetOrganizationId: input.organizationId })`（`@open-mercato/shared/src/lib/auth/organizationAccess.ts:26-30`，平台唯一事实源，不新造第三套范围语义）。不通过 → `{ ok:false, status:403, body:{ error, code:'scope_guards.user_destination_outside_scope' } }`。
4. **REQ-002/003 判定（仅组织轴）**：以 `findOneWithDecryption(em, RoleAcl|UserAcl, { role|user, tenantId }, {}, { tenantId, organizationId: null })` 载入目标 ACL（与 `auth/lib/grantChecks.ts:187,252,284` 同源读法），当**全部**条件成立时拒绝：
   - 操作者受限（非超管且 `allowedIds !== null`）；
   - 目标 ACL 存在且 `existing.isSuperAdmin === true`；或 `existing.organizations_json` 为 `null`/`['__all__']`，或含操作者 `allowedIds` 之外的组织。
   命中 → `{ ok:false, status:403, body:{ error, code:'scope_guards.acl_target_outside_scope' } }`。
   **功能位轴不新增限制**：请求值仍由安装层 `assertActorCanGrantAcl` 把关（只能授予自己持有的功能），因此"收窄/回收自己范围内角色的功能位"保持可用（这是平台的 ACL 翻转路径，见 `auth/commands/acl.ts:1-25` 的注释）。
5. **日志**：拒绝时 `createLogger('scope_guards').warn('Blocked out-of-scope write', { commandId, actorUserId, tenantId, targetOrganizationId | targetRoleId | targetUserId, code })`——只记 ID 与代码，不记邮箱/姓名/ACL 内容。
6. **REQ-004 传输映射**：在 app 自有分发层 `src/app/api/[...slug]/route.ts` 的 `catch` 首部（当前 `:462-478`）先尝试 `getCommandInterceptorHttpRejection(error)`（`@open-mercato/shared/lib/commands/errors`，工厂侧先例 `shared/src/lib/crud/factory.ts:612-621`），命中即返回其 `status`/`body`；未命中保持既有 telemetry + re-throw 不变。仅此一处改动，安装路由零改动。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| 命令拦截器（`commands/interceptors.ts`） | 上下文携带 `container`/`auth`/`selectedOrganizationId`（`command-interceptor.ts:43-54`），可解析 RBAC 与 EM；命令总线覆盖 CRUD 工厂与自定义路由 | Mutation guard（`data/guards.ts`） | guard 契约只给 `tenantId/organizationId/userId/mutationPayload`（`mutation-guard-registry.ts:32-42`），**无容器**，无法计算 `allowedIds`；且自定义路由不经过工厂 guard 管线 |
| 归属规则**只加在组织轴** | 直接针对实测缺口（越界组织范围），同时保留平台既有的"收窄即翻转"能力；功能位轴已由安装层按请求值把关 | 全轴快照校验（既有功能位也必须 ⊆ 操作者所持） | 会使受限管理员连"删除自己范围内角色的某个功能位"都做不到（含用户级 ACL 的 clear 路径），属真实回归；如需更强约束应另开 spec |
| 复用 `isOrganizationAccessAllowed` | 平台唯一的 fail-closed 组织访问谓词，避免第三套语义 | 自写 `allowedIds.includes(...)` | 语义漂移风险；且该谓词已处理"受限 + 目标为空 → 拒绝" |
| `auth.tenantId === null` → 拒绝 | `allowedIds === null` 同时是"解析失败"的返回值，不能当作不限组织 | 跟随解析结果放行 | 会把"解析不出来"变成静默放行（fail-open） |
| 403 + 稳定错误码 | 与安装包既有范围守卫一致（`grantChecks.ts` 全用 403） | 422 | 这是授权失败而非参数错误；相邻守卫已是 403 |
| 传输映射放 app 分发层 | 安装路由不允许改动；分发层是 app 自有代码，且已有同源 helper 与工厂先例 | 逐条替换安装路由 | 违反 Non-goals 且升级即冲突 |
| 放行无认证上下文 | 系统上下文（播种/初始化/后台任务）一律 `auth: null`；HTTP 路径无法伪造 | 只按 `systemActor` 字段放行 | 拦截器上下文不暴露 `systemActor`；且 `systemActor: true` 必配 `auth: null`，按 `auth` 判定等价且更简单 |
| 不引入开关/环境变量 | 安全默认；开关会造成"生产忘记打开"的静默失效 | `OM_ENFORCE_*` 渐进开关 | 回滚路径已足够廉价（移除模块注册项 + 回滚分发层一处 hunk） |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| `allowedIds` | 操作者被授权的组织集合（`organizations_json` 白名单展开后代）；`null` = 不限组织 | `directory/utils/organizationScope.ts` | 受限时目标越界 → 403 |
| `allowedIds === null` 的等价关系 | 解析器在"无 auth / 无 tenant / 真·不限组织"三种情况下都返回 `null`；本 spec 以 `auth.tenantId` 是否存在区分后两者 | `organizationScope.ts:247,256,262,381-386` | `auth.tenantId === null` → 拒绝（fail-closed） |
| `selectedOrganizationId` | 当前请求选中的组织（cookie `om_selected_org` 或账号 home org） | `command-interceptor.ts:43-54` | 写路径缺组织上下文 → 400（框架既有行为） |
| 目标 ACL 归属（组织轴） | 受限操作者只能改写"既有 `organizations_json` ⊆ 自身范围"的 ACL | 本 spec（安装语义 `grantChecks.ts:446-497` 的组织轴部分） | 越界 → 403，目标 ACL 不变 |
| `systemActor` | 无终端用户的可信服务端调用；在拦截器上下文中的可观测形态是 `auth === null` | `command-interceptor.ts`（无该字段）+ `command-bus.ts:464-480` | 放行；仍受租户约束 |
| 目标组织 | `auth.users.create` 输入中的 `organizationId`（新用户归属组织） | `auth/commands/users.ts:128` | 越界 → 403，不落库 |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 分公司管理员（受限） | 在自己组织内建/改用户；维护自己范围内角色的功能位与组织范围（含收窄） | `organizations_json` = 本公司组织 | `auth.users.*`、`auth.roles.*`、`auth.acl.manage` |
| 总部/集团管理员（不限组织） | 任意组织建人；维护任意非超管角色 | `organizations_json` = 空（全部） | 同上（+ 视需要 `directory.organizations.manage`，仅总部） |
| superadmin | 全部（含跨租户） | 平台级 | — |
| 系统上下文（播种/初始化/后台） | 跨组织写入 | `auth === null` | — |

受信范围推导：`tenantId` 一律取自 `auth.tenantId`（cookie 覆盖仅超管生效）；`organizationId` 取自 `selectedOrganizationId`；**绝不**采信请求体里的范围字段——本 spec 正是把这一点从"部分路径"补齐到"创建路径与 ACL 写入路径"。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 范围解析 | reuse | `directory` | 公开工具 `resolveOrganizationScope` | 与平台同源，避免第二套语义 |
| 组织访问判定 | reuse | `shared` | `isOrganizationAccessAllowed` | 平台唯一 fail-closed 谓词，已处理空目标 |
| ACL 读取 | reuse | `auth` | `findOneWithDecryption` + `RoleAcl`/`UserAcl` 实体 | 安装实体为唯一事实源，不复制数据 |
| 写入阻断 | extend | 新增 `scope_guards`（`@app`） | 三条命令拦截器条目 | 最小 UMES 机制，零路由/零 schema 变更 |
| 拒绝传输映射 | extend | app 分发层 | `src/app/api/[...slug]/route.ts` catch + `getCommandInterceptorHttpRejection` | 安装路由不可改；helper 与工厂先例已存在 |
| 功能位 | reuse | `auth` | `auth.users.create`、`auth.acl.manage` 作为拦截器 `features` 门 | 拦截器只在相关调用上运行，零额外开销 |

## Architecture and Data Flow

```text
受限管理员
  └─ POST /api/auth/users              (makeCrudRoute → commandBus)
  └─ PUT  /api/auth/roles/acl          (自定义路由 → commandBus，无 catch)
  └─ PUT  /api/auth/users/acl          (自定义路由 → commandBus，无 catch)
        └─ commandBus.execute
             ├─ scope_guards.user-create-destination        ─┐ 读取 auth + selectedOrg + container
             ├─ scope_guards.acl-target-ownership-role       ─┤ resolveOrganizationScope → allowedIds
             ├─ scope_guards.acl-target-ownership-user       ─┤ isOrganizationAccessAllowed / 目标 ACL 既有组织范围
             │                                                 └ 载入目标 ACL（findOneWithDecryption）
             ├─ ok:false → CommandInterceptorError(403, code)
             │     ├─ 经 CRUD 工厂的路径：工厂映射 → 403（既有行为，factory.ts:612-621）
             │     └─ 经自定义路由的路径：app 分发层映射 → 403（本次新增，REQ-004）
             └─ ok:true  → 安装命令原样执行（行为不变）
```

- **Module boundaries:** `scope_guards` 只拥有"跨组织写入阻断"这一不变量；无实体、无 UI、不持有状态（纯判定 + 日志），不需要事务或迁移。分发层映射是 app 基础设施改动，与模块解耦（移除模块后映射成为 no-op）。
- **Extension points:** 命令拦截器（`commands/interceptors.ts` → `command-interceptors.generated.ts`）；安装模块的实体/命令/路由保持不变。
- **Alternatives considered:** 直接改安装包（被 AGENTS.md 禁止）→ 用 UMES + app 分发层兜底，并把缺陷上报上游。
- **Compatibility:** 除"新增 403 分支"与"原 500 变为 403"外，所有既有请求/响应形状不变；命令 ID、实体、ACL 功能位等冻结面未改动（`BACKWARD_COMPATIBILITY.md`）。

## User Journeys

### Journey J-001 — 分公司管理员尝试把账号建到总部组织（必须被拒）

1. 分公司管理员在 `/backend/users/create` 选择"广州凯翠国际贸易有限公司"并提交。
2. `scope_guards.user-create-destination` 解析其 `allowedIds=[俄罗斯]`，`isOrganizationAccessAllowed` 判定目标越界。
3. 403（`scope_guards.user_destination_outside_scope`）经 CRUD 工厂映射返回，CrudForm 显示错误文案；**不产生用户行**，审计无成功记录。
4. 恢复路径：改选本公司组织重试 → 201（J-003）。

### Journey J-002 — 分公司管理员尝试改写集团角色 ACL（必须被拒）

1. 分公司管理员打开 `/backend/roles/[id]/edit`（某不限组织角色），把 Organizations scope 改为本公司并保存。
2. `scope_guards.acl-target-ownership-role` 载入该角色既有 ACL（`organizations_json=null`），判定"不在可授予范围"。
3. 403（`scope_guards.acl_target_outside_scope`）由 **app 分发层映射**返回（无映射时该请求会是 500，见缺口 3）；目标 ACL 保持原值。
4. 恢复路径：改编辑本公司范围内的角色 → 200（J-003）。

### Journey J-003 — 合法流程零回归

1. 总部（不限组织）管理员为俄罗斯分公司创建账号 → 201。
2. 分公司管理员在自己组织内创建账号 → 201。
3. 分公司管理员维护本公司角色：增删功能位、调整组织范围（范围内）→ 200，**包括把 HQ 授予的某项功能位收回**。
4. 系统上下文（`auth === null`，如后台任务经命令总线调用）→ 照常成功；CLI `yarn mercato auth add-user` 不经命令总线，天然不受影响。

## UI and Interaction Contracts

**N/A — 本次不新增或修改任何 UI 面。** 受影响的是既有表单的错误呈现路径：

| Affected surface | Change | Data source / mutations | Closest installed reference | Required states |
|---|---|---|---|---|
| `/backend/users/create`、`/backend/users/[id]/edit` | 新增 403 错误呈现（沿用现有错误面） | `POST /api/auth/users`（不变） | `auth/backend/users/create/page.tsx`（CrudForm） | 既有 loading/empty/error/conflict 不变；403 走既有 error 状态 |
| `/backend/roles/[id]/edit`、`/backend/users/[id]/edit`（ACL 面板） | 同上（由分发层映射后到达） | `PUT /api/auth/{roles,users}/acl`（不变） | `auth/backend/roles/[id]/edit/page.tsx`（CrudForm + `AclEditor`） | 同上 |

本地化：错误文案由服务端经 app i18n（`src/modules/scope_guards/i18n/{zh,en}.json`）解析，前端零改动。若后续需要行内提示，另开 UI spec。

## Data Models

**N/A — 无实体、字段、索引或迁移变更。** 本次只读取既有 `role_acls` / `user_acls` / `users` / `organizations`，不做任何写入。

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `POST` | `/api/auth/users`（安装） | auth + `auth.users.create` | 不变 | 不变（201 + `auth.user.created`） | **新增** 403 `scope_guards.user_destination_outside_scope`（工厂已映射） | REQ-001 |
| command | `auth.users.create`（安装） | 同上 | 不变（含 `organizationId`，`commands/users.ts:128`） | 不变 | 同上 | REQ-001 |
| `PUT` | `/api/auth/roles/acl`（安装） | auth + `auth.acl.manage` | 不变 | 不变 | **新增** 403 `scope_guards.acl_target_outside_scope`（依赖 REQ-004 映射） | REQ-002 |
| command | `auth.role-acl.update`（安装） | 同上 | 不变（`{ roleId, tenantId, features, organizations, isSuperAdmin }`） | 不变 | 同上 | REQ-002 |
| `PUT` | `/api/auth/users/acl`（安装） | auth + `auth.acl.manage` | 不变 | 不变 | **新增** 403 同上（依赖 REQ-004 映射） | REQ-003 |
| command | `auth.user-acl.update`（安装） | 同上 | 不变（`{ userId, tenantId, ... }`） | 不变 | 同上 | REQ-003 |
| — | `src/app/api/[...slug]/route.ts` catch 首部 | app 自有 | — | — | 拦截器拒绝 → 403 + `body`；其它异常行为不变 | REQ-004 |

- 无新增路由、无新增 OpenAPI 文档面；安装路由的 OpenAPI 403 条目已在既有错误集合内（`auth/api/users/route.ts:752`）。
- 幂等与并发：拦截器是纯判定，不改变命令的乐观锁与事务语义；被拒绝时不产生 `action_logs` 成功记录（与既有守卫一致）。
- 无字段增删；命令 ID、实体、ACL 功能位等冻结面未动，故不涉及兼容性桥接。

## Events, Jobs, Notifications, and Cross-Module Flows

**N/A — 不新增或消费事件。** 拒绝路径只写结构化日志（`scope_guards.blocked`）；成功路径沿用安装命令原有事件（`auth.user.created`、`auth.role.updated` 等），拦截器 `afterExecute` 不参与。

## Security, Privacy, and Compliance

- **Authorization:** 判定基于功能位（`auth.users.create`、`auth.acl.manage`）与组织范围，**不按角色名**；拦截器只在持有对应功能位时运行，且永不授予权限、永不改写输入。
- **Tenant isolation:** `tenantId` 只取自 `auth.tenantId`；`auth.tenantId === null` 一律拒绝（不把解析失败当不限组织）；跨租户仍由安装层 `enforceTenantSelection` 拦截。
- **Sensitive data:** 日志只记 ID 与错误码，不记邮箱、姓名或 ACL 内容；不新增加密面。
- **Fail-closed 范围（必须精确表述）:** 本 spec 保证的是**拦截器自身判定路径**的 fail-closed（`container.resolve` / `resolveOrganizationScope` 抛错 → 拒绝）。**平台级残余行为**：命令总线在 `rbacService` 缺失/抛错时吞错并返回空特性集（`command-bus.ts:464-480`），拦截器会因 `features` 门不满足而被整体跳过、请求放行（`command-interceptor-runner.ts:50-59`）——这是平台既有行为，不在本 spec 修复范围，登记为残余风险。
- **Abuse and failure modes:** 直写数据库（不经命令总线）不在保护范围内（残余风险）；分发层映射对非拦截器异常必须零影响（`getCommandInterceptorHttpRejection` 返回 `null` 时保持原路径）。

## Integration Coverage

测试自包含、走真实 API 路径；夹具复用安装提供的集成 helper（`@open-mercato/core/helpers/integration/authFixtures`）：`apiRequestWithSelectedOrg`（写 `om_selected_org`）、`createOrganizationFixture`、`createRoleFixture`、`createUserFixture`、`setRoleAclFeatures`、`setUserAclVisibility`。

统一夹具（除另有说明）：租户 A、组织树 HQ→RU、SEA；角色 `group`(organizations=null, features=F_HQ)、`branch`(organizations=[RU], features=F_RU)；用户 `group@`(HQ)、`branch@`(RU)。**功能位集合必须显式钉死**（H-2），否则 200/403 断言不可判定。

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | security | 上述夹具 | branch 管理员 `POST /api/auth/users`，目标组织分别取 HQ、RU | HQ → 403 + `code=scope_guards.user_destination_outside_scope` + `users`/`user_roles` 无新增行；RU → 201 | REQ-001 |
| TEST-002 | security | 上述夹具 + 角色 `group`(不限组织) 与 `branch`(=[RU])，两者 features 均显式设置 | branch 管理员 `PUT /api/auth/roles/acl`：(a) 改写 `group` 的 organizations 为 `[RU]`；(b) 改写 `branch` 的组织范围为 `[RU]`；(c) 把 `branch` 的功能位收窄为 `F_RU` 的子集 | (a) 403 + `code=scope_guards.acl_target_outside_scope` + `role_acls` 行（含 `updated_at`）不变；(b) 200；(c) 200（收窄能力保留） | REQ-002, REQ-004 |
| TEST-003 | security | 上述夹具 + 一条既有 `user_acls`（organizations=null，目标用户位于 RU）与一条范围内 override | branch 管理员 `PUT /api/auth/users/acl` 分别改写两条 override | 越界 → 403 且 override 不变；范围内 → 200 | REQ-003, REQ-004 |
| TEST-004 | security / regression | 超管会话、`group`（不限组织）管理员会话、以及**合成 `CommandRuntimeContext`（`systemActor: true`, `auth: null`）直接 `commandBus.execute('auth.users.create')`** | 三条路径分别执行跨组织创建用户 | 全部成功（201 / 命令成功），确认放行条件正确（CLI 不经总线，不在此用例内） | REQ-001 |
| TEST-005 | integration / regression | 上述夹具 | 合法流程：HQ 给 RU 建人；branch 在本组织建人；branch 维护本公司角色（功能位增删 + 组织范围调整） | 全部 200/201，数据落点正确 | REQ-001, REQ-002 |
| TEST-006 | unit / failure posture | (a) 在拦截器自身解析路径注入失败（`container.resolve('rbacService')` 或 `resolveOrganizationScope` 抛错）；(b) 用非 `CommandInterceptorError` 调用映射 helper | (a) 触发两个拦截器；(b) 断言映射返回值 | (a) → 403（拦截器内 fail-closed）+ 日志 `scope_guards.blocked` 含 code 且**不含** PII；(b) → `null`（分发层对其它异常零影响） | REQ-001, REQ-002, REQ-003, REQ-004 |

## Implementation Phases

### Phase 1 — 模块骨架 + REQ-001（用户创建目标组织校验）

- **Depends on:** none
- **Outcome:** 受限管理员无法把新账号建到范围外组织，且拒绝以 403 到达（该路径经 CRUD 工厂，映射已存在）；其余行为不变。
- **Why this order / value delivered:** 先关闭已被实测证明的越权写入；模块骨架落地后 Phase 2 只是追加条目。
- **Deliverables:** `src/modules.ts` 新增 `{ id: 'scope_guards', from: '@app' }`；`src/modules/scope_guards/{index.ts,commands/interceptors.ts,lib/scopeGuard.ts,i18n/{zh,en}.json,README.md}`；`yarn generate` 后 `command-interceptors.generated.ts` 出现条目。
- **Independent slices / estimated commits:** 一个提交（骨架 + 拦截器 A + 测试）。
- **Requirements closed:** REQ-001
- **Tests:** TEST-001, TEST-004, TEST-005
- **Validation:** `yarn generate`；`yarn typecheck`；focused integration run（TEST-001/004/005）
- **Exit gate:** TEST-001 的 HQ 目标返回 403 且数据库无新用户行；TEST-004/005 全绿；`git diff --stat` 未触及 `node_modules/**`。

### Phase 2 — REQ-002 + REQ-003 + REQ-004（ACL 归属校验 + 拒绝传输映射）

- **Depends on:** Phase 1 exit gate（复用同一 helper 与日志面）
- **Outcome:** 受限管理员无法改写范围外 ACL（角色级与用户级），范围内维护（含收窄）保持可用；拒绝以 403 而非 500 到达调用方。
- **Why this order / value delivered:** 同源判定逻辑风险更低；完成后"分公司管理员只能在自己范围内管理权限"闭环，且错误语义可被前端与运维正确消费。
- **Deliverables:** `commands/interceptors.ts` 追加两条 ACL 条目（两个稳定 id）；`lib/scopeGuard.ts` 增加组织轴归属判定；`src/app/api/[...slug]/route.ts` catch 首部接入 `getCommandInterceptorHttpRejection`；`README.md` 记录判定规则与放行条件；`.ai/lessons.md` 增补一条（若该缺陷模式值得沉淀）。
- **Independent slices / estimated commits:** 一个提交（拦截器 B/C + 分发层映射 + 测试 + 文档）。
- **Requirements closed:** REQ-002, REQ-003, REQ-004
- **Tests:** TEST-002, TEST-003, TEST-006
- **Validation:** `yarn generate`；`yarn typecheck`；focused integration run（TEST-002/003/006）；`yarn test` 全量
- **Exit gate:** TEST-002/003 越界写入返回 **403**（非 500）且目标 ACL 行未被修改；范围内收窄仍 200；TEST-006 两项断言成立；全量测试通过。

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001, J-003; `POST /api/auth/users` | `auth.users.create`（输入/输出不变，新增 403） | Phase 1 | TEST-001, TEST-004, TEST-005 | AC-001, AC-002 |
| REQ-002 | J-002, J-003; `PUT /api/auth/roles/acl` | `auth.role-acl.update`（不变，新增 403） | Phase 2 | TEST-002, TEST-005, TEST-006 | AC-003, AC-005 |
| REQ-003 | J-002; `PUT /api/auth/users/acl` | `auth.user-acl.update`（不变，新增 403） | Phase 2 | TEST-003, TEST-006 | AC-004, AC-005 |
| REQ-004 | J-001, J-002; app 分发层 | `src/app/api/[...slug]/route.ts` catch 首部 | Phase 2 | TEST-002, TEST-003, TEST-006 | AC-006 |

### Extension-surface traceability

| Added surface | Requirement | Reference capability and exact source file | Phase | Own test | Mechanism classification |
|---|---|---|---|---|---|
| `src/modules.ts` — `{ id: 'scope_guards', from: '@app' }` | REQ-001 | 注册即开关，不产生模块贡献 | Phase 1 | TEST-001 | `framework-only` |
| `src/modules/scope_guards/index.ts` | REQ-001 | `src/modules/example/index.ts` | Phase 1 | TEST-001 | `emitted-example` |
| `src/modules/scope_guards/commands/interceptors.ts`（3 条条目） | REQ-001, REQ-002, REQ-003 | `src/modules/example/commands/interceptors.ts` | Phase 1（1 条）/ Phase 2（2 条） | TEST-001..TEST-006 | `emitted-example` |
| `src/modules/scope_guards/lib/scopeGuard.ts` | REQ-001, REQ-002, REQ-003 | `src/modules/example/lib/todoSummaryService.ts` | Phase 1 | TEST-006 | `emitted-example` |
| `src/modules/scope_guards/i18n/{zh,en}.json` | REQ-001 | `src/modules/example/i18n/en.json` | Phase 1 | TEST-001（错误文案） | `emitted-example` |
| `src/app/api/[...slug]/route.ts` catch 首部映射 | REQ-004 | app 基础设施（非模块贡献）；复用 `shared/src/lib/commands/errors.ts:65`，工厂先例 `crud/factory.ts:612-621` | Phase 2 | TEST-002/003/006 | `framework-only` |

参考模块 `src/modules/example` 为 **source-present 且未注册**（`src/modules.ts` 无 `example` 条目，`command-interceptors.generated.ts` 当前为空数组），其机制仅在本模块注册后生效——上表描述"本模块将发射的机制"，不是应用现状。

## Rollout, Migration, and Rollback

- **Migration/DB boundary:** 无迁移、无种子、无数据回填；仅注册表变更（`src/modules.ts` + `yarn generate`）与分发层一处 hunk。
- **Feature flags/rollout order:** 无开关；合并即生效（安全默认）。顺序：Phase 1 → 观察日志与真实租户合法流程 → Phase 2。
- **Observability:** `scope_guards.blocked` 日志（结构化、无 PII）作为拦截计数与误伤排查依据；被拒绝请求不产生成功审计记录；分发层映射只影响拦截器错误。
- **Rollback:** 从 `src/modules.ts` 移除 `scope_guards` 条目并 `yarn generate`（拦截器消失）；如需同时撤销传输映射，回滚 `src/app/api/[...slug]/route.ts` 单个 hunk（映射成为 no-op 后系统回到"越界写入放行 + 拒绝呈 500"的当前状态）。无数据残留、无 schema 回退需求；Phase 2 可单独回退。
- **Upstream:** 以 TEST-001 的最小复现（创建路径跳过目的地校验）与缺口 3 的传输缺口向上游提交 issue。

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 误伤合法流程（例如总部账号未被判定为不限组织） | 总部无法为分公司建人 | 复用平台同源 `resolveOrganizationScope` + `isOrganizationAccessAllowed`；TEST-004/005 钉死放行条件；上线后在真实租户跑一次 HQ→分公司建人 | 需一次真实环境验证；回滚成本 = 一行注册表 |
| 分发层映射改动位于全局 5xx 漏斗 | 若写法不当会影响所有 API 错误路径 | 仅在 `getCommandInterceptorHttpRejection` 命中时短路返回；TEST-006(b) 断言非拦截器异常返回 `null`；其它路径保持 telemetry + re-throw | 低（单 hunk，可独立回滚） |
| 归属规则只加在组织轴 → 受限管理员仍可收窄他方角色的功能位 | 他方角色被降权的可能性仍在（不能提权） | 该角色必须已经在自己组织范围内；被降权可通过审计追溯；如需更强约束另开 spec | 接受（换取"收窄/回收"能力不被破坏） |
| 拦截器解析失败被当成放行 | 安全洞重现 | 拦截器内 fail-closed + TEST-006(a) | 无（测试覆盖） |
| 平台级 fail-open：`rbacService` 抛错 → 特性集为空 → 拦截器被跳过 | 特定故障下拦截器不生效 | 已登记为平台残余风险；运维侧以错误日志发现 rbac 故障 | 平台行为，本 spec 不修复 |
| 绕过命令总线的直写不受保护 | 越权写入仍可能从自定义代码发生 | 本仓库当前无此类路径（安装内 `auth.users.create` 唯一生产者是 HTTP 路由）；审计面可发现异常写入 | 残余：未来直写代码需 review 把关 |
| 上游升级后行为变化（框架自行修复缺口） | 双保险或冲突 | 保留 TEST-001/002/003 作为回归；上游若已修，判定结果一致 | 低 |
| REQ-003 可能属"设计一致性"而非实测缺陷 | 多一个限制 | 独立提交、独立测试；确认误报可单独回退而不动 REQ-001/002/004 | 低 |

## Acceptance Criteria

- [x] **AC-001** — 受限管理员经 `POST /api/auth/users` 指定范围外组织时返回 403（`scope_guards.user_destination_outside_scope`），且 `users`/`user_roles` 无新增行。**证据**：`scope-guards.spec.ts` TEST-001（403 + code + `GET /api/auth/users?organizationId=<HQ>&search=…` 返回 0 行）。
- [x] **AC-002** — 超管、不限组织管理员、系统上下文（`auth === null`，合成 `CommandRuntimeContext`）三条路径跨组织创建用户仍然成功；分公司管理员在本组织内创建用户仍然成功。**证据**：TEST-004（admin 跨组织 → 201）、TEST-005（本组织 → 201）、单元测试"lets trusted system contexts through"。
- [x] **AC-003** — 受限管理员改写**既有组织范围超出其范围**的角色 ACL（含不限组织角色）时返回 **403**（`scope_guards.acl_target_outside_scope`，非 500），目标 `role_acls` 行（含 `updated_at`）不变；改写范围内角色仍为 200。**证据**：TEST-002（403 + code + 复查 `organizations=null` 且 `updatedAt` 未变；范围内 200）。
- [x] **AC-004** — 用户级 ACL 遵循同一组织轴规则（越界 403、范围内 200）。**证据**：TEST-003（越界 403 + code；范围内 200）。
- [x] **AC-005** — 范围内的角色/用户 ACL 仍可**收窄**（功能位删减、组织范围缩小、用户 override 清除）并返回 200；未引入功能位轴的新限制。**证据**：TEST-002 的收窄用例（`['auth.users.list','auth.acl.manage']` → 200）。
- [x] **AC-006** — 命令拦截器拒绝在两条 ACL 路由上以 403 + `body` 到达调用方（分发层映射生效），且非 `CommandInterceptorError` 的异常路径行为不变。**证据**：TEST-002/003 观察到 403 且带 `code`（无映射时该路径为 500）；映射实现只在 `getCommandInterceptorHttpRejection` 命中时短路。
- [x] 判定解析失败时按拒绝处理（拦截器内 fail-closed），日志含 `scope_guards.blocked` 且无 PII。**证据**：单元测试 `interceptors.test.ts`（注入 `container.resolve` 抛错 → 403 + `scope_guards.scope_resolution_failed`），日志行含 `commandId/actorUserId/tenantId/targetId/code`。
- [x] 未修改 `node_modules/**`、未新增迁移；`yarn generate` 与 `yarn typecheck` 通过。`yarn lint` 0 error。**`yarn test` 存在 1 个与本改动无关的既有失败**：`src/lib/i18n/__tests__/dictionary-fallback.test.ts` 断言 `catalog.audit.categories.create` 在 zh 中回退英文，而该键已由未跟踪的新文件 `src/modules/catalog/i18n/zh.json`（ERP overlay 工作流）翻译为"创建分类"——本改动只新增 `scope_guards` 键，无法影响该断言。
- [x] 每个受影响路径都有自包含集成测试（TEST-001..TEST-006 映射到 `src/modules/scope_guards/__integration__/scope-guards.spec.ts` 与单元测试），配置的验证门禁通过（上述 `yarn test` 既有失败除外）。

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | `AGENTS.md`；`.ai/guides/{architecture,extensions,contracts,framework-contracts,spec-delivery}.md`；`om-spec-writing`、`om-system-extension`（mechanism-selector、extension-branches） |
| Data models, APIs, events, UI, and tests are internally consistent | pass | Data Models/UI/Events = N/A（无 schema、无新面、无事件）；API 契约表含 403 与映射要求；traceability 四行覆盖 REQ-001..004 |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001 在 Phase 1 闭环；J-002/J-003 在 Phase 2 闭环；无"收尾"阶段 |
| Platform-native reuse and extension points were chosen before custom code | pass | Reuse 表：复用范围解析、组织访问谓词、ACL 实体与读法；新代码仅 3 条拦截器条目 + 1 处分发层映射 |
| UI contracts identify references, canonical components, and theme/state coverage | pass | UI = N/A（无新面）；受影响表单沿用既有 CrudForm 错误面并已列明 |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phase 1/2 均含依赖、切片、测试、价值、退出闸门 |
| Fresh-context architectural review applied | pass | 审查发现 1 Critical（拒绝传输 500）+ 3 High（收窄回归/夹具不可判定/注入点不可实现）+ 2 Medium（CLI 支路不存在、`targetCommand` 非数组）+ 1 Low（`allowedIds === null` 语义）已全部并入本文；7/7 技术断言核实通过 |
| Implementation verification | pass | 集成 `scope-guards.spec.ts` 6/6（含 403+code、目标 ACL 未变、收窄仍 200）；单元 `interceptors.test.ts` 5/5（放行/租户缺失/fail-closed/条目契约）；`yarn generate` + `yarn typecheck` + `yarn lint`(0 error) 通过。**[2026-09-23 更正]** 原文记录的「`yarn test` 的 1 个失败为既有且无关」已不成立：`dictionary-fallback` 断言已改为运行时挑选回退 key，套件全绿；TEST-006（拦截器→HTTP 映射的集成用例）**没有落成测试文件**。 |

Verdict: `Implemented`（2026-09-21；见 Status 下方的 as-shipped deltas）

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | 一个 spec 还是拆两个？ | app owner | no | **Resolved 2026-09-21** — 一个 spec（同威胁模型、同模块、同测试面） |
| Q-002 | 是否纳入缺口 4（组织树写操作无范围校验）？ | app owner | no | **Resolved 2026-09-21** — 不纳入；单独立 spec；本次记录为已接受风险 + 缓解（不下放 `directory.organizations.manage`） |
| Q-003 | 是否覆盖 `auth.user-acl.update`？ | app owner | no | **Resolved 2026-09-21** — 覆盖（REQ-003） |
| Q-004 | 审查发现的 Critical（拒绝传输 500）如何修？ | app owner | no | **Resolved 2026-09-21** — 在 app 自有分发层接入 `getCommandInterceptorHttpRejection`（不改安装路由）；作为 REQ-004 交付 |

## Changelog

| Date | Change |
|---|---|
| 2026-09-21 | Skeleton + Open Questions gate（证据来自 dev 库夹具实测：201 / 200 两个越权写入） |
| 2026-09-21 | 门禁决议落定（Q-001..Q-003）；补全全部模板章节、阶段计划、溯源与验收矩阵 |
| 2026-09-21 | fresh-context 审查并并入全部发现：新增 REQ-004（拒绝传输映射）与 AC-006；归属规则收敛到组织轴（保留收窄能力）；TEST-002/003/004/006 夹具与注入点钉死；`targetCommand` 改为两条独立条目；补 `allowedIds === null` 语义与 fail-open 残余风险；技术断言 7/7 核实 |
| 2026-09-21 | 实施完成（Phase 1+2 一并落地）：`src/modules/scope_guards/**`（3 条拦截器 + helper + i18n + README）、`src/modules.ts` 注册、`src/app/api/[...slug]/route.ts` catch 首部拒绝映射、`jest.config.cjs` 排除 `__integration__`、`docs/dev/multi-company-org-model.md` + `docs/dev/README.md` 索引、模块 `__integration__` 与单元测试。验证：集成 6/6、单元 5/5、`yarn generate`/`yarn typecheck`/`yarn lint` 通过；`yarn test` 仅剩与本改动无关的既有 i18n 断言失败（见 Acceptance Criteria） |
| 2026-09-23 | Status → `Implemented`. Corrected three unsupported claims (no `scope_guards.blocked` log token, TEST-006 has no artifact, the recorded `yarn test` failure is fixed at HEAD) and restated the organization-tree write gap as still unspecced. |
