# Supplier Code Issuance — 供应商编码由系统发号（`SUP-####`）

**Date**: 2026-09-24
**Status**: Implemented and verified (Phases 1–2, 2026-09-24) — the API issues `SUP-####` on a create without a code, the create form no longer renders the field, the edit form shows it read-only, and the explicit-code contract is untouched. No schema change, no migration.

> 关联阅读：[`2026-09-21-purchasing-module.md`](2026-09-21-purchasing-module.md) 拥有供应商主数据本身；
> [`2026-09-24-supplier-product-code-rules.md`](2026-09-24-supplier-product-code-rules.md) 拥有「商品 SKU」的发号引擎
> （`product_codes`，品牌+类别+序列）。**本 spec 与它无关**：这里改的是供应商主数据的编号，不碰 `product_codes`、
> 不新增规则、不新增表、不新增索引。

## Implementation Status

Source doc: .ai/specs/2026-09-24-supplier-code-issuance.md

| Phase | State | Dependencies | Acceptance IDs | Focused validation | Exit gate |
|---|---|---|---|---|---|
| Phase 1 — 服务端发号 | verified | none | AC-001…003, AC-005 | `yarn typecheck`、`yarn test src/modules/purchasing`（5 套件 / 25 测试）、`npx playwright test … supplier-code-issuance`（4 passed） | 不带 `code` 的创建拿到连续编号；软删后不复用；显式码与重复 409 不变 |
| Phase 2 — 表单与文档 | verified | Phase 1 | AC-004, AC-006 | `yarn typecheck`、`yarn ds:check`（697 文件）、浏览器实测（真实表单保存 → `SUP-0018`；编辑页编码 `readOnly`） | 新建页无编码字段、保存后列表显示发号结果；编辑页只读展示 |

### Phase 1 evidence

- [x] `data/validators.ts`：`supplierCreateSchema.code` → `z.string().trim().max(64).optional()`（只放宽不收窄，符合 `BACKWARD_COMPATIBILITY.md` §data/validators 的「不得移除或收窄」）
- [x] `commands/suppliers.ts`：`nextSupplierCode`（`SUP-` + 4 位，扫本组织**含软删行**的 `code like 'SUP-%'` 取 `^SUP-(\d+)$` 最大序号 +1）、`createSupplierRow`（显式码 1 次尝试 / 发号码 ≤5 次，每次 `em.fork()`）、本地 `isUniqueViolation` 换成 `@open-mercato/shared/lib/crud/errors` 的共享实现
- [x] 集成 `__integration__/supplier-code-issuance.spec.ts`：4 个用例全绿（连续发号；软删后不复用；新组织从 `SUP-0001` 独立起算；显式码原样保存 + 重复 409 + 不占用发号序号）。第三个用例需要给新建的分公司组织播一份币种字典（命令按**组织**校验币种，见 `lib/currencyDictionary.ts`），spec 里用真实 API（`POST /api/dictionaries` + 条目）完成
- [x] 既有集成套件 `supplier-products.spec.ts` 未受本改动影响（10 passed；唯一失败项 TEST-SPL-013 属于同仓另一会话在制的折扣功能，与本 spec 无关）
- [x] `yarn typecheck` 0 error；改动文件 `npx eslint` 干净

### Phase 2 evidence

- [x] `components/SupplierForm.tsx`：`useSupplierFields(t, mode)` + `supplierGroups(mode)`——新建不渲染 `code`，编辑渲染 `readOnly: true` + `purchasing.suppliers.form.help.code`；`buildSupplierPayload` 空白码不下发
- [x] i18n：`purchasing.suppliers.form.help.code`（zh「系统自动发号，无需填写。」/ en「Issued automatically when the supplier is created.」）
- [x] 浏览器实测（真实 dev server、真实会话）：新建页字段为 名称*/联系人/电话/邮箱/地址/默认币种*/默认品牌/启用/备注——**无「编码」**；经真实表单保存后列表出现 `SUP-0018`；编辑页 `编码 = SUP-0018` 且 DOM `readOnly: true`、说明文案可见
- [x] 文档：`src/modules/purchasing/README.md`（规则 + 验证清单）、`docs/plans/cross-border-erp.md` 进度行 六·补12、`docs/plans/README.md` 状态板
- 说明：该页在本机 headless Chromium 下**截图像素超时**（`Page.captureScreenshot` 协议超时，同仓 2026-09-24 的另一份 spec 也记录过同类工具限制），因此 UI 证据取自渲染后的可访问性树与 DOM 断言，而非截图

