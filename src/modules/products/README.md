# `products` — 商品主数据（产品线 / 产品品类树 / 三档价格 / 变体）

app 自有模块。业务商品主数据的**唯一来源**：产品线 → 产品品类树 → 产品（出口/包装/锂电/认证字段）→
三档价格（成本价 / 内部结算价 / 对外销售价）→ 变体 / SKU（可售可入库的最小单位）。**外购、自产、委托加工的商品在同一个库、同一条流程里建档**：货源不同只影响「品牌 / 型号 / 成本价」怎么填，不影响后面的单据链路。官方 `catalog`
保持启用，只作平台级商品注册表，经 `products_products.catalog_product_id` 可选链接。需求见
[`.ai/specs/2026-09-22-products-and-trade-docs.md`](../../../.ai/specs/2026-09-22-products-and-trade-docs.md)、
[`.ai/specs/2026-09-22-product-variants.md`](../../../.ai/specs/2026-09-22-product-variants.md)，
业务归属见 [`docs/dev/business-architecture.md`](../../../docs/dev/business-architecture.md)。

**术语（2026-09-23 定名，只改显示名）**：

| 界面名 | 实体 / 表 | 是什么 |
|---|---|---|
| **产品线** | `ProductsType` / `products_types` | 平铺的产品族标签（智能饮水机 / 智能喂食器 / …），用于筛选与统计；**不含层级、不接行为** |
| **产品品类** | `ProductsCategory` / `products_categories` | 可多级分类树（宠物 → 饮水机 → 无线饮水机）；产品按它归类，本模块**唯一**的层级 |

表名 / API 路径（`/api/products/types`、`/api/products/categories`）/ 命令 id / feature id / 事件 id 仍是 `types` / `categories`，**未改名**（改名会牵连 `sourcing` 按 code 查品类与已存 ACL）；定名依据与"类型为什么不建树"见 [`.ai/specs/2026-09-23-product-taxonomy-consolidation.md`](../../../.ai/specs/2026-09-23-product-taxonomy-consolidation.md)。

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
| API | `GET|POST|PUT|DELETE /api/products/items`、`/types`、`/categories`；`POST /api/products/items/distribute`（分发到其它组织，幂等）；`GET /api/products/items/{id}`（产品 + 变体）；`GET|PUT|POST /api/products/prices`（整组价格替换；`POST` 与 `PUT` 同一 `products.prices.replace` 动作）；`GET /api/products/variants/options`（SKU 选择器数据源） |
| 命令 | `products.types.{create,update,delete}`、`products.categories.{create,update,delete}`、`products.items.{create,update,delete}`（变体随产品一起写入）、`products.items.distribute`（跨组织分发副本）、`products.prices.replace` |
| 后台页面 | `/backend/products/items`（列表/新建/编辑，含三档价格行与变体步）、`/backend/products/taxonomy`（**产品分类**：产品品类树 + 产品线两个页签）；`/backend/products/types` 与 `/backend/products/categories` 是同一页的旧入口（`navHidden`，各自渲染对应页签），create/edit 页仍在原路径且全部 `navHidden` |
| 事件 | `products.item.{created,updated,deleted}`、`products.type.*`、`products.category.*`、`products.prices.updated` |
| 权限 | `products.items.view|manage`、`products.types.manage`、`products.categories.manage`、`products.prices.manage`（变体继承 `products.items.*`，不新增 feature） |
| 种子 | `seedDefaults` 幂等写入五条产品线（fountain / feeder / litter_box / camera / accessory），只插不改 |
| 迁移 | `migrations/Migration*_products.ts`（`yarn db:generate` 生成，审阅后应用） |

## 分类页面（产品分类，2026-09-23 合并，REQ-001…007）

两个分类入口合并成一个页面 `/backend/products/taxonomy`（界面名**产品分类**），页内两个页签——**产品品类**（默认）与**产品线**；
页签状态进 URL（`?tab=lines`），旧入口 `/backend/products/types`、`/backend/products/categories` 仍是已注册路由（`navHidden`），
**直接渲染同一组件并锁定对应页签**，挂载后把 URL 规范化成 `/backend/products/taxonomy[?tab=lines]`（保留其余查询参数，含
`?flash=`），因此已发出的通知/收藏链接不会断、也不会丢保存提示（不做 `null` 删路由，见
[`.ai/lessons/module-override-page-hide-needs-routes-domain.md`](../../../.ai/lessons/module-override-page-hide-needs-routes-domain.md)）。

