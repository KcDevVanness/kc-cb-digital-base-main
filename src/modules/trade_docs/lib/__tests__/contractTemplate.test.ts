import { describe, expect, it } from '@jest/globals'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { amountInChineseWords, amountInEnglishWords, amountInWords } from '../amountInWords'
import { buildContractSheet, CONTRACT_TEMPLATE_ID } from '../contractTemplate'

/**
 * Stands in for the platform translator: the dictionary entry when the locale has one, the
 * component-side English fallback otherwise — the same order the real translator uses.
 */
function translatorFor(dictionary: Record<string, string> = {}): TranslateFn {
  return ((key: string, fallback?: unknown) =>
    dictionary[key] ?? (typeof fallback === 'string' ? fallback : key)) as TranslateFn
}

const ENGLISH = translatorFor()
const CHINESE = translatorFor({ 'trade_docs.contracts.print.purchaseTitle': '采购合同' })

describe('amountInChineseWords', () => {
  it('renders whole yuan with 整', () => {
    expect(amountInChineseWords('0', 'CNY')).toBe('人民币零元整')
    expect(amountInChineseWords('100', 'CNY')).toBe('人民币壹佰元整')
  })

  it('renders fen without jiao with the zero marker', () => {
    expect(amountInChineseWords('0.05', 'CNY')).toBe('人民币零元零伍分')
    expect(amountInChineseWords('1000.01', 'CNY')).toBe('人民币壹仟元零壹分')
  })

  it('renders jiao and closes with 整 when there is no fen', () => {
    expect(amountInChineseWords('100.5', 'CNY')).toBe('人民币壹佰元伍角整')
  })

  it('renders a large amount across 万 and 仟 groups', () => {
    expect(amountInChineseWords('1234567.89', 'CNY')).toBe('人民币壹佰贰拾叁万肆仟伍佰陆拾柒元捌角玖分')
  })

  it('names the currency and falls back to the code for an unknown one', () => {
    expect(amountInChineseWords('12', 'USD')).toBe('美元壹拾贰元整')
    expect(amountInChineseWords('12', 'RUB')).toBe('RUB壹拾贰元整')
  })

  it('returns the input unchanged when it is not a plain decimal', () => {
    expect(amountInChineseWords('1,234.00', 'CNY')).toBe('1,234.00')
  })
})

describe('amountInEnglishWords', () => {
  it('names the minor unit of the currency and closes with ONLY', () => {
    expect(amountInEnglishWords('0', 'CNY')).toBe('SAY YUAN ZERO ONLY')
    expect(amountInEnglishWords('100.5', 'CNY')).toBe('SAY YUAN ONE HUNDRED AND FEN FIFTY ONLY')
  })

  it('renders the minor unit even when it is a single digit', () => {
    expect(amountInEnglishWords('1000.01', 'CNY')).toBe('SAY YUAN ONE THOUSAND AND FEN ONE ONLY')
  })

  it('renders a large amount with scale words and hyphens', () => {
    expect(amountInEnglishWords('1234567.89', 'CNY')).toBe(
      'SAY YUAN ONE MILLION TWO HUNDRED AND THIRTY-FOUR THOUSAND FIVE HUNDRED AND SIXTY-SEVEN AND FEN EIGHTY-NINE ONLY',
    )
  })

  it('reads the minor unit from two digits of the stored scale', () => {
    // The money engine stores four decimals; 20 fen must not become "TWO THOUSAND".
    expect(amountInEnglishWords('3601.2000', 'CNY')).toBe(
      'SAY YUAN THREE THOUSAND SIX HUNDRED AND ONE AND FEN TWENTY ONLY',
    )
    expect(amountInEnglishWords('3601.0000', 'CNY')).toBe('SAY YUAN THREE THOUSAND SIX HUNDRED AND ONE ONLY')
  })

  it('uses the configured currency words for USD', () => {
    expect(amountInEnglishWords('1234.56', 'USD')).toBe(
      'SAY DOLLARS ONE THOUSAND TWO HUNDRED AND THIRTY-FOUR AND CENTS FIFTY-SIX ONLY',
    )
  })
})

