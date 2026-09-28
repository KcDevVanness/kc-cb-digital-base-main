"use client"

import * as React from 'react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { useCodeListOptions } from '../lib/codeListOptions'
import {
  PRODUCT_BRAND_DICTIONARY_KEY,
  PRODUCT_CATEGORY_DICTIONARY_KEY,
} from '../../product_codes/lib/dictionaryValues'

/**
 * 商品 SKU — the field, the generator, and the reading of whatever is in it, as one block.
 *
 * This is the form's `supplierSku` field (`type: 'custom'`), not a panel beside it: the SKU, the brand
 * it is generated from, the category, the 生成 button and the breakdown of the stored characters are
 * one task, so they live in one place. A separate block below the field made the operator read the
 * generator as unrelated to the value it writes, and made the brand look like two different brands
 * (owner 2026-09-24: 「商品 SKU 和品牌和生成工具应该放在一起…生成出来的 SKU 编号，就可以应用到商品 SKU」).
 *
 * It does three things, all through the `product_codes` module's real endpoints:
 *
 * 1. **拆解** — the code in the field is parsed on every change, so the line under the input always
 *    explains the stored characters: `品牌 PetKit（PK）· 类别 猫砂（CL）· 序列 007`.
 * 2. **生成** — issues the next code for the rule (a real issuance: the number is spent even if the
 *    row is never saved, which is what makes "never reused" true) and writes it into the field.
 * 3. **改用规范编码** — for a row that already carries a hand-typed or legacy code: generates a regular
 *    one and records the retired code as an alias, so search still finds the row by the old characters.
 *    Disabled once the row is promoted, because the master's SKU must not diverge from the library's.
 *
 * The brand is the **form field directly above** (`brandValue`, the row's override) — this block never
 * offers a second editor for it. What it does add is the resolution: the row's brand, else the
 * supplier's default brand, and nothing at all is a disabled button with a hint naming the field.
 * 类别 is picked from the `product_category` dictionary — the same list the issuing command validates
 * against, so a value that cannot produce a code is not offerable in the first place.
 */

type CodePart = { key: string; kind: string; value: string; label: string | null; known: boolean }
type ParseResult = {
  status: 'issued' | 'full' | 'partial' | 'none'
  source: 'generated' | 'unissued'
  ruleName: string | null
  parts: CodePart[]
}
type GenerateResult = { code: string; ruleName: string; parts: CodePart[] }

// `readApiResultOrThrow` takes the **full** path — unlike `fetchCrudList`, which prefixes `/api/`
// itself. Getting this wrong is a 404 the operator reads as "the feature is broken".
const PARSE_PATH = '/api/product_codes/parse'
const GENERATE_PATH = '/api/product_codes/generate'
const ALIAS_PATH = '/api/product_codes/aliases'
const SUPPLIERS_PATH = '/api/purchasing/suppliers'

/** The field's own cap, mirrored from the `supplierSku` validator (`max(120)`). */
const MAX_SKU_LENGTH = 120

function badgeVariant(status: ParseResult['status']): 'success' | 'neutral' | 'warning' {
  if (status === 'issued') return 'success'
  if (status === 'none') return 'neutral'
  return 'warning'
}

function describeParts(parts: CodePart[]): string {
  return parts.map((part) => (part.label && part.label !== part.value ? `${part.label}（${part.value}）` : part.value)).join(' · ')
}

