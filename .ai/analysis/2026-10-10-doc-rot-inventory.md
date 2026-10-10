# Catalog cut — 文档腐化清单（Phase 3 的作业单）

**Date**: 2026-10-10
**Source**: DocRotScout（只读扫描，12 份文档逐行对照 2026-10-10 的「catalog 单一商品存储」口径；71 条 stale + 10 条缺失叙述）
**Used by**: `.ai/specs/2026-10-10-catalog-single-store.md` Phase 3（文档收尾）。Phase 0 已处理其中 `business-architecture.md`、`docs/README.md`、`docs/dev/README.md` 三份。

> 口径：catalog = 唯一商品存储（products_* 五表退役）、产品线/自建品类树移除、SKU 手填 + 发号器停用（保留旧码别名）、
> 供应商产品库指针 → `catalog_product_id`、公司订单为订单链根。`[需定]` 标记新口径中尚未在代码里定稿的部分。

## 1. docs/prd/cross-border-erp.md（20 条）

| 行号 | 现在的写法（摘录） | 新逻辑下应该怎么写 |
|---|---|---|
| 22 | 三条链…**采购链**（采购单→定金/尾款→…） | 三条链的起点改为**公司订单**：公司订单 → 采购/对内对外销售/合同/发运/单证 → 收汇退税 |
| 30 | 不复建…（**商品主数据改为自建 `products`**） | 商品主数据沿用官方 `catalog` 单一存储（`products` 模块退役），app 只自绘界面 |
| 77 | ### E. products + trade_docs（产品主数据与购销合同） | 标题与正文改为 catalog + trade_docs |
| 81 | E-1 产品主数据自建：产品线、产品品类树、可选链接 `catalog_product_id` | 商品/变体/类别/价格/自定义字段全在 catalog；产品线与自建品类树取消；指针成为唯一归属；SKU 手填 |
| 82 | E-2 三档价格…一次提交整组价格 | 三档价改 catalog 价格模型（价格类型×币种×起订量），`products_prices` 退役 |
| 86 | E-8 行引用自建商品（含官方目录变体桥接） | 行直接引用 catalog 商品/变体，删除「桥接」 |
| 87 | E-7 官方 catalog 页面隐藏；无官方目录链接可下单但不可发运 | catalog 页面仍不出导航，但数据即唯一存储；「目录链接」前置校验删除 |
| 89 | E-9 `products_variants`…切换到自建变体延后到 wms 轮 | 变体在 catalog；SKU 手填；发运/收货直接用 catalog 变体，wms 轮不再存在 |
| 90 | E-10 发运/收货仍要求一张采购单 + 商品的官方目录链接 | 改为「一张采购单 + catalog 商品即可发运/收货」 |
| 97 | F-1 行含「派生 SKU」 | 派生 SKU 仅供报价/别名；商品 SKU 一律手填 |
| 100 | F-4 …与本组织现有 `purchase` 价比对 | 比价对象改 catalog 价格档；「未建档」指向 catalog 无对应商品 |
| 102 | F-6 提升按 SKU 建/改商品、合并 purchase 档、按分类横幅建类别 | 提升写 catalog 商品+价格；分类横幅不再建自建树节点 |
| 110/112 | G-1 parties…；G-3 行引用自建商品并自动桥接官方目录变体 | G-3 改：行引用 catalog 商品/变体，删除桥接 |
| 126 | **状态（2026-09-28）**：逐条证据见… | 更新日期并补 cut 后的重新验收口径 |
| 129 | 一条完整链路…建供应商 → 下采购单 → … | 改为以公司订单为根 |
| 133 | 产品主数据三档价格可取… | 改为「catalog 价格档可取」 |
| 134 | 复核后可提升为商品；提升出的商品带 `purchase` 档价格与 MOQ | 提升目标改 catalog 商品与价格 |
| 148 | Q5 **已答**：`products.items.distribute`（分发副本） | 分发随 products 退役 ⇒ 记作**作废**并挂新口径 `[需定]`（注：本次决策为「保留并在 catalog 上重造」，以 spec 2026-10-10 Q-新1 为准） |

## 2. docs/dev/business-architecture.md（30 条）

**Phase 0 已按新逻辑重写该文件**；下列对照保留作为复查用（重写后仍应逐条确认无残留）。要点：
链路首段前插根（16-17/20-29）；商品主数据行 = catalog 单一存储（38）；编码行 = 已停用（39）；供应商报价论证改引 catalog 价格模型（40）；供应商产品库行保留定位、指针改 catalog（41）；catalog 页面行改写（48）；内部销售选品改 catalog（50）；消费清单删「官方目录链接」行（84）、组织选项行（86，分发保留则改为 catalog 写路径）、directory 校验行（115/117）；数据主源表（139/140/141）；决策表 SKU/变体归属（152）、是否自建目录（153）、自产/委托加工（154）、采购单引用（160）、Q-SPL-001（166）；对齐规则 5（179）；术语表 194/198-204（变体、提升、供应商产品库、同步为商品、关联已有商品、同步字段、官方目录链接）；开放问题 229（wms 轮结案）；231（分发）；验证方式 238/239。
> 与本次决策的差异：分发副本**保留**（在 catalog 上重造）——不以 scout 推断的「作废」为准。

