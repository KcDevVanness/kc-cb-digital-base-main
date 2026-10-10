# 业务约定（owner 口径清单）

**放**：业务与产品层**长期有效**的约定——文案语言、字段与数据口径、交互规则、流程规则、产品/货源规则、文档与交付纪律。
每条一行，带**来源**（owner 原话、spec、模块 README、lesson 或代码注释）。

**不放**：一次性的实现细节（→ 各模块 README / spec）、环境与部署（→ `../deploy/`）、踩坑复盘（→ `../pitfalls/`、`.ai/lessons/`）。

> 本文件是「catalog 单一商品存储」大改（`.ai/specs/2026-10-10-catalog-single-store.md`）的 Phase 0 基准之一。
> 后续任何改动先对照本清单；与本清单冲突的方案，要么改方案，要么先改本清单（并注明日期与出处）。

## 文案与语言

| # | 约定 | 来源 |
|---|---|---|
| C-01 | 界面文案**单语言**：不写「中文 English」并排的标签；语言按当前 locale 渲染 | Owner UI review 2026-09-23（`.ai/specs/2026-09-22-supplier-product-library.md` Changelog：库表单曾「标签逐条双语」被判为第二种语言） |
| C-02 | 括号里的拉丁缩写（PO / PI / CI / SQ / PL）算注释、不算第二种语言 | `docs/dev/business-architecture.md`「界面命名口径」（2026-09-28 / PL 2026-09-29） |
| C-03 | 字典/种子标签单语言（显示名本身）；选择器渲染 `CODE — name`（码在前，因为记录存码） | `src/modules/purchasing/README.md`（单位字典行）；`.ai/lessons/unit-pickers-read-the-app-unit-dictionary.md` |
| C-04 | 单据/导出表头这类**没有本地化口子**的接缝，只用英文，不混排中英 | `src/modules/purchasing/README.md`「导出列语言」 |
| C-05 | 生成的文档（合同、XLSX 等）标签在**生成时**按语言解析并冻结 | `.ai/specs/2026-09-22-products-and-trade-docs.md` Changelog（合同文档标题跟随语言，owner 语言规则） |

## 字段与数据口径

| # | 约定 | 来源 |
|---|---|---|
| C-06 | 业务上**没有小数**的字段要收窄列与校验（折扣 = 0–100 整数；体积 = 整数 cm³），四舍五入掉小数是拒绝而不是静默 | `src/modules/purchasing/README.md`（折扣收窄行）+ `.ai/lessons/no-decimals-means-narrow-the-column-scale.md` |
| C-07 | 界面名与字段名可以不同，但必须在代码/README 里注明字段的真实来源（如「产品尺寸」= `inner_packing`，来自供应商表「内箱尺寸」列） | `.ai/specs/2026-09-22-supplier-product-library.md` Changelog（2026-09-23 改名并注明字段不动） |
| C-08 | 编码类字段一律**文本**存储（HS code 带前导零与点分组；SKU 不改大小写）；永不 number | `src/modules/purchasing/components/SupplierProductForm.tsx` help text（HS code 行） |
| C-09 | 金额恒 2 位、单价恒 4 位、HALF_UP；量化走 BigInt 引擎单点，**不用 `toFixed`** | `.ai/specs/2026-09-28-money-scale-2dp-unification.md` |
| C-10 | 单据引用商品 = **标量 id + 冻结快照**；改名/删除不改历史单据 | `src/modules/products/README.md`「商品被下游引用只存 ID + 快照」 |
| C-11 | 编码一经发号**永久占用**（含软删行）；旧码只登记别名、永不重编 | `.ai/specs/2026-09-24-supplier-product-code-rules.md`（REQ-PC-009）；`src/modules/purchasing/README.md` 唯一键行 |
| C-12 | 重量/体积只**照录**不推算（供应商印了才填；单件口径），单位固定（kg / cm³） | `src/modules/purchasing/README.md`（单件物理数据行） |
| C-13 | 「整组替换」语义：价格/变体按整组提交，**载荷里消失的行停用不删**（历史快照仍能自解释） | `src/modules/products/README.md`（价格整组）+ `purchasing_supplier_product_prices` 注释 |
| C-14 | 跨模块引用只存 ID + 快照；禁止跨模块 ORM 关联 | `AGENTS.md`；`docs/dev/business-architecture.md` 对齐规则第 4 条 |

## 交互

| # | 约定 | 来源 |
|---|---|---|
| C-15 | **不能编辑的填写项要变灰**（disabled），不隐藏、不改成只读文本 | Owner 2026-10-10；`src/modules/purchasing/components/SupplierProductForm.tsx`（供应商字段注释） |
| C-16 | 一个搜索框合并两个来源时，**来源放标签第一段**（`本供应商产品库 · …` / `商品库 · …`），描述行留给代价提示 | `.ai/lessons/merged-picker-source-belongs-in-the-label.md`（owner 2026-09-24 反馈） |
| C-17 | 后果要在**选择当时**可见：未建档的行仍可选，但选项上直接写「未建档：建过档才能发运、收货」 | `src/modules/purchasing/README.md`（采购单行选择器的建档标记） |
| C-18 | 行的状态改动用 ⋯ 菜单的**禁用项**表达（该动作不适用时置灰，而不是消失） | `.ai/lessons/row-state-needs-a-menu-with-disabled-items.md` |
| C-19 | 建档/同步类动作的界面文案统一（「建商品档案」），确认框写明这一步的后果与下一步 | `src/modules/purchasing/README.md`（同步为商品行 + 2026-09-23 文案统一） |
| C-20 | 列表默认只读 `active`；停用行立刻离开默认视图，可在同一处一键恢复；停用**什么都不删** | `src/modules/purchasing/README.md`「停用 / 启用」 |
| C-21 | 复杂列**先算后显**（页面加载时一次算好），不在单元格里现算 | `src/modules/purchasing/README.md`（公司订单关联列） |
| C-22 | 页面隐藏用 `navHidden`，**不删路由**（已存通知的 `linkHref` 会断） | `.ai/lessons/module-override-page-hide-needs-routes-domain.md` |
| C-23 | 表单/表格一律平台原语（`CrudForm` / `DataTable` / 共享 API helper / 语义 token），不手写 fetch、`<form>`、`<table>`、硬编码颜色 | `AGENTS.md`；`.ai/guides/backend-ui.md` |
| C-24 | 写路径一律走命令（事件、审计、乐观锁、索引副作用只有一份实现） | `AGENTS.md`；各模块 README |

