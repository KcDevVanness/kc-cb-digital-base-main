# products — 自有商品库（数据在官方 `catalog`）

**放**：自有商品库的页面与它的唯一读写层（`lib/store.ts`）：商品的读取/建档/改档/分发，三档价格、变体、业务自定义字段的映射规则。
**不放**：供应商侧货品（→ `purchasing` 的供应商产品库）；商品数据本身（→ 官方 `catalog` 的表）；旧码别名与品牌/类别字典（→ `product_codes`）。

## 数据在哪（2026-10-10 单一存储改造）

商品**没有 app 侧的表**：身份、变体、价格、分类都在官方 `catalog`；本模块只提供自绘界面与 store。
业务字段用 catalog 的**自定义字段**（`ce.ts` 声明、`yarn mercato entities install` 安装；字段集 `product_erp`）：

| app 字段 | 存储 |
|---|---|
| sku / name / unit / status | `catalog_products.sku / title / default_unit / is_active` |
| hsCode / cnCode / countryOfOriginCode | catalog 原生列 |
| netWeight / dimensions | catalog 原生列（`weight_value`、`dimensions`；app 的 `length` ↔ catalog 的 `depth` 双向映射） |
| nameEn / brand / series / manufacturerModel / specSummary / barcode / cartonQuantity / grossWeight / volume / certifications / batteryCapacityMah / batteryWh / notes / sourceProductId | `custom_field_values`（`cf_*` 写入，`product_erp` 字段集） |
| 三档价 `purchase` / `internal` / `export` | `catalog_product_variant_prices` + `catalog_price_kinds`（按 code 幂等建）；价格行带 `starts_at` / `ends_at` 窗口，"消失的行"= `ends_at` 关窗 |
| 变体 | `catalog_product_variants`（`sku` / `name` / `barcode` / `is_default` / `is_active`） |

**身份**：catalog 商品 id 就是 app 的商品 id；catalog 变体 id 就是库存单位。app 不再有第二套身份（旧 `products_products.catalog_product_id` 桥已删除）。

## 单位词表（2026-10-10）

商品的单位是 catalog 的 `default_unit`，而 catalog 的解析器（`catalog/lib/unitResolution.ts`）**只认它自己 `unit` 字典里的码**，并且存的是字典条目的 `value`——所以词表必须是 catalog 字典的子集，否则建档/改档直接 400 `uom.unit_not_found`（实测：19 个集成用例在 `POST /api/products/items` 上全红）。

`lib/unitVocabulary.ts` 是这份词表的唯一定义（11 个海关常用码，`label` 是纯中文名）：

- `PCS` / `CTN` / `BAG`：catalog 没有，由 `products/setup.ts` 的 `ensureCatalogUnitEntries` 幂等补进它的 `unit` 字典（catalog 的字典不存在时一并创建）；
- `set` / `pair` / `box` / `roll` / `kg` / `g` / `m` / `l`：沿用 catalog 已有（小写）拼写——改拼写要么让已存商品的下一次写失败，要么造出 normalized key 冲突的第二条，解析结果就不确定了；
- 词表之外的手输码，要先把码加进 catalog 的 `unit` 字典才能建档。

选品器读的是 app 自己的 `supplier_product_unit` 字典（`lib/unitOptions.ts`，`CODE — 名称` 形状）；两份字典的码一致，所以「选什么就存什么」。已有组织跑 `yarn mercato seed:defaults --module products` 补齐。

## 读写在 `lib/store.ts`

- 写：全部经官方命令（`catalog.products.*` / `catalog.variants.*` / `catalog.prices.*` / `catalog.priceKinds.*`），命令载荷里的 `cf_*` 键带业务字段；事件、审计、索引副作用由官方命令产生。
- 读：scoped Kysely（catalog 表 + `custom_field_values` + `product_codes_aliases` 别名兜底）。
- 导出：`listStoreProducts` / `getStoreProduct` / `findStoreProductBySku` / `listStorePrices`、`createStoreProduct` / `updateStoreProduct` / `deleteStoreProduct` / `createStoreVariant` / `replaceStorePrices`；字段映射 `nativeProductPayload` / `customFieldPayload`。

## catalog 写路径的硬契约（2026-10-10 集成跑测后钉住）