## TLDR

供应商主数据的 `code` 从「操作员手工填」改为「命令层发号」：新建表单不再出现该字段，创建时由
`purchasing.suppliers.create` 按组织发 `SUP-0001` 形状的下一个号（扫该组织**全部**行、含软删行取最大序号 +1），
唯一索引仍是最终保证、撞号有界重试；编辑页把编码以只读字段展示（说明「系统发号」）；接口继续接受显式 `code`，
所以导入、集成测试与既有调用方一个都不用改。无 schema 变更、无迁移、无新权限。

## Problem Statement

**编码今天只有一个作用，却被要求人工发明。** 它不参与任何计算或发号：列表列（`components/SuppliersTable.tsx:42`）、
搜索键（`api/suppliers/route.ts:96-99`）、两个选择器的标签 `编码 — 名称`
（`components/PurchaseOrderForm.tsx:195-199`、`components/SupplierProductForm.tsx:80-99`）、以及下单时冻结进
`supplier_snapshot`（`commands/orders.ts:419-435`）。但它是必填自由文本、无格式约束
（`data/validators.ts:97`，仅长度 1–64），于是编号风格随人漂移：集成测试里是 `PETKIT-<stamp>`/`OTHER-<stamp>`
（`__integration__/supplier-products.spec.ts:170,179`），线上则各写各的。

**手填带来的具体代价。** ① 两个操作员同时建档，第二个会撞上
「A supplier with this code already exists in this organization」——一句对着他从未填写过的字段说的 409
（`commands/suppliers.ts:86-105`）；② 唯一索引**包含软删行**（`data/entities.ts:16` 的注释已写明），
删掉的供应商仍占着编号，人工命名时必须记得这件事；③ 编码已冻结在历史采购单快照里，
`commands/orders.ts:433` 把它写进 `supplier_snapshot.code`，所以编号的稳定性比可读性更重要。

**为什么可以放手改。** 供应商编码的下游读者只有上面那几处展示面，没有第二个业务含义、没有外部系统按它对齐
（对方的号是供应商货号 `supplier_sku`/`item_no`，另一套字段，见 `README.md:54`），所以发号规则可以完全由本模块决定。

## Overview and Success Measures

- **Primary outcome:** 新建供应商时操作员不需要（也无法）填编码，保存后系统给出 `SUP-0001` 形状的组织内唯一编号，
  并且该编号永不复用——包括被软删的供应商占过的号。
- **Leading indicators:** 新建表单上不再出现「编码」字段；同一组织连续建档得到连续序号；删除一个供应商后新建，
  序号继续递增而不是回收。
- **Baseline:** `code` 必填手填（`data/validators.ts:97`），无任何发号代码；线上编号风格不统一。
- **Market / product reference:** 中端 ERP 的主数据编号（Odoo 的 `ir.sequence` 供应商编号、SAP 的供应商账户组
  内部编号、NetSuite 的 auto-generated vendor ID）。采用：**内部编号由系统发号、永不回收**，人工编号仍可作为
  外部/迁移数据写入。拒绝：给供应商编号加业务含义分段（那是商品 SKU 的 `product_codes` 规则要解决的问题）。

## Goals

- **REQ-001** — 创建契约放宽：`supplierCreateSchema.code` 变可选（`z.string().trim().max(64).optional()`）；
  缺失或空白时由命令发号，形状 `SUP-<序号>`，序号宽度 4、超出后自然变宽（`SUP-10000`）。
- **REQ-002** — 发号扫描**该组织的全部供应商行（含软删行）**，取匹配 `^SUP-(\d+)$` 的最大序号 +1；
  非本形状的历史编码（如 `PETKIT-…`）不参与计算、不被改写。
- **REQ-003** — 并发安全：`purchasing_suppliers_scope_code_uniq`（`(tenant, organization, code)`）仍是最终保证；
  发号路径在唯一冲突时重读重试（≤5 次），耗尽返回可读 409；显式 `code` 的冲突仍立即 409（现状不变）。
- **REQ-004** — 表单：新建不渲染「编码」字段；编辑页以 `readOnly` 字段展示编码并附「系统发号，无需填写」说明；
  提交载荷在编码为空时省略该键。
- **REQ-005** — 契约面：`POST /api/purchasing/suppliers` 仍接受显式 `code`（导入、集成测试、历史调用方零改动），
  `PUT` 的 `code` 仍可选可改（UI 只读，接口不窄化）；响应形状、事件载荷、权限 id、路由路径全部不变。
