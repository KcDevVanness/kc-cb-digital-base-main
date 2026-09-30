# 我方主体主数据（our entity master）

**Date**: 2026-09-30
**Status**: Implemented — 四个 Phase 已实现并验证（2026-09-30）

> Route: `module-data`（新 app 模块 `our_parties` + `trade_docs` 消费方）+ `backend-ui`。
> 决策来源：owner 2026-09-30 对「我方主体（主数据）数据源是交易对手，逻辑不对」的答复——选 **A 方案**：以**组织**为键的 app 自有主体档案（名称来自组织，地址/联系人 + 加密银行账户由档案维护），单据的我方主体选择器读组织列表、选中即回填。

## 📝 TLDR

把单据的「我方主体」从**交易对手主数据**改成**组织 + 组织档案**：`our_parties` 新模块以 `organizationId` 为键保存每家公司自己的打印档案（地址/联系人 + 多行加密银行账户），合同/PI/CI/发票的我方主体选择器列出**组织**（当前组织、其上级与下级），选中后带出名称（组织名）与档案里的地址/银行；落库仍是 `our_party_snapshot` 快照（新增 `organizationId` 键，旧行的 `partyId` 键原样可读，无迁移）。

## 📝 Problem Statement

1. 现在「我方主体（主数据）」读 `/api/parties/options`（无角色过滤）——也就是**交易对手**档案：外部客户、银行、货代都能被选成我方主体。
2. 我方主体在业务上就是我们自己的法人：主体公司或其子公司，即**组织树**里的节点（本部署：`kaicui` 主体 + `ru`/`sea` 分公司）。组织行只有 `name/slug/logo/parent`，没有地址/联系人/银行（`@open-mecato/core` 的 `Organization` 实体），所以打印所需的档案数据无处安放。
3. 分公司档案 `RU-AB`/`SEA-AB` 是**对方侧**的记录（总部→分公司内部销售合同的对方打印块），不是我方主体；今天没有任何一处承载「我方某公司」的打印档案。

## 📝 Proposed Solution

- 新 app 模块 **`our_parties`**：`our_parties_profiles`（每组织一行）+ `our_parties_bank_accounts`（子表，银行四列加密，默认账户唯一）——形态镜像 `parties`（同一套银行编辑器、同样的默认账户规则、同样的子行整组替换语义）。
- 维护 UI：`/backend/our-parties`（列表：我方主体档案 + 组织名）、`/backend/our-parties/create`（选组织 + 填档案）、`/backend/our-parties/[id]/edit`；银行块复用 `parties/components/BankAccountsEditor`。
- 选择器：`trade_docs` 的 `OurPartyPicker`（合同/PI/CI/发票共用）改为**组织选项**（来自页面 chrome 的组织树 payload，无需 `directory.organizations.view`）+ 选中后读该组织的档案（`GET /api/our_parties/profiles?organizationId=<id>`）；档案不存在时只带出组织名，其余字段仍可手填（旧行为兜底）。
- 快照：`ourPartySnapshot` 继续写 `{name,address,contact,bank,bankAccountId}`，新增 `organizationId`；旧行里的 `partyId` 保留可读，不改写、不迁移。

### Alternatives considered

| 方案 | 为什么否决 |
|---|---|
| B：`parties` 加 `self` 角色 + 关联组织 | 我方主体继续寄居在交易对手表里——正是 owner 指出的语义错误；`parties` 的组织列是**作用域**列，不是「这是哪家公司」的键 |
| C：只把 `parties` 选择器限制角色 | 防误选，但没解决「我方主体 = 组织」这条主线，也没有承载地址/银行的地方 |
| 挂在 installed `directory` 组织的自定义字段上 | 地址/联系人是标量、银行是多行加密子表；自定义字段放不下子表，且组织实体属于 installed 模块 |

## 📝 Architecture