- **产品品类页签是真树**：`lib/categoryRows.ts` 的 `buildCategoryTree`（扁平 `tree_path` 列表 → 根 + 子桶；父级缺失或成环的行留在根）与
  `flattenCategoryTree`（深度优先展开、折叠隐藏整枝）都是纯函数，`lib/__tests__/categoryRows.test.ts` 覆盖；表格仍是 `DataTable`
  （名称列承载缩进与折叠箭头，`层级路径` 保留为次要列，原先的「上级品类」列在树里冗余已去掉）。
  **有意不用 `DataTable` 自带的 `getSubRows` 展开**：它的展开状态在行模型变化时会被重置，既无法默认全开，也会把运营刚展开的枝收回。
- **行内「新增子类」**跳到 `/backend/products/categories/create?parentId=<id>`，创建表单把该 id 作为「上级品类」初值（可改可清空，
  命令仍校验父级可见性与成环）。
- **两个页签都带「组织」列，且列表随顶栏所选组织收窄**（`organizationId` 查询参数）：读展开到下级组织、写只作用于所选组织，
  所以选定具体组织时列表只显示本组织、可保存的行；顶栏选「所有组织」时改为**只读总览**——每行用「组织」列标注所属组织
  （`products.taxonomy.scope.allOrganizationsReadOnly` 说明为什么不能编辑），不再出现"看起来重复、点开却保存不了"的行。
  列表项因此新增 `organizationId` 字段（additive，`products/{types,categories}` 的 GET 响应）。
- **create/edit 页全部 `navHidden`**（`items`/`types`/`categories` 的 create 与 edit）：框架按 href 前缀把列表下的子路由挂进侧栏，
  漏掉 `navHidden` 就会多出「新建…」侧栏项，见 [`create-page-under-list-becomes-sidebar-child.md`](../../../.ai/lessons/create-page-under-list-becomes-sidebar-child.md)。
- **未动契约面**：表名 / `code` / API 路径 / 命令 id / feature id / 事件 id / create-edit 路径全部不变；数据模型不变（产品线保持平铺）。
  设计依据见 [`.ai/specs/2026-09-23-product-taxonomy-consolidation.md`](../../../.ai/specs/2026-09-23-product-taxonomy-consolidation.md)。

## 产品表单的分步与字段收敛（REQ-015）

表单是四步：**① 基本信息 → ② 出口/包装/锂电 → ③ 三档价格 → ④ 变体/SKU**。切换步骤不丢输入，一次提交保存整条记录；
服务端校验失败时表单会跳到出错字段所在的那一步（`rows.*` → 价格步，`variants.*` → 变体步）。

**箱规只留「每箱数量」**（2026-09-23 业主口径「采购只看单件数据」）：整箱毛重/净重与箱规尺寸已从实体、validator、
命令、API 投影、表单与 i18n 里一并删除，单件净重/毛重/产品尺寸（`dimensions`，卡片标题即「产品尺寸」）与 `carton_quantity`（每箱数量）保留；箱规分组
因此只剩「装箱」一张单字段卡。`lib/supplierMapping.ts` 的字段契约（`sourcing` 报价提升与 `purchasing`
同步共用）同步去掉这三个键，两边只停止供给与读取。

**体积（`volume`，2026-09-24）**：产品库的单件体积（`unit_volume`，cm³）在同步时写到商品主数据的 `volume`
（`numeric(16,0)`，界面名「体积（cm³）」，落在「出口与包装」卡；整数 cm³，所以显示 `88642` 而不是 `88642.000000`，小数进不来——validator 按列 scale 拒绝）。它是**记录**字段：不由 `dimensions` 推算
（供应商印的数不能被静默重算），目前也没有读取方——运费询价是预期消费方，那套按 m³/CBM 计费，读取时再换算。
`lib/supplierMapping.ts` 的契约新增 `volume` 键，报价行侧声明为 `null`（报价层没有体积列）。

步骤层的形状（2026-09-23 重排，只动 UI）：