## 3. docs/dev/architecture.md（8 条）

| 行号 | 现在的写法（摘录） | 新逻辑下应该怎么写 |
|---|---|---|
| 41 | app 自有（16…）：`products`（…）、`product_codes`（…） | 删 `products`/`product_codes`（或降级为弃用壳），模块数改 14+；`catalog` 注明「唯一商品存储」 |
| 47 | `platform_ops`…、`product_codes`（…） | 删 `product_codes`；`catalog` 条目补「官方页面隐藏、由自绘商品库使用」 |
| 60-61 | app 自建了业务面（`products`/…）…ERP 业务模块保持启用 | 业务面列表删 `products`；catalog 数据面 = 唯一商品存储 |
| 74 | 已隐藏的模块：`catalog`（8 个页面 + config/catalog） | 保留事实，补「隐藏的是官方 UI，数据由自绘商品库直接读写」 |
| 88-91 | `config/catalog`…本部署没有自有面读它（`catalog_price_kinds` 为空表） | 整段重写：价格词表回到 catalog 价格类型（是否播种/取消隐藏 `[需定]`） |
| 107-110 | **`dictionaries` 是唯一例外**（遮蔽页面体） | 若自有商品库以遮蔽 catalog 页面体实现，此处列为第二处例外 `[需定]` |

## 4. docs/dev/navigation.md（1 条 + 树）

| 行号 | 现在的写法 | 新逻辑下 |
|---|---|---|
| 22 | 基础数据 ─ 商品主数据 / 产品分类 / 编码规则 / 交易对手 / 我方主体 / 字典维护 | 改为 基础数据 ─ **商品库（单入口，自绘）** / 交易对手 / 我方主体 / 字典维护；分类与编码规则页删除 |
| 13 | ├ 采购 ── 采购单 / 供应商 / 供应商产品库 / 供应商报价单 | 结构不变（供应商产品库内容改为挂 catalog 商品；URL 变则同步 `NAV_TREE`） |
| 38-41 | 配置单点真源 `navTree.ts` + `coverage.test.ts` | 裁剪页面后必须同步 `NAV_TREE` / `TREE_EXCLUDED` 与覆盖测试 |

## 5. docs/dev/setup.md（需补写）

- 行 34：补一节「cut 后开发库整体重建」（drop/recreate + `yarn initialize`），无数据迁移。
- 行 88：补一句：cut 会生成 drop `products_*` 的迁移，按「无 back-compat」直接应用。

## 6. docs/dev/multi-company-org-model.md（14 条）

行 41/42/43/79/80/81/87：功能位清单删 `products.*`，改 catalog 系功能位；行 50/88/110：分发副本条目整体改写为单一存储归属口径 `[需定]`；行 70-71：业务面列表删 `products`、catalog 功能位升级为「唯一商品存储的读写门禁」；行 89：收货口径改「仓库 + 库位 + catalog 变体」；行 105：分发实测证据作废/按单一存储重测。

## 7. docs/plans/README.md（9 条）

行 43 核对日期后移；行 54 catalog-eject 决策记录加「被 2026-10-10 cut 覆盖」；行 55 products 部分标退役（trade_docs/internal_sales 仍已实现）；行 56 变体/ wms 轮 → 结案；行 59 供应商产品库追加指针变更阶段；行 61 taxonomy → 已退役；行 65 code-rules → 已停用（迁移不应再用）；行 76 distribution → 依 spec 2026-10-10 Q-新1（保留并重造）；行 92 补 cut 阶段。

## 8. docs/plans/cross-border-erp.md

行 10 目标补根；行 21 审计实测路径（`PUT /api/products/items`）作废或标注历史；行 42 追加 cut 行；**新增「阶段六 catalog 单一存储 cut」**（建/删表、指针、库重建、两套自绘 UI、验收）。

## 9. docs/plans/finance-and-cockpit.md

行 25 依赖清单删 `products`、补 `catalog`；行 30「采购价档」改指 catalog 价格档。

## 10. docs/prd/finance-and-cockpit.md

行 21 端到端链路起点补根（公司订单）；行 28 驾驶舱写口改为「缺口 → 公司订单 + 采购单草稿」；行 54 补「链路以公司订单为根」的前置断言。

## 11. docs/README.md（Phase 0 已补索引）

行 44-47 建议再补一条：跨模块归属变更须同一改动更新「业务架构单一存储归属表 + 约定清单」。

