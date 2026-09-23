# `products` — 商品主数据（类型 / 类别树 / 三档价格 / 变体）

app 自有模块。业务商品主数据的**唯一来源**：产品类型 → 类别树 → 产品（出口/包装/锂电/认证字段）→
三档价格（成本价 / 内部结算价 / 对外销售价）→ 变体 / SKU（可售可入库的最小单位）。**外购、自产、委托加工的商品在同一个库、同一条流程里建档**：货源不同只影响「品牌 / 型号 / 成本价」怎么填，不影响后面的单据链路。官方 `catalog`
保持启用，只作平台级商品注册表，经 `products_products.catalog_product_id` 可选链接。需求见
[`.ai/specs/2026-09-22-products-and-trade-docs.md`](../../../.ai/specs/2026-09-22-products-and-trade-docs.md)、
[`.ai/specs/2026-09-22-product-variants.md`](../../../.ai/specs/2026-09-22-product-variants.md)，
业务归属见 [`docs/dev/business-architecture.md`](../../../docs/dev/business-architecture.md)。

## 货源（外购 / 自产 / 委托加工）

**一个商品库，不分两套表**：货从哪来只体现在三个字段的填法上，不新增字段、不新增流程。

| 字段 | 外购（品牌方 / 代理商） | 自产 / 委托加工 |
|---|---|---|
| `brand` 品牌 | 品牌方（如 Petkit） | 自有品牌；没有就留空 |
| `manufacturer_model` 型号 | 品牌方型号（如 `W5C`） | 工厂型号或自有型号 |
| `purchase` 档价格（界面标签「成本价」） | 付给供应商的采购价 | 生产成本 / 加工费 |

品牌**没有默认值**：`brand` 的库默认值、validator 默认值、表单默认值都已去掉，留空就是留空——自产商品不会被系统悄悄标成 Petkit 的品牌。

规则的边界（有意为之）：
- **发运与海外仓收货仍要求商品填「官方目录链接」**（库存按 catalog 变体入账），自产商品也一样；不填就只能下单。
- **要发运/收货就必须有采购单**：`cross_border` 的发运分摊锚在采购单行上，自产/委托加工商品同样要开一张采购单（把工厂建成供应商即可）。本轮不为自产单独开一条非采购入库链路——业务确认「走系统原流程」。
- **不做生产制造**：没有 BOM、工单、工序、成本核算；自产的成本只是 `purchase` 档上的一个参考价。

## 表面

| 层 | 内容 |
|---|---|
| 实体（`data/entities.ts`） | `ProductsType` / `ProductsCategory` / `ProductsProduct` / `ProductsPrice` / `ProductsVariant` → 表 `products_types` / `products_categories` / `products_products` / `products_prices` / `products_variants` |
| API | `GET|POST|PUT|DELETE /api/products/items`、`/types`、`/categories`；`GET /api/products/items/{id}`（产品 + 变体）；`GET|PUT|POST /api/products/prices`（整组价格替换；`POST` 与 `PUT` 同一 `products.prices.replace` 动作）；`GET /api/products/variants/options`（SKU 选择器数据源） |
| 命令 | `products.types.{create,update,delete}`、`products.categories.{create,update,delete}`、`products.items.{create,update,delete}`（变体随产品一起写入）、`products.prices.replace` |
| 后台页面 | `/backend/products/items`（列表/新建/编辑，含三档价格行与变体步）、`/backend/products/types`、`/backend/products/categories` |
| 事件 | `products.item.{created,updated,deleted}`、`products.type.*`、`products.category.*`、`products.prices.updated` |
| 权限 | `products.items.view|manage`、`products.types.manage`、`products.categories.manage`、`products.prices.manage`（变体继承 `products.items.*`，不新增 feature） |
| 种子 | `seedDefaults` 幂等写入五个产品类型（fountain / feeder / litter_box / camera / accessory），只插不改 |
| 迁移 | `migrations/Migration*_products.ts`（`yarn db:generate` 生成，审阅后应用） |