```text
组织树（installed directory）        我们的档案（app 自有）
  kaicui 主体公司  ──┐             our_parties_profiles（organization_id = 组织 id）
  ├─ ru 分公司     ──┼─ 选择器读组织 ──┬─ our_parties_bank_accounts（加密子表）
  └─ sea 分公司    ──┘   id/name      └─ 选中 → 回填 name/address/contact/bank
trade_docs（合同/PI/CI/发票）
  └─ our_party_snapshot = { organizationId?, name, address, contact, bank, bankAccountId? }  ← 打印用快照
```

- 模块边界：`our_parties` 拥有档案与银行账户；`directory` 拥有组织（只读标量 id + 名称，名称从 chrome payload 取，不建 ORM 关系、不直读 installed 实体）。
- 复用：银行编辑器（`parties`）、`CrudForm`/`DataTable`/`makeCrudRoute`/命令与加密读取助手；不新造选择器/编辑器。

## 📝 Data Model

| 实体 | 表 | 关键列 | 说明 |
|---|---|---|---|
| `OurPartyProfile` | `our_parties_profiles` | `id`, `tenant_id`, `organization_id`（唯一：`(tenant, organization)`）、`address_line1/2`, `city`, `country_code`, `contact_name`, `contact_phone`, `email`, `notes`, `created_at/updated_at/deleted_at` | 每组织一行；`organization_id` 是**主体组织 id**（跨模块只存标量，不建关系）；有软删 |
| `OurPartyBankAccount` | `our_parties_bank_accounts` | `id`, `tenant_id`, `organization_id`(=主体组织), `profile_id`(FK), `beneficiary_bank`, `account_number`, `swift_code`, `bank_address`, `is_default`, 时间戳 | 同模块子行；银行四列进 `encryption.ts`；一个档案最多一行默认 |

- 迁移：`yarn db:generate` 生成、审阅、**不手工 apply**（dev supervisor 自行迁移）。
- 加密：银行四列；名称/地址/联系方式**不加密**（我方公开抬头，且要能出现在打印与列表上）——与 `parties`（对方 PII 全加密）不同，属有意差异，写在 `encryption.ts` 注释里。

## 📝 API Contracts

| Method / command | Path / ID | Auth | Input | Response | Errors |
|---|---|---|---|---|---|
| `GET` | `/api/our_parties/profiles` | `our_parties.view` | `search`(组织名不检索——无组织名列，按 `organization_id`)、`organizationId`、分页/排序 | 分页 `items[]`（`organizationId`, 地址/联系人, `bankAccounts[]` 解密, `updatedAt`） | 既有 |
| `POST` | `/api/our_parties/profiles` | `our_parties.manage` | `organizationCreateSchema`（`organizationId` 必填 + 档案字段 + `bankAccounts[]`） | 201 + `our_parties.profile.created` | 400 重复组织 409；两行默认 400 |
| `PUT` | `/api/our_parties/profiles` | `our_parties.manage` | `updateSchema` + `id` + `updatedAt`（乐观锁）；`bankAccounts` 缺席=不改、`[]`=清空 | 200 + `.updated` | 409 版本冲突/重复组织 |
| `DELETE` | `/api/our_parties/profiles` | `our_parties.manage` | `id` + `updatedAt` | 200 软删 + `.deleted` | 409 |
| commands | `our_parties.profiles.{create,update,delete}` | — | 同上 | 事件 + undo | — |

- `organizationId` 只来自 payload 作**主体键**（不是作用域）；作用域（tenant/当前组织）一律来自会话 —— 与「请求体永不接受 tenantId/organizationId 作为作用域」的规则一致：这里的 `organizationId` 是业务键（哪家公司），行自身的 `organization_id` 列写**该组织**，作用域由命令的 `ensureScope` 校验「调用者能读到的组织集合包含它」。

## 📝 UI/UX

