# product_codes — retired code issuance, surviving aliases

**放**：旧码别名（`product_codes_aliases`）与品牌/类别字典的播种。
**不放**：商品身份、价格、变体（→ 官方 `catalog`，经 `products/lib/store.ts`）；供应商侧货品（→ `purchasing`）。

## 这个模块现在是什么

2026-10-10 的「catalog 单一商品存储」大改（`.ai/specs/2026-10-10-catalog-single-store.md`）把
**编码发号机制整体停用**：编码规则（`product_codes_rules`）、append-only 发号台账
（`product_codes_ledger_entries`）、三态解析（`/api/product_codes/parse`）、发号
（`/api/product_codes/generate`）、字典值冻结拦截器与规则后台页全部删除。SKU 现在**手填**
（组织内唯一、含软删占码，由官方 `catalog_products.sku` / `catalog_product_variants.sku` 约束）。

留下的两件事：

| 表面 | 说明 |
|---|---|
| `product_codes_aliases` | 已废弃的旧码 → 目标记录（`target_kind='product'` 指 catalog 商品、`supplier_product` 指产品库行）。单据上印的旧码仍要能搜到：商品列表搜索（`products/lib/store.ts`）与供应商库列表都按它兜底。手写维护，**不重发**。 |
| 字典播种（`setup.ts`） | `product_brand`（品牌）与 `product_category`（类别；同时是公司订单/采购单的「订单描述」码）。`yarn mercato seed:defaults --module product_codes` 幂等、insert-only。 |

## 关键约束

- **不发号、不解析、不冻结**：字典值不再因为「发过号」而不可改——保护对象（台账）已经不在了；
  改一个品牌/类别码只影响以后的显示与录入，不会重写任何已存在的 SKU。
- 别名表**没有反向生成**：没有任何代码路径会从 SKU 推回规则；别名的唯一用途是搜索兜底。
- 旧码表随 `product_codes_aliases` 保留；其余两张表由 `yarn db:generate` 生成删除迁移（开发库重建）。

## 验证方式

```bash
yarn test src/modules/product_codes           # 如仍有单测（当前无）
# 搜索兜底（dev server 在跑时）：给一条 catalog 商品登记别名 → GET /api/products/items?search=<旧码> 命中该商品
# 字典播种：yarn mercato seed:defaults --module product_codes → 重复执行不产生第二份字典
```
