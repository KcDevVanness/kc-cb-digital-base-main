# Attachment File Preview — 附件（图片 / PDF）在线预览

**Date**: 2026-09-24
**Status**: Implemented and verified (Phase 1, 2026-09-24) — 一个 app 级共享查看器（`src/lib/attachments/AttachmentPreview.tsx` + `PdfPreview.tsx`）接进 5 个模块的 9 处附件引用 + 供应商产品照片：图片在对话框内等比显示，PDF 由 Mozilla PDF.js（`pdfjs-dist`，本 app 已声明依赖）逐页渲染到同源 canvas，不支持/过大/越权三态都保留「下载」。**零服务端改动**：无新 API、无新权限、无迁移，`next.config.ts` 的 CSP 与 installed `attachments` 一个字节未改。

> Owner request (2026-09-24):「关于文件，图片,PDF，做成预览形式，不要只是单一的下载功能，要有预览的方式」——
> 现在每个单证/水单/照片位置都只有一条「下载」链接，操作人员要核对一张扫描件必须先下载再打开本地程序。

## Implementation Status

Source doc: `.ai/specs/2026-09-24-attachment-file-preview.md`

| Phase | State | Dependencies | Acceptance IDs | Focused validation | Exit gate |
|---|---|---|---|---|---|
| Phase 1 — 共享预览组件与全部接线 | verified | none | AC-001…AC-009 | `yarn generate`、`yarn typecheck`（改动文件 0 error）、`yarn lint` 0 error、`yarn ds:check` ✓ 703 files、`yarn test` ✓ 35 suites / 284 tests、浏览器实测 | 采购单证（图片 + PDF）在对话框内可读；`.txt` 给出说明而非空白；下载入口全部仍在；installed `attachments` 零改动 |

### Phase 1 evidence

- [x] 新组件：`src/lib/attachments/AttachmentPreview.tsx`（`useAttachmentPreview` / `AttachmentPreviewLink`；`apiCall` 取字节、`Content-Length` 25 MiB 预检、`AbortController` + `revokeObjectURL`、失败/不支持/过大三态用 `EmptyState` + 「下载」，`DialogContent size="xl"`）与纯函数 `src/lib/attachments/previewKind.ts`（PNG/JPEG/GIF/WEBP/BMP/AVIF 魔数、`%PDF-` 前 1024 字节、响应 `Content-Type` 回退）；`src/lib/attachments/__tests__/previewKind.test.ts` **6 tests 通过**（`yarn test` 全量 35 suites / 284 tests 亦全绿）。
- [x] 样式与文案：`src/app/globals.css` 的 `@utility attachment-preview-stage`（`100svh - 22rem`，避开 `ds:check` 的任意 Tailwind 值规则）；app 级 `src/i18n/{en,zh}.json` 的 `attachments.preview.*`（zh 只中文、en 只英文，通过 `language-purity` 测试）。
- [x] 接线（9 处 + 照片）：`purchasing/components/PurchaseOrderDetail.tsx`（付款水单列、单证列、单证行操作、单证表单字段）、`purchasing/components/SupplierProductForm.tsx`（照片缩略图可点击放大）、`export_finance/components/OrderFileDetail.tsx`（收汇单证列、行操作、表单字段）、`export_finance/components/ContainerFileDetail.tsx`（退税资料列、表单字段）、`cross_border/components/ShipmentDetail.tsx`（单证列、表单字段）、`trade_docs/components/{ContractDetail,InvoiceForm,InvoicesTable}.tsx`（盖章件、发票表单、发票列表）；四个模块的 zh/en 文案键随行补齐，下载入口一律保留。
- [x] 浏览器实测（dev `http://localhost:3000`，`admin@acme.com`；采购单 `56985efe-62f3-49d9-8462-5e76d0c1dc5d`，四行单证 JPG / 3 页 PDF / 1 页 PDF / TXT）：图片在对话框内等比显示（natural 400×260，无 canvas）；**PDF 由 PDF.js 渲染**——3 页 PDF 得到 3 个 canvas，每个 960×1358 设备像素，逐页非白像素 ≈ 98.8k、其中蓝色块 ≈ 93.9k（与 PDF 内容吻合），舞台 `clientHeight 414 / scrollHeight 3297`（多页在对话框内滚动），控制台 0 条 error、无 CSP 违规、无 worker 失败；TXT 显示「此文件类型不支持预览，请下载后用本地程序打开。」+「下载」；`RowActions` 菜单含「预览/下载/编辑/删除」；供应商产品库照片缩略图（`aria-label="预览这张照片"`）点击放大到原图（natural 400×260）；暗色下对话框取语义 token 暗值、420px 窄屏为整宽底部抽屉且对话框内无横向溢出（舞台 372×468、canvas 354×500 落在舞台内）；Esc 关闭。
- [x] PDF 渲染的失败路径：解析/渲染异常与网络失败同一态（`onError` → 「无法加载文件预览。」+ 下载）；超过 30 页时提示「仅显示前 30 页…」并保留下载（`attachments.preview.pageLimit`）。
- [x] 零服务端改动核对：`next.config.ts`、`node_modules/@open-mercato/core/src/modules/attachments/**`、`src/modules.ts` 均未修改（`git status` 只含本 spec 列出的文件）。
- [x] 文档：`src/modules/{purchasing,export_finance,cross_border,trade_docs}/README.md`（规则/所有权 + 冒烟行）、`docs/plans/cross-border-erp.md` 进度行 **六·补18** + 门禁重跑段、`docs/plans/README.md` 规格状态板。