- `/backend/our-parties`：`DataTable`（我方主体 / 组织 / 联系人 / 银行账户数 / 更新时间 + 行操作「编辑」「删除（带确认）」）+「新建我方主体」。
- `/backend/our-parties/create`：组织选择器（只列**还没有档案**的组织：当前可选组织 − 已有档案）+ 地址/联系人 + 银行块（复用 `BankAccountsEditor`，默认账户单选）。
- `/backend/our-parties/[id]/edit`：同表单，组织只读（键不可变）。
- `trade_docs` 我方主体块：组织选择器（含组织名）+ 银行下拉（该档案默认账户优先）；档案缺失时的提示「该公司还没有档案，去维护」链接到维护页（`our_parties.manage` 才显示）。
- 状态：loading/empty/error/权限降级；表单冲突 409 就地提示；窄屏单列。

## 📝 Edge Cases & Failure Scenarios

| 场景 | 行为 |
|---|---|
| 组织很多（含测试组织） | 列表按可读组织作用域 + 分页；创建选择器只列没有档案的可读组织 |
| 同一组织被并发创建档案 | `(tenant, organization)` 唯一约束 + 409 |
| 银行两行都标默认 | 命令 400 + 部分唯一索引兜底 |
| 档案被删 | 软删；已出单据的快照不变（快照是打印副本） |
| 组织被改名 | 选择器/列表显示组织当前名（来自 payload）；快照里的旧名不变 |
| 分公司看不到上级档案 | 作用域内读取：读不到就只带出组织名，其余手填（不报错） |
| 旧单据的 `partyId` 快照 | 原样可读；编辑页 seed 显示存的名字，不解析 |

## 📝 Risks & Impact Review

- **跨模块 ACL**：`trade_docs` 的操作员需要 `our_parties.view` 才能回填档案；只在部署角色的功能位里补（`docs/dev/multi-company-org-model.md` + 本 spec），不做隐式放行。
- **组织名来源**：选择器与列表用页面 chrome 的组织 payload（id/name），不读 installed `directory` 实体，也不要求 `directory.organizations.view`。
- **回滚**：revert 本单元即可；新表可留存（无外键跨模块、无数据改写）；`ourPartySnapshot` 只新增键。
- **不迁移历史数据**：无必要——快照即打印副本；新的我方主体数据由业务一次性录入（各公司法务抬头/银行，属业务数据）。

## 📋 Phasing

- **Phase 1** — `our_parties` 模块：实体/迁移/命令/API/ACL/setup/加密 + 单测与集成。
- **Phase 2** — 维护 UI：列表/新建/编辑 + 银行块复用 + i18n + 导航。
- **Phase 3** — `trade_docs` 我方主体选择器改读组织 + 档案回填（合同/PI/CI/发票共用），快照加 `organizationId`。
- **Phase 4** — 文档与证据：spec 状态、模块 README、角色矩阵、计划行、浏览器实测。

## 📋 Implementation Plan

### Phase 1 — 模块与服务端

- 1.1 `index.ts`/`acl.ts`/`setup.ts`/`encryption.ts`/`src/modules.ts` 注册（追加 `enabledModules.push`）。
- 1.2 `data/entities.ts` + `data/validators.ts`；`yarn db:generate` 生成迁移并审阅（不 apply）。
- 1.3 `commands/profiles.ts`：create/update/delete（银行子行替换、默认唯一、乐观锁、undo、事件、`meta`），`commands/__tests__/profiles.test.ts`。
- 1.4 `api/profiles/route.ts` + `openapi.ts`；集成 spec：两作用域、允许/拒绝、重复组织 409、银行密文落库与解密回读、清空往返。

### Phase 2 — 维护 UI

- 2.1 `backend/our-parties/{page,create,[id]/edit}` + `page.meta.ts`（导航到「基础数据」组）+ 组件 `OurPartiesTable`/`OurPartyForm`（`CrudForm` + 银行自定义字段）。
- 2.2 i18n（zh/en）+ 设计系统/状态覆盖；浏览器实测（创建 → 编辑 → 删除）。

### Phase 3 — trade_docs 接入

- 3.1 `formOptions.ts`：`loadOurPartyProfile(organizationId)`（解密读）。
- 3.2 `ContractForm` 的 `OurPartyPicker`：组织选项（payload）+ 档案回填 + 银行下拉 + 缺失档案提示；快照加 `organizationId`。
- 3.3 浏览器实测合同/PI 的我方主体块（选中组织 → 回填 → 保存 → 回读）。

