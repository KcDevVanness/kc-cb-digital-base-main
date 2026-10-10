# 2026-10-10 — company-order-round10（根单持有字段 / 采购单明细回退 / 供应商产品库 Excel 导入）

**Source doc:** `.ai/specs/2026-10-09-company-order-root.md` 的「第十轮」节（REQ-040…REQ-046）
**Base:** `origin/dev`（`caa5598`）
**Branch:** `feat/company-order-round10`（worktree `../kc-cb-digital-base-min-co-round10`）
**PR:** #162（draft → ready；截图证据见 PR 评论）

## Goal

owner 2026-10-10 对五个页面的 12 点设计反馈落地；当日问答定下七条口径（见 spec 第十轮「背景」）：

1. **根单持有（通用规则）**：「订单描述」「采购负责人」统一由公司订单持有；关联处只读、修改跳回根单；同类面一并审计。
2. 订单描述字典复用 `product_category`。
3. 预付款/尾款 = **实际口径**（已登记 deposit / balance 阶段合计）。
4. hub 抬头「供应商」：根单优先，空则取采购单。
5. 采购单详情**只撤三个关联区块**（发运单 `?purchaseOrderId=` 过滤保留）。
6. 供应商产品库：现在做 **Excel 上传 + 解析骨架**（AI/PDF 后续）。
7. 迁移生成并**在本地开发库应用**。

逐条对应：

| 反馈 | 落点 |
|---|---|
| hub 抬头新增「订单描述」（item 1） | REQ-040：根单加 `product_category` + 抬头只读格 + 表单选择器 |
| 工作台「金额」→「订单金额」，映射采购单金额（item 2） | REQ-042：列名 + 取值采购优先 |
| hub 采购行显示订单金额 / 预付款 / 尾款（item 3） | REQ-043：采购单列表投影 + hub 批量读 |
| hub 抬头「供应商」锚定采购单（item 4） | REQ-040：根单优先、空则回退采购行 |
| hub 采购区新增「采购负责人」（人员账号，item 5） | REQ-040/041：根单持有 + 采购单镜像只读 |
| 采购单列表列名/新增三列（item 6） | REQ-044 |
| 采购单详情撤三区块（item 7/8/9） | REQ-045 |
| 采购单详情「订单描述/采购负责人」不再单独入口（item 10） | REQ-041：表单去掉两字段、详情只读 + 跳回根单 |
| 供应商产品库预留 AI 导入入口（item 11） | REQ-046：Excel 上传 → 解析 → 复核 → 导入 |
| 采购单列表与工作台互相关联快速跳转（item 12） | REQ-044：行操作「打开公司订单」 |

## Scope

- `order_hub`：根单三列（`product_category`/`owner_user_id`/`owner_snapshot`）+ 迁移、表单两字段、抬头两格与供应商回退、采购行三金额、工作台金额口径、镜像事件发布、i18n/README/单测。
- `purchasing`：列表列与行操作、详情回退三区块与两字段只读、表单去两字段、`paidDeposit`/`paidBalance` 投影、镜像订阅者、供应商产品库 Excel 导入（lib/命令/路由/向导）、i18n/README/测试。
- `sourcing`：仅共享件搬迁的引用更新（`lib/workbook.ts` → `src/lib/workbook`）。
- 共享：`@/lib/workbook`（新）、`@/lib/dictionaries/codeListOptions`（新，由 purchasing 迁出）。
- 文档：spec 第十轮、本 run record、`docs/plans/cross-border-erp.md` 行、`docs/plans/README.md` 状态板、两个模块 README。

## Non-goals

- 不恢复 `order_product_category` 字典；不动 `cross_border` 的 `?purchaseOrderId=` 过滤与集成 spec（owner 口径：只撤 UI 区块）。
- 不做 PDF 与 AI 列映射（导入骨架只到 Excel；入口留扩展位）。
- 不改采购单 create/update 命令契约（字段仍在 schema 内，UI 不再发送）。
- 不做订单树之外其它模块的「重复入口」改造（审计结论：本轮只有采购单两字段同类）。

## Implementation Plan

### Phase 10.A: order_hub 根单字段与显示

- [ ] 1.1 实体/校验/API 三字段 + 迁移
- [ ] 1.2 公司订单表单两字段 + hub 抬头两格 + 供应商回退
- [ ] 1.3 采购行三金额（批量读）+ 工作台「订单金额」采购优先
- [ ] 1.4 镜像事件发布（create/update/links.replace/link-child）

