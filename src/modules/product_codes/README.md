# product_codes — 编码规则、发号台账与解析器

本模块负责**一个商品编码是什么、由谁发出、以及怎么读懂它**。它不持有商品数据、不持有供应商数据：
调用方（供应商产品库的表单）拿到编码后自己保存，模块只回答"下一个编号是什么"和"这串字符是什么意思"。

规格：`.ai/specs/2026-09-24-supplier-product-code-rules.md`（Phase 2 = 本模块；Phase 3/4 才是 purchasing 侧的接入）。

## 三个不变量

1. **规则是数据，不是代码。** 段序列、分隔符、序列位数与作用域都存在 `product_codes_rules` 行里，
   所以新增一套编码方案是加一行 + 加两张码表，不是改代码。
2. **号一经发出不再回收。** 发号写进 `product_codes_ledger_entries`（append-only，唯一索引
   `(tenant, organization, code)` 才是真保证），取号撞了就换下一个号重试。行被删掉、或生成后没保存，
   号照样作废 —— 序列面板上能看到这个空洞，这正是"永不复用"的实现方式。
3. **正向生成与反向解析共用同一份规则模型**（`lib/ruleModel.ts`）。解析器走的就是生成器格式化时用的
   段数组，因此拆解结果不可能与系统发出的码不一致。

## 数据模型

| 表 | 作用 |
|---|---|
| `product_codes_rules` | 一条规则：名称、模式（`generate` / `carry_over`）、段序列、分隔符、序列位数与作用域、`enforce`（warn/strict）、启用开关 |
| `product_codes_ledger_entries` | 发号台账：`code` 唯一、`serial`、品牌/类别值、`rule_id`。**台账里有 = 系统发出的**；没有 = 旧码或手工码，无需回填、无需标记列 |
| `product_codes_aliases` | 旧码 → 记录 的映射。只在操作员显式"改用规范编码"时写入，供搜索与单据回溯命中旧码 |

迁移 `Migration20260924034626_product_codes.ts` 只建这三张表，纯新增，未应用到任何库（`yarn db:migrate` 需先批准）。

## 接口

| 方法 | 路径 | 权限 |
|---|---|---|
| GET/POST/PUT/DELETE | `/api/product-codes/rules` | `product_codes.rules.view` / `product_codes.rules.manage` |
| POST | `/api/product-codes/generate` | `product_codes.codes.generate`（`dryRun: true` 只试算不占号） |
| GET | `/api/product-codes/parse?code=` | `product_codes.rules.view` |
| GET | `/api/product-codes/sequences?ruleId=` | `product_codes.rules.view` |
| POST | `/api/product-codes/aliases` | `product_codes.rules.manage` |

命令：`product_codes.rules.create|update|delete`（update/delete 带乐观锁与 undo）、
`product_codes.codes.issue`、`product_codes.aliases.create`。
事件：`product_codes.rule.created|updated|deleted`、`product_codes.code.issued`、`product_codes.alias.created`。

页面：`/backend/product-codes/rules`（列表）、`/rules/create`、`/rules/[id]/edit`（编辑页含试算与发号面板）。

## 码表与"值不可改"

品牌与类别码表是**字典库里的 `product_brand` / `product_category`**（本模块 `setup.ts` 播种，
业务人员在「字典库」页面维护）。因为一条已发出的编码里存的是**值**（`SP`、`CL`），
`commands/interceptors.ts` 拦下字典条目的 `update`/`delete`：值一旦出现在台账里就不能改值、不能删，
只能改显示名或停用 —— 否则所有旧码的含义会被悄悄改写，解析器会把系统自己发过的值报成"未登记"。

## 验证

- 单元：`yarn test src/modules/product_codes`（规则模型、解析三态）。
- 生成：`yarn generate`（页面/路由/事件/权限注册）。
- 迁移：`yarn db:generate`（探针；只审不应用）。
- 门禁：`yarn typecheck`、`yarn lint`、`yarn ds:check`、`yarn build`。

## 回滚

从 `src/modules.ts` 移除 `enabledModules.push({ id: 'product_codes', from: '@app' })` 并 `yarn generate`：
路由与页面消失，三张表留作历史（**台账不要删** —— 它是唯一一份"哪些号已经发出去"的记录）。