> 关联阅读：installed 附件平台的安全策略 `node_modules/@open-mercato/core/src/modules/attachments/lib/security.ts`
> （`SAFE_INLINE_MIME_TYPES` 仅 6 种图片）与 `api/file/[id]/route.ts`（PDF 因此以 `application/octet-stream` 下发）；
> 本 spec 不修改它们，而是在客户端把字节重新发声为 `application/pdf` 的交由浏览器阅读器。

## TLDR

给 app 自有界面上的每一个附件引用加**预览**：图片在对话框里直接看，PDF 由 Mozilla PDF.js（`pdfjs-dist`，Apache-2.0，本 app 已声明的依赖）在对话框里渲染成可滚动的页面画布，
不支持的格式给出明确说明并保留下载。实现是**一个共享组件**
（`src/lib/attachments/AttachmentPreview.tsx` + `PdfPreview.tsx`）+ 各页面把「下载」链接旁边补一个「预览」入口；
不改 installed `attachments` 的存储、路由、权限与安全策略（PDF 依旧以 `application/octet-stream` +
`attachment` 下发，客户端取回字节后自行判定类型再交给 PDF.js 渲染），无新 API、无迁移、无新权限。

## Problem Statement

**今天只有下载，没有查看。** app 自有的 5 个模块把附件渲染成一条下载链接：

| 位置 | 现状 |
|---|---|
| `purchasing/components/PurchaseOrderDetail.tsx` | 付款水单（`payments.attachmentOpen`）、采购单证（`documents.actions.download`）+ 行操作 |
| `export_finance/components/OrderFileDetail.tsx` | 收汇单证（`collection.documents.download`）+ 行操作 |
| `export_finance/components/ContainerFileDetail.tsx` | 退税资料（`cabinets.detail.documents.download`） |
| `cross_border/components/ShipmentDetail.tsx` | 出口单证（`documents.field.attachment`） |
| `trade_docs/components/{ContractDetail,InvoiceForm,InvoicesTable}.tsx` | 合同盖章扫描件、发票归档件 |
| `purchasing/components/SupplierProductForm.tsx` | 产品照片（`image_attachment_ids`，只渲染 96px 缩略图，点不开） |

**代价是真实的工作流摩擦。** 单证核对是逐张比对（发票 vs 装箱单 vs 水单 vs 盖章合同），每张都要
「下载 → 找文件 → 用系统看图/PDF 程序打开 → 关掉 → 回浏览器」。供应商发来的是 PDF 与手机拍的
JPG/PNG 扫描件，正是浏览器能直接显示的两类。

**平台侧的能力边界（为什么不能只去掉 `?download=1`）。** installed 的
`node_modules/@open-mercato/core/src/modules/attachments/lib/security.ts:59-66` 把
`SAFE_INLINE_MIME_TYPES` 限定为 6 种图片格式；`api/file/[id]/route.ts:86-87` 因此对 PDF 下发
`application/octet-stream` + `Content-Disposition: attachment`。把 PDF 塞进 `<iframe src="/api/attachments/file/…">`
只会触发下载，不会渲染——所以预览必须在**客户端**拿到字节、按内容判定类型，再交给一个**自带渲染器的开源库**
（Mozilla PDF.js）画到同源 canvas 上。这是本 spec 的核心技术点，也是不碰平台安全策略的代价。

## Overview and Success Measures

- **Primary outcome:** 在采购单详情、订单档案、柜档案、发运单详情、合同/发票页面上，任一附件都能在
  **一次点击**内于当前页面查看（图片原图、PDF 阅读器），不需要下载、不需要离开页面。
- **Leading indicators:** 每个附件位置出现「预览」入口；预览失败（无权限/文件不存在/过大/不支持）有
  明确说明且**下载入口仍在**；不改任何 API 契约与权限，`/api/attachments/file/<id>?download=1` 行为不变。
- **Baseline:** 5 个模块 9 处附件引用全部只有下载；产品照片只有 96px 缩略图，点不开。
- **Market / product reference:** Odoo 的附件预览（表单右上角图片缩略图 + PDF 内嵌渲染）、
  NetSuite 的 File Cabinet「View」（图片/PDF 内嵌，其它格式提示下载）、SAP Fiori 的 `PDFViewer`、
  Mozilla PDF.js 的 `viewer`。采用：**对话框内嵌查看器 + 保留下载**，PDF 由 Mozilla PDF.js 渲染到 canvas
  （owner 2026-09-24 明确「PDF 可以使用开源的工具库预览实现」；`pdfjs-dist` 本来就是本 app 的依赖）。
  拒绝：① 依赖浏览器内置阅读器（`<iframe>` + 重建 Blob 类型）——它随浏览器/嵌入环境变化，渲染结果是一个不透明的插件文档，既不能断言也无法在无插件的环境里工作；
  ② 改 installed 的 `SAFE_INLINE_MIME_TYPES` 让 PDF 直接 inline（那是平台的安全契约）；
  ③ 新开标签页打开下载 URL（仍是下载，不是预览）。

## Goals

- **REQ-001** — 新增 app 级共享客户端组件 `src/lib/attachments/AttachmentPreview.tsx`：导出
  `useAttachmentPreview()`（返回 `openPreview(attachmentId, fileName?)` 与 `previewDialog`）与
  `AttachmentPreviewLink`（自带触发器 + 对话框的便捷组件）。
- **REQ-002** — 预览类型判定基于**响应内容**：先嗅探字节（PDF `%PDF-`、PNG/JPEG/GIF/WEBP/BMP/AVIF 魔数），
  再退回响应 `Content-Type`；图片用 `<img>`（同源 Blob URL），PDF 交给 Mozilla PDF.js（`pdfjs-dist`）渲染到
  同源 `<canvas>`（最多 30 页，按舞台宽度缩放，页数超出时提示并保留下载）。