## 流程与业务逻辑

| # | 约定 | 来源 |
|---|---|---|
| C-25 | **一个销售入口 = 一种贸易类型**：对内固定对内、对外固定对外（类型只读显示） | `.ai/specs/2026-09-29-sales-trade-type-and-line-reuse.md` Changelog（2026-09-30 定稿） |
| C-26 | **公司订单是唯一的订单入口**：工作台每行 = 一张公司订单，详情页关联三类子单（对内销售/对外销售/采购），下游按子单并集只读 + 预填新建 | `.ai/specs/2026-10-09-company-order-root.md`；`docs/dev/navigation.md` |
| C-27 | **根单持有**：属于这笔生意的字段（订单描述、采购负责人、单证槽位）只在根单可写；子单页面只读镜像，「需要修改跳回根单」——后续新字段沿用此规则 | Owner 2026-10-10（`.ai/specs/2026-10-09-company-order-root.md` 第十轮） |
| C-28 | 报价是谈判文档、采购单行价是谈判值，**不被产品库价格自动带出** | `src/modules/purchasing/README.md`（与 Q-P-004 的关系） |
| C-29 | 供应商侧的货品清单与「我们的商品」是两个方向：供应商货号 ≠ 我方 SKU 时**不复制商品档案**，而是建立显式指向 | `src/modules/purchasing/README.md`（关联已有商品行） |
| C-30 | 作用域一律取自会话并 **fail closed**；跨组织 404/422、越界 403 且零写入 | `AGENTS.md`；各模块 `ensureScope` |
| C-31 | 数据主源只有一个：库存账以本系统 `wms` 为准、平台数据只作同步输入、差异进对账不静默覆盖 | `docs/dev/business-architecture.md`「数据主源与同步约定」 |

## 产品与货源

| # | 约定 | 来源 |
|---|---|---|
| C-32 | 外购、自产、委托加工**共用同一套商品与三档价格**（成本价 / 内部结算价 / 对外销售价），货源只影响「品牌 / 型号 / 成本价」怎么填 | `src/modules/products/README.md` §货源（owner 2026-09-23） |
| C-33 | 品牌**没有默认值**——自产商品绝不能被系统悄悄标成供应商品牌 | `src/modules/products/README.md:29` |
| C-34 | 自产/委外仍走系统原流程：**开一张采购单**（工厂建成供应商），发运/收货按变体入账 | `src/modules/products/README.md` §货源（owner 2026-09-23） |
| C-35 | 折扣是**产品级**（同供应商不同货号折扣不同），不是供应商级、不是价格行级 | Owner 2026-09-24（`.ai/specs/2026-09-22-supplier-product-library.md` D10） |
| C-36 | 商品身份、变体、价格、分类以官方 `catalog` 为**唯一存储**；供应商方向的数据住在供应商产品库；两者之间只有一行显式指针 | `.ai/specs/2026-10-10-catalog-single-store.md`（owner 2026-10-10 决策） |
| C-37 | SKU **手填**（组织内唯一、含软删占码）；旧码可搜（别名表）；自动编码是可选能力，重做前不启用 | `.ai/specs/2026-10-10-catalog-single-store.md` Q5 |

## 文档与交付纪律

| # | 约定 | 来源 |
|---|---|---|
| C-38 | `docs/` 给人看、`.ai/` 给 agent 用；每个目录的 `README.md` 是该目录的契约 | `docs/README.md` |
| C-39 | 交付一件事时**同一个改动**更新：spec Status + Changelog、plans 状态板与进度表、受影响 `docs/dev/*`、模块 README | `docs/README.md`「状态从哪来」；`AGENTS.md` |
| C-40 | 写「完成/未完成」必须带可重跑的凭据（file:line、生成物、迁移文件名），不凭记忆 | `docs/README.md`「状态从哪来」 |
| C-41 | 一个工作单元 = 一个 worktree = 一个分支 = 一个 PR；草稿起步、门禁绿才转 ready；AI 提交带 `[AI-Generated]`，运行评论以 🤖 开头 | `AGENTS.md` Delivery Flow |
| C-42 | Linear 是仓库文档的**单向只读镜像**：改内容改仓库再重跑 `scripts/linear-sync`；不删除、不改需求 ID（会留孤儿）；写入必须回读校验 | `docs/dev/linear-sync.md`；`.ai/lessons/orca-linear-writes-need-readback.md` |
| C-43 | 评审清单（`.ai/review-checklist.md`）与 guides 由 harness 生成，不手改；改 harness 走 `yarn mercato agentic:init --update-harness` | `AGENTS.md`「Harness-managed files」 |

---

## 验证方式

1. 清单里的每条都能在其「来源」列指到的文件里找到对应表述；找不到的条目应删除或补写来源。
2. `.ai/specs/2026-10-10-catalog-single-store.md` 的实现与验收逐条对照本清单：**冲突即为缺陷**。
3. 新增约定时：先加一行（含日期与出处），再改代码；不要在代码里留下只在口头存在的规则。
