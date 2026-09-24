import type { EntityManager } from '@mikro-orm/postgresql'
import { Currency } from '@open-mercato/core/modules/currencies/data/entities'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import {
  BASE_CURRENCY_CODE,
  POLICY_CURRENCIES,
  normalizeCurrencyCode,
  resolveCurrencyName,
  type PolicyCurrency,
} from './policy'

export type CurrencyPolicyScope = { tenantId: string; organizationId: string }

export type CurrencyPolicyOutcome = {
  /** Currency codes newly created in the FX master. */
  created: string[]
  /** Currency codes whose master row was brought back in line with the policy. */
  updated: string[]
  /** Currency codes switched off (`is_active = false`) because they left the policy. */
  deactivated: string[]
  dictionaryCreated: boolean
  entriesAdded: string[]
  entriesUpdated: string[]
  entriesRemoved: string[]
}

const CURRENCY_DICTIONARY_KEY = 'currency'
const LEGACY_CURRENCY_DICTIONARY_KEY = 'currencies'

/** Brings one currency row in line with the policy; returns whether anything was assigned. */
function assignCurrencyFields(
  currency: Currency,
  definition: PolicyCurrency,
  name: string,
  isBase: boolean,
): boolean {
  let changed = false
  if (currency.name !== name) {
    currency.name = name
    changed = true
  }
  if ((currency.symbol ?? null) !== definition.symbol) {
    currency.symbol = definition.symbol
    changed = true
  }
  if (currency.decimalPlaces !== definition.decimalPlaces) {
    currency.decimalPlaces = definition.decimalPlaces
    changed = true
  }
  if ((currency.decimalSeparator ?? null) !== definition.decimalSeparator) {
    currency.decimalSeparator = definition.decimalSeparator
    changed = true
  }
  if ((currency.thousandsSeparator ?? null) !== definition.thousandsSeparator) {
    currency.thousandsSeparator = definition.thousandsSeparator
    changed = true
  }
  if (currency.isBase !== isBase) {
    currency.isBase = isBase
    changed = true
  }
  if (!currency.isActive) {
    currency.isActive = true
    changed = true
  }
  if (currency.deletedAt) {
    currency.deletedAt = null
    changed = true
  }
  return changed
}

/**
 * Reconciles both currency stores of one organization scope to `POLICY_CURRENCIES`:
 * the FX master (`currencies`) and the `currency` dictionary the CRM and sales
 * pickers read. Idempotent — a scope already on the policy is left untouched
 * (`updated_at` included), so it is safe to run on every seed pass.
 *
 * Currencies outside the policy are switched off, never deleted: exchange rates
 * and documents that reference them keep resolving.
 */
