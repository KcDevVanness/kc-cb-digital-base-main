# Business Model Re-Assessment — 外贸（国内采购 → 海外分公司）+ 跨境电商

**Date**: 2026-09-21
**Trigger**: 业主确认业务实质：不是询盘获客型外贸，而是 **国内供应商进货 → 卖给国外分公司**（关联交易），国外分公司做 **跨境电商运营**；核心诉求是 ERP 业务流程 + 仓库商品流转。
**Effect**: 之前"自建一套产品目录 + 自建销售流程"的假设需要修正 —— 大部分主干平台已有，真正缺的是采购、跨境发运/在途、平台结算。

## 1. 业务链路（候选 Q-001 答案，待业主逐条确认）

四条链 + 一条结算线：

```text
① 采购链      供应商 ──采购订单(PO)──→ 到货/入库(GRN) ──→ 国内仓库存
                                                          └─→ 采购应付

② 出口/内部销售链
   内部销售订单(对分公司) ──→ 拣货/装箱 ──→ 报关/出口单证 ──→ 发运(在途) ──→ 海外仓入库

③ 电商履约链
   平台订单 ──→ 拣货/打包 ──→ 发货(面单/轨迹) ──→ 平台结算(回款/佣金/费用)

④ 反向链      退货入库 / 换货 / 残次处理（跨境电商高频）

⑤ 结算线      采购应付 · 内部结算价 · 平台回款与费用 · 汇率(FX)
```

判断标准：链条上每个箭头对应一个真实动作；每张单据能一句话说出"谁创建、何时结束"。

## 2. 平台现状：主干几乎齐备（证据）

| 能力 | 已安装模块 | 证据 | 结论 |
|---|---|---|---|
| 商品主数据（含跨境字段） | `catalog` | 12 实体；`catalog_product` 自带 `hs_code`/`cn_code`/`country_of_origin_code`/`weight_value`/`dimensions`/`hazmat_class`/`contains_lithium_battery`/`min_order_qty`/UoM 换算/多币种价格/`option_schema_template`+variants | **复用**（补字段用自定义字段/extension） |
| 分公司/客户主数据 | `customers` | 25 实体（person/company/deal/address/tag…） | **复用**（海外分公司 = 客户/公司） |
| 内部销售单据链 | `sales` | 27 实体：quote / order / shipment / return / invoice / credit memo / payment + 渠道与报价（`sales_channel`、offers）+ 单据编号序列；13 个后台页面 | **复用**（对分公司那一段就是 B2B 销售） |
| 多仓库存与流转 | `wms` | 9 实体（warehouse/zone/location/inventory profile/lot/balance/reservation/movement/销售订单仓库分配）；24 命令（receive/adjust/move/reserve/release/allocate/cycleCount + 配置）；12 个页面（inventory/movements/reservations/sku/warehouses/zones/locations/lots） | **复用**（国内仓、海外仓各建 warehouse） |
| 币种与汇率 | `currencies` | 3 实体 + 汇率抓取 | **复用** |
| 组织/多主体 | `directory` | organizations | **复用**，但主数据跨组织共享需确认（Q-009） |
| 外部数据同步 | `data_sync` | "Streaming data sync hub for import/export integrations" | **启用**（平台订单/商品同步的底座） |
| 外部集成框架 | `integrations` | "external ID mapping, status badges, integration registry" | **启用**（连接器注册与外部 ID 映射） |
| 连接器参考实现 | `sync_akeneo` | `requires: ['integrations','data_sync','catalog','sales']`，把 Akeneo PIM 的分类/属性/商品导入 catalog | **照这个形状写平台连接器** |
| 规则与审批 | `business_rules` | 未启用 | 按需启用 |
| 长流程 / 定时任务 | `workflows` + `scheduler` | 未启用 | 按需启用 |
| 分公司自助 | `portal` + `customer_accounts` | 未启用 | 按需启用（分公司看订单/发票） |
| 多语言商品内容 | `translations` | 未启用 | 按需启用（跨境 listing 文案） |
| Excel 导入导出 | `sync_excel` | 未启用 | 按需启用（供应商价目表/商品批量） |
| 物流面单与轨迹 | `shipping_carriers` | 未启用 | 按需启用 |
| EU 合规 | `eudr` | 未启用 | 视品类（木材/咖啡/可可/橡胶/大豆/牛/棕榈） |
| 邮件驱动作业 | `messages` + `inbox_ops` + `communication_channels` + email channels（gmail/imap/ses/resend） | 未启用 | 按需启用（供应商/物流邮件转任务） |