### Phase 10.B: purchasing 台账

- [ ] 2.1 列表列改造 + `paidDeposit`/`paidBalance` 投影
- [ ] 2.2 行操作「打开公司订单」
- [ ] 2.3 详情撤三区块 + 两字段只读 + 跳回根单
- [ ] 2.4 表单去两字段 + 死代码清理 + 镜像订阅者
- [ ] 2.5 README/i18n/测试

### Phase 10.C: 供应商产品库 Excel 导入

- [ ] 3.1 解析库（别名/表头探测/行构建）+ 单测
- [ ] 3.2 命令 + 两个路由（parse/import）
- [ ] 3.3 三步向导 + 列表页入口 + i18n

### Phase 10.D: 收口

- [x] 4.1 迁移在本地开发库应用 + 宽门禁
- [x] 4.2 浏览器实测（五个页面逐点）
- [x] 4.3 文档（spec/README/计划/状态板）
- [x] 4.4 PR draft → ready（#162）

## Risks

- 镜像订阅者写失败 → 采购侧与根单不一致：幂等覆盖写、失败只记日志；采购详情保留跳回根单入口。
- 并发三个切片共享 purchasing 的 i18n/README：由父 agent 合并键与小节，冲突在收口时处理。
- 导入行校验与手填口径不一致：逐行复用 create schema；失败附原因。

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 10.A: order_hub 根单字段与显示

- [x] 1.1 实体/校验/API 三字段 + 迁移（`Migration20261010025411_order_hub.ts`；本地开发库已由 dev supervisor 应用）
- [x] 1.2 公司订单表单两字段 + hub 抬头两格 + 供应商回退（`CompanyOrderForm.tsx` / `OrderDetail.tsx` / `companyOrderDisplay.ts`）
- [x] 1.3 采购行三金额（`?ids=` 批量读，按 100 分页）+ 工作台「订单金额」采购优先（`OrderWorkbench.tsx`）
- [x] 1.4 镜像事件发布（create/update/links.replace/link-child；`events.ts` 声明 `order_hub.company_order.order_fields_updated`）

### Phase 10.B: purchasing 台账

- [x] 2.1 列表列改造 + `paidDeposit`/`paidBalance` 投影（`api/purchase-orders/route.ts` 的 `afterList` + `lib/orderTotals.ts` 的 `stagePaidTotals`）
- [x] 2.2 行操作「打开公司订单」（`PurchaseOrdersTable.tsx`；未关联/403 → 置灰提示）
- [x] 2.3 详情撤三区块 + 两字段只读 + 跳回根单（`PurchaseOrderDetail.tsx`；来源单号回到抬头摘要格）
- [x] 2.4 表单去两字段 + 死代码清理（`purchaseOrderQuickEdit.ts` 删除）+ 镜像订阅者（`subscribers/mirror-root-order-fields.ts`）
- [x] 2.5 README/i18n/测试

### Phase 10.C: 供应商产品库 Excel 导入

- [x] 3.1 解析库（别名/表头探测/行构建）+ 单测（`lib/supplierProductExcelImport/**`）
- [x] 3.2 命令 + 两个路由（`commands/supplierProductImport.ts`、`api/supplier-products/excel-import{,/parse}/route.ts`）
- [x] 3.3 三步向导 + 列表页入口 + i18n（`SupplierProductImportDialog.tsx`；必填列在映射步拦截）

### Phase 10.D: 收口

- [x] 4.1 迁移在本地开发库应用（dev supervisor 启动时 `order_hub: 1 migration applied`）+ 宽门禁
- [x] 4.2 浏览器实测（五个页面逐点，见下）
- [x] 4.3 文档（spec 第十轮 + 状态/Changelog、`order_hub`/`purchasing`/`sourcing` README、计划行 六·补60、状态板、`business-architecture` 决策行、lesson）
- [x] 4.4 PR draft → ready（#162，labels: review / feature / priority-high / risk-medium / qa-self-verified）

### Phase 10.E: 第十轮复查·三（列表行菜单 / 详情单证镜像）