export async function applyCurrencyPolicy(
  em: EntityManager,
  scope: CurrencyPolicyScope,
): Promise<CurrencyPolicyOutcome> {
  const { tenantId, organizationId } = scope
  const now = () => new Date()
  const policyCodes = new Set(POLICY_CURRENCIES.map((currency) => currency.code))
  const outcome: CurrencyPolicyOutcome = {
    created: [],
    updated: [],
    deactivated: [],
    dictionaryCreated: false,
    entriesAdded: [],
    entriesUpdated: [],
    entriesRemoved: [],
  }

  const currencyRows = await em.find(Currency, { tenantId, organizationId })
  const rowsByCode = new Map<string, Currency>()
  for (const row of currencyRows) rowsByCode.set(normalizeCurrencyCode(row.code), row)

  for (const definition of POLICY_CURRENCIES) {
    const name = resolveCurrencyName(definition.code)
    const isBase = definition.code === BASE_CURRENCY_CODE
    const existing = rowsByCode.get(definition.code)
    if (!existing) {
      em.persist(
        em.create(Currency, {
          tenantId,
          organizationId,
          code: definition.code,
          name,
          symbol: definition.symbol,
          decimalPlaces: definition.decimalPlaces,
          decimalSeparator: definition.decimalSeparator,
          thousandsSeparator: definition.thousandsSeparator,
          isBase,
          isActive: true,
          deletedAt: null,
          createdAt: now(),
          updatedAt: now(),
        }),
      )
      outcome.created.push(definition.code)
      continue
    }
    if (assignCurrencyFields(existing, definition, name, isBase)) {
      existing.updatedAt = now()
      em.persist(existing)
      outcome.updated.push(definition.code)
    }
  }

  for (const row of currencyRows) {
    const code = normalizeCurrencyCode(row.code)
    // Soft-deleted rows are already out of circulation; reviving them is a human decision.
    if (policyCodes.has(code) || row.deletedAt) continue
    if (!row.isActive && !row.isBase) continue
    row.isActive = false
    row.isBase = false
    row.updatedAt = now()
    em.persist(row)
    outcome.deactivated.push(code)
  }

  let dictionary = await em.findOne(Dictionary, {
    tenantId,
    organizationId,
    key: CURRENCY_DICTIONARY_KEY,
    deletedAt: null,
  })
  if (!dictionary) {
    dictionary = await em.findOne(Dictionary, {
      tenantId,
      organizationId,
      key: LEGACY_CURRENCY_DICTIONARY_KEY,
      deletedAt: null,
    })
  }
  if (!dictionary) {
    dictionary = em.create(Dictionary, {
      key: CURRENCY_DICTIONARY_KEY,
      name: 'Currencies',
      description: 'ISO 4217 currencies enabled for this organization',
      tenantId,
      organizationId,
      isSystem: true,
      isActive: true,
      managerVisibility: 'default',
      createdAt: now(),
      updatedAt: now(),
    })
    em.persist(dictionary)
    outcome.dictionaryCreated = true
  } else if (!dictionary.isActive || dictionary.deletedAt) {
    // The platform protects the currency dictionary from being disabled (see
    // dictionaries/api/[dictionaryId]/route.ts); the reconcile restores that invariant.
    dictionary.isActive = true
    dictionary.deletedAt = null
    dictionary.updatedAt = now()
    em.persist(dictionary)
  }

  const entries = await em.find(DictionaryEntry, { dictionary, tenantId, organizationId })
  const entriesByValue = new Map<string, DictionaryEntry>()
  for (const entry of entries) entriesByValue.set(normalizeCurrencyCode(entry.value), entry)

  // Exactly one entry per dictionary may carry `is_default` (partial unique index) and
  // the base currency owns it. Clearing a stray default is flushed on its own so the
  // clearing update can never race the assignment that follows it.
  const strayDefaults = entries.filter(
    (entry) => entry.isDefault && normalizeCurrencyCode(entry.value) !== BASE_CURRENCY_CODE,
  )
  if (strayDefaults.length) {
    for (const entry of strayDefaults) {
      entry.isDefault = false
      entry.updatedAt = now()
      em.persist(entry)
    }
    await em.flush()
  }

  for (const definition of POLICY_CURRENCIES) {
    const normalizedValue = definition.code.toLowerCase()
    const isDefault = definition.code === BASE_CURRENCY_CODE
    const existing = entriesByValue.get(definition.code)
    if (!existing) {
      em.persist(
        em.create(DictionaryEntry, {
          dictionary,
          tenantId,
          organizationId,
          value: definition.code,
          normalizedValue,
          label: definition.label,
          color: null,
          icon: null,
          position: 0,
          isDefault,
          createdAt: now(),
          updatedAt: now(),
        }),
      )
      outcome.entriesAdded.push(definition.code)
      continue
    }
    const changed =
      existing.value !== definition.code ||
      existing.normalizedValue !== normalizedValue ||
      existing.label !== definition.label ||
      existing.isDefault !== isDefault
    if (changed) {
      existing.value = definition.code
      existing.normalizedValue = normalizedValue
      existing.label = definition.label
      existing.isDefault = isDefault
      existing.updatedAt = now()
      em.persist(existing)
      outcome.entriesUpdated.push(definition.code)
    }
  }

  for (const entry of entries) {
    if (policyCodes.has(normalizeCurrencyCode(entry.value))) continue
    em.remove(entry)
    outcome.entriesRemoved.push(normalizeCurrencyCode(entry.value))
  }

  await em.flush()
  return outcome
}