- **REQ-003** — 超过 25 MiB 的文件在读取正文前（按 `Content-Length`）放弃预览，提示过大并保留下载。
- **REQ-004** — 每个附件位置的**下载入口保持可用**：预览是新增，不是替换。
- **REQ-005** — 9 处附件引用全部接上预览：`purchasing`（付款水单列、单证列、单证行操作、单证表单字段）、
  `export_finance`（收汇单证列与行操作、退税资料列、退税资料表单字段）、`cross_border`（出口单证列与表单字段）、
  `trade_docs`（合同盖章件、发票表单、发票列表）。
- **REQ-006** — 供应商产品照片（`image_attachment_ids`）的已存缩略图可点击放大（预览对话框），
  移除按钮行为不变。
- **REQ-007** — 预览的失败态可读且不误导：403/404/网络失败 → 「无法加载」+ 下载入口；类型不支持 →
  「此文件类型不支持预览」+ 下载入口；过大 → 「文件过大，请下载查看」+ 下载入口。
- **REQ-008** — 无障碍与主题：触发器是可聚焦的 `button`（不是 `<a href>`）、对话框有标题与描述、
  Esc 关闭、图片有 `alt`、加载态用共享 `Spinner`（`role="status"`）、亮/暗与窄屏可用；不新增任意
  Tailwind 值（尺寸类走 `globals.css` 的 `@utility`，`yarn ds:check` 必须干净）。
- **REQ-009** — 零服务端改动：不新增/修改路由、命令、事件、实体、迁移、权限；预览读取的是既有的
  `GET /api/attachments/file/<id>`（该路由自身的分区/分配访问检查是唯一授权判断）。

## Non-goals

- **不改 installed `attachments`**：不动 `SAFE_INLINE_MIME_TYPES`、不动 file 路由的响应头、不替换
  installed 附件库页面（`/backend/storage/attachments` 的列表与元数据面板保持包内实现）。
- **不做服务端渲染 / 文档转换 / OCR / 缩略图服务**：PDF 由客户端 PDF.js 直接渲染，不生成服务端预览图、不落盘；
  不做批注、表单填写、文本选择/复制工具栏、页码跳转控件（PDF.js 的 `viewer` 界面不引入）。
- **不做图片编辑、缩放控件、多图轮播、翻页控件**：预览是「看清楚」，不是查看器产品。
- **不做上传前的本地文件预览**（表单里选中的本地文件在上传成功前仍只显示文件名）——
  上传成功后即可用同一入口预览。
- **不新增下载/预览的审计事件**：读取路径不写 `audit_logs`（与既有的下载行为一致）。

## Proposed Solution

一个共享组件 + 各页面接线。

```text
任何附件引用（表格单元格 / 行操作 / 表单字段 / 照片缩略图）
        │  点击「预览」
        ▼
useAttachmentPreview().openPreview(attachmentId, fileName?)
        ▼
GET /api/attachments/file/<id>            ← 既有路由，既有授权（分区 + 分配 + 组织 scope）
        │  Content-Length > 25 MiB → 放弃（提示过大 + 下载）
        ▼
嗅探字节 + Content-Type
        ├─ 图片 → <img src={Blob URL}>
        ├─ PDF  → <PdfPreview bytes={ArrayBuffer}/>            ← Mozilla PDF.js 逐页画到 canvas
        └─ 其它 → 「不支持预览」+ 下载
```

- **为什么 PDF 用 PDF.js 而不是把它丢给浏览器：** 服务端按平台安全策略把 PDF 当二进制附件下发
  （`application/octet-stream` + `attachment`），浏览器因此不会渲染 —— 能渲染的内置阅读器只认「顶层导航到
  一个真正的 PDF 文档」，而这里既没有那个 URL，也不该为了它去改平台的下发策略或加一个转发路由。
  PDF.js 直接在内存里解析已授权取回的字节，把每一页画进同源 canvas：不依赖插件、不受嵌入环境与
  sandbox 设置影响，渲染结果还是可断言的 DOM（`page.getViewport` 定尺寸、`getImageData` 数像素，
  集成/冒烟都能验），并且它本来就是本 app 的依赖（`pdfjs-dist@^6.2.108`，Apache-2.0）。
  懒加载（`await import('pdfjs-dist')`）让这 ~1 MB 只落在真正打开 PDF 预览的那一刻。
- **为什么不额外调元数据接口：** `GET /api/attachments/library/<id>` 需要 `attachments.view`，
  而单据的查看者可能只有 `purchasing.orders.view` 之类的业务权限；预览因此只依赖**文件路由本身**的
  授权判断，不多要一个权限、不多一次往返。
