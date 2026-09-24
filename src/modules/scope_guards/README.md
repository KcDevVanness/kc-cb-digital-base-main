# `scope_guards` — 跨组织越权写入封堵

app 侧加固模块：在**命令总线层**为安装的认证域写命令补上"操作者组织范围"校验。不含实体、不含 UI、不含迁移。

## 职责

| 拦截器 id | 目标命令 | 规则 |
|---|---|---|
| `scope_guards.user-create-destination` | `auth.users.create` | 目标组织必须落在操作者 `allowedIds` 内（安装的更新路径已校验，创建路径没有） |
| `scope_guards.acl-target-ownership-role` | `auth.role-acl.update` | 目标角色 ACL 的**既有组织范围**必须落在操作者可授予范围内 |
| `scope_guards.acl-target-ownership-user` | `auth.user-acl.update` | 同上，用户级 ACL |

拒绝形态：`403` + `{ error, code }`，code 为 `scope_guards.user_destination_outside_scope` / `scope_guards.acl_target_outside_scope` / `scope_guards.scope_resolution_failed`。两条 ACL 路由不经过 CRUD 工厂，其拒绝由 `src/app/api/[...slug]/route.ts` catch 首部的 `getCommandInterceptorHttpRejection` 映射为 403（否则会是 500）。

## 放行条件

1. 无终端用户上下文（`auth === null`，即框架的 `systemActor`：播种/初始化/后台任务）；
2. `auth.isSuperAdmin === true`，或解析出的 `allowedIds === null`（真·不限组织）；
3. 目标在范围内。

**反向**：`auth.tenantId` 无法解析时按拒绝处理——`allowedIds === null` 同时是"解析失败"的返回值，不能当作不限组织。拦截器自身解析抛错同样 fail-closed（`scope_guards.scope_resolution_failed`）。

## 有意为之的边界

- **只判组织轴**：目标 ACL 的功能位轴沿用安装层 `assertActorCanGrantAcl`（只校验请求值），因此"收窄/回收自己范围内角色的功能位"仍然可用。
- **平台级残余**：命令总线在 `rbacService` 缺失/抛错时吞错并返回空特性集，`features` 门会让拦截器被整体跳过（放行）。这是平台行为，本模块不修复。
- **不覆盖**直写 ORM（不经命令总线）的代码路径。

## 验证

```bash
yarn generate          # command-interceptors.generated.ts 出现 3 条条目
yarn typecheck
# 集成测试（需目标环境在运行；本仓库 dev server 端口见 APP_URL / 实际监听端口）
BASE_URL=http://localhost:3000 npx playwright test --config .ai/qa/tests/playwright.config.ts scope-guards
npx jest --config jest.config.cjs src/modules/scope_guards
```

`__integration__/**` 是 Playwright 专用目录，已在 `jest.config.cjs` 的 `testPathIgnorePatterns` 中排除（否则 jest 会把 Playwright 用例当单测收集）。

场景与验收见 `.ai/specs/2026-09-21-auth-scope-guard-hardening.md`（TEST-001..TEST-006 / AC-001..AC-006）。

## 回滚

从 `src/modules.ts` 移除 `{ id: 'scope_guards', from: '@app' }` 并 `yarn generate`：拦截器全部消失。如需同时撤销拒绝映射，回滚 `src/app/api/[...slug]/route.ts` catch 首部的单个 hunk（映射变 no-op）。

## 相关知识（`.ai/lessons/`）

- `interceptor-rejection-http-mapping.md` — 拦截器拒绝为什么必须在分发层映射，以及 `status`/`body` 必须成对。
- `auth-admin-writes-need-scope-guards.md` — 安装的认证域写路径漏了哪些范围校验、为什么 `directory.organizations.manage` 不下放。
- `per-user-acl-is-an-absolute-override.md` — 用户级 ACL 是绝对覆盖，写测试与运维时的坑。