describe('amountInWords', () => {
  it('returns both renderings for the same quantized amount', () => {
    expect(amountInWords('3601.20', 'CNY')).toEqual({
      chinese: '人民币叁仟陆佰零壹元贰角整',
      english: 'SAY YUAN THREE THOUSAND SIX HUNDRED AND ONE AND FEN TWENTY ONLY',
    })
  })
})

describe('buildContractSheet', () => {
  const input = {
    number: 'PC-2026-0001',
    direction: 'purchase',
    status: 'issued',
    currencyCode: 'CNY',
    priceTier: 'purchase',
    signedAt: '2026-09-22',
    deliveryDate: '2026-10-15',
    paymentTerms: '30% 定金 + 70% 尾款',
    shippingMethod: '海运',
    destination: '圣彼得堡',
    marks: 'PK-W5C / 1-40',
    notes: null,
    counterparty: { name: '广州某某代理商' },
    ourParty: { name: '广州总部' },
    contractTotal: '3601.2000',
    financeTotal: '3600.0000',
    differenceTotal: '1.2000',
    lines: [
      {
        lineNumber: 1,
        name: 'Petkit 无线饮水机 W5C',
        sku: 'PK-W5C',
        model: 'W5C',
        spec: '白色 / 1.5L',
        unit: 'PCS',
        quantity: '3.000000',
        unitPrice: '1200.400000',
        contractAmount: '3601.2000',
        note: null,
      },
    ],
  }

  it('is the shipped default template revision', () => {
    expect(CONTRACT_TEMPLATE_ID).toBe('default@1')
  })

  it('names the sheet after the contract number and titles the direction', () => {
    const sheet = buildContractSheet(input, ENGLISH)
    expect(sheet.name).toBe('PC-2026-0001')
    expect(sheet.rows[0]?.[0]).toBe('Purchase contract')
  })

  it('takes every label from the translator, so the document follows the locale', () => {
    // A locale whose dictionary only carries the title still renders one language throughout:
    // no label is a hand-written pair, so nothing renders bilingual.
    const sheet = buildContractSheet(input, CHINESE)
    expect(sheet.rows[0]?.[0]).toBe('采购合同')
    expect(sheet.rows[1]?.[0]).toBe('Contract no.')
    // The data stays data: a Chinese party name is not translated.
    expect(sheet.rows[2]?.[1]).toBe('广州总部')
  })

  it('writes the header block, then the line grid, then the three totals', () => {
    const sheet = buildContractSheet(input, ENGLISH)
    const lineHeaderIndex = sheet.rows.findIndex((row) => row[0] === 'No.')
    expect(lineHeaderIndex).toBeGreaterThan(0)
    expect(sheet.rows[lineHeaderIndex + 1]?.[1]).toBe('Petkit 无线饮水机 W5C')
    // Totals follow the single line, and the words rows close the sheet.
    expect(sheet.rows[lineHeaderIndex + 3]?.[6]).toBe('Contract total')
    expect(sheet.rows[lineHeaderIndex + 4]?.[6]).toBe('Finance total')
    expect(sheet.rows[lineHeaderIndex + 5]?.[6]).toBe('Difference')
    expect(sheet.rows[lineHeaderIndex + 6]?.[0]).toBe('Amount in words')
  })

  it('writes amounts as numbers so Excel can sum the column', () => {
    const sheet = buildContractSheet(input, ENGLISH)
    const lineHeaderIndex = sheet.rows.findIndex((row) => row[0] === 'No.')
    const lineRow = sheet.rows[lineHeaderIndex + 1]!
    expect(typeof lineRow[7]).toBe('number')
    expect(lineRow[7]).toBe(3601.2)
    expect(typeof sheet.rows[lineHeaderIndex + 3]?.[7]).toBe('number')
    expect(sheet.rows[lineHeaderIndex + 3]?.[7]).toBe(3601.2)
  })

  it('prints both word forms of the amount, as the bank/customs convention requires', () => {
    const sheet = buildContractSheet(input, ENGLISH)
    const wordsIndex = sheet.rows.findIndex((row) => row[0] === 'Amount in words')
    expect(sheet.rows[wordsIndex]?.[1]).toBe('人民币叁仟陆佰零壹元贰角整')
    expect(String(sheet.rows[wordsIndex + 1]?.[1])).toContain('SAY YUAN THREE THOUSAND SIX HUNDRED AND ONE')
  })
})
