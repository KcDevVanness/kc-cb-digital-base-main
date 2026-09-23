# `currency_policy` — 币种与汇率主数据收敛

app 自有模块，**无实体、无 UI、无迁移，但有一个只读路由**。主要工作是在 `customers`/`currencies` 各自的
`seedDefaults` 之后，按公司政策把**币种字典**与**汇率主数据**收敛到同一个集合，避免两个种子互相覆盖；
同时对外提供选币器数据源 `GET /api/currency_policy/currencies`。它也没有自己的功能位与事件：
门禁直接用安装层 `currencies.view`，不声明 `acl.ts`/`events.ts`。

完整策略（启用哪些币种、收敛规则、重跑命令与验证方式）见 [`docs/dev/currency-policy.md`](../../../docs/dev/currency-policy.md)。

## 入口

| 文件 | 作用 |
|---|---|
| `lib/policy.ts` | 政策定义：启用币种清单（16 个，四个地区）、本位币 `BASE_CURRENCY_CODE` 与显示格式（小数位/分隔符） |
| `lib/apply.ts` | 收敛实现（对字典与汇率主数据做幂等对齐） |
| `setup.ts` | `seedDefaults`：由框架在模块启用时调用 |
| `cli.ts` | 手工重跑入口（不依赖重新播种），子命令 `apply` |
| `api/currencies/route.ts` | `GET /api/currency_policy/currencies`：选币器数据源，门禁 `currencies.view` |
| `index.ts` | 模块元数据（`requires: currencies, dictionaries, customers`） |

## 唯一的路由

`GET /api/currency_policy/currencies`（`api/currencies/route.ts`）返回 `{ entries: [{ value, label }] }`，
数据取自安装层 `dictionaries` 模块里的 `currency` 字典（该键不存在时回退到旧键 `currencies`），
并只在调用者的可读组织内查找：命中多个时优先取第一个可读组织（当前选中/所属组织）的那份字典，否则取结果里的第一条；
组织内没有字典则返回 `{ entries: [] }`。未命中字典不算错误，以下才是：

- 未登录 / 无租户 → **401**；可读组织为空 → **400** `organization_scope_required`；
- 缺 `currencies.view` → **403**（功能位来自安装层 `currencies`，本模块不新造功能位）；
- 读取失败 → **500**。

它存在的理由：app 的选币器不该依赖 `customers` 托管的路由与 `customers.people.view`——`currency_policy` 拥有
币种政策，就拥有选币器。目前 **7 个模块共 10 处选币器**读它（`products`、`purchasing` 的供应商与采购单、
`trade_docs`、`sourcing` 的商品与报价面板、`platform_ops` 的渠道、`internal_sales` 的表单、`export_finance` 的收汇与退税），
响应形状保持不变。

**客户端加载器也归本模块**：`lib/clientOptions.ts` 是唯一实现（`loadCurrencyOptions` / `useCurrencyOptions` /
`withCurrentCurrency`），与路由放在一起——`sourcing`（`components/currencyOptions.ts` 转出）与 `export_finance`
已经改读它；其余模块仍各自保留早先复制的 `CURRENCY_DICTIONARY_URL` 常量，收敛是后续清理，行为一致。

## 规则（有意为之）

- **排序只要求「在 `customers`/`currencies` 之后」**：它的 `seedDefaults` 依赖这两个模块先播种完成。
  `src/modules.ts` 里它排在中段（其后还追加了 app 自有模块），不要按「必须最后」理解。
- **幂等**：重复执行结果一致——已经符合政策的 scope 连 `updated_at` 都不动，所以每次播种都能安全重跑。
- **汇率主数据不删除**：清单外的币种 `is_active = false`（`is_base` 一并清掉），历史汇率与引用它的单据仍可解析；
  已软删的行不动（复活是人的决定）。
- **币种字典会删除清单外的条目**：字典是选币器的来源，留下的条目就会出现在下拉里，所以清单外条目直接移除
  （`entriesRemoved`）。字典里 `is_default` 只允许一条且归本位币：散落的 default 先清掉、再写。
- **不改安装层代码**：政策差异全部落在本模块，`node_modules` 保持只读。

## 验证

```bash
yarn generate && yarn typecheck
yarn mercato currency_policy apply [--tenant <id>] [--org <id>]   # 手工重跑（不带过滤则全组织）
yarn mercato seed:defaults --module currency_policy               # 只重跑播种这一步
# 冒烟（dev server 在跑时）：
#  GET /api/currency_policy/currencies（已选组织）→ 200 { entries: [...] }，值来自政策清单（大写三字母）；
#  未选组织 → 400 organization_scope_required；缺 currencies.view 的账号 → 403；未登录 → 401。
#  apply 输出：清单外的币种进 deactivated、清单外的字典条目进 removed；紧接着重跑一次，两者都为空（幂等）。
```

## 回滚

从 `src/modules.ts` 移除 `{ id: 'currency_policy', from: '@app' }` 并 `yarn generate`：
路由与播种钩子一起消失，后续播种不再收敛；已写入的字典与汇率数据保留。本模块没有自己的表与迁移，
因此没有可回退的 DDL——要还原数据只能把政策改回去后重跑 `apply`，或直接改字典/汇率行。