## 产品表单的分步与字段收敛（REQ-015）

表单是四步：**① 基本信息 → ② 出口/包装/锂电 → ③ 三档价格 → ④ 变体/SKU**。切换步骤不丢输入，一次提交保存整条记录；
服务端校验失败时表单会跳到出错字段所在的那一步（`rows.*` → 价格步，`variants.*` → 变体步）。

步骤层的形状（2026-09-23 重排，只动 UI）：

- **步骤条**是 DS 的 `StepIndicator`（编号、逐步可点、出错步标红），放在 `CrudForm` 的 `contentHeader`，
  所以它在页面标题与保存按钮之下、表单内容之上；`上一步/下一步` 是每一步最后一个 `bare` 分组，
  长步骤（出口/包装/锂电有六张卡）填完最后一张时按钮就在眼前，不必滚回顶部。
- **一步占满整行**：`groupsForStep` 每次只渲染一步，因此没有任何分组再声明 `column: 2`——
  整步都是侧栏分组时，`CrudForm` 会把内容画进 `3fr` 侧栏、左侧 `7fr` 留空。
- **必填按步生效**：`scopeRequiredToStep` 只把字段标成必填在它所属的那一步。跨步提交因此会走到 API，
  400 的 `path` 让表单跳到该步并把消息挂到字段上；否则 `CrudForm` 的客户端必填拦截会在看不见的字段上触发，
  只弹一句「请修正标红的字段」而页面上没有任何标红。
- **自绘区块共用一个卡片外壳**（`ProductFormCard`）：单件尺寸、箱规尺寸、官方目录链接、三档价格
  都是 `bare` 分组（组件自己画卡片），外壳统一后它们的边框、内边距与标题样式与 `CrudForm` 的普通分组一致。

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

`products_variants`（实体 `products:products_variant`，由类名推导）是产品的可售可入库单位：`code`（组织内唯一）、`name`、
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
- **单位读 app 自有的单位字典**：产品表单的「单位」是 `supplier_product_unit` 字典（`lib/unitOptions.ts`，字典由 `purchasing/setup.ts` 播种）
  的下拉，与供应商产品库、合同/发票行同一份词表；官方 `catalog` 自带的小写 `unit` 字典是给目录定价用的
  工程单位表，**有意不读**。记录里已有的、字典未收录的编码会作为该记录自己的选项并入（`withCurrentUnit`），
  不会因打开表单被清空；要新增单位先在「字典库」里加一条。单件/箱规尺寸里的 `dimensions.unit`（如 `cm`）走
  **固定的** `cm/mm/m/in/ft` 下拉——那是工程单位集合、不是公司词表；记录里其它写法仍作为该记录自己的选项保留。
- **供应商映射只有一份**（`lib/supplierMapping.ts`）：报价提升（`sourcing`）与产品库「同步为商品」（`purchasing`）共用同一套「只写非空且变化的值」和「整组价格替换」规则；两个模块各自只负责把自己的单据映射成这套字段，不互相引用内部实现。
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

从 `src/modules.ts` 移除 `{ id: 'products', from: '@app' }` 并 `yarn generate`；表与迁移保留。
迁移只向前：工具链没有 `db:migrate:down`（也没有 `db:reset`），撤销已落库的结构与数据是一次单独、
显式的数据变更（手写反向 SQL 或从备份恢复），本模块不自动化。

## 与官方 `catalog` 的关系

| 关注点 | 结论 |
|---|---|
| 谁是真源 | 业务商品主数据在 `products`；官方 `catalog` 只是平台级注册表 |
| 链接方式 | `products_products.catalog_product_id`（可空）+ `catalog_snapshot`（jsonb），不建 ORM 关联 |
| 官方链路 | `sales` / `purchasing` 仍引用 `catalog_products`；把它们切到本模块是后续独立改动 |
| 是否停用 `catalog` | 本模块不决定；保持启用 |
