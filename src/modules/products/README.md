# `products` — 商品主数据（类型 / 类别树 / 三档价格 / 变体）

app 自有模块。业务商品主数据的**唯一来源**：产品类型 → 类别树 → 产品（出口/包装/锂电/认证字段）→
三档价格（采购价 / 内部结算价 / 对外销售价）→ 变体 / SKU（可售可入库的最小单位）。官方 `catalog`
保持启用，只作平台级商品注册表，经 `products_products.catalog_product_id` 可选链接。需求见
[`.ai/specs/2026-09-22-products-and-trade-docs.md`](../../../.ai/specs/2026-09-22-products-and-trade-docs.md)、
[`.ai/specs/2026-09-22-product-variants.md`](../../../.ai/specs/2026-09-22-product-variants.md)，
业务归属见 [`docs/dev/business-architecture.md`](../../../docs/dev/business-architecture.md)。

## 表面

| 层 | 内容 |
|---|---|
| 实体（`data/entities.ts`） | `ProductsType` / `ProductsCategory` / `ProductsProduct` / `ProductsPrice` / `ProductsVariant` → 表 `products_types` / `products_categories` / `products_products` / `products_prices` / `products_variants` |
| API | `GET|POST|PUT|DELETE /api/products/items`、`/types`、`/categories`；`GET /api/products/items/{id}`（产品 + 变体）；`GET|PUT /api/products/prices`（整组价格替换）；`GET /api/products/variants/options`（SKU 选择器数据源） |
| 命令 | `products.types.{create,update,delete}`、`products.categories.{create,update,delete}`、`products.items.{create,update,delete}`（变体随产品一起写入）、`products.prices.replace` |
| 后台页面 | `/backend/products/items`（列表/新建/编辑，含三档价格行与变体步）、`/backend/products/types`、`/backend/products/categories` |
| 事件 | `products.item.{created,updated,deleted}`、`products.type.*`、`products.category.*`、`products.prices.updated` |
| 权限 | `products.items.view|manage`、`products.types.manage`、`products.categories.manage`、`products.prices.manage`（变体继承 `products.items.*`，不新增 feature） |
| 种子 | `seedDefaults` 幂等写入五个产品类型（fountain / feeder / litter_box / camera / accessory），只插不改 |
| 迁移 | `migrations/Migration*_products.ts`（`yarn db:generate` 生成，审阅后应用） |

## 产品表单的分步与字段收敛（REQ-015）

表单是四步：**① 基本信息 → ② 出口/包装/锂电 → ③ 三档价格 → ④ 变体/SKU**。切换步骤不丢输入，一次提交保存整条记录；
服务端校验失败时表单会跳到出错字段所在的那一步（`rows.*` → 价格步，`variants.*` → 变体步）。

**`lib/formLayout.ts` 是唯一的「显示哪些字段/放在哪一步」的位置**：字段白名单、分组归属、字段→步骤映射都在这里，
改字段不用动 `CrudForm`、命令或 API。API 契约仍是完整 schema——别的集成写入的字段不会因为"不在表单上"而被拒绝。

**`lib/variantFields.ts` 是变体字段的唯一白名单**：表单按这份列表渲染 SKU 行（`Record<ProductVariantFormField, …>`
保证漏画一个字段就编译不过）。评审时新增一个 SKU 字段 = 实体加列 + 迁移 + `data/validators.ts` 加键 + 这个文件加一项；
其余未定字段先放 `products_variants.attributes`（jsonb）。

## 官方目录链接（选填，收货必需）

`基本/出口步` 上的「官方目录链接」指向官方 `catalog_products`（只读选择器，仅调用其列表 API，不引用其组件或实体）。
它不是装饰：**发货与海外仓收货按商品变体入账**（`wms.inventory.receive`），变体经官方目录解析，
所以没链接的商品只能下单、不能发运/收货（分摊命令会明确报错）。链接可清空；指向不存在/跨组织的目录商品会被 400 拒绝。

## 变体 / SKU（REQ-V-001…007）

`products_variants`（实体 `products:product_variant`）是产品的可售可入库单位：`code`（组织内唯一）、`name`、
`barcode`、`status`、`is_default`、`attributes`（jsonb，评审前先放未定字段）、`sort_order`，属于产品聚合。

- **随产品一起写**：`POST/PUT /api/products/items` 的 `variants[]` 由 `products.items.create|update` 在**同一个事务**里写入
  （`withAtomicFlush`），不新增命令、不新增 feature——拦截器、审计与索引桥保持不变。
