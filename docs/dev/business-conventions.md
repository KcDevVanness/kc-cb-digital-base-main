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

---

## 补充清单（全仓扫描，2026-10-10）

第二批来自 `.ai/specs`、`.ai/runs`、`.ai/lessons`、`docs/dev`、`src/modules/*/README.md` 的逐条扫描（ConventionsScout），每条带出处。

### 交互（补充）

| # | 约定 | 来源 |
|---|---|---|
| C-44 | 不可编辑项一律 `disabled` 灰态，**不用 `readOnly`**（`CrudForm` 多数类型不转发 readOnly，number 完全不转发） | `.ai/specs/2026-10-09-company-order-root.md`（REQ-054，2026-10-10） |
| C-45 | 状态的三种呈现：纯状态 = ⋯ 菜单 `ActionsDropdown` 的禁用项；带动作 = `RowActions`；不在 ⋯ 旁另加按钮 | `.ai/lessons/row-state-needs-a-menu-with-disabled-items.md`；order-root spec REQ-057 |
| C-46 | 关联状态**先算后显**：已关联可点直达、未关联置灰、读不到（403/失败）不显示该位、不给错误态 | order-root spec（REQ-053） |
| C-47 | 建档状态筛选走**服务端列条件**（`product_id is null/not null`），不做单页客户端切片，`total`/分页正确 | `.ai/specs/2026-09-22-supplier-product-library.md`（REQ-SPL-018） |
| C-48 | 行编辑器**只有一个**搜索框覆盖多个来源，不做「改从 X 选择」开关 | `.ai/specs/2026-09-21-purchasing-module.md`（2026-09-23 业主 UI review） |
| C-49 | 引用一律「显示名 + 选择器」；UUID 只出现在 API 载荷；草稿单据必须可被搜到 | `.ai/specs/2026-09-24-pi-ci-tax-invoice-documents.md`；`src/modules/order_hub/README.md` |
| C-50 | 日期字段全 app 同一套控件（`CrudForm` `type:'date'` → `DatePicker`），不用原生 `<input type="date">` | `.ai/specs/2026-09-24-supplier-quotation-import.md`（2026-09-24） |
| C-51 | 行编辑器/价格/分摊类分组进**主列**（column 1）；`column:2` 是 3fr 侧栏，只放窄标量组 | `.ai/lessons/crudform-column-two-is-a-sidebar.md` |
| C-52 | 堆叠多行的单元格必须 `truncate:false` + 自身 `whitespace-nowrap`（默认 150px 截断、右对齐无 tooltip） | `.ai/lessons/datatable-cell-truncates-at-150px.md` |
| C-53 | 无状态不渲染徽章（只写「—」的徽章不承载信息） | `src/modules/order_hub/README.md`（owner 复查 2026-10-09） |
| C-54 | 「所有组织」下维护列表 = **只读总览**（保留组织列，不渲染行动作/新增/行点击） | `.ai/lessons/read-expands-writes-are-selected-org.md` |
| C-55 | 选项加载器尊重页大小上限（一次 ≤100），分页读全量，别让超限请求被静默吞掉 | `.ai/runs/2026-10-10-company-order-round10.md` |
| C-56 | 六态齐全（loading/empty/error/conflict/permission/success）+ 键盘提交 + 窄宽无横向溢出 + 亮/暗 + 语义 token | `.ai/specs/2026-09-22-products-and-trade-docs.md`（REQ-011） |
| C-57 | 一页一事；旧别名页只渲染同一组件并保留原 `requireFeatures`（不构成越权入口）；URL 规范化用挂载后 `replace`（302 会丢 `?flash=`） | `.ai/specs/2026-09-23-product-taxonomy-consolidation.md` |

### 流程（补充）