- **步骤条**是 DS 的 `StepIndicator`（编号、逐步可点、出错步标红），放在 `CrudForm` 的 `contentHeader`，
  所以它在页面标题与保存按钮之下、表单内容之上；`上一步/下一步` 是每一步最后一个 `bare` 分组，
  长步骤（出口/包装/锂电有五张卡）填完最后一张时按钮就在眼前，不必滚回顶部。
- **一步占满整行**：`groupsForStep` 每次只渲染一步，因此没有任何分组再声明 `column: 2`——
  整步都是侧栏分组时，`CrudForm` 会把内容画进 `3fr` 侧栏、左侧 `7fr` 留空。
- **必填按步生效**：`scopeRequiredToStep` 只把字段标成必填在它所属的那一步。跨步提交因此会走到 API，
  400 的 `path` 让表单跳到该步并把消息挂到字段上；否则 `CrudForm` 的客户端必填拦截会在看不见的字段上触发，
  只弹一句「请修正标红的字段」而页面上没有任何标红。
- **自绘区块共用一个卡片外壳**（`ProductFormCard`）：产品尺寸、官方目录链接、三档价格
  都是 `bare` 分组（组件自己画卡片），外壳统一后它们的边框、内边距与标题样式与 `CrudForm` 的普通分组一致。

**`lib/formLayout.ts` 是唯一的「显示哪些字段/放在哪一步」的位置**：字段白名单、分组归属、字段→步骤映射都在这里，
改字段不用动 `CrudForm`、命令或 API。API 契约仍是完整 schema——别的集成写入的字段不会因为"不在表单上"而被拒绝。

**`lib/variantFields.ts` 是变体字段的唯一白名单**：表单按这份列表渲染 SKU 行（`Record<ProductVariantFormField, …>`
保证漏画一个字段就编译不过）。评审时新增一个 SKU 字段 = 实体加列 + 迁移 + `data/validators.ts` 加键 + 这个文件加一项；
其余未定字段先放 `products_variants.attributes`（jsonb）。

## 官方目录链接（选填，收货必需）

`基本/出口步` 上的「官方目录链接」指向官方 `catalog_products`（只读选择器，仅调用其列表 API，不引用其组件或实体）。
选择器对**已保存**的链接值走 `resolveCatalogLinkLabel(id)`（`/api/catalog/products?id=` → `catalogLinkLabel`，
与选项列表同一个 `SKU — title` 形状）；否则编辑一个带链接的商品时，字段里显示的是裸 uuid（2026-09-29 修正；
教训见 [`.ai/lessons/preselected-picker-value-needs-a-label-resolver.md`](../../../.ai/lessons/preselected-picker-value-needs-a-label-resolver.md)）。
它不是装饰：**发货与海外仓收货按商品变体入账**（`wms.inventory.receive`），变体经官方目录解析，
所以没链接的商品只能下单、不能发运/收货（分摊命令会明确报错）。链接可清空；指向不存在/跨组织的目录商品会被 400 拒绝。

**目录行从哪来（2026-09-28 查清并已落地）**：官方目录的商品/分类页在 `src/modules.ts` 里是 **`navHidden: true`**（不是 `null`）--
**不进侧边栏，但 URL 仍可解析**：实测 `/backend/catalog/products` 与 `/backend/catalog/products/create` 均 **200**（`/backend/catalog/variants` 该路径不存在 → 404）。之所以用 `navHidden`：`catalog.product.low_stock` 通知的
`linkHref` 指向 `/backend/catalog/products/{id}`，摘除路由会打断已存链接。供应商产品的 `promote` 只写商品主数据、
**不建目录行**（`supplierProductPromotion.ts`：主数据带链接、链接本身不由它创建）。因此目录行有三条路：
① 打开被隐藏的 `/backend/catalog/products/create` 直接建（页面含 **Variants** 步骤，变体才是收货的落点）；
② 调 API（`POST /api/catalog/products` + `POST /api/catalog/variants`）；
③ app 侧按 SKU 镜像建行 + 回填链接。
**本部署已按 ③ 完成（2026-09-28）**：5 件正式商品 P4108 / P4108-UVC / P4114 / P4161 / P570 各建 1 条目录商品
（`title` = 商品名、`sku` = 商品 SKU、`defaultUnit: pc`）+ 1 个默认启用变体（`<sku>-V`）并回填 `catalogProductId`；
实测以 `hq-operator` 账号选 P4161 建报价单 → 行 `productVariantId` 自动填 `e248edbf-…`（该变体）✓。
**重复商品口径与清理（2026-09-28 已执行）**：`eversweet-3-pro` / `eversweet-3-pro-uvc` 与
`P4108` / `P4108-UVC` 是同一件商品的重复行（前者无规格、后者有完整申报要素），**以 P 码为准**：
6 行重复（总部 2 + 俄罗斯 2 + 东南亚 2，后者是分发副本）已**软删除**，未镜像进目录；`eversweet-*` 不再出现在
任何商品列表与选品器里。唯一受影响的引用：一张**无编号的采购草稿单**的行仍挂着被删的 `eversweet-3-pro-uvc`——
该行的显示走它自己冻结的 `product_snapshot`（采购单行的既有口径），重新编辑该行时重新选品即可；
采购单行接口是只读投影（`/api/purchasing/purchase-orders/lines` 只有 GET），改引用要走订单更新命令，故未代改。