- **REQ-006** — 文案与文档：新增/改动的字符串中英双语（`purchasing/i18n/{zh,en}.json`），
  `src/modules/purchasing/README.md` 表面表补一行，`docs/plans/cross-border-erp.md` 进度表与 spec 状态回填。

## Non-goals

- **不加表、不加列、不加索引、不生成迁移**：编号直接写在既有的 `purchasing_suppliers.code` 上，唯一约束已存在。
- **不引入独立序列表**（`product_codes_ledger_entries` 那套是为 SKU 的「品牌+类别+序列」与别名服务的）；
  供应商编号的「不复用」由「扫描含软删行」+ 唯一索引保证。
- **不给历史供应商回填或重编编号**：现有 `code` 原样保留，新号从现有最大序号继续。
- **不把编码改成可配置规则**（前缀/宽度/年份不做成配置项）；**不改** `update` 的编码可写性（只改 UI 呈现）。
- **不动 `parties.code`、`customers`、`products` 的编号**——它们是各自领域的编号，不属于本 spec。
- **不做「发号预览」**：号在保存时确定，表单不显示未落库的号。

## Proposed Solution

一个纯服务端的发号函数 + 两处表单呈现调整，全部落在 `src/modules/purchasing/**`：

```text
/backend/purchasing/suppliers/create ── POST /api/purchasing/suppliers （makeCrudRoute, schema=supplierCreateSchema）
        （表单不再有「编码」字段）          └─ purchasing.suppliers.create（commands/suppliers.ts）
                                                  ├─ code 有值 → assertCodeAvailable()（现状不变，冲突即 409）
                                                  └─ code 缺失/空白 → nextSupplierCode(em, scope)
                                                        扫 purchasing_suppliers（含软删）like 'SUP-%'
                                                        → max(^SUP-(\d+)$) + 1 → 'SUP-0001'
                                                        → em.fork().create + flush
                                                        → 唯一冲突？重读重试（≤5），耗尽 409
/backend/purchasing/suppliers/[id]/edit ─ PUT（编码字段 readOnly，值原样回传）
```

发号函数放在 `commands/suppliers.ts`，紧挨现有的 `assertCodeAvailable` / `isUniqueViolation`——
供应商编号的规则集中在一个文件里，符合本模块「编号规则跟它的使用处同文件」的现状
（`commands/orders.ts:444-461` 的 `nextOrderNumber`、`sourcing/commands/shared.ts:85-104` 的 `nextQuoteNumber`）。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| `SUP-####`，不带年份 | 供应商是长期档案，编号跨年续用；年份分段只增加检索噪音，选择器标签 `SUP-0001 — 名称` 也最短 | `SUP-2026-0001`（对齐 `PO-`/`SQ-`） | 那两套是**单据**号，年份有业务含义（年度序列）；供应商没有 |
| 扫全量行（含软删）取 max+1，而不是查「当前是否被占用」 | 唯一索引含软删行，且编号已进历史快照；「取最大」天然跳过所有已发出的号，一次查询解决 | 循环试探 `SUP-0001`、`0002`… 直到空闲 | 行数增长后是 N 次查询；且删号后回收会与快照冲突 |
| 有界重试（≤5，`em.fork()` 每次尝试） | 并发建档时操作员看到「编码已存在」是不可理解的——他从未填过编码；`product_codes/lib/issuance.ts:76-127` 已是本仓先例 | 直接 409（`PO-`/`SQ-` 现状） | 那两处的操作员确实在提交一个可见的单据动作；这里是后台发号，失败必须自愈 |
| 显式 `code` 仍被接受（创建与更新） | 导入、集成测试、迁移数据依赖它；移除是契约收窄 | 强制系统发号（移除入参） | 需要 BC 桥与调用方改造，收益为零 |
| 新建隐藏、编辑只读 | 业主确认（2026-09-24）：编号是身份，不该有人改；只读展示保证操作员看得到 | 新建显示只读预览 / 新建可选（留空自动） | 预览会展示一个未落库的号；可选则让两套风格继续并存 |
| 序号宽度溢出自然变宽 | `padStart(4)` 只补不截；`SUP-10000` 仍匹配 `^SUP-(\d+)$`，后续 max 计算不受影响 | 溢出即报错 | 报错会让第 10000 个供应商无法建档 |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| 供应商编码 | 我方给供应商编的内部号；显示、检索、随单快照的稳定标识。**不是**供应商货号（对方表格上印的号） | `purchasing_suppliers.code` | 冲突 409（显式路径） |
| 序号 | `SUP-` 后紧跟的十进制整数；组织内单调递增，永不复用 | 扫描 `purchasing_suppliers`（含软删行）的最大值 | 无——由「取最大 + 唯一索引」共同保证 |
| 非本形状的历史编码 | 不匹配 `^SUP-(\d+)$` 的既有值（如 `PETKIT-XXXX`） | 数据本身 | 正常保留、可检索、可显示；不参与发号计算 |
| 空白即未填 | `code` 为 `undefined` 或 trim 后为空字符串 → 发号 | `supplierCreateSchema` | 无 |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 采购员 | 新建供应商（系统发号）、编辑（编码只读） | 所选组织 | `purchasing.suppliers.manage` |
| 只读角色 | 查看列表/详情 | 所选组织 | `purchasing.suppliers.view` |
| 集成/导入调用方 | 提交显式 `code`（照旧） | 所选组织 | `purchasing.suppliers.manage` |