### Phase 4 — 文档

- 4.1 spec 状态 + Changelog；`src/modules/our_parties/README.md`；`trade_docs/README.md` 我方主体一节；`docs/dev/multi-company-org-model.md` 角色矩阵补 `our_parties.*`；`docs/plans/cross-border-erp.md` 行。

## Changelog

| Date | Change |
|---|---|
| 2026-09-30 | **评审修复（四 major + 五 minor + 一 nit）**：①update/delete（及其 undo）补**主体组织授权**，`loadProfile` 带 tenant 谓词（拿到 `manage` 但组织范围收窄的账号不能按 id 改别家公司档案；跨租户 id 一律 404）；②`(tenant, organization)` 唯一索引改为**部分唯一**（`where deleted_at is null`）——删档后该公司可再建档、undo 后可重做，dev 库索引已同步重建；③银行默认账户先清旧标记再按载荷落位（否则「新默认行排在旧默认行之前」会撞部分唯一索引 500）；④编辑既有单据时银行下拉按组织**懒加载**账户；⑤旧快照的 `partyId` 键在表单值里透传、未选组织时原样回写（兑现「旧键不改写」）；⑥create-undo 的副作用改用被删行自己的组织作用域（否则 query-index 作用域校验报错）；⑦新增 `events.ts` 声明三条 crud 事件（含 `clientBroadcast`）；⑧维护表单只列**可操作**组织（与写入守卫一致）；⑨删除 trade_docs 中已无引用的两个 loader 与未用的 openApi 导出。 |
| 2026-09-30 | 实现并验证：`our_parties` 模块（`our_parties_profiles` + `our_parties_bank_accounts`，迁移 `Migration20260930040746_our_parties.ts`，银行四列加密）、三条命令（create/update/delete，子行整组替换 + 默认唯一 + 乐观锁 + undo + 事件）、CRUD + 聚合详情两条路由、维护页（列表/新建/编辑，银行块复用 `parties` 的编辑器）、`trade_docs` 我方主体选择器改读组织链 + 档案回填（合同/PI/CI/发票共用）。实现期发现并修掉两处：①实体 `entityId` 必须遵引擎的 `<module>:<module>_<entity>` 约定（`our_parties:our_party_profile`），否则查询引擎把表名猜成 `profiles` → 列表 500；②只改银行子行时父行不落写、乐观锁版本不前进 → 更新命令每次显式推进 `updatedAt`。验证：门禁全绿 + 浏览器实测（列表/新建/编辑/删除、银行密文落库与解密回读、合同表单选中组织回填名称/地址/联系人/银行、未建档组织提示）。既有 dev 库需跑一次 `yarn mercato entities seed-encryption --tenant <id>` 物化银行加密映射（本机已跑）。 |

## Resolved assumptions (autonomous defaults)

| # | 问题 | 取值 | 理由 / 可否推翻 |
|---|---|---|---|
| Q1 | 选择器列出哪些组织？ | **当前组织 + 其祖先 + 其后代**（= 页面组织 payload 里可见的那条链） | 「主体公司或主体以下的子公司」——分公司账号也能选主体公司做抬头；读不到档案时退化为只带名称，可随时放宽/收紧 |
| Q2 | 银行账户几条？ | **多行 + 一行默认**（镜像 `parties`） | 与对方侧同一交互与快照口径（`bankAccountId`）；单账户是它的子集 |
| Q3 | 谁维护档案？ | `our_parties.manage`（默认授 `superadmin`/`admin`；部署角色矩阵给总部与分公司管理员） | 与 `parties`/`purchasing` 的默认一致；可只给总部收紧 |
| Q4 | 旧单据的 `partyId` 快照？ | **原样保留可读，不改写** | 快照是打印副本；无需迁移、无数据风险 |
| Q5 | 本次是否删除 dev 库遗留的 `incoterms` 字典行？ | 否（另一个单元已移除表单读取；删行需 owner 批准） | 与本 spec 无关，单独确认 |