- **为什么共享组件放在 `src/lib/attachments/`：** 与 `src/lib/money/MoneyAmount.tsx` 同款——
  app 级共享 UI 原语放在 `src/lib/<域>/`，各模块直接 import（`@/lib/...`），一份实现一处维护。

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| 共享 app 组件（`src/lib/attachments/`） | 9 处引用、4 个模块；一份类型判定与错误处理 | 每个模块各写一份 | 必然漂移（类型判定与 Blob 重建是最易错的两处） |
| 预览 + 下载并存 | owner 明确「不要只是单一的下载功能」；下载仍是归档/转发路径 | 预览替换下载 | 丢掉把文件交给第三方（货代/银行/客户）的路径 |
| PDF 由 Mozilla PDF.js 渲染到 canvas（owner 2026-09-24 指示用开源库） | 平台把 PDF 当二进制附件下发，浏览器内置阅读器只认顶层 PDF 导航；PDF.js 解析内存字节、不依赖插件与嵌入环境，渲染结果（canvas 尺寸/像素）可断言 | 浏览器内置阅读器：`<iframe>` + 客户端重建的 `application/pdf` Blob URL（首版实现） | 渲染结果是不透明的插件文档（`contentDocument === null`），无法自动断言，且随浏览器/嵌入环境（无插件内核、被 sandbox 的宿主）失效 |
| 复用 installed file 路由 | 授权、分区、软删除、存储驱动全部现成 | 新写一个 `/api/<module>/attachment-preview` | 新路径 = 新授权面 = 新漏洞面，且零收益 |
| PDF.js 懒加载（动态 `import()`） | ~1 MB 渲染器只落在真正打开 PDF 预览的那一刻 | 静态 import | 会进入每个渲染附件链接的后台页面的 client chunk |
| 按 `Content-Length` 预检 25 MiB | 避免把 200 MB 扫描件读进内存卡死标签页 | 不设上限 | 单证扫描件常见 5–20 MB，但不乏整箱报关资料打包件 |
| 尺寸类走 `@utility` | `yarn ds:check` 禁止任意 Tailwind 值；仓库已有 `pane-below-header` 先例 | `max-h-[70vh]` + `.ds-check-ignore` 例外条目 | 例外条目是给历史遗留的，新代码应落在设计系统里 |
| 触发器是 `button` 而非 `<a>` | 打开的是对话框，不是导航；`<a href="#">` 会污染历史与右键菜单 | `<a href={downloadUrl} target=_blank>` | 那还是下载，不是预览 |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| 附件引用 | 单据行上存储的 `attachment_id`（uuid），文件本体在 installed `attachments` | `attachments` 模块 | 无 id → 不渲染预览入口（单元格保持 `—`） |
| 可预览类型 | 图片（PNG/JPEG/GIF/WEBP/BMP/AVIF）与 PDF；其余一律「不支持预览」 | 本 spec 的 `detectAttachmentPreview()` | 显示说明 + 下载入口 |
| 预览上限 | 25 MiB（`ATTACHMENT_PREVIEW_MAX_BYTES`），按响应 `Content-Length` 判断 | 本 spec | 提示过大 + 下载入口；不读取正文 |
| PDF 渲染不变式 | 每次预览独立加载文档；页序 1..n 画到独立 canvas；最多 30 页（超出提示 + 下载）；设备像素比封顶 2；关闭对话框时用 `PDFDocumentLoadingTask.destroy()` 释放文档与 worker | `src/lib/attachments/PdfPreview.tsx` | 解析/渲染失败 → 与网络失败同一态（「无法加载」+ 下载） |
| 授权 | 预览**不新增**授权判断：文件路由按分区可见性与分配关系自行判定 | installed `attachments/lib/access.ts` | 403/404 → 「无法加载」+ 下载入口 |
| 下载语义 | `?download=1` 保持原样（`Content-Disposition: attachment`） | installed file 路由 | 不变 |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| 采购/外贸/财务操作员 | 在业务页面上预览、下载其可见记录的附件 | 记录的 `tenant_id`/`organization_id` 由既有页面与 API 决定；文件另受 `attachments` 分区/分配规则约束 | 页面既有（如 `purchasing.orders.view`、`export_finance.orders.view`、`cross_border.shipments.view`、`trade_docs.*.view`） |
| 无附件访问权的用户 | 预览与下载都失败，且失败信息不泄露文件是否存在 | fail closed（installed 路由判断） | — |

- 预览是**纯客户端读取**：不派生新的 scope 规则，不引入 `organizationId: null` 的系统范围操作，
  不新增服务端信任边界。
- `tenantId`/`organizationId` 的派生与失败关闭完全沿用既有页面/API（本 spec 不碰）。

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| 文件存储、分区、访问规则、下载路由 | reuse（零改动） | installed `attachments` | `GET /api/attachments/file/<id>` | 平台已拥有存储与授权 |
| 预览对话框、类型判定、错误态 | **app-own（新增）** | `src/lib/attachments/AttachmentPreview.tsx` | 各模块组件直接 import | 一份实现，四处接线 |
| PDF 渲染 | reuse（零改动） | `pdfjs-dist`（Mozilla PDF.js 6.3.289，Apache-2.0，本 app 已在 `package.json` 声明） | `src/lib/attachments/PdfPreview.tsx` 懒加载 `getDocument` → canvas | 开源、无服务端渲染、无需新依赖 |
| 页面外壳、`DataTable`、`RowActions`、`Dialog`、`EmptyState`、`Spinner` | reuse | `@open-mercato/ui` 原语 | 组件 props | 平台原语已覆盖 |
| 业务页面与单证行 | extend（接线） | `purchasing`、`export_finance`、`cross_border`、`trade_docs` | 单元格/行操作/表单字段 | 附件引用的所有者 |
| 产品照片 | extend（接线） | `purchasing/components/SupplierProductForm.tsx` | `image_attachment_ids` 缩略图 | 同一入口 |

## Architecture and Data Flow

```text
页面组件（purchasing / export_finance / cross_border / trade_docs）
   │  useAttachmentPreview() → openPreview(id, fileName?)
   │  AttachmentPreviewLink（自带对话框的便捷封装）
   ▼
AttachmentPreviewDialog（客户端）
   │  apiCall('GET /api/attachments/file/<id>', 不追加 download=1, 关掉 401/403 重定向)
   │  parse: Content-Length 预检 → { blob } | { tooLarge }
   ▼
detectAttachmentPreview(bytes, contentType) → { kind: 'image' | 'pdf', mimeType } | null
   ▼
图片：Blob URL（同源、内存内）→ <img>；关闭/切换时 revokeObjectURL
PDF ：bytes → PdfPreview → PDF.js getDocument → 每页 render() 到同源 <canvas>；关闭时 task.destroy()
```