- **SKU 字符集 = catalog 的**（`^[A-Za-z0-9._\-]{1,64}$`，无 `/`）：SKU 同时写进 `catalog_products.sku` 与默认变体的 `sku`，两条 catalog 正则在写路径上拒绝斜杠。sourcing 的 Item No. 清洗把 `/` 换成 `-`（`P4117/1` → `P4117-1`），因为删掉斜杠会把两个不同货号并成一个。
- **变体的 `name` / `barcode` 是「可选字符串」不是「可空字符串」**：catalog 的 schema 只收字符串（`null` → `invalid_type`），GTIN 细则又拒绝出现但为空的 `barcode`（`''`），所以载荷**只有非空才带这两个键**——留空 = 保持原值，清空在本平台契约下无法表达。`lib/store.ts` 的 `variantTextPayload` 是唯一实现。
- **单位必须存在于 catalog 的 `unit` 字典**（见上节）。
- **价行挂在商品的默认变体上**（`variantId` + `productId` 一起发）：catalog 的 `catalog.prices.create` 接受只有 `productId` 的行，但 `catalog.prices.update` 的 scope guard 是**经变体**解析这条行的组织归属的——没有变体时它拿到的组织是空的，命令答 403 `Forbidden`（2026-10-10 实测：于是「消失的行以 `ends_at` 关窗」这条口径从来没生效过，而且半写：本次 PUT 里别的行已经落库）。`lib/store.ts` 的 `resolvePriceVariantId` 是唯一实现（默认启用变体 → 默认变体 → 任意启用变体）；商品没有变体时 422 `product_has_no_variant`（附修法），不留半写。
- **删除商品是硬删**：`catalog.products.delete` 直接移除行（连同变体与价格，`em.remove`），没有软删态——编码随之释放，可被重新建档；单据里的商品快照不受影响，指向它的供应商产品库行按「已关联的商品已删除」显示（`productDeleted`），再存档点「建商品档案」会重新建一个同码商品。要保留档案请用**停用**（`is_active`），那是列表与选择器的常规做法。
- 同伴命令的 zod 失败会被 `summarizePeerFailure` 收成一句可读消息（`catalog rejected the write — barcode: …`），而不是把 issues 数组原样塞进表单错误条；单位不在名单里则答 422 `unit_not_in_catalog_dictionary`（附可执行的修法）。
- 其他模块（`trade_docs`、`finance`、`ru_sync`、`purchasing`、`sourcing`）用它的读函数做跨模块投影——不要直接写 catalog 表。

## 表面

| 表面 | 说明 |
|---|---|
| 后台页面 | `/backend/products/items`（列表/新建/编辑；版式与供应商产品库一致：商品标识 → 商品 SKU 与品牌 → 照片 → 海关与单位 → 价格（三档，整组提交）→ 装箱/重量/体积 → 产品尺寸 → 状态） |
| API | `GET|POST|PUT|DELETE /api/products/items`（列表搜索命中 SKU/名称/别名）、`GET /api/products/items/[id]`、`GET|PUT /api/products/prices`、`GET /api/products/variants/options`、`POST /api/products/items/distribute` |
| 命令 | `products.items.{create,update,delete}`、`products.prices.replace`、`products.items.distribute`（均为 store 之上的薄封装；`isUndoable: false`，撤销由 catalog 自身机制承担） |
| 权限 | `products.items.view|manage`、`products.prices.manage`（页面闸门；写 catalog 命令另需调用方角色具备 catalog 写权限） |
| 分发副本 | `products.items.distribute`：目标组织建 catalog 副本 + 变体，价格仅首次复制，`sourceProductId` 记来源；越界 403 零写入 |

## 已停用 / 已删除（勿再引用）

`products_types`、`products_categories`（含品类树重建）、`products_variants`、`products_prices`、`products_products` 五表与其命令/路由/页面/事件；`product_codes` 的发号规则、台账、生成/解析与字典冻结拦截器。迁移由 `yarn db:generate` 生成（drop），开发库重建，不写数据迁移——见 `.ai/specs/2026-10-10-catalog-single-store.md`。

## 验证方式

```bash
yarn generate && yarn typecheck
yarn test src/modules/products
yarn test:integration:ephemeral            # 含 products 分发/建档链路
# 冒烟：/backend/products/items 新建 → 保存后 DB 回读 catalog_products + 默认变体 + cf_* 值
#       三档价保存 → catalog_product_variant_prices 三行（price_kind code = purchase/internal/export）
#       分发到分公司 → 目标组织出现副本（source_product_id 自定义字段指回来源）
```
