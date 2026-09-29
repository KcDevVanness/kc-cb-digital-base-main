import { describe, expect, it } from '@jest/globals'
import { catalogLinkLabel } from '../catalogLink'

/**
 * The label shape the catalog-link picker renders for a product, both in its option list and when
 * the value is already set on the form.
 *
 * The two must not diverge: a value the option list calls `SKU — title` cannot come back as the raw
 * uuid once the field is pre-selected (the bug this module was extracted for).
 */
describe('catalog link label', () => {
  it('joins sku and title', () => {
    expect(catalogLinkLabel({ id: 'x', sku: 'P4108-UVC', title: 'UVC 灯管' })).toBe('P4108-UVC — UVC 灯管')
  })

  it('falls back to the name key when the projection spells it name', () => {
    expect(catalogLinkLabel({ id: 'x', sku: 'SKU-1', name: 'Product name' })).toBe('SKU-1 — Product name')
  })

  it('uses whichever half exists', () => {
    expect(catalogLinkLabel({ id: 'x', sku: 'SKU-1' })).toBe('SKU-1')
    expect(catalogLinkLabel({ id: 'x', title: 'Only a title' })).toBe('Only a title')
  })

  it('never returns an empty string for a record that carries only an id', () => {
    expect(catalogLinkLabel({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  })

  it('treats blank halves as absent', () => {
    expect(catalogLinkLabel({ id: 'x', sku: '   ', title: 'T' })).toBe('T')
  })
})