- [x] 5.1 行「⋯」菜单：`purchaseOrderRowActions` + `ActionsDropdown` + 单测 TEST-037 — 9e5a2b3
- [x] 5.2 详情「单证」只读镜像：`rootDocuments` 解析 + `PurchaseOrderDetail` 渲染 + i18n — b96b74d
- [x] 5.3 解析单测 TEST-038 + 组件改用共享解析 — e439973
- [x] 5.4 宽门禁（generate/typecheck/lint/check-lessons/ds:check/test/build）+ 浏览器实测（AC-052…AC-053）
- [x] 5.5 文档：spec 复查·三 + Changelog、本文件、`purchasing`/`order_hub` README、计划行 六·补60、lesson

## Evidence（实现期实测，2026-10-10）

- **宽门禁**（`yarn generate && yarn typecheck && yarn lint && node scripts/check-lessons.mjs && yarn ds:check && yarn test && yarn build`）：全部通过——typecheck 0 error；lint 0 error（12 条既有 warning）；`ds:check` 1106 files passed；`yarn test` **92 suites · 822 tests passed**；`yarn build` 成功（`yarn generate` 277 API paths）。
- **浏览器实测**（dev server 本 worktree，http://localhost:3000）：
  1. `/backend/orders`：列名「订单金额」，`CO-2026-0004` 行 = `¥2,000.00`（采购金额优先）。
  2. `/backend/orders/<id>`：抬头 8 格（订单描述/采购负责人/客户/供应商/是否已收款/…），供应商回退 = `CI E2E supplier mumhx0rr`；采购行 = 订单金额 ¥2,000.00 / 预付款金额 ¥0.00 / 尾款金额 ¥0.00。
  3. 编辑公司订单存「订单描述 = CL — 猫砂、采购负责人 = employee@acme.com」→ hub 抬头回读一致；DB 回读 `PO-2026-0008` 的 `product_category/owner_user_id/owner_snapshot` 已被镜像。
  4. `/backend/purchasing/orders`：列 = 单号/供应商/状态/订单金额/预付款金额/尾款金额/预计交货日期/操作；`PO-2026-0008` 行操作「打开公司订单」→ `/backend/orders/e9ad342f…`；未关联的 `PO-2026-0009` → 置灰「未关联公司订单」（不跳转）。
  5. `/backend/purchasing/orders/<PO-2026-0008>`：无三个关联区块；「订单描述 CL — 猫砂 + 去公司订单修改 → 根单」；编辑页无这两格。
  6. 从根单「新建」采购单（预填来源销售订单）→ 建档后详情 = 「来源销售订单 ORDER-20260929-00007 → /backend/internal-sales/orders/d245512a…」+ 两字段镜像就位；hub 采购行出现该单（三金额 ¥100.00/0.00/0.00）。实测后已「移除」该关联并删除该草稿单，根单回到一张采购单。
  7. `/backend/purchasing/supplier-products`：「Excel 导入」→ 选供应商 + 上传 9 列表 → 表头第 1 行、9/9 列映射（精确 + 别名）→ 预览 → 「成功导入 2 行」；库里 `SMOKE-IMP-SKU-1/2` 字段齐（货号/中英品名/PCS/装箱/MOQ/折扣 5·空）。缺「商品 SKU/品名」的表在映射步被拦（提交禁用 + 提示），接口层同样按行拒绝。
- **实现期自修**：hub 的采购金额批量读原先按 `pageSize: 200` 问（`purchasing/purchase-orders` 上限 100 → 400 被静默吞掉、金额全显示「—」），改为 100 分页并写进 `.ai/lessons/option-loaders-must-respect-page-size-caps.md`。
- **留验（写进 PR Assumptions）**：导入行沿用 create 契约 → `source` 记 `manual`（未扩枚举）；单价列本轮不导入（价格类型 × 币种 × 起订量另有二维）；只读第一个工作表。

## 复查（owner 2026-10-10 复看 5 点）

同一天 owner 复看第十轮交付的 hub 采购区块，提了 5 点；本轮在同一分支/PR 追加（spec 第十轮复查 REQ-047…REQ-050 / AC-043…AC-046）。