## 3. 真正的缺口（平台没有，必须自建）

1. **采购侧**：安装清单里没有任何 purchase/procurement/supplier 模块（`supplier` 仅出现在 `eudr`，`vendor` 仅在 `warranty_claims`）。缺：供应商主数据、采购订单、到货/质检、采购应付。
2. **跨境发运 / 内部调拨（含在途）**：`wms` 提供的是仓库台账（余额、预留、移动、盘点）与仓库内动作，**没有调拨单/发运单/在途库存**实体。跨境段要自建单据，出口/入库两端用 `wms.inventory.receive|move` 落账。
3. **出口单证**：报关单、装箱单、商业发票无模型 → 自建单据 + `attachments` 存文件。
4. **平台结算 / 回款对账**：`sales_payment` 是客户付款；平台回款、佣金、费用、结算周期、FX 差额要自建。
5. **关联交易定价与内部结算**：平台无 intercompany 概念（内部销售价、内部对账）。

## 4. 修正后的方案（对比之前的假设）

| 之前假设 | 修正后 | 依据 |
|---|---|---|
| 自建一套产品目录（绕过 `catalog`） | **不建**：catalog 已有 HS/CN、原产国、重量尺寸、锂电/危化、最小起订量、UoM 换算、多币种价格；且 `wms` 通过 enricher/interceptor 绑定在 catalog 商品与变体上 | `.ai/guides/modules/catalog/entities.md`、`wms` 的 incoming contributions |
| eject `catalog` 以便自由改 | **不做**：升级税 + 33 处自引用（已实测），而字段需求用自定义字段即可满足 | `.ai/analysis/2026-09-21-catalog-eject-spike.md` |
| 自建整套销售流程 | **分裂处理**：对分公司的内部销售走 `sales`（多币种、单据链现成）；平台订单是"导入 + 履约 + 结算"，自成一条链 | `sales/entities.md`、`sales/backend-pages.md` |
| 自建仓库与库存 | **复用 `wms`**，只补跨境段单据（发运/在途） | `wms/entities.md`、`wms/domain-commands.md`、`wms/backend-pages.md` |
| — | **新增**：平台连接器按 `sync_akeneo` 模式（`integrations` + `data_sync`）实现 | `sync_akeneo/index.ts` |

**三个可独立交付的 app 模块**（按 `om-spec-writing` 的 scope-cohesion，应各自一份 spec）：

1. `purchasing` — 供应商、采购订单、到货入库、采购应付
2. `cross_border` — 内部销售发运单、报关/装箱/商业发票单证、在途跟踪（落账调用 `wms` 命令）
3. `platform_ops` — 平台连接器（订单拉取/库存与发货回传）、平台结算与回款对账（落账调用 `sales` 付款/或自建结算单）

## 5. 必须在设计前解决的新问题

- **Q-009（架构，需一次框架确认）**：主数据跨主体共享。`catalog_product`、`sales_order` 等都是 **tenant + organization 双作用域**。国内 HQ 与海外分公司如何建主体？商品主数据要不要跨组织共享？可选：同 tenant 多 organization + 主数据单组织持有；或系统作用域（`organizationId: null`，仅限已安装契约允许的场景）；或按组织复制 + 同步。需要 `om-framework-context` 精确确认后再定，不能拍脑袋。
- **Q-010（集成方式）**：平台订单怎么进来 —— 平台 API 直连 / 平台后台导出文件 / 第三方 ERP 服务商？（决定 `data_sync` 适配器形态）
- **Q-011（采购细节）**：是否需要多级审批、账期与应付账龄、供应商价格表（多币种）？
- **Q-012（合规与内容）**：商品是否需要多语言文案（`translations`）？是否涉及 EUDR 品类？

## 6. 结论

- 你的业务**不是**"平台流程不满足所以推倒重来"，而是"**主干（商品/客户/销售/库存/币种）够用，缺三块（采购、跨境发运与单证、平台结算）**"。
- 因此正确形态是：**复用主干 + 自建三个缺口模块 + 按需启用连接器与流程类模块**；之前讨论的"自建目录/自建销售/eject catalog"三条路都可以撤下。
- 收缩验证（`.ai/analysis/2026-09-21-disable-official-chain-drill.md`）仍然有用：它证明模块可以随时增删且不动数据，所以"先启用更多官方模块试跑、不行再关"是安全策略。
