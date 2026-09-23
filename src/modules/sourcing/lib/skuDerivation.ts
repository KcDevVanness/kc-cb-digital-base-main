/**
 * Derives the SKU a quotation line would promote as.
 *
 * The rule is fixed by the owner and matches how the reference file actually behaves:
 * `products_products.sku` is unique per organization (soft-deleted rows included), while
 * PetKit reuses one Item No. for several variants — `P4108` appears twice (base and UVC),
 * `P9906` twice, `PD10` twice, `PKCL11`-style rows repeat too. So the first row of an Item
 * No. group keeps the Item No. and every later row appends a variant token taken from the
 * name difference (`P4108-UVC`, `P41171-5PCS`, `PKCL10-4BAGS`). When the names differ in no
 * usable token the row falls back to `-2`, `-3`, … and is flagged so the operator can name it.
 *
 * A row without an Item No. falls back to a slug of its name; a name that cannot produce a
 * usable slug (CJK-only, symbols) yields no SKU at all and the line is blocked from
 * promotion until the operator types one.
 */

import { NULL_TOKENS, slugifySku, splitVariantName } from './valueNormalization'

export type SkuWarning = 'sku_required' | 'sku_from_name' | 'duplicate_sku_in_file' | 'sku_suffix_fallback'

export type DerivedSku = {
  sku: string | null
  variantLabel: string | null
  warnings: SkuWarning[]
  /** True when the operator should review the generated value (name slug or numeric suffix). */
  generated: boolean
}

const SKU_PATTERN = /^[A-Za-z0-9._\-/]{1,64}$/
const MAX_SKU_LENGTH = 64
const MAX_VARIANT_LENGTH = 20

/** Keeps only the characters `products_products.sku` accepts; null when nothing usable is left. */
export function sanitizeSkuCandidate(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).replace(/\s+/g, ' ').trim()
  if (trimmed.length === 0 || NULL_TOKENS[trimmed.toLowerCase()] === true) return null
  const cleaned = trimmed.replace(/[^A-Za-z0-9._\-/]+/g, '').replace(/^[._\-/]+|[._\-/]+$/g, '')
  if (cleaned.length === 0) return null
  return cleaned.slice(0, MAX_SKU_LENGTH)
}

function tokenizeName(value: string | null | undefined): string[] {
  if (!value) return []
  const { base, variantTokens } = splitVariantName(value)
  return [base, ...variantTokens]
    .join(' ')
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token.length > 0)
}

/**
 * First token that appears in the variant's name but not in the group's first name, shaped as
 * a SKU suffix (`uvc` → `UVC`, `5pcs` → `5PCS`). Null when the names carry no distinguishing
 * token, which is when the caller falls back to an ordinal suffix.
 */
export function variantSuffix(candidateName: string | null | undefined, baseName: string | null | undefined): string | null {
  const candidateTokens = tokenizeName(candidateName)
  if (candidateTokens.length === 0) return null
  const baseTokens = new Set(tokenizeName(baseName).map((token) => token.toUpperCase()))
  for (const token of candidateTokens) {
    const upper = token.toUpperCase()
    if (baseTokens.has(upper)) continue
    const suffix = upper.replace(/[^A-Z0-9]+/g, '').slice(0, MAX_VARIANT_LENGTH)
    if (suffix.length > 0) return suffix
  }
  return null
}

function appendSuffix(base: string, suffix: string): string {
  const room = Math.max(1, MAX_SKU_LENGTH - suffix.length - 1)
  return `${base.slice(0, room)}-${suffix}`
}

/**
 * Derives one SKU per line, in input order. Duplicates inside the file are suffixed with
 * `-2`, `-3`, … and flagged, so a promotion can never collide on the unique index.
 */
export function deriveLineSkus(
  lines: readonly { itemNo: string | null | undefined; productName: string | null | undefined }[],
): DerivedSku[] {
  const baseSkus = lines.map((line) => sanitizeSkuCandidate(line.itemNo))
  const groups = new Map<string, number[]>()
  baseSkus.forEach((base, index) => {
    if (!base) return
    const groupKey = base.toUpperCase()
    const members = groups.get(groupKey) ?? []
    members.push(index)
    groups.set(groupKey, members)
  })

  const results: DerivedSku[] = baseSkus.map(() => ({ sku: null, variantLabel: null, warnings: [], generated: false }))
  for (const members of groups.values()) {
    const firstIndex = members[0]
    const base = baseSkus[firstIndex] as string
    members.forEach((lineIndex, position) => {
      if (position === 0) {
        results[lineIndex].sku = base
        return
      }
      const suffix = variantSuffix(lines[lineIndex].productName, lines[firstIndex].productName)
      const resolved = suffix ?? String(position + 1)
      const warnings: SkuWarning[] = suffix ? [] : ['sku_suffix_fallback']
      results[lineIndex] = {
        sku: appendSuffix(base, resolved),
        variantLabel: resolved,
        warnings,
        generated: suffix === null,
      }
    })
  }

  const claimedBy = new Map<string, number>()
  results.forEach((result, index) => {
    if (!result.sku) {
      const slug = slugifySku(lines[index].productName)
      if (slug.length < 2) {
        results[index] = { sku: null, variantLabel: null, warnings: ['sku_required'], generated: false }
        return
      }
      results[index] = { sku: slug, variantLabel: null, warnings: ['sku_from_name'], generated: true }
    }
    const key = (results[index].sku as string).toUpperCase()
    // First claim wins: the earlier line keeps the plain value and later lines are suffixed.
    if (!claimedBy.has(key)) claimedBy.set(key, index)
  })

  results.forEach((result, index) => {
    if (!result.sku) return
    const owner = claimedBy.get(result.sku.toUpperCase())
    if (owner === undefined || owner === index) return
    let ordinal = 2
    let next = appendSuffix(result.sku, String(ordinal))
    while (claimedBy.has(next.toUpperCase())) {
      ordinal += 1
      next = appendSuffix(result.sku, String(ordinal))
    }
    claimedBy.set(next.toUpperCase(), index)
    results[index] = {
      ...result,
      sku: next,
      variantLabel: String(ordinal),
      warnings: [...result.warnings, 'duplicate_sku_in_file'],
      generated: true,
    }
  })

  return results.map((result) =>
    result.sku && !SKU_PATTERN.test(result.sku)
      ? { sku: null, variantLabel: null, warnings: [...result.warnings, 'sku_required' as SkuWarning], generated: false }
      : result,
  )
}
