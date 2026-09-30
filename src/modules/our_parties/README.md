# our_parties — 我方主体（我们自己的公司档案）

本模块是**我方主体主数据**：以**组织**为键，保存我们自己的法人（主体公司或其子公司）在单据上需要的打印档案——地址、联系人、银行账户。合同 / PI / CI / 发票的「我方主体（主数据）」选择器从它读数据。

规格：[`.ai/specs/2026-09-30-our-entity-master.md`](../../../.ai/specs/2026-09-30-our-entity-master.md)（owner 2026-09-30 选定 A 方案）。

## 为什么不是 `parties`

`parties` 是**交易对手**主数据（买方/分公司档案/货代/银行），组织列是**作用域**；我方主体在业务上是我们自己的法人 = **组织树节点**，所以本模块把档案挂在 `organization_id` 上，名称直接来自组织（选择器显示组织名），只有组织行没有的字段（地址/联系人/银行）存在这里。组织实体属于 installed `directory`，本模块只存**标量 id**，不建 ORM 关系、不读它的实体。

## 表面（surfaces）

| 表面 | 说明 |
|---|---|
| 实体 | `OurPartyProfile` → `our_parties_profiles`（`(tenant_id, organization_id)` **部分**唯一索引 `where deleted_at is null`：一家公司同时只有一份**存活**档案，删掉后可再建）；`OurPartyBankAccount` → `our_parties_bank_accounts`（同模块子表，`profile_id` 外键 cascade，`is_default` 部分唯一索引） |
| 迁移 | `Migration20260930040746_our_parties.ts`（两张表 + 作用域索引 + `(tenant, organization)` 与 `is_default` 两个**部分唯一索引**；仅建表，无数据改写） |
| 命令 | `our_parties.profiles.create` / `.update` / `.delete`（银行子行整组替换语义、默认账户唯一、乐观锁、undo、事件、审计；`prepare` 快照含银行行） |
| 路由 | `GET/POST/PUT/DELETE /api/our_parties/profiles`（CRUD 工厂，`our_parties.view` / `our_parties.manage`）；`GET /api/our_parties/profiles/[id]`（聚合读：档案 + 解密后的银行块） |
| 页面 | `/backend/our-parties`（列表）、`/backend/our-parties/create`、`/backend/our-parties/[id]/edit`；银行块复用 `parties` 的 `BankAccountsEditor` |
| 加密 | `encryption.ts`：银行四列（`beneficiary_bank` / `account_number` / `swift_code` / `bank_address`）。**故意不加密**地址与联系人：那是我们自己印在单据上的公开抬头（与 `parties` 对对方 PII 的全加密是有意差异） |
| ACL | `our_parties.view`、`our_parties.manage`（`manage` 依赖 `view`）；`setup.ts` 默认授 `superadmin`/`admin` |
| 事件 | `events.ts`：`our_parties.profile.{created,updated,deleted}`（`category: 'crud'`、`clientBroadcast`），列表/选择器在写后自动刷新 |

## 作用域与「能写哪家公司」

- 读取：行自身的 `organization_id` 就是**主体公司**，所以框架的 scoped 读天然回答「能不能看这家公司的档案」——分公司账号只能看到分公司的档案（含其下级）。
- 写入：`organizationId` 是业务键（哪家公司），命令用**调用者可读组织集合**（ACL 组织轴）校验，越界 403 `our_parties.organization_outside_scope`；系统上下文（无终端用户）直接放行。同一公司重复建档 → 409（部分唯一索引 + 冲突映射）。**create / update / delete（以及两者的 undo）都对行自身的主体公司重新校验一次**——拿到 `our_parties.manage` 但组织范围收窄的账号不能靠已知 id 改别人公司的档案；加载也带 tenant 谓词，跨租户 id 一律 404。

## 消费方（trade_docs）

合同 / PI / CI / 发票的「我方主体（主数据）」选择器列出**组织链**（页面顶栏组织 payload：本公司 + 祖先 + 下级），选中后：

- 名称 = 组织名；地址 / 联系人 / 银行账户 = 该公司档案（默认账户优先）；
- 该公司还没有档案（或调用者读不到、读取失败）→ **名称照常带出**，其余字段仍可手填，并提示「去维护我方主体」；
- 编辑既有单据时，银行下拉在首次展开时按组织懒加载该公司的账户（不依赖先重选公司）；
- 快照写入 `our_party_snapshot = { organizationId, name, address, contact, bank, bankAccountId? }`；**旧单据里的 `partyId` 键原样保留可读**（不迁移、不改写）。

因此**操作单据的角色需要 `our_parties.view`**（部署角色矩阵见 [`docs/dev/multi-company-org-model.md`](../../../docs/dev/multi-company-org-model.md)）。

## 验证方式

- 单元：`yarn test src/modules/our_parties`（校验器：组织必填/国家码/邮箱/银行行必填与上限、update 不含组织键；`bankAccountIsDefault` 的默认账户规则）。
- 门禁：`yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build`。
- 浏览器实测：新建档案（选组织 → 填地址/银行）→ 列表 → 编辑 → 删除；合同表单选同一组织 → 抬头与银行回填；未建档的组织只带出名称 + 提示。

## 本地步骤与回滚

- 新表随迁移由 dev supervisor 自动应用；**已有租户**需要为银行列物化加密映射：`yarn mercato entities seed-encryption --tenant <tenantId>`。
- 回滚：revert 本单元；两张新表可留存（无跨模块外键、无数据改写），删除即可。
- 我方主体的银行/地址属**业务数据**，由业务一次性录入（本模块不播种）。