可信作用域不变：`ensureScope(ctx)`（`commands/shared.ts`）从命令上下文取 `tenantId` + `organizationId`，
发号扫描与唯一索引都在这个作用域内；缺组织 fail closed。**无系统作用域操作**、无新增 feature。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 发号（max+1 + 有界重试） | reuse 既有仓内约定 | `purchasing`（`commands/suppliers.ts`） | 命令内部私有函数 | 与 `nextOrderNumber` / `nextQuoteNumber` / `issueCode` 同款；不新建共享工具（`2026-09-24-supplier-product-code-rules.md` 的 Non-goals 已明确不合并它们） |
| 唯一性保证 | reuse | 数据库索引 `purchasing_suppliers_scope_code_uniq` | 索引即保证 | 无需应用层锁 |
| 冲突识别 | reuse | `@open-mercato/shared/lib/crud/errors` 的 `isUniqueViolation` | 直接 import | 模块内那份同名本地副本随之删除（同文件已有 import 位） |
| 表单呈现 | reuse | `@open-mercato/ui` `CrudForm`（字段级 `readOnly`，`CrudForm.tsx:214,1862`） | 字段定义 | 平台原语足够，不自定义控件 |
| 创建/更新写入 | reuse | `purchasing.suppliers.{create,update}` 命令 + `makeCrudRoute` | 契约不变 | 只在命令内加发号分支 |

## Architecture and Data Flow

```text
表单（新建，无编码字段）→ POST /api/purchasing/suppliers → supplierCreateSchema（code 可选）
                                                        → purchasing.suppliers.create
                                                             → nextSupplierCode()（含软删扫描）
                                                             → insert（唯一索引）
                                                             → 冲突重试 ≤5
                                                             → emitCrudSideEffects（事件/索引，现状不变）
表单（编辑，编码只读）  → PUT  /api/purchasing/suppliers → 值原样回传，行为与今天一致
列表/选择器/快照        → 不变（读到的是发号结果）
```

- **Module boundaries:** 全部改动在 `src/modules/purchasing/**`（校验器、命令、表单、i18n、README）+ 文档；
  不新增模块、不跨模块调用。
- **Extension points:** 不变（`makeCrudRoute` 的 actions、命令注册、`CrudForm` 字段定义）。
- **Alternatives considered:** 独立序列表（否决，见决策表）；`product_codes` 规则引擎（否决：供应商编号没有
  品牌/类别语义，为它单开一条规则与一个序列表是净增复杂度）。
- **Compatibility:** `POST`/`PUT` 的入参只**放宽**（`code` 由必填变可选），响应、事件载荷、权限、路由路径不变；
  既有显式 `code` 调用方（集成测试、导入）行为不变。

## User Journeys

### Journey J-001 — 新建供应商（系统发号）

1. 采购员打开 `/backend/purchasing/suppliers/create`：表单只有 名称 / 联系人 / 电话 / 邮箱 / 地址 / 默认币种 /
   默认品牌 / 启用 / 备注，**没有编码字段**。
2. 填名称、保存 → 命令发号 → 列表页 flash「供应商已保存」，该行的「编码」列显示 `SUP-0001`。
3. 连续建档 → `SUP-0002`、`SUP-0003`…（组织内连续，与操作员无关）。
4. 失败路径：无 `purchasing.suppliers.manage` → 403（页面 Access Denied）；校验失败 → 字段级错误、输入保留；
   并发撞号 → 命令内部重试后成功（操作员看不到冲突）。

### Journey J-002 — 删除后新建不复用旧号