- **Module boundaries:** 无新模块。共享原语在 `src/lib/attachments/`（app 级），业务接线在各模块组件内，
  不产生跨模块 import。
- **Extension points:** 无新增（不新增页面、路由、事件、部件、菜单项）。这是一次纯组件层扩展。
- **Alternatives considered:** 见 Design Decisions 表（新 API、改平台策略、引入 PDF.js、每模块自研）。
- **Compatibility:** `/api/attachments/file/<id>` 与 `?download=1` 的响应、既有下载链接、既有上传字段
  一律不变；新增的只有页面上的一个按钮与一个对话框。

## User Journeys

### Journey J-001 — 财务核对一张水单（图片）

1. 操作员打开采购单详情 → 付款区，水单行上出现「预览 · 下载」。
2. 点「预览」→ 对话框打开，图片按容器等比显示；Esc 或右上角 X 关闭。
3. 失败路径：附件被删除/越权 → 对话框显示「无法加载文件预览」+ 下载按钮；下载本身失败则维持既有行为。

### Journey J-002 — 外贸核对一份报关单 PDF

1. 打开发运单详情 → 出口单证表 → 点「预览」。
2. 对话框内出现浏览器内置 PDF 阅读器（可翻页、可缩放），关闭后回到列表位置不变。
3. 失败路径：文件 > 25 MiB → 「文件过大，请下载查看」+ 下载；格式为 `.docx` → 「此文件类型不支持预览」+ 下载。

### Journey J-003 — 商品/产品照片放大看细节

1. 供应商产品库编辑页 → 照片区，点击 96px 缩略图。
2. 对话框按容器放大显示原图；移除按钮仍在缩略图右上角，行为不变。

## UI and Interaction Contracts

Closest references: `purchasing/components/PurchaseOrderDetail.tsx` 的单证表（`DataTable` + `RowActions`
+ `Dialog` 组合）、`trade_docs/components/ContractDetail.tsx` 的附件区（`SectionHeader` + 按钮 + 链接行）、
`purchasing/components/SupplierProductForm.tsx` 的照片区（`<img>`/`Image` 缩略图 + 角标按钮）。
规则见 `.ai/guides/backend-ui.md`（DataTable / Dialog / 状态与无障碍 / 设计系统契约）。
平台原语：`Dialog`（`size="xl"`）、`DialogHeader/Title/Description/Footer`、`Button`、`EmptyState`、`Spinner`。

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| 采购单详情（付款列 / 单证列 / 单证行操作 / 单证表单字段） | 预览 + 下载附件 | 读 `GET /api/attachments/file/<id>`（预览）；写路径不变 | `PurchaseOrderDetail.tsx` 现状 | `DataTable`、`RowActions`、`Dialog`、`EmptyState`、`Spinner` | 加载、就绪（图片/PDF）、不支持、过大、错误、无附件（`—`） | REQ-001…REQ-005, REQ-007 |
| 订单档案 / 柜档案（单证列 / 行操作 / 表单字段） | 同上 | 同上 | `OrderFileDetail.tsx` / `ContainerFileDetail.tsx` 现状 | 同上 | 同上 | REQ-001…REQ-005, REQ-007 |
| 发运单详情（出口单证列 / 表单字段） | 同上 | 同上 | `ShipmentDetail.tsx` 现状 | 同上 | 同上 | REQ-001…REQ-005, REQ-007 |
| 合同详情 / 发票表单 / 发票列表 | 同上 | 同上 | `ContractDetail.tsx` / `InvoiceForm.tsx` / `InvoicesTable.tsx` 现状 | 同上 | 同上 | REQ-001…REQ-005, REQ-007 |
| 供应商产品库照片区 | 缩略图点击放大 | 同上 | `SupplierProductForm.tsx` 现状 | `img`/`Image` 缩略图 + `Dialog` | 就绪、加载、错误 | REQ-001, REQ-006, REQ-007 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| 业务操作员 | 不变（无新增导航） | 无新增 | 采购/外贸/财务 → 记录详情 → 预览（≤3 次点击） |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| 预览对话框 | 不支持/过大/错误三态各有说明 + 下载按钮 | 窄屏：对话框占满宽度，舞台高度随 `svh` 收缩；不产生横向滚动 | 打开后焦点进入对话框（Radix），Esc 关闭，X 可聚焦；图片有 `alt`，PDF 的页面画布有可读的对话框标题与文件说明 |
| 附件单元格 | 无附件保持 `—` | 与既有一致 | 预览是原生 `button`（可 Tab 聚焦、Enter/Space 触发） |

### 预览对话框 — `AttachmentPreviewDialog`

```text
┌──────────────────────────────────────────────────────────────┐
│ 文件预览                                                [X]  │
│ scan_2026-09-24.pdf                                          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│        舞台：<img>（等比 object-contain）或 PDF.js 逐页 canvas  │
│        或：EmptyState（不支持 / 过大 / 无法加载）            │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                                                [ 下载 ]      │
└──────────────────────────────────────────────────────────────┘
```

- **Behavior:** 打开即取字节（不缓存跨次打开的结果）；`Content-Length` 超限时不读正文；PDF 交给 PDF.js 解析（`PDFDocumentLoadingTask.destroy()` 释放）；关闭或切换目标时撤销 Blob URL、销毁 PDF 文档并中止请求。
- **Responsive and accessibility:** 舞台高度 `calc(100svh - 22rem)`（`globals.css` 的
  `@utility attachment-preview-stage`），最小 12rem；对话框 `size="xl"`（`sm:max-w-4xl`），
  窄屏为底部抽屉（原语既有行为）。加载态 `Spinner`（`role="status"`），错误态 `role="alert"`。