## 12. docs/dev/README.md（Phase 0 已更新）

行 14 `architecture.md` 描述随模块清单更新；行 18 已改为「公司订单为根的链路、商品单一存储归属」；索引已加 `business-conventions.md`。

## 缺失的叙述（放哪份文档）

1. 公司订单为根的整链叙述 → PRD / plans / business-architecture / finance 两份
2. 单一存储归属（catalog 唯一存储 + 两套自绘 UI）→ business-architecture / architecture.md / PRD E 段 / docs README
3. 指针迁移口径（`catalog_product_id`；promote/link/sync-fields 目标）→ business-architecture / PRD E·F / plans 状态板与进度
4. SKU 手填 + 发号器停用 + legacy 别名保留 → business-architecture / PRD E / architecture.md / plans 状态板
5. 产品线/自建品类树移除 → PRD E-1 / navigation.md / plans 状态板
6. 两套自绘 UI 的落点与 URL `[需定：以自有商品库的技术落点为准]` → navigation.md / architecture.md / business-architecture
7. 开发库重建、无迁移、无 back-compat → setup.md / plans
8. 跨组织商品可见性 / 分发处置 `[需定]` → multi-company-org-model.md / business-architecture / PRD Q5
9. wms 轮结案 → business-architecture 开放问题 / PRD E-9 / plans 状态板
10. 约定清单一处汇总 → `docs/dev/business-conventions.md`（Phase 0 已新建）+ `docs/README.md`「状态从哪来」指向它

## 附注（扫描时点的代码状态）

`src/modules.ts` 仍注册 `products`/`product_codes`（`from: '@app'`），catalog 页面仍以 `products_*` 为理由隐藏；`purchasing/data/entities.ts:311-319,630-631` 与 `purchasing/README.md:56-72` 仍是 `product_id` + 目录桥口径——**cut 尚未进入代码**，本清单的「新写法」全是待落地的目标口径。

---

## 本次大改会失效 / 需重写的约定（12 条，来自 ConventionsScout）

| # | 将失效的约定 | 出处 | 后果 |
|---|---|---|---|
| 1 | 「官方 `catalog` 退为可选注册表，自建 `products` 才是唯一真源」 | `docs/dev/business-architecture.md:38,139,153`；`src/modules/products/README.md:3-5,245-248` | 方向反转：catalog 成为唯一商品库，`products_*` 五表退役 |
| 2 | catalog 后台页面全部 `navHidden`（理由是自建 products 才是业务面） | 同上 `:48`；products README:117-126 | catalog 的 products/variants/categories 页需重新可见或被自绘库取代（含 navHidden 覆写撤回） |
| 3 | 「发运/收货要求商品填官方目录链接」 | products README:32,114,204；business-architecture:160,204 | 前置条件改指向 catalog 商品/变体；提示与校验重写 |
| 4 | 内部销售行变体桥 `productVariantId`（缺桥 422） | `src/modules/internal_sales/README.md:228-230,207-212` | 解析源与 422 文案重写；`catalogSnapshot` 语义重定义 |
| 5 | 「收货仍走官方目录桥（本阶段有意为之）」+ wms 轮开放问题 | products README:164-166；business-architecture:229 | 该 deferred 轮即本次大改主体，开放问题关闭 |
| 6 | 采购单行 `product_id` → `products_products`；`catalog_product_id` 仅历史 | business-architecture:160；products-and-trade-docs spec:599 | `purchasing_purchase_order_lines.product_id` 退役，指针统一 `catalog_product_id` |
| 7 | 三条同步动作按 SKU 写 `products_products` 并回填 `product_id` | purchasing README:94；supplier-product-library spec:120-124,180-185 | 写路径目标改 catalog 商品；字段与语义重写 |
| 8 | `product_codes` 三不变量与整条发号链 | product_codes README:8-19；code-rules spec:213-219 | 规则/发号/解析 UI 下线；SKU 手工（唯一性 + 别名表） |
| 9 | 「值一旦发号即冻结」的字典拦截器与 `dictionary_value_in_use` 409 | product_codes README:44-47；code-rules spec:290 | 发号停用后失去判定源：删除或重定义为别名引用判定 |
| 10 | 分发副本命令与白名单（不复制 `catalogProductId`/`catalogSnapshot`） | products README:176-186；multi-company-org-model.md:50 | 依 2026-10-10 决策（Q-新1）：**保留语义、在 catalog 上重造** |
| 11 | `products_*` 五表的自持规则（品类树派生列、三档价、变体替换、SKU 唯一含软删） | products README:136-138,192-195；products-and-trade-docs spec:599 | 规则迁到 catalog 侧字段语义或显式作废 |
| 12 | 「两个主源（products 与 catalog）会造成引用困惑，合同只引用 products」的风险条目 | products-and-trade-docs spec:676 | 单源后关闭，改写为「单库后的引用与快照口径」 |