| 反馈 | 落地 |
|---|---|
| 行内「编辑」应改「打开详情」（单证/付款记录都在采购单详情页） | 行内动作固定为「打开详情」→ `/backend/purchasing/orders/<id>`（带 `returnTo`）；协作者与所有者同一动作 |
| 所有「移除 / 取消」都要二次确认 | 全 app 审计（`ConfirmAudit` 侦察）：30 个文件 ~34 处**原本已有**确认（表行删除、解绑、停用、取消订单/发运/合同、付款与单证删除、批量状态、附件删除）。本轮补 5 处**落库即生效**的缺口：hub 子单移除（对话框写出单号）、合同盖章件移除、单据替换件移除、报价归档、导入「重建行」（仅当会覆盖已生成的行）。**口径**：表单内尚未保存的行删除不弹窗——保存前不落库，弹窗只会打扰逐行编辑（18 处属此类，已在 spec/PR 披露） |
| 子单状态徽章要按状态区分颜色 | `childStatusAppearance` 返回 `{ label, tone, color }`：采购状态复用导出的 `PURCHASE_ORDER_STATUS_TONES`（与 `PurchaseOrderStatusBadge` 同一份），销售状态用字典色点（与销售列表同一个色），未知码中性 + 原值；单测 TEST-034 |
| 行内新增「定金比例」 | 取自同一批量读的 `depositPercent`，渲染成 `50%` 形状（`numeric(6,3)` 去尾零），无值「—」 |
| 行内新增「备注」 | 同一批量读的 `notes`，单行截断 + `title` 全文，无值「—」 |

**证据**（浏览器实测，主目录合并树 dev server）：行内动作 = 「打开详情」→ `/backend/purchasing/orders/ac8753f3…?returnTo=…`，落点是采购单详情（含 编辑采购单/标记已发运/取消订单）；行 = 「… 已下单 · 订单金额 ¥2,000.00 · 预付款金额 ¥1,000.00 · 尾款金额 ¥0.00 · 定金比例 — · 备注 — · 打开详情 · 移除」，状态徽章 `data-variant="info"`（原 neutral）；点「移除」→ 对话框 = 「移除 / 确定移除关联 PO-2026-0008 吗？/ 取消 确认」，「取消」后行仍在。本库所有采购单都没有定金比例/备注（显示「—」是数据状态，不是兜底）；两张销售子单的 status 为空（无徽章可看），销售色点由单测覆盖。截图见 PR 评论。

## 复查·二（owner 同日再复看 5 点：采购单详情 / 列表 / 编辑页）

| 反馈 | 落地 |
|---|---|
| 详情摘要格缺可填字段（备注等） | 摘要补 定金比例 / 定金金额 / 备注；明细表补「单价含税」列（REQ-051）；新增共享件 `@/lib/orders/depositPercent`（`numeric(6,3)` 去尾零 → `50%`） |
| 被公司订单关联了要有跳转按钮 | 抬头在「编辑采购单」旁给「打开公司订单」→ 根单详情页（REQ-052） |
| 「未关联公司订单」不该先点才出现 | `order_hub/orders/links` 新增 `refIds=` 批量反查（去重/uuid 过滤/上限 200）；列表加载即定状态：已关联＝可点按钮、未关联＝置灰不可点、读不到（403）＝不显示（REQ-053） |
| 不能编辑的填写项要变灰；可填内容要在详情完整显示（其他模块同规则） | 采购单编辑表单的锁定项改用 `disabled`；两格定金是 `number`，CrudForm 的 number 分支不转发 disabled，因此锁定态改为自定义灰态只读值渲染；供应商编码、产品库供应商名同样 `disabled`。审计结论：其余模块锁定项本就用 `disabled`（`our_parties` 等）——该规则即覆盖全 app（REQ-054） |
| 单证已托到根订单统一录入，采购单只做映射（且历史不保留） | 详情「单证」区块改为指向根订单的入口（已关联给「去公司订单录入单证」），不再读/写单证表；客户端读取与表单/表格代码删除；`purchasing_purchase_order_documents` 4 行历史数据**已清空**（其他环境：`delete from purchasing_purchase_order_documents;`）。路由/命令/实体/表保留（按迁移策略不做破坏性删表）。**披露**：`export_finance` 订单档案「单据齐套」的三项（供应商发票/装箱单/采购水单）由该表供数，清空后回到「未上传」——要不要改读根单槽位、怎么映射，需要业务口径（REQ-055） |