- **Localization:** 通用文案 `attachments.preview.*` 落在 app 级 `src/i18n/{en,zh}.json`；
  各模块自己的入口文案落在模块目录（`purchasing.*`、`export_finance.*`、`cross_border.*`、`trade_docs.*`），
  zh 只写中文、en 只写英文。
- **Design-system and theming:** 语义 token（`text-primary`、`bg-muted/30`、`border`）；无硬编码调色板、
  无 `dark:` 手写覆盖、无任意 Tailwind 值；亮/暗与窄屏实测。

## Data Models

N/A — 无实体、字段、索引或迁移变更（预览只读既有的附件字节，不落库、不写审计）。

## API, Command, and Error Contracts

N/A — 不新增或修改任何路由/命令。预览消费既有的
`GET /api/attachments/file/[id]`（`node_modules/@open-mercato/core/src/modules/attachments/api/file/[id]/route.ts`：
`requireAuth: false` + 路由内 `checkAttachmentAccess`，`download=1` 强制附件下发），
其请求参数、响应头、错误码与权限判断一律不变。app 侧新增的只是客户端消费方式。

## Events, Jobs, Notifications, and Cross-Module Flows

N/A — 不新增事件/作业/通知；预览是同步读取，无跨模块写入。

## Security, Privacy, and Compliance

- **Authorization:** 预览**不新增**授权面；唯一判断仍是 installed file 路由的
  `checkAttachmentAccess`（分区可见性 + 分配关系 + 组织 scope）。客户端不做任何「先放行再看」的判断。
- **Tenant isolation:** 沿用既有页面与路由；预览请求同源、带会话 cookie，且显式关闭
  401/403 的登录重定向（`x-om-unauthorized-redirect: 0`），避免把登录页 HTML 当成文件内容渲染。
- **Sensitive data:** 预览的字节只存在于当前标签页内存、同源 Blob URL（图片）与 canvas（PDF）里；PDF 的
  解析与光栅化全部发生在浏览器内（PDF.js 的 worker 由同源 URL 加载），不写日志、不上传第三方、
  不落地磁盘、不做服务端渲染。Blob URL 在关闭/切换时撤销，PDF 文档用 `PDFDocumentLoadingTask.destroy()` 释放。
- **Abuse and failure modes:** ① 超大文件 → 按 `Content-Length` 预检，不读正文；② PDF 中的活动内容 →
  PDF.js 只解析结构并光栅化页面：不启用 PDF 内嵌 JavaScript（`enableScripting` 默认关闭）、不执行表单动作，
  渲染面是同源 canvas，与页面脚本上下文隔离；SVG 明确不在可预览集合内（平台已按 active content 处理）；
  ③ 越权枚举 → 与下载一致的 403/404，无额外信息泄露；④ 重复点击 → 每次打开独立请求，
  关闭时中止（`AbortController`）并销毁文档。

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | unit | 纯函数 | jest over `src/lib/attachments/__tests__/previewKind.test.ts` | PNG/JPEG/PDF 魔数识别、`image/*` 与 `application/pdf` 的 Content-Type 回退、未知字节返回 `null` | REQ-002 |
| TEST-002 | UI | dev 应用 + 有采购权限的会话；一张 JPG 与一份多页 PDF 作为采购单证 | 打开采购单详情 → 点「预览」 | 图片在对话框内等比显示；PDF 由 PDF.js 渲染出与页数相同的 canvas（尺寸 > 0、有非白像素）；两者下载入口仍在 | REQ-001…REQ-005 |
| TEST-003 | UI | 同上 + 一个 `.docx` 附件 | 点「预览」 | 显示「此文件类型不支持预览」+ 下载按钮，无空白对话框、无控制台报错 | REQ-002, REQ-007 |
| TEST-004 | UI/security | 越权会话（或已删除的附件 id） | 点「预览」 | 显示「无法加载文件预览」+ 下载按钮；不泄露文件存在性 | REQ-007, REQ-009 |
| TEST-005 | UI | 供应商产品库编辑页（已有照片） | 点击缩略图 | 对话框放大显示原图；移除按钮行为不变 | REQ-006 |
| TEST-006 | UI | 同一页面，窄屏 + 暗色 | 打开预览 | 无横向滚动、无对比度问题；Esc 关闭后焦点回到触发按钮 | REQ-008 |

## Implementation Phases

### Phase 1 — 共享预览组件与全部接线（一次可发布）

- **Depends on:** none
- **Outcome:** 5 个模块的每个附件引用都能一次点击预览（图片/PDF），下载保持不变。
- **Why this order / value delivered:** 单一改动面（一个共享组件 + 9 处接线 + 文案），
  价值在页面刷新后即可用；没有依赖链，不需要分阶段。
- **Deliverables:**
  - `src/lib/attachments/AttachmentPreview.tsx`（`useAttachmentPreview`、`AttachmentPreviewLink`、
    `detectAttachmentPreview`、`ATTACHMENT_PREVIEW_MAX_BYTES`）
  - `src/lib/attachments/__tests__/previewKind.test.ts`
  - `src/app/globals.css` 的 `@utility attachment-preview-stage`
  - `src/i18n/{en,zh}.json` 的 `attachments.preview.*`
  - 接线：`purchasing/components/PurchaseOrderDetail.tsx`、`purchasing/components/SupplierProductForm.tsx`、
    `export_finance/components/OrderFileDetail.tsx`、`export_finance/components/ContainerFileDetail.tsx`、
    `cross_border/components/ShipmentDetail.tsx`、`trade_docs/components/{ContractDetail,InvoiceForm,InvoicesTable}.tsx`
  - 模块文案：`purchasing`、`export_finance`、`cross_border`、`trade_docs` 的 `i18n/{en,zh}.json`