| # | 约定 | 来源 |
|---|---|---|
| C-58 | 一个子单只属于一张公司订单（替换 = **移动**语义）；销售类子单无根时自动建根；关联失败不阻断子单 | `src/modules/order_hub/README.md`；order-root spec |
| C-59 | 报价是谈判文档：未发出/未确认的报价不得下单，非 `confirmed` 订单不得进发运分摊，`canceled` 即锁 | `.ai/specs/2026-09-30-document-status-lifecycle.md` |
| C-60 | 报价 → 订单两条路：**转换**（报价即最终版、就地不可逆）与**载入**（报价保留、可出多张） | `src/modules/internal_sales/README.md`（2026-09-29 owner 确认） |
| C-61 | 合同为主体：发运单/PL/PI/CI 关联合同；合同再以 1:N 关联表挂采购单与销售单 | `.ai/specs/2026-09-29-contract-linked-export-documents.md` |
| C-62 | 公司订单状态 = 4 个模块常量（不建字典）；工作台状态 = 7 个业务阶段；「是否已收款」三态（缺席 = unpaid、显式 null = 清空、有值 = 写入） | order-root spec；`src/modules/order_hub/README.md` |
| C-63 | 回填/批量写 CLI **默认 dry-run**，`--apply` 需 owner 批准；分类不做猜测 | `src/modules/internal_sales/README.md` |
| C-64 | 迁移由 `yarn db:generate` 生成 + 人工审阅 + **提交前问业主**再应用；绝不用迁移当验证 | `.ai/specs/2026-09-24-pi-ci-tax-invoice-documents.md` |

### 金额、编码与快照（补充）

| # | 约定 | 来源 |
|---|---|---|
| C-65 | 金额一律**按币种分组**，绝不跨币种加总 | `src/modules/order_hub/README.md` |
| C-66 | 编号 `<PRE>-<年>-<4位>`，按 `(tenant, organization)` 独立、最大号 +1、四位补零、唯一索引兜底、撞号重试；**草稿不占号、签发才发号** | `.ai/specs/2026-09-24-pi-ci-tax-invoice-documents.md` |
| C-67 | 供应商编码 `SUP-0001`：扫本组织**含软删行**取最大序号 +1、有界重试（≤5）；新建表单不渲染编码字段 | `src/modules/purchasing/README.md`；`.ai/specs/2026-09-24-supplier-code-issuance.md` |
| C-68 | 号一经发出**不再回收**（append-only 台账 + 唯一索引才是真保证）——发号器停用期间原则保留，供重做参照 | `src/modules/product_codes/README.md` |
| C-69 | 关联行冻结快照；对端硬删仍显示冻结值 + 「对端已不存在」 | order-root spec |
| C-70 | 缺席 = `null` 不是 0（缺失显示「—」；无汇率**不显示换算，绝不编数**） | `.ai/specs/2026-09-22-order-file-and-export-finance.md` |
| C-71 | 重复生成 = 新附件 + 指针前移、旧文件保留；我方生成件与上传替换件互相独立 | `.ai/specs/2026-09-24-pi-ci-tax-invoice-documents.md` |
| C-72 | 付款凭证**先建后绑**（先 `record` 拿 id 再上传附件）；上传失败不回滚业务行 | `src/modules/purchasing/README.md` |
| C-73 | 价格组是「替换」不是「补丁」（缺失行停用；故意不加乐观锁） | `src/modules/purchasing/README.md` |
| C-74 | 部分更新不得把「字段缺席」读成「字段清空」（值 / 显式 null / 缺席三态） | `.ai/lessons/partial-update-must-not-clear-absent-fields.md` |

### 权限与作用域（补充）

| # | 约定 | 来源 |
|---|---|---|
| C-75 | 读展开到后代组织、写只作用于**所选组织**；选项源按所选组织显式收窄 | `.ai/lessons/read-expands-writes-are-selected-org.md`；`docs/dev/multi-company-org-model.md` |
| C-76 | 协作组织只能写 `status`/`notes`（服务端白名单，其余 422）；owner-only 动作 403 | `src/modules/order_hub/README.md` |
| C-77 | per-user ACL 是**绝对覆盖**（收窄用户 ACL = 撤销） | `.ai/lessons/per-user-acl-is-an-absolute-override.md` |

### 页面隐藏与导航（补充）

| # | 约定 | 来源 |
|---|---|---|
| C-78 | 挂在列表路由下的 create/edit 页在 **installed 覆写**里 `navHidden:true`（否则成为缩进的侧栏子项）；app 自有页面按列表子项嵌套 | `.ai/lessons/create-page-under-list-becomes-sidebar-child.md`；PI/CI spec |
| C-79 | 按「app 有没有替代面」逐个决定隐藏；无替代面的能力**不隐藏** | `docs/dev/architecture.md`（2026-09-30） |
| C-80 | 组 key = 用户侧边栏偏好键：**只改 label 不改 key**；一个业务角色 = 一个 `pageGroupKey`；排序只在一处声明 | `.ai/lessons/sidebar-group-is-the-role-boundary.md` |