1. 采购员删掉 `SUP-0002`（软删）。
2. 再新建一个供应商 → 拿到 `SUP-0004`（不是 `0002`），因为发号扫描包含软删行。

### Journey J-003 — 编辑既有供应商

1. 打开 `/backend/purchasing/suppliers/<id>/edit`：编码以只读字段显示（`SUP-0001`）+ 说明「系统发号，无需填写」。
2. 改名称、保存 → 成功；编码未变（值原样回传，命令侧唯一性检查通过）。
3. 陈旧 `updatedAt` → 409 冲突对话框（现状不变）。

## UI and Interaction Contracts

参照页面：本模块既有的 `components/SupplierForm.tsx`（`CrudForm` + 字段分组 + `withFlash` 成功跳转）——
它就是被改动的表面本身；canonical 参考实现是 `ui.form-create` / `ui.form-edit`
（`src/modules/example/backend/todos/create/page.tsx`、`src/modules/example/components/TodoForm.tsx`），
规则见 `.ai/guides/backend-ui.md`（CrudForm 一节：字段 id 与校验器/命令/翻译对齐、`initialValues.updatedAt` 驱动乐观锁）。

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/purchasing/suppliers/create` | 新建供应商（**无编码字段**） | `POST /api/purchasing/suppliers` | `SupplierForm.tsx`（本模块）+ `example/…/todos/create/page.tsx` | `CrudForm`、`Page` 外壳由 catch-all 提供、`withFlash` 跳转 | loading（提交中）/ validation error / server error / permission denied / success flash | REQ-001, REQ-004 |
| `/backend/purchasing/suppliers/[id]/edit` | 编辑（**编码只读展示**） | `GET` 列表接口取单行 + `PUT /api/purchasing/suppliers` | 同上 | 同上 + 字段级 `readOnly` | loading / not found / error / conflict(409) / permission denied / success flash | REQ-004 |

### `/backend/purchasing/suppliers/create` — 新建供应商

```text
┌──────────────────────────────────────────────────────────────┐
│ 新建供应商                                        [保存]      │
├──────────────────────────────────────────────────────────────┤
│ 名称*            联系人            默认币种*                  │
│ 电话             邮箱              默认品牌                   │
│ 地址                               启用 / 备注                │
│ （编码字段不出现——保存后由系统发号）                          │
└──────────────────────────────────────────────────────────────┘
```

### `/backend/purchasing/suppliers/[id]/edit` — 编辑供应商

```text
┌──────────────────────────────────────────────────────────────┐
│ 编辑供应商                                        [保存]      │
├──────────────────────────────────────────────────────────────┤
│ 名称*            联系人            默认币种*                  │
│ 编码（只读）     邮箱              默认品牌                   │
│  SUP-0001                                                      │
│  系统发号，无需填写                                            │
│ 电话 / 地址                        启用 / 备注                │
└──────────────────────────────────────────────────────────────┘
```

- **Behavior:** 新建提交后 `withFlash` 跳回列表；编辑页编码字段 `readOnly`（不可聚焦编辑，值仍在表单状态里
  随载荷回传）；校验与服务端错误沿用 `CrudForm` 既有行为（输入保留、字段级错误）；乐观锁 409 走既有冲突对话框。
- **Responsive and accessibility:** 沿用 `CrudForm` 的两列分组与窄屏降级；只读字段有可读标签与说明文本，
  不依赖颜色传达「不可编辑」。
- **Localization:** 新增键 `purchasing.suppliers.form.help.code`（说明文案）；`field.code` 标签沿用；
  zh 中文、en 英文，符合 `docs/dev/i18n.md` 的单语言规则。
- **Design-system and theming:** 无新增样式；只读态由 `CrudForm` 渲染，亮/暗两态随 DS。

## Data Models

N/A — 无实体、字段、索引或迁移变更。编号写入既有的 `purchasing_suppliers.code`（`data/entities.ts:31`），
唯一约束 `purchasing_suppliers_scope_code_uniq`（`data/entities.ts:16`）继续生效；软删语义不变
（`deleted_at`，`assertCodeAvailable` 与发号扫描都刻意包含软删行）。

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `POST` | `/api/purchasing/suppliers`（`makeCrudRoute`） | `purchasing.suppliers.manage` | `supplierCreateSchema`，**`code` 变可选**（`data/validators.ts:97`） | 201 `{ id }` + `purchasing.supplier.created`（不变） | 400 校验；403；显式 `code` 重复 → 409（不变）；发号路径内部重试，耗尽 → 409 | REQ-001, REQ-003, REQ-005 |
| `PUT` | `/api/purchasing/suppliers` | `purchasing.suppliers.manage` | `supplierUpdateSchema`（`code` 仍可选，`data/validators.ts:112`） | 200 `{ ok: true }` + `purchasing.supplier.updated` | 409 乐观锁 / 编码重复（不变） | REQ-005 |
| 命令 | `purchasing.suppliers.create` | — | 同上（经 `mapInput` 原样透传） | `PurchasingSupplier` 实体 | 发号冲突重试 ≤5 次，耗尽 → `conflict(...)` | REQ-002, REQ-003 |

`openApi`（`api/suppliers/route.ts` 的 `create.schema`）引用同一个 schema，因此文档随校验器一起放宽，无需单独改。

## Events, Jobs, Notifications, and Cross-Module Flows

N/A — 事件 id、载荷（`serializeSupplier` 已含 `code`）、索引器与订阅方全部不变。发号发生在创建命令内部，
`emitCrudSideEffects` 仍在写入成功后执行（顺序不变）。

## Security, Privacy, and Compliance

- **Authorization:** 不变——`POST/PUT` 仍由 `purchasing.suppliers.manage` 把关，页面 `requireFeatures` 不变。
- **Tenant isolation:** 发号扫描显式按 `tenant_id` + `organization_id` 过滤（与唯一索引同作用域），
  跨组织不共享序号；缺组织 fail closed（`ensureScope`）。
- **Sensitive data:** 供应商编号非 PII，无加密字段变更。
- **Abuse and failure modes:** 发号不可被外部指定序号（入参只放宽不新增能力）；重试有界（≤5），
  不能靠并发刷号造成无界循环；软删行参与计算，删号不释放编号（防串历史）。

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | integration | 新租户/组织 + staff token（沿用 `__integration__/meta.ts` 的既有 fixture） | `POST /api/purchasing/suppliers` 不带 `code`（连发两次） | 201；`code` 匹配 `^SUP-\d{4,}$` 且两次连续（第二个 = 第一个 +1）；列表回读一致 | REQ-001, REQ-002 |
| TEST-002 | integration | 同上，另建一个组织 | 在组织 A 发号后删除该供应商，再发号；同时看组织 B 的号 | 删除后新号**不复用**被删行的号；组织 B 从 `SUP-0001` 独立起算 | REQ-002, REQ-003 |
| TEST-003 | integration | 同上 | `POST` 显式 `code`（含非 `SUP-` 形状）→ 重复提交同一 `code` | 显式值被原样保存；重复返回 409 且错误可读（现状保持） | REQ-005 |
| TEST-004 | UI | dev 应用 + 有 `purchasing.suppliers.manage` 的会话 | 打开新建页；打开既有供应商编辑页 | 新建页无「编码」字段；编辑页编码只读且显示既有值；保存后列表显示发号结果 | REQ-004 |

## Implementation Phases

### Phase 1 — 服务端发号（一次可发布）

- **Depends on:** none
- **Outcome:** `POST /api/purchasing/suppliers` 不带 `code` 也能建档，且编号永不复用。
- **Why this order / value delivered:** 先让接口具备发号能力，表单才可能隐藏字段；此阶段不改变任何既有调用方行为。
- **Deliverables:** `data/validators.ts`（`supplierCreateSchema.code` 放宽）；`commands/suppliers.ts`
  （`nextSupplierCode`、发号分支、有界重试、改用共享 `isUniqueViolation` 并删除本地副本）；
  `__integration__/supplier-code-issuance.spec.ts`（+ `meta.ts`，如目录未提供）。
- **Independent slices / estimated commits:** 校验器 + 命令为一个提交；集成测试为一个提交。
- **Requirements closed:** REQ-001, REQ-002, REQ-003
- **Tests:** TEST-001, TEST-002, TEST-003
- **Validation:** `yarn generate`、`yarn typecheck`、`yarn test src/modules/purchasing`、
  `yarn mercato test:integration "supplier-code-issuance"`
- **Exit gate:** 不带 `code` 的两次创建得到连续编号；软删后不复用；显式 `code` 行为不变；既有 `supplier-products` 集成套件仍绿。

### Phase 2 — 表单与文档

- **Depends on:** Phase 1 退出条件
- **Outcome:** 新建表单不再出现编码字段，编辑页只读展示；文档与状态板同步。
- **Why this order / value delivered:** 只有接口能发号，隐藏字段才不会造成「保存失败」；本阶段是操作员可见的收益。
- **Deliverables:** `components/SupplierForm.tsx`（按 mode 生成字段/分组；编辑态 `readOnly` + 说明；
  `buildSupplierPayload` 空白 `code` 不下发）；`i18n/{zh,en}.json`（`purchasing.suppliers.form.help.code`）；
  `README.md` 表面表；`docs/plans/cross-border-erp.md` 进度行；本 spec 的 Status/Changelog。
- **Requirements closed:** REQ-004, REQ-005, REQ-006
- **Tests:** TEST-004
- **Validation:** `yarn typecheck`、`yarn lint`、`yarn ds:check`、`yarn test`，浏览器实测新建/编辑两页（亮/暗、窄屏）
- **Exit gate:** 新建页无编码字段且保存成功；编辑页编码只读并显示既有值；列表显示发号结果。

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001, `/backend/purchasing/suppliers/create` | `supplierCreateSchema.code` 可选（`data.validators` ← `src/modules/example/data/validators.ts`） | Phase 1 | TEST-001 | AC-001 |
| REQ-002 | J-001, J-002 | `nextSupplierCode` 含软删扫描（`commands.write` ← `src/modules/example/commands/todos.ts`） | Phase 1 | TEST-001, TEST-002 | AC-002 |
| REQ-003 | J-001 失败路径 | 唯一索引 + 有界重试（`isUniqueViolation` ← `@open-mercato/shared/lib/crud/errors`） | Phase 1 | TEST-001, TEST-002 | AC-003 |
| REQ-004 | J-003, 两个表单页 | `CrudForm` 字段级 `readOnly`（`ui.form-create` / `ui.form-edit` ← `src/modules/example/components/TodoForm.tsx`） | Phase 2 | TEST-004 | AC-004 |
| REQ-005 | 全部 | `POST`/`PUT` 入参只放宽（`api.crud-factory` ← `src/modules/example/api/customer-priorities/route.ts`） | Phase 1–2 | TEST-003 | AC-005 |
| REQ-006 | 列表/编辑页文案 | `module.i18n-catalogs` ← `src/modules/example/i18n/en.json`；README + 计划表 | Phase 2 | TEST-004 | AC-006 |

Every surface reference above is classified **`emitted-example`**：`src/modules/example/references/surface-inventory.json`
为每个 capability ID 提供了可编译实现；被改动的 `purchasing` 表面（供应商表单/命令/校验器）由
`2026-09-21-purchasing-module.md` 覆盖。本 spec 不新增运行时或发现面（无新路由、无新事件、无新命令 id），
因此没有需要新登记的 surface 行。

## Rollout, Migration, and Rollback

- **Migration:** 无（无 schema 变更，`yarn db:generate` 应产出空 diff）。
- **Rollout order:** Phase 1 → Phase 2，各自独立可发布；`yarn generate` 后核对生成物未出现新路由。
- **Observability:** 无新增指标；发号耗尽时的 409 文案可读（沿用 `conflict()` 的既有文案风格）。
- **Rollback:** 纯代码回退。Phase 2 回退 = 表单恢复渲染编码字段（`readOnly` 与说明移除）；
  Phase 1 回退 = `code` 恢复必填、移除发号分支——期间已发出的 `SUP-####` 编号是合法数据，无需清理
  （它们只是显式编码路径下的普通值）。

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 发号扫描随组织内供应商数量线性增长 | 建档变慢（数千行时） | 扫描只取 `code` 一列且带前缀 LIKE；建档是低频操作；`like 'SUP-%'` 命中量=已发号行 | 接受：量级远低于此前的订单号扫描 |
| 并发重试耗尽的极端情形 | 操作员看到 409 而非成功 | 重试 ≤5 且每次重读最大值；冲突窗口是毫秒级 | 接受：与 `issueCode` 同款上限与行为 |
| 显式 `code` 与系统发号混用 | 组织内可能出现 `PETKIT-…` 与 `SUP-…` 并存 | 发号只算 `^SUP-(\d+)$`，两套互不干扰；测试覆盖 | 接受：历史编号不该被改写 |
| 编辑页仍可通过 API 改编码 | 有人用脚本改掉已进快照的编号 | UI 只读；接口行为与今天一致（未窄化） | 接受：收窄接口需要 BC 桥，收益不足 |
| 前缀 `SUP` 与既有 `SQ-`/`PO-` 视觉相近 | 单据与主数据编号易混 | 三段式（`SUP-` 无年份）与两段式单据号天然区分；选择器标签带名称 | 低 |