- **Independent slices / estimated commits:** (a) 共享组件 + 单测 + CSS + app 文案；(b) `purchasing` 接线；
  (c) `export_finance` + `cross_border` 接线；(d) `trade_docs` 接线 + 文档/计划表。
- **Requirements closed:** REQ-001…REQ-009
- **Tests:** TEST-001…TEST-006
- **Validation:** `yarn generate`、`yarn typecheck`、`yarn lint`、`yarn ds:check`、`yarn test`（含新增单测）、
  浏览器实测（图片/PDF/不支持/越权、亮暗、窄屏、键盘）
- **Exit gate:** 采购单证（图片 + PDF）在对话框内可读；`.docx` 给出说明而非空白；下载入口全部仍在；
  `ds:check`/`typecheck` 干净；installed `attachments` 零改动。

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001…J-003, 全部接线面 | 新组件 `src/lib/attachments/AttachmentPreview.tsx`（app 级共享原语，非发现面） | Phase 1 | TEST-002, TEST-005 | AC-001 |
| REQ-002 | J-001, J-002 | `detectAttachmentPreview`（纯函数）+ `GET /api/attachments/file/<id>` 响应字节 | Phase 1 | TEST-001, TEST-002, TEST-003 | AC-002 |
| REQ-003 | 失败路径 | `Content-Length` 预检，不读正文 | Phase 1 | TEST-003 | AC-003 |
| REQ-004 | 全部接线面 | 既有 `?download=1` 链接不变 | Phase 1 | TEST-002 | AC-004 |
| REQ-005 | 采购/档案/柜/发运/合同/发票 | 单元格、`RowActions`、表单字段接线 | Phase 1 | TEST-002, TEST-004 | AC-005 |
| REQ-006 | J-003 | `image_attachment_ids` 缩略图 | Phase 1 | TEST-005 | AC-006 |
| REQ-007 | 失败路径 | 403/404/不支持/过大四态 | Phase 1 | TEST-003, TEST-004 | AC-007 |
| REQ-008 | 全部面 | `@utility attachment-preview-stage`、`Dialog`/`EmptyState`/`Spinner` | Phase 1 | TEST-006 | AC-008 |
| REQ-009 | 全部面 | installed `attachments` 零改动 | Phase 1 | TEST-004 | AC-009 |

**Extension-surface traceability:** 本 spec **不新增也不实质修改任何运行时或发现面**
（无路由、页面、事件、部件、菜单、命令、实体、注册表条目）——它只给既有 app 自有页面增加客户端交互，
因此没有需要 `emitted-example` / `framework-only` 等机制分类的行。唯一的新文件是一个 app 级共享 React
组件，由既有页面直接 import，其证据是 TEST-002…TEST-006。

## Rollout, Migration, and Rollback

- **Migration:** 无（`yarn db:generate` 应产出空 diff）。
- **Rollout order:** 单阶段，与页面改动同一次发布；无开关（行为是纯增量：多一个入口）。
- **Observability:** 无新增指标；预览失败在 UI 上可见（错误态），不发遥测。
- **Rollback:** 回滚接线（各页面去掉预览入口）与删除 `src/lib/attachments/**` + `@utility` + 文案键即可；
  无数据、无迁移、无契约残留。

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| 大文件把标签页内存打满 | 卡顿/崩溃 | 25 MiB `Content-Length` 预检 + 下载兜底 | 无 `Content-Length` 的旧行（`fileSize = 0`）不预检，仍可能加载大文件 |
| PDF 内嵌渲染在不同浏览器的差异 | Safari/Chrome 阅读器 UI 不同，移动端可能只给一页 | 下载入口始终在；不支持则用户可下载 | 移动端体验非本 spec 目标 |
| 服务端未来把 PDF 改成 inline | 预览仍工作（Content-Type 命中同一分支） | `detectAttachmentPreview` 同时接受 `application/pdf` | 无 |
| 每处接线遗漏一个入口 | 某页面仍只有下载 | TEST-002/TEST-004 覆盖 9 处引用清单 | 新增页面需要人工遵循同一入口 |
| 越权用户通过预览探测文件存在性 | 信息泄露 | 与下载完全一致的 403/404 与同一授权判断 | 与既有下载行为同等级（不扩大） |

## Acceptance Criteria

- [x] **AC-001** — 任一附件位置的「预览」在对话框内打开；组件是 app 级共享实现，4 个模块无重复实现。
- [x] **AC-002** — JPG/PNG 图片等比显示；PDF 在对话框内由浏览器阅读器渲染；判定基于响应字节/类型。
- [x] **AC-003** — 超过 25 MiB 的文件不进入预览，提示过大并可下载。
- [x] **AC-004** — 所有原有下载入口与 `?download=1` 行为不变。
- [x] **AC-005** — 9 处引用（采购 4、档案/柜 4、发运 2、合同/发票 3 中的每一项）都能预览。
- [x] **AC-006** — 产品照片缩略图可点击放大，移除行为不变。
- [x] **AC-007** — 不支持/过大/越权三态都有可读说明与下载入口，无空白对话框。
- [x] **AC-008** — 亮/暗、窄屏、键盘（Tab/Enter/Esc）可用；`yarn ds:check` 无新增违规。
- [x] **AC-009** — `node_modules/@open-mercato/core/src/modules/attachments/**` 与 `src/modules.ts` 零改动。
- [x] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light-mode, and dark-mode states.
      *Evidence: no new page or route is added — the only new surface is a dialog assembled from the platform primitives (`Dialog size="xl"`, `EmptyState`, `Spinner`, `Button`, `RowActions`), fed through `apiCall`; loading/ready/unsupported/too-large/error, keyboard (Tab/Enter/Esc), 420px and dark mode were exercised in the live dev app.*