export default function SupplierProductCodePanel({
  id,
  value,
  values,
  setValue,
  disabled,
  autoFocus,
  t,
  rowId,
  masterProductId,
}: CrudCustomFieldRenderProps & { t: TranslateFn; rowId: string | null; masterProductId: string | null }) {
  const { options: brandOptions } = useCodeListOptions(PRODUCT_BRAND_DICTIONARY_KEY)
  const { options: categoryOptions, loading: categoryLoading } = useCodeListOptions(PRODUCT_CATEGORY_DICTIONARY_KEY)
  const record = values as { brandValue?: string; supplierId?: string }
  const code = String(value ?? '')
  const brand = String(record.brandValue ?? '')
  const supplierId = String(record.supplierId ?? '')

  const [category, setCategory] = React.useState('')
  const [parsed, setParsed] = React.useState<ParseResult | null>(null)
  const [supplierBrand, setSupplierBrand] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    const trimmed = code.trim()
    if (!trimmed) {
      setParsed(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const result = await readApiResultOrThrow<ParseResult>(`${PARSE_PATH}?code=${encodeURIComponent(trimmed)}`)
        if (!cancelled) setParsed(result)
      } catch {
        // A parse failure is not worth an error banner: the code simply shows without an explanation.
        if (!cancelled) setParsed(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code])

  React.useEffect(() => {
    if (brand.trim().length > 0 || !supplierId) return
    let cancelled = false
    void (async () => {
      try {
        const payload = await readApiResultOrThrow<{ items?: Array<{ brandValue?: string | null }> }>(
          `${SUPPLIERS_PATH}?ids=${encodeURIComponent(supplierId)}`,
        )
        if (!cancelled) setSupplierBrand(String(payload.items?.[0]?.brandValue ?? ''))
      } catch {
        if (!cancelled) setSupplierBrand('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [brand, supplierId])

  const effectiveBrand = brand.trim() || supplierBrand
  // Offer the category unless we *know* the rule does not read one. A legacy code has no breakdown at
  // all (`parts` is empty), which is exactly the case 改用规范编码 exists for — hiding the input there
  // made the button unusable, so "unknown" means "show it".
  const needsCategory = parsed === null || parsed.parts.length === 0 || parsed.parts.some((part) => part.key === 'category')
  // The label of the brand the code will be generated under (`PK — PetKit`); a value the dictionary no
  // longer lists renders as itself, exactly as the picker above does.
  const effectiveBrandLabel = brandOptions.find((option) => option.value === effectiveBrand)?.label ?? effectiveBrand
  const inheritsSupplierBrand = brand.trim().length === 0 && supplierBrand.trim().length > 0
  const categoryListEmpty = !categoryLoading && categoryOptions.length === 0

  const generate = async (retireCurrentCode: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const issued = await readApiResultOrThrow<GenerateResult>(GENERATE_PATH, {
        method: 'POST',
        body: JSON.stringify({
          brandValue: effectiveBrand,
          categoryValue: category.trim() || undefined,
          dryRun: false,
        }),
      })
      if (retireCurrentCode && rowId && code.trim().length > 0) {
        await readApiResultOrThrow(ALIAS_PATH, {
          method: 'POST',
          body: JSON.stringify({
            aliasCode: code.trim(),
            targetKind: 'supplier_product',
            targetId: rowId,
            note: t('purchasing.supplierProducts.code.aliasNote'),
          }),
        })
      }
      setValue(issued.code)
      setParsed({ status: 'issued', source: 'generated', ruleName: issued.ruleName, parts: issued.parts })
    } catch (generateError) {
      setError(generateError instanceof Error && generateError.message ? generateError.message : t('purchasing.supplierProducts.code.generateFailed'))
    } finally {
      setBusy(false)
    }
  }

  const canRetire = code.trim().length > 0 && parsed?.status !== 'issued' && rowId !== null && masterProductId === null
  const generateDisabled = busy || disabled || effectiveBrand.length === 0 || (needsCategory && category.trim().length === 0)

  return (
    <div className="flex flex-col gap-2">
      <Input
        id={id}
        value={code}
        onChange={(event) => setValue(event.target.value)}
        maxLength={MAX_SKU_LENGTH}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={t('purchasing.supplierProducts.form.field.supplierSku', 'Product SKU (ours)')}
      />

      {/* The generator sits directly under the value it writes — one block, one reading order. */}
      <div className="flex flex-wrap items-end gap-3">
        {needsCategory ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('purchasing.supplierProducts.code.category')}</span>
            <Select value={category} onValueChange={setCategory} disabled={disabled}>
              <SelectTrigger className="w-40" aria-label={t('purchasing.supplierProducts.code.category')}>
                <SelectValue placeholder={t('purchasing.supplierProducts.code.categoryPlaceholder', 'Pick a category')} />
              </SelectTrigger>
              <SelectContent>
                {categoryOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <Button type="button" variant="outline" disabled={generateDisabled} onClick={() => void generate(false)}>
          {t('purchasing.supplierProducts.code.generate')}
        </Button>
        {canRetire ? (
          <Button type="button" variant="outline" disabled={generateDisabled} onClick={() => void generate(true)}>
            {t('purchasing.supplierProducts.code.retire')}
          </Button>
        ) : null}
        {busy ? <Spinner /> : null}
      </div>

      {parsed ? (
        <div className="flex flex-col gap-1" aria-live="polite">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm">{code.trim()}</span>
            <StatusBadge variant={badgeVariant(parsed.status)} dot>
              {t(`purchasing.supplierProducts.code.status.${parsed.status}`)}
            </StatusBadge>
          </div>
          <span className="text-sm text-muted-foreground">
            {parsed.parts.length > 0 ? describeParts(parsed.parts) : t('purchasing.supplierProducts.code.legacyHint')}
          </span>
          {parsed.status === 'partial' ? (
            <span className="text-xs text-muted-foreground">{t('purchasing.supplierProducts.code.partialHint')}</span>
          ) : null}
        </div>
      ) : null}

      {/*
        The generator is a helper, not the owner of the value: the rule describes the shape of *one*
        brand's codes, and a brand it does not describe is typed by hand exactly as before. Saying so
        here is what keeps 生成 from reading as "this field is machine-managed".
      */}
      <p className="text-xs text-muted-foreground">
        {t(
          'purchasing.supplierProducts.code.editableHint',
          'Generate only fills a starting value into “Product SKU”; edit it freely — a code no rule describes is still typed by hand.',
        )}
      </p>

      {inheritsSupplierBrand ? (
        <p className="text-xs text-muted-foreground">
          {t(
            'purchasing.supplierProducts.code.brandInherited',
            'Blank uses the supplier’s default brand: {brand}',
            { brand: effectiveBrandLabel },
          )}
        </p>
      ) : null}
      {effectiveBrand.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('purchasing.supplierProducts.code.brandMissing')}</p>
      ) : null}
      {needsCategory && categoryListEmpty ? (
        <p className="text-xs text-muted-foreground">
          {t(
            'purchasing.supplierProducts.code.categoryMissing',
            'No categories are available: add one to the product_category dictionary, or reload the page.',
          )}
        </p>
      ) : null}

      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </div>
  )
}