## Acceptance Criteria

- [x] **AC-001** — 不带 `code` 的 `POST /api/purchasing/suppliers` 返回 201，新行编码匹配 `^SUP-\d{4,}$`。
- [x] **AC-002** — 同组织连续创建得到连续序号；软删一个供应商后新建，编号**不回收**被删行的号。
- [x] **AC-003** — 并发/重复插入不会返回 500；发号路径内部重试，耗尽才 409（可读文案）。
- [x] **AC-004** — 新建页不渲染「编码」字段；编辑页编码为只读字段并显示既有值，保存不改编码。
- [x] **AC-005** — 显式 `code` 的创建/更新行为与今天一致（含重复 409），事件载荷、权限 id、路由路径未变。
- [x] **AC-006** — 新增文案中英双语齐备；README 表面表、计划表进度行、本 spec 的 Status 与 Changelog 已回填。
- [x] **AC-007** — 门禁实测：`yarn generate` 通过（无新增路由；OpenAPI 打包回退为**既有**环境问题：`language-subtag-registry/data/json/registry.json` 在 Node 24 下缺 `type: json` 断言，生成物保持上一版）；`yarn typecheck` 0 error；`yarn ds:check` 697 文件通过；`yarn test` **32 套件 / 257 测试全绿**；集成 `supplier-code-issuance` **4/4 通过**，既有 `supplier-products` 10 passed（唯一失败项 TEST-SPL-013 属同仓另一会话在制的折扣功能，与本 spec 无关）。`yarn lint` 全仓仍红：186 个 error 全部落在**被 gitignore 的** `.ai/qa/test-results/html/trace/assets/*.js`（Playwright trace 产物，非源码），改动文件 `npx eslint` 干净。受影响 UI 已浏览器实测（新建页无编码字段、真实表单保存得 `SUP-0018`、编辑页编码 `readOnly`）；像素截图在本机 headless Chromium 下协议超时，见 `## Implementation Status` 的说明。

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | `AGENTS.md`、`.ai/guides/spec-delivery.md`、`.ai/guides/backend-ui.md`、`.ai/guides/contracts.md`、`skill://om-spec-writing`、`skill://om-module-scaffold`、`skill://om-backend-ui-design` |
| Data models, APIs, events, UI, and tests are internally consistent | pass | 无数据/事件变更；API 行与校验器/命令逐项对应；TEST-001…004 覆盖 REQ-001…006 |
| Every workflow completes end to end without a catch-all integration phase | pass | J-001…J-003 在 Phase 1–2 内闭环 |
| Platform-native reuse and extension points were chosen before custom code | pass | `CrudForm` 字段级 `readOnly`、`makeCrudRoute`、命令注册、共享 `isUniqueViolation` 全部复用；无自造控件/锁 |
| UI contracts identify references, canonical components, and theme/state coverage | pass | 参照页 + 文本 mockup + 状态/键盘/窄屏/明暗行 |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phase 1（服务端）/ Phase 2（表单+文档）各含依赖、测试、价值、退出条件 |