**证据**（浏览器实测，同上）：编辑页 `depositPercent`/`depositAmount`/`supplierId` 控件 `disabled=true`、`businessNumber` 仍可编辑；详情摘要 = 「… 预计交货日期 — 定金比例 — 定金金额 — 备注 额温枪」（owner 自己填的备注照常显示）且无重复「%」；抬头按钮 href = `/backend/orders/e9ad342f…`；「单证」区块 = 提示 + 「去公司订单录入单证」，无「新增单证」；列表 8 行首屏 = `PO-2026-0008` 「打开公司订单」（可点）+ 其余「未关联公司订单」（`disabled`）——无需任何点击；DB `purchasing_purchase_order_documents` 计数 = 0。截图见 PR 评论。

**实现期自修**：`psql` 清表前置的一次核对发现链接表里 `PO-2026-0010` 的根单归属已被移除（owner 浏览时所为），列表据此显示「未关联」——批量反查与库内状态一致。

## 复查·三（owner 2026-10-10 复查 2 点：列表行菜单 / 详情单证镜像）

| 反馈 | 落地 |
|---|---|
| 列表里公司订单的动作**放在 ⋯ 外面很丑**，要求放进菜单 | 行操作只剩一个「⋯」菜单（`@open-mercato/ui/backend/forms` 的 `ActionsDropdown`，`triggerClassName` 保持裸行动作图标同形）；项由纯函数 `components/purchaseOrderRowActions.ts` 构建——「打开」常驻；已关联＝「打开公司订单」直达根单；未关联＝「未关联公司订单」置灰（`disabled`、`pointer-events: none`）；读不到（403/失败）＝该项不出现（REQ-057、TEST-037） |
| 「单证」区块要显示**会关联什么单证数据**、并**联动**显示 | 详情「单证」＝根单「单据与文件」的只读镜像（`GET /api/order_hub/orders/fields` 的 `documents.bySlot`，与 hub 区块/全字段抽屉同一投影，不读它的表）：有内容的槽位一行——本单文件 chips（名称/日期/预览/下载，字节走根单代理 `/api/order_hub/orders/attachments/<id>`）+ 子单来源 chips（份数 + 深链根单 `#contracts`/`#shipments`/`#money`/`#purchasing`）；解析 `components/rootDocuments.ts`（TEST-038）；未关联/403/失败只留提示与入口（REQ-056） |

**证据**（浏览器实测；dev server 本 worktree，port 3000 被主树占用 → 运行时落到 `http://localhost:3001`，以日志为准）：

- 列表：首屏 8 行每行只有一个「⋯」——`PO-2026-0008`（已关联）菜单 = 「打开 / 打开公司订单」；`PO-2026-0007`（未关联）菜单 = 「打开 / 未关联公司订单」（`disabled=true`、计算样式 `pointer-events: none`）；行内不再有第二个按钮。截图 2 张。
- 详情（`PO-2026-0008`）：区块 = 「商业发票（INV.NO） 本单 20260923164549_67_40.jpg 2026-10-10 预览 下载」+「采购水单及发票 采购 1 份」→ `/backend/orders/e9ad342f…#purchasing` + 「去公司订单录入单证」。截图 1 张。
- **联动双向**：把 `r10-doc-smoke.txt` 上传到根单「装箱单（PL）」→ 采购单页出现该槽位，其「下载」= 200 + 原字节 + UTF-8 文件名；在根单删除该文件 → 采购单页随之消失。（「采购 1 份」来源由付款凭证附件触发；验后已按 installed `DELETE /api/attachments?id=` 删除该附件并把付款行 `attachment_id` 复位，槽位文件走 hub 删除。）
- 说明：根单上更早的槽位文件由**别的 dev 树**上传，本树答 404「File not available」——根单页自己的下载链在该服务器上同样如此（附件本地存储按工作树分开），不是本改动的缺陷。
- 宽门禁：`yarn generate && yarn typecheck && yarn lint && node scripts/check-lessons.mjs && yarn ds:check && yarn test && yarn build` 全绿——typecheck 0 error；lint 0 error（12 条既有 warning）；`ds:check` **1109 files passed**；`yarn test` **94 suites · 832 tests passed**（+2 套件 / +9 用例 = TEST-037/038）；`yarn build` 成功。
- **实现期自修**：解析从组件内联抽到 `components/rootDocuments.ts` 并补 TEST-038（跨模块 HTTP 载荷的边界值得单独钉住），组件仅消费该函数。