## 商品 SKU 的校验与「祖父条款」（2026-09-24）

`products_products.sku` 的字符集/长度规则是 `^[A-Za-z0-9._\-/]{1,64}$`（`data/validators.ts` 的 `SKU_PATTERN`）。
**创建**走严格校验；**更新**只在 SKU 真的变化时校验 —— 未变化的 SKU 不再重新校验，因为库里存在历史遗留编码
（PetKit 时期的货号等），把规则套到它们身上会让那一行**连改名字都存不下去**。变化时仍然严格校验字符集与唯一性
（唯一性含软删行）。规则与理由：`.ai/specs/2026-09-24-supplier-product-code-rules.md`（REQ-PC-009）。
列表搜索除 sku/名称/型号外，还会命中 `product_codes_aliases` 里登记的**旧码**（改用规范编码时写入），
所以单据上印的旧编码仍能找到对应的商品。

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

## 商品分发到分公司（2026-09-28）

商品主数据是**组织级私有**，而分公司（俄罗斯/东南亚）要对外销售就得在自己组织里有商品行。本模块新增一条
**幂等的分发命令**把总部的商品复制进目标组织（spec：[`.ai/specs/2026-09-28-product-distribution-to-branches.md`](../../../.ai/specs/2026-09-28-product-distribution-to-branches.md)）：

| 层 | 内容 |
|---|---|
| 入口 | `/backend/products/items` 的**行操作**「分发到分公司」（该商品）与**表头按钮**「分发到分公司」（本组织全部在售商品）→ 对话框：目标组织多选（来源 = 顶栏组织切换器 payload 的 `selectable` 节点 − 当前组织）+ 结果摘要（`New N · updated M`，跳过项逐条列出）。**可见性**：这两个入口与「新建/编辑/删除」一并按 `products.items.manage` 显示（`hasFeature(chrome payload)`，与 `purchasing` 供应商库同一写法）——只有 `products.items.view` 的账号（如分公司业务员看自己那 9 行副本）只看到只读列表与导出，服务端仍是最终门禁 |
| API | `POST /api/products/items/distribute`（`products.items.manage`）：`{ productIds?: uuid[]（≤200）, organizationIds: uuid[]（1..50） }` → `{ created, updated, skipped: [{ sku, organizationId, reason }] }`（200） |
| 命令 | `products.items.distribute`（`isUndoable: false`，与 `purchasing.supplier-products.promote-batch` 同口径：批量 fan-out 的撤销靠目标组织内删除，审计仍记录命令与载荷） |
| 列 | `products_products.source_product_id`（可空，外键 → 自身 `on delete set null`，索引 `(organization_id, tenant_id, source_product_id)`）；列表/详情投影出 `sourceProductId` |

**分发规则（有意为之）**：

- **副本 = 字段白名单 + 变体 + 首次价格**：字段逐项列出（`lib/distribution.ts`），**不**复制 `typeId`/`categoryId`
  （来源组织的分类树）、`catalogProductId`/`catalogSnapshot`（来源组织的官方目录行）、`notes`；变体按 `code` upsert
  （不删除目标侧新增的变体）；价格**只在首次创建时**复制——此后价格归目标组织自管，重复分发不回写（避免悄悄改分公司的对外销售价）。
