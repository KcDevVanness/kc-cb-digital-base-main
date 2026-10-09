import { describe, expect, it } from '@jest/globals'
import type { DictionaryMap } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { childStatusLabel } from '../companyOrderChildStatus'

/**
 * The hub row's status-badge gate (REQ-031, TEST-022).
 *
 * Sales orders written before the status field was used carry none (8 of the 9 rows in the
 * development database), and the row rendered a status badge reading 「—」 — the noise the owner
 * asked about. The helper answers `null` for "no status" so the row renders nothing at all; the
 * label mapping itself (sales dictionary / purchase vocabulary / raw value) is covered here too.
 */

const t = ((key: string) => `t:${key}`) as TranslateFn

const salesDictionary: DictionaryMap = {
  draft: { value: 'draft', label: '报价' },
  sent: { value: 'sent', label: '已发送' },
}

describe('childStatusLabel', () => {
  it('answers null for a child without a status, so no empty badge is rendered', () => {
    expect(childStatusLabel(t, 'internal_sales_order', null, salesDictionary)).toBeNull()
    expect(childStatusLabel(t, 'external_sales_order', null, null)).toBeNull()
    expect(childStatusLabel(t, 'purchase_order', null, null)).toBeNull()
  })

  it('translates a sales status through the sales dictionary', () => {
    expect(childStatusLabel(t, 'internal_sales_order', 'draft', salesDictionary)).toBe('报价')
    expect(childStatusLabel(t, 'external_sales_order', 'sent', salesDictionary)).toBe('已发送')
  })

  it('falls back to the raw code when the dictionary does not know it', () => {
    expect(childStatusLabel(t, 'internal_sales_order', 'unknown_code', salesDictionary)).toBe('unknown_code')
    expect(childStatusLabel(t, 'external_sales_order', 'draft', null)).toBe('draft')
  })

  it('maps the purchase vocabulary and keeps an unknown value as-is', () => {
    expect(childStatusLabel(t, 'purchase_order', 'received', null)).toBe('t:purchasing.orders.status.received')
    expect(childStatusLabel(t, 'purchase_order', 'legacy_code', null)).toBe('legacy_code')
  })
})