- **替换语义**：提交的 `variants[]` 就是新的全集——带 `id` 的行就地更新，缺的行**软删**（`deleted_at`），
  不属于本产品的 `id` → 400，载荷内重复 `code` → 400，两个 `isDefault` → 400。**省略** `variants` = 不动变体，
  `variants: []` = 全部软删。
- **编码永久占用**：`products_variants_scope_code_uniq` 不含 `deleted_at` 条件，所以删掉的 SKU 仍占用编码
  （写入前查重也会看软删行并给出可读的 409）。要复活请恢复或清理该行，不要换个写法重开。
- **默认变体唯一**：局部唯一索引 `products_variants_default_unique_idx`
  （`on (product_id) where is_default and deleted_at is null`）。因此命令按「先删缺行 → 先写非默认行 → 最后写默认行」
  的顺序落地，事务中途不会出现两行默认。
- **变体写入会推进产品版本**：`updated_at` 是产品乐观锁的版本，只改变体、不改标量的保存也会 +1，
  否则过期表单会通过版本校验并静默替换别人的 SKU 行。
- **读取**：`GET /api/products/items/{id}` 返回 `{ item: { …, updatedAt, variants: [] } }`（表单编辑用，
  **含 `updatedAt`**，否则 `CrudForm` 的版本头会缺失）；列表投影保持单表、不含变体。
- **选择器数据源**：`GET /api/products/variants/options`（`products.items.view`）返回 `{ value, label }`，
  label = `<产品名> · <编码> — <名称>`；支持 `?search=`（code/name/barcode 明文列）、`?ids=`、`?productId=`、
  可选 `?organizationId=`（只允许在可读组织内收窄）。产品已删的变体不再出现。
- **收货仍走官方目录桥**（本阶段有意为之）：把 `wms` / `cross_border` 切到自有变体是后续独立一轮
  （见 spec 的 *Deferred — the wms round*）。

## 规则（有意为之）

- **类别树的层级列是推导值**：`root_id` / `tree_path` / `depth` / `ancestor_ids` / `child_ids` /
  `descendant_ids` 由 `lib/categoryTree.ts` 在每次类别写入后重算，读取端不做递归查询；
  把类别挂到自身或自己的后代下 → **422** 且不改数据。
- **SKU 与 code 的组织内唯一包含软删行**：数据库唯一约束不排除 `deleted_at`，查重必须一起查已删记录，
  否则用户会遇到 500 而不是可读的 409。
- **三档价格是固定码**（`lib/tiers.ts`）：`purchase` / `internal` / `export`，不走官方 price kind 表；
  价格整组提交（`products.prices.replace`），缺失行**停用**而非删除，历史单据的快照仍可解释。
- **币种必须来自币种字典**，且**要求大写三字母**：唯一键含 `currency_code`，同时接受 `cny` 与 `CNY`
  会让同一档价格出现两条。
- **商品被下游引用只存 ID + 快照**：合同/发票行保存 `sku/name/model/spec/unit` 快照，商品改名或删除
  不影响已出单据；本模块不写 `catalog_products`。
- **删除策略与引用**：`types` 被产品引用不可删（422）；`categories` 有子类或被产品引用不可删（422）；
  `items` 软删，被单据引用不影响历史。

## 验证

```bash
yarn generate && yarn typecheck && yarn lint && yarn ds:check
yarn jest --config jest.config.cjs src/modules/products
# 冒烟（dev server 在跑时）：类型 201 → 类别 A/B/C（treePath=A/B/C）→ 产品 201 → 三档价格 200；
# 变体：带 2 个 SKU（其中 1 个默认）的 PUT 200 → GET /api/products/items/{id} 回读一致；
#      去掉一行再 PUT → 该行 deleted_at 有值且编码仍被占用（重开同码 409）；重复编码/两个默认 400；
#      GET /api/products/variants/options?productId=… 返回「产品名 · 编码 — 名称」；
# 停用态不入默认列表；无权限 403；跨组织 404；旧 updatedAt 409（只改变体也会 409）
```

## 回滚

从 `src/modules.ts` 移除 `{ id: 'products', from: '@app' }` 并 `yarn generate`；表与迁移保留
（数据回滚需另行走 `yarn db:migrate:down` 并确认目标库）。

## 与官方 `catalog` 的关系

| 关注点 | 结论 |
|---|---|
| 谁是真源 | 业务商品主数据在 `products`；官方 `catalog` 只是平台级注册表 |
| 链接方式 | `products_products.catalog_product_id`（可空）+ `catalog_snapshot`（jsonb），不建 ORM 关联 |
| 官方链路 | `sales` / `purchasing` 仍引用 `catalog_products`；把它们切到本模块是后续独立改动 |
| 是否停用 `catalog` | 本模块不决定；保持启用 |