- **幂等靠来源链接**：命中 `source_product_id` 的行走**更新**；同 SKU 但无链接（对方自建）→ `skipped: sku_taken`，
  不覆盖、不中断其余商品；来源组织自身永远不会被写入。
- **安全**：来源 = 会话所选组织（`ensureScope`）；每个目标组织逐个对命令上下文的 `ctx.organizationIds`
  （ACL 展开后的可写组织集，`null` = 不受限角色）校验，越界 **403 且零写入**（校验先于任何写）。
- **不传播删除、不做自动同步**：总部删除/停用不会影响副本；同步是显式动作（可重复执行）。
- **分类/产品线不随分发复制**（非目标）：副本的 `typeId`/`categoryId` 为空，需要时另立项。

## 规则（有意为之）

- **产品品类树的层级列是推导值**：`root_id` / `tree_path` / `depth` / `ancestor_ids` / `child_ids` /
  `descendant_ids` 由 `lib/categoryTree.ts` 在每次品类写入后重算，读取端不做递归查询；
  把品类挂到自身或自己的后代下 → **422** 且不改数据。
- **SKU 与 code 的组织内唯一包含软删行**：数据库唯一约束不排除 `deleted_at`，查重必须一起查已删记录，
  否则用户会遇到 500 而不是可读的 409。
- **三档价格是固定码**（`lib/tiers.ts`）：`purchase` / `internal` / `export`，不走官方 price kind 表；
  价格整组提交（`products.prices.replace`），缺失行**停用**而非删除，历史单据的快照仍可解释。
- **币种必须来自币种字典**，且**要求大写三字母**：唯一键含 `currency_code`，同时接受 `cny` 与 `CNY`
  会让同一档价格出现两条。
- **单位读 app 自有的单位字典**：产品表单的「单位」是 `supplier_product_unit` 字典（`lib/unitOptions.ts`，字典由 `purchasing/setup.ts` 播种）
  的下拉，与供应商产品库、合同行同一份词表；字典条目只写显示名（`件`），选择器渲染成 `PCS — 件`
  （码在前，因为记录里存的是码；见 `docs/dev/i18n.md`）。官方 `catalog` 自带的小写 `unit` 字典是给目录定价用的
  工程单位表，**有意不读**。记录里已有的、字典未收录的编码会作为该记录自己的选项并入（`withCurrentUnit`），
  不会因打开表单被清空；要新增单位先在「字典库」里加一条。产品尺寸里的 `dimensions.unit`（如 `cm`）走
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
# 冒烟（dev server 在跑时）：产品线 201 → 产品品类 A/B/C（treePath=A/B/C）→ 产品 201 → 三档价格 200；
# 变体：带 2 个 SKU（其中 1 个默认）的 PUT 200 → GET /api/products/items/{id} 回读一致；
#      去掉一行再 PUT → 该行 deleted_at 有值且编码仍被占用（重开同码 409）；重复编码/两个默认 400；
#      GET /api/products/variants/options?productId=… 返回「产品名 · 编码 — 名称」；
# 停用态不入默认列表；无权限 403；跨组织 404；旧 updatedAt 409（只改变体也会 409）
# 分发：HQ 建商品（含变体 + 一档价）→ 行操作/表头「分发到分公司」→ 选下级组织 → 结果 New 1 · updated 0；
#      目标组织列表出现副本且 sourceProductId 指向来源、价格随首次复制；再分发 → updated 1 且行数不变、价格不变；
#      目标已自建同 SKU → 该 SKU 进 skipped（sku_taken），其余照常；分公司令牌分发到上级组织 → 403 且零写入；
#      分公司行选品器（/backend/internal-sales/quotes/create）能选到副本
# 分类页：/backend/products/taxonomy 两个页签可切换（URL 带 ?tab=lines）；/backend/products/types 与 /categories 落到对应页签；
#        侧栏「商品主数据」只有 产品 / 产品分类（无 create 子项）；
#        品类树默认展开、折叠隐藏整枝、键盘（Tab+Enter）可切换；行「新增子类」预填上级并创建成功；
#        两个页签都只显示当前所选组织，切组织即切换列表
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
