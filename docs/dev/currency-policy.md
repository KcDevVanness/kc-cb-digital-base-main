# 币种策略（currency_policy）

## 适用范围

- 要**增删本部署启用的币种**时（改清单 + 重跑一条命令）。
- 排查「尚未配置币种字典 / Currency dictionary is not configured yet.」、商机或销售单据的
  币种下拉为空/缺项时。
- 新建组织后要让它拿到币种配置时。

## 两份币种数据，谁读哪份

平台里「币种」是两个互不相干的存储，改错一份等于没改：

| 存储 | 表 | 谁读它 | 谁写它 |
|---|---|---|---|
| 币种字典 | `dictionaries`（`key = 'currency'`）+ `dictionary_entries` | **客户商机表单、销售单据表单的币种下拉**（`useCurrencyDictionary()` → `GET /api/customers/dictionaries/currency`），以及 `AnnualRevenueField` | `customers` 模块的 `seedDefaults`（`seedCurrencyDictionary`，把 `Intl.supportedValuesOf('currency')` 的**全部** ISO 代码写进去） |
| 汇率主数据 | `currencies` | 汇率换算、本位币报表、`/api/currencies/currencies/options`（如 staff 模块） | `currencies` 模块的 `seedDefaults`（USD/EUR/JPY/GBP/CHF/CAD/AUD/CNY/CNH/PLN，USD 为本位币） |

两者都只在 `mercato init` / `mercato seed:defaults` 时播种，**建租户/组织时不会自动播种**。
本仓的 ERP 模块是后开的（见 `.ai/specs/2026-09-21-erp-core-module-activation.md`，当时明确不跑
seed），所以库里一开始两份都是空的 —— 这就是商机表单报「尚未配置币种字典」的原因。

平台没有「收窄币种清单」的扩展点，因此本仓自持一个模块把两份数据收敛到清单：
`src/modules/currency_policy/`。

## 清单

`src/modules/currency_policy/lib/policy.ts` 是唯一 owner：

| 地区 | 币种 |
|---|---|
| 中国地区 | CNY、HKD、TWD、MOP |
| 俄罗斯地区 | RUB |
| 东南亚地区 | SGD、MYR、THB、IDR、PHP、VND、MMK、KHR、LAK、BND |
| 美国地区 | USD |

- 本位币（默认金额单位）：`BASE_CURRENCY_CODE = 'USD'`，每个组织恰好一个 `is_base` 行（平台
  要求）。商机 KPI/看板聚合、汇率换算、销售单据的兜底币种都按它走；某个组织要改（例如
  俄罗斯主体用卢布记账），在 `/backend/currencies` 改一行即可，本模块不会再掰回来。
- 字典条目的 `label` 只写**中文名**（`人民币`、`卢布`…）：商机表单会把 `CODE – ` 前缀拼在
  label 前面（`CNY – 人民币`），销售单据表单直接用 label，所以 label 里不能再带代码。
- 字典条目的 `is_default` 给本位币，`dictionaries` 的唯一索引只允许一条。

## 收敛规则（`lib/apply.ts`）

对每个组织（`tenantId` + `organizationId`）执行，幂等，重复跑不写库：

1. 清单内币种：`currencies` 行按清单补齐（名称用 `Intl.DisplayNames` 的 ISO 英文名，与平台
   自带播种同名，避免互相覆盖）、`is_active = true`、`deleted_at = null`，只有本位币
   `is_base = true`。
2. 清单外币种：**关掉不删除** —— `is_active = false`、`is_base = false`。历史汇率和引用它的
   单据仍然可解析；软删除的行不动。
3. 币种字典：缺则建（`key = 'currency'`，`is_system = true`），清单外条目**删除**
   （条目没有启用位，下拉会列出全部条目，留着等于没收敛）。
4. 已存在的字典名称/描述/可见性不覆盖（那是运营改过的）。

## 什么时候会跑

| 时机 | 入口 |
|---|---|
| `mercato init` / `mercato seed:defaults` | `setup.ts` 的 `seedDefaults` |
| 只补一个模块 | `yarn mercato seed:defaults --module currency_policy` |
| 修某个/全部组织 | `yarn mercato currency_policy apply [--tenant <id>] [--org <id>]` |

**顺序很关键**：`seed:defaults` 按 `src/modules.ts` 的 `enabledModules` 顺序跑（不是按
`requires`），所以 `currency_policy` 必须列在最后 —— `customers` 会写全量 ISO 币种，本模块
随后收敛。若将来顺序被改坏，症状是币种下拉里又出现全量 ISO 代码，重跑
`yarn mercato currency_policy apply` 即可恢复。

## 常用操作

```bash
# 加一个币种：改 lib/policy.ts 的清单 → 重跑
yarn mercato currency_policy apply

# 新组织（建完组织后跑一次；字典会按 org 继承父组织，币种不会自动跟）
yarn mercato currency_policy apply --org <organizationId>
```

## 已知边界

- 币种**标签**由清单决定：运营在 `/backend/config/dictionaries?key=currency` 改过的 label，
  下次播种会被清单覆盖。要改文案请改 `lib/policy.ts`。
- 平台的 `feature_toggles` / `customers` 其余默认值（管道、商机状态字典、功能开关等）同样
  没在本库播种过，页面上表现为 `/api/feature_toggles/check/boolean?identifier=sales_channels_enabled`
  之类的 404；需要时用 `yarn mercato seed:defaults` 补齐（会写参考数据，不含示例数据）。

## 验证方式

```bash
# 两个组织各 16 个启用币种、恰好 1 个本位币；字典条目各 16 条
docker exec kc-cb-digital-base-min-postgres-1 psql -U postgres -d kc_cb_base_min -c \
  "select organization_id, count(*) filter (where is_active) active, count(*) filter (where is_base) base from currencies group by 1;" -c \
  "select d.organization_id, count(e.id) entries from dictionaries d join dictionary_entries e on e.dictionary_id = d.id where d.key='currency' group by 1;"

# 幂等：第二次跑应全是 none
yarn mercato currency_policy apply

# 收敛：手插一条 EUR 到 currencies + 字典，重跑后应被关掉/删除
```

页面侧：`/backend/products/items/create`（自建商品表单）与 `/backend/purchasing/suppliers/create` 的「币种」下拉应列出 16 项且无「尚未配置币种字典」；
`/backend/currencies`（页面已从侧边栏隐藏，URL 直达）列出 16 个启用币种，USD 带「基础」标记。

## 相关

- 规则记录：[.ai/lessons/currency-dictionary-seeding.md](../../.ai/lessons/currency-dictionary-seeding.md)
- 模块清单与启用顺序：[src/modules.ts](../../src/modules.ts)
- 环境与命令：[setup.md](./setup.md)
