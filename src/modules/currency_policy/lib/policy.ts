/**
 * 本部署启用的币种清单 —— 只保留公司实际结算的四个地区。
 *
 * 两份平台数据跟着这份清单走（见 lib/apply.ts）：
 *
 * - `currencies`（汇率主数据，`@open-mercato/core/modules/currencies`）：清单内币种每
 *   组织恰好一行且启用，`BASE_CURRENCY_CODE` 是唯一的 `is_base` 行；清单外的币种一律
 *   关掉（`is_active = false`）而不是删除，历史汇率仍然可解析。
 * - `currency` 字典（`@open-mercato/core/modules/dictionaries`）：客户商机表单和销售单据
 *   表单的币种下拉都读它，最终只剩这份清单。
 *
 * 增删币种＝改这里的清单 + `yarn mercato currency_policy apply`（或重跑
 * `yarn mercato seed:defaults`）。说明见 docs/dev/currency-policy.md。
 */

export type CurrencyRegion = 'china' | 'russia' | 'southeast_asia' | 'united_states'

export type PolicyCurrency = {
  /** ISO 4217 code — what documents and rates store. */
  code: string
  region: CurrencyRegion
  /** Operator-facing dictionary label, shown as `CODE – label` in the CRM pickers. */
  label: string
  symbol: string
  decimalPlaces: number
  decimalSeparator: string
  thousandsSeparator: string
}

export const CURRENCY_REGION_LABELS: Record<CurrencyRegion, string> = {
  china: '中国地区',
  russia: '俄罗斯地区',
  southeast_asia: '东南亚地区',
  united_states: '美国地区',
}

/**
 * 默认金额单位（本位币）。每个组织恰好一个 `is_base` 行；商机 KPI/看板聚合、汇率换算、
 * 销售单据的兜底币种都按它走。某个组织要改（例如俄罗斯主体用卢布记账），在
 * `/backend/currencies` 改一行即可，本模块不会把它掰回来。
 */
export const BASE_CURRENCY_CODE = 'USD'

function defineCurrency(
  code: string,
  region: CurrencyRegion,
  label: string,
  symbol: string,
  formatting: Partial<Pick<PolicyCurrency, 'decimalPlaces' | 'decimalSeparator' | 'thousandsSeparator'>> = {},
): PolicyCurrency {
  return {
    code,
    region,
    label,
    symbol,
    decimalPlaces: formatting.decimalPlaces ?? 2,
    decimalSeparator: formatting.decimalSeparator ?? '.',
    thousandsSeparator: formatting.thousandsSeparator ?? ',',
  }
}

export const POLICY_CURRENCIES: readonly PolicyCurrency[] = [
  // 中国地区 —— 两岸四地的法定货币
  defineCurrency('CNY', 'china', '人民币', '¥'),
  defineCurrency('HKD', 'china', '港元', 'HK$'),
  defineCurrency('TWD', 'china', '新台币', 'NT$'),
  defineCurrency('MOP', 'china', '澳门元', 'MOP$'),
  // 俄罗斯地区 —— 卢布按俄式写法（小数逗号、千分空格）
  defineCurrency('RUB', 'russia', '卢布', '₽', { decimalSeparator: ',', thousandsSeparator: ' ' }),
  // 东南亚地区 —— 东盟十国
  defineCurrency('SGD', 'southeast_asia', '新加坡元', 'S$'),
  defineCurrency('MYR', 'southeast_asia', '马来西亚林吉特', 'RM'),
  defineCurrency('THB', 'southeast_asia', '泰铢', '฿'),
  defineCurrency('IDR', 'southeast_asia', '印尼盾', 'Rp', { decimalSeparator: ',', thousandsSeparator: '.' }),
  defineCurrency('PHP', 'southeast_asia', '菲律宾比索', '₱'),
  defineCurrency('VND', 'southeast_asia', '越南盾', '₫', { decimalSeparator: ',', thousandsSeparator: '.' }),
  defineCurrency('MMK', 'southeast_asia', '缅元', 'K'),
  defineCurrency('KHR', 'southeast_asia', '瑞尔', '៛'),
  defineCurrency('LAK', 'southeast_asia', '基普', '₭'),
  defineCurrency('BND', 'southeast_asia', '文莱元', 'B$'),
  // 美国地区
  defineCurrency('USD', 'united_states', '美元', '$'),
]

/** Codes as stored in the database and in documents: trimmed, upper-cased. */
export function normalizeCurrencyCode(code: string): string {
  return code.trim().toUpperCase()
}

let displayNames: Intl.DisplayNames | null | undefined

/**
 * ISO 4217 英文名，用于 `currencies.name`。和平台自带的种子
 * （`currencies/lib/seeds.ts`、`customers` 的币种字典种子）取同一个来源，
 * 因此重复播种不会在名称上互相覆盖。
 */
export function resolveCurrencyName(code: string): string {
  if (displayNames === undefined) {
    try {
      displayNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'currency' }) : null
    } catch {
      displayNames = null
    }
  }
  const name = displayNames?.of(code)
  return typeof name === 'string' && name.trim().length ? name.trim() : code
}
