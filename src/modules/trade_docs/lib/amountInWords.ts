/**
 * Amount-in-words for a printed contract.
 *
 * A Chinese contract states the total twice (阿拉伯数字 and 大写), and a USD contract states it as
 * `SAY US DOLLARS ... AND CENTS ... ONLY`. Both renderings have to agree with the numeric total
 * to the cent, so they are pure functions over the **already quantized** amount string the money
 * engine produced — never over a float.
 *
 * Only the two currencies this business signs in are supported by name; any other code falls back
 * to the code itself (e.g. `SAY RUB 3601.20 ONLY`), which is honest rather than wrong.
 */

const CN_DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'] as const
const CN_UNITS = ['', '拾', '佰', '仟'] as const
const CN_GROUPS = ['', '万', '亿', '兆'] as const
const EN_ONES = [
  'ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
  'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN',
] as const
const EN_TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'] as const

const CURRENCY_WORDS: Record<string, { cn: string; enSingular: string; enPlural: string; subCn: string; subEn: string }> = {
  CNY: { cn: '人民币', enSingular: 'YUAN', enPlural: 'YUAN', subCn: '分', subEn: 'FEN' },
  USD: { cn: '美元', enSingular: 'DOLLAR', enPlural: 'DOLLARS', subCn: '美分', subEn: 'CENTS' },
}

type AmountParts = {
  integerPart: string
  fractionPart: string
  /** Fraction digits the input carried, so `100` and `100.00` stay distinguishable. */
  fractionLength: number
}

function splitAmount(amount: string): AmountParts | null {
  const trimmed = amount.trim()
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null
  const [integerPart, fractionPart = ''] = trimmed.split('.')
  return { integerPart, fractionPart, fractionLength: fractionPart.length }
}

/** `1234` → `壹仟贰佰叁拾肆`; groups are joined with 万/亿 and zero runs collapse. */
function integerToChineseGroup(group: string): string {
  let result = ''
  let zeroPending = false
  const digits = group.padStart(4, '0').slice(-4)
  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[index])
    const unit = CN_UNITS[digits.length - 1 - index]
    if (digit === 0) {
      zeroPending = result.length > 0
      continue
    }
    if (zeroPending) {
      result += CN_DIGITS[0]
      zeroPending = false
    }
    result += `${CN_DIGITS[digit]}${unit}`
  }
  return result
}

function integerToChinese(value: string): string {
  if (/^0+$/.test(value)) return CN_DIGITS[0]
  const groups: string[] = []
  let remaining = value
  while (remaining.length > 0) {
    groups.unshift(remaining.slice(-4))
    remaining = remaining.slice(0, -4)
  }

  let result = ''
  for (let index = 0; index < groups.length; index += 1) {
    const groupValue = Number(groups[index])
    const groupUnit = CN_GROUPS[groups.length - 1 - index]
    if (groupValue === 0) {
      // A whole empty group only needs a single 零 marker between non-empty neighbours.
      if (result.length > 0 && !result.endsWith(CN_DIGITS[0])) result += CN_DIGITS[0]
      continue
    }
    const rendered = integerToChineseGroup(groups[index])
    if (result.length > 0 && Number(groups[index]) < 1000 && !result.endsWith(CN_DIGITS[0])) {
      result += CN_DIGITS[0]
    }
    result += `${rendered}${groupUnit}`
  }
  return result
}

function integerToEnglish(value: string): string {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric === 0) return EN_ONES[0]
  if (numeric < 20) return EN_ONES[numeric]!
  if (numeric < 100) {
    const tens = Math.floor(numeric / 10)
    const rest = numeric % 10
    return rest === 0 ? EN_TENS[tens]! : `${EN_TENS[tens]}-${EN_ONES[rest]}`
  }
  if (numeric < 1000) {
    const hundreds = Math.floor(numeric / 100)
    const rest = numeric % 100
    return rest === 0
      ? `${EN_ONES[hundreds]} HUNDRED`
      : `${EN_ONES[hundreds]} HUNDRED AND ${integerToEnglish(String(rest))}`
  }

  for (const [scale, word] of [[1_000_000_000, 'BILLION'], [1_000_000, 'MILLION'], [1_000, 'THOUSAND']] as const) {
    if (numeric >= scale) {
      const head = Math.floor(numeric / scale)
      const rest = numeric % scale
      return rest === 0
        ? `${integerToEnglish(String(head))} ${word}`
        : `${integerToEnglish(String(head))} ${word} ${integerToEnglish(String(rest))}`
    }
  }
  return String(numeric)
}

/**
 * Chinese rendering: `人民币壹仟贰佰叁拾肆元伍角陆分`. A zero fraction digit is stated as 零
 * (`…元零伍分`), which is how a Chinese invoice writes it.
 */
export function amountInChineseWords(amount: string, currencyCode: string): string {
  const parts = splitAmount(amount)
  if (!parts) return amount
  const words = CURRENCY_WORDS[currencyCode.toUpperCase()]
  const prefix = words?.cn ?? currencyCode.toUpperCase()

  const integerWords = integerToChinese(parts.integerPart)
  const jiao = parts.fractionLength > 0 ? Number(parts.fractionPart[0] ?? '0') : 0
  const fen = parts.fractionLength > 1 ? Number(parts.fractionPart[1] ?? '0') : 0

  let fraction = ''
  if (jiao === 0 && fen === 0) {
    fraction = '整'
  } else {
    if (jiao > 0) fraction += `${CN_DIGITS[jiao]}角`
    else fraction += '零'
    if (fen > 0) fraction += `${CN_DIGITS[fen]}分`
    else if (jiao > 0) fraction += '整'
  }
  return `${prefix}${integerWords}元${fraction}`
}

/**
 * English rendering: `SAY YUAN ONE THOUSAND TWO HUNDRED THIRTY-FOUR AND FEN FIFTY-SIX ONLY`.
 *
 * The minor unit is exactly two digits: the amount arrives at the *stored* scale (`3601.2000`),
 * and reading more digits would turn 20 fen into "TWO THOUSAND". The currency name appears once and
 * is followed by the minor unit, which is how a trade contract spells it out.
 */
export function amountInEnglishWords(amount: string, currencyCode: string): string {
  const parts = splitAmount(amount)
  if (!parts) return amount
  const code = currencyCode.toUpperCase()
  const words = CURRENCY_WORDS[code]

  const integerWords = integerToEnglish(parts.integerPart)
  const minor = parts.fractionLength > 0 ? parts.fractionPart.slice(0, 2).padEnd(2, '0') : '00'
  const minorValue = Number(minor)

  const majorName = words
    ? (Number(parts.integerPart) === 1 ? words.enSingular : words.enPlural)
    : code
  const minorName = words ? words.subEn : 'CENTS'

  if (minorValue === 0) {
    return `SAY ${majorName} ${integerWords} ONLY`.toUpperCase()
  }
  return `SAY ${majorName} ${integerWords} AND ${minorName} ${integerToEnglish(String(minorValue))} ONLY`.toUpperCase()
}

/** The pair printed on the contract: the Chinese 大写 and the English words. */
export function amountInWords(amount: string, currencyCode: string): { chinese: string; english: string } {
  return {
    chinese: amountInChineseWords(amount, currencyCode),
    english: amountInEnglishWords(amount, currencyCode),
  }
}
