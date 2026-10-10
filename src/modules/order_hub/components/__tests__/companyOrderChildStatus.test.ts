import { describe, expect, it } from '@jest/globals'
import type { DictionaryMap } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { childStatusAppearance } from '../companyOrderChildStatus'

/**
 * The hub row's status badge (REQ-031, REQ-051, TEST-022/TEST-034).
 *
 * Sales orders written before the status field was used carry none (8 of the 9 rows in the
 * development database), and the row rendered a status badge reading 「—」 — the noise the owner
 * asked about. The helper answers `null` for "no status" so the row renders nothing at all.
 *
 * It also answers the **colour**: the purchase vocabulary's own tones (the same ones
 * `PurchaseOrderStatusBadge` draws) and the sales dictionary's hex, so a status cannot be one colour
 * here and another on the module's own page (owner 2026-10-10: 不同状态需要用颜色区分).
 */

const t = ((key: string) => `t:${key}`) as TranslateFn

const salesDictionary: DictionaryMap = {
  draft: { value: 'draft', label: '报价', color: '#94a3b8' },
  sent: { value: 'sent', label: '已发送', color: '#0ea5e9' },
}

describe('childStatusAppearance', () => {
  it('answers null for a child without a status, so no empty badge is rendered', () => {
    expect(childStatusAppearance(t, 'internal_sales_order', null, salesDictionary)).toBeNull()
    expect(childStatusAppearance(t, 'external_sales_order', null, null)).toBeNull()
    expect(childStatusAppearance(t, 'purchase_order', null, null)).toBeNull()
  })

  it('translates a sales status through the sales dictionary and keeps its colour', () => {
    expect(childStatusAppearance(t, 'internal_sales_order', 'draft', salesDictionary)).toEqual({
      label: '报价',
      tone: null,
      color: '#94a3b8',
    })
    expect(childStatusAppearance(t, 'external_sales_order', 'sent', salesDictionary)?.color).toBe('#0ea5e9')
  })

  it('falls back to the raw code when the dictionary does not know it', () => {
    expect(childStatusAppearance(t, 'internal_sales_order', 'unknown_code', salesDictionary)).toEqual({
      label: 'unknown_code',
      tone: null,
      color: null,
    })
    expect(childStatusAppearance(t, 'external_sales_order', 'draft', null)?.label).toBe('draft')
  })

  it('maps the purchase vocabulary to its label and tone', () => {
    expect(childStatusAppearance(t, 'purchase_order', 'received', null)).toEqual({
      label: 't:purchasing.orders.status.received',
      tone: 'success',
      color: null,
    })
    expect(childStatusAppearance(t, 'purchase_order', 'cancelled', null)?.tone).toBe('error')
    expect(childStatusAppearance(t, 'purchase_order', 'placed', null)?.tone).toBe('info')
  })

  it('keeps an unknown purchase status as-is, in the neutral tone', () => {
    expect(childStatusAppearance(t, 'purchase_order', 'legacy_code', null)).toEqual({
      label: 'legacy_code',
      tone: 'neutral',
      color: null,
    })
  })
})