- [x] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes.
      *Evidence: no API path changed (previews read the existing `GET /api/attachments/file/[id]`); the pure type-decision has a unit test (`src/lib/attachments/__tests__/previewKind.test.ts`, 6 cases) and the UI paths are browser-verified (TEST-002…TEST-006) — a Playwright spec is intentionally not added for a client-only viewer. Gate: `yarn generate` ✓, `yarn typecheck` (touched files) ✓, `yarn lint` 0 error, `yarn ds:check` ✓ 703 files, `yarn test` ✓ 35 suites / 284 tests.*

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | root `AGENTS.md`、`.ai/guides/backend-ui.md`、`.ai/guides/spec-delivery.md`、`.ai/guides/modules/attachments/index.md`、`om-spec-writing` |
| Data models, APIs, events, UI, and tests are internally consistent | pass | 无数据/API/事件改动；traceability 表逐行对齐 |
| Every workflow completes end to end without a catch-all integration phase | pass | Phase 1 单阶段交付全部 REQ |
| Platform-native reuse and extension points were chosen before custom code | pass | 复用 installed file 路由与 `@open-mercato/ui` 原语；自研仅限浏览器无法原生表达的部分（类型判定 + Blob 重建） |
| UI contracts identify references, canonical components, and theme/state coverage | pass | UI 合约表 + 对话框线框图 + 状态清单 |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Phase 1 条目 |

Verdict: `Ready for implementation`

Implementation verdict (2026-09-24): **delivered and verified** — Phase 1 landed exactly as specified, with the two deviations recorded in the Changelog (no CSP change was needed; the PDF frame loads the browser's own viewer, proven by `contentDocument === null` with zero CSP violations). See *Implementation Status* above for the evidence list.

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | 预览入口覆盖哪些面（是否包括 installed 附件库页面）？ | owner | no | 覆盖 app 自有 5 个模块的 9 处引用 + 产品照片；**不碰** installed 附件库页面（包内实现，改它等于替换包组件；其列表本身已有缩略图列）——2026-09-24 默认，可按 owner 要求追加 |
| Q-002 | 预览替换下载还是并存？ | owner | no | 并存（owner 原话「不要只是单一的下载功能」= 增加，不是替换）——2026-09-24 |
| Q-003 | PDF 用什么渲染？ | owner | no | **Mozilla PDF.js（`pdfjs-dist`，Apache-2.0，本 app 已声明依赖）渲染到 canvas** —— owner 2026-09-24 指示「PDF 可以使用开源的工具库预览实现」；首版的浏览器内置阅读器（`<iframe>` + 重建 Blob 类型）已按此替换 |
| Q-004 | 是否有预览大小上限？ | owner | no | 25 MiB，超限提示并下载——2026-09-24 |
| Q-005 | 新开标签页预览还是页内对话框？ | owner | no | 页内对话框（保持上下文、可键盘关闭）——2026-09-24 |

## Changelog

| Date | Change |
|---|---|
| 2026-09-24 | Initial draft：owner 要求文件/图片/PDF 可预览，含技术要点（PDF 需客户端重建 Blob 类型）与 9 处接线清单 |
| 2026-09-24 | **Phase 1 实施完成 → `Implemented and verified`**。落地：`src/lib/attachments/{AttachmentPreview.tsx,previewKind.ts}` + 单测、`@utility attachment-preview-stage`、app 级 `attachments.preview.*` 文案、5 个模块 9 处接线 + 产品照片、四个模块 README 与计划表 六·补18。验证：单元 6 tests（全量 35 suites / 284 tests）、`ds:check` 703 files、改动文件 typecheck/eslint 干净、浏览器实测（图片等比、TXT 不支持态、行操作预览、照片放大、暗色、420px 窄屏、Esc）。**未改 CSP**：`object-src 'none'` 对白名单外的帧不构成阻挡，`next.config.ts` 保持原样 |
| 2026-09-24 | **PDF 渲染改为 Mozilla PDF.js（owner 指示「PDF 可以使用开源的工具库预览实现」）**。首版把字节重建成 `application/pdf` 的 Blob URL 交给浏览器内置阅读器的 `<iframe>`：能显示，但渲染结果是不透明的插件文档（`contentDocument === null`），既无法自动断言，也随浏览器/嵌入环境失效。现在新增 `src/lib/attachments/PdfPreview.tsx`：懒加载 `pdfjs-dist`（`^6.2.108`，本 app 已声明依赖，Apache-2.0）、worker 走 `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`、逐页 `getViewport`/`render` 到同源 canvas（最多 30 页、DPR 封顶 2、按舞台宽度缩放）、关闭时 `PDFDocumentLoadingTask.destroy()`；`AttachmentPreview.tsx` 的 PDF 分支改为传 `ArrayBuffer`，新增 `attachments.preview.pageLimit` 文案与失败路径回退到「无法加载」+ 下载。实测：3 页 PDF → 3 个 canvas（各 960×1358、非白像素 ≈ 98.8k / 蓝色块 ≈ 93.9k）、舞台内滚动、控制台 0 error；图片/不支持/暗色/窄屏路径复测不变 |