Verdict: `Implemented and verified (Phases 1–2, 2026-09-24)` — 上述矩阵在实现完成后逐条复核，证据见 `## Implementation Status`。

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | 编码格式 | owner | resolved | **`SUP-0001`（组织内序号、不带年份）**（2026-09-24 业主确认） |
| Q-002 | 表单行为 | owner | resolved | **新建隐藏、编辑只读**（2026-09-24 业主确认） |

## Changelog

| Date | Change |
|---|---|
| 2026-09-24 | Initial draft；Q-001/Q-002 经业主确认后按推荐项定稿（`SUP-####`、新建隐藏+编辑只读） |
| 2026-09-24 | **Phase 1–2 实施完成 → `Implemented and verified`**。落地：`supplierCreateSchema.code` 放宽为可选；`commands/suppliers.ts` 新增 `nextSupplierCode`（含软删行取最大序号 +1）与 `createSupplierRow`（显式码 1 次尝试 / 发号码有界重试 ≤5，每次 `em.fork()`），本地 `isUniqueViolation` 换成共享实现；`SupplierForm` 按 mode 生成字段（新建隐藏、编辑只读 + 说明）、`buildSupplierPayload` 空白码不下发；新增集成 `supplier-code-issuance.spec.ts`。验证：`yarn typecheck` 0 error、`yarn ds:check` 697 文件、`yarn test src/modules/purchasing` 25 测试、集成 4/4 绿、浏览器实测（新建页无编码字段、真实表单保存得 `SUP-0018`、编辑页 `readOnly`）。无 schema 变更、无迁移 |
