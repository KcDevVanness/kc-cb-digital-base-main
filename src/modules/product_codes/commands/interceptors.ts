import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'
import type { CommandInterceptor, CommandInterceptorBeforeResult, CommandInterceptorContext } from '@open-mercato/shared/lib/commands/command-interceptor'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { ProductCodeLedgerEntry } from '../data/entities'
import { CODE_DICTIONARY_KEYS } from '../lib/dictionaryValues'

/**
 * Protects a code-list value that has already been issued.
 *
 * `product_brand` / `product_category` live in the installed dictionaries module, and its editor lets
 * an operator re-value or delete an entry. For every other code list that is harmless; for these two
 * it silently rewrites history — every code issued with `SP` would keep its characters while the
 * label beside them changed meaning, and the parser would start reporting a value as 未登记 that the
 * system itself issued. So the *value* is frozen once the ledger holds it, while the label stays
 * editable (renaming 猫砂's display name is exactly what an operator should be able to do).
 *
 * This is a command interceptor rather than a guard inside the dictionaries module: the installed
 * module stays untouched, and the rule belongs to the code lists, not to the dictionary editor.
 */

/** The ledger columns this guard reads, declared so the query is typed. */
type LedgerValueTable = {
  product_codes_ledger_entries: {
    id: string
    tenant_id: string
    organization_id: string
    brand_value: string
    category_value: string | null
  }
}

/** Rejection shared by both hooks: a deliberate business refusal, not a crash. */
function valueInUse(dictionaryKey: string, value: string): CommandInterceptorBeforeResult {
  return {
    ok: false,
    status: 409,
    body: {
      error: `${value} is already used by issued product codes in ${dictionaryKey}; add a new value instead of changing this one`,
      code: 'dictionary_value_in_use',
    },
  }
}

/**
 * The value this command is about to change or remove, or `null` when the write is harmless.
 *
 * `anyUse` is what separates the two commands: a **delete** removes the value whatever the payload
 * says, so any ledger use is at risk, while an **update** carries `value` on every save and is only
 * dangerous when the value actually differs — a label-only edit must stay allowed, or an operator
 * could never rename 猫砂's display name.
 */
async function frozenValueAtRisk(
  input: unknown,
  context: CommandInterceptorContext,
  options: { anyUse: boolean },
): Promise<{ dictionaryKey: string; value: string } | null> {
  // The installed entries routes call the command bus with `{ body: { … } }`, while other callers
  // pass the fields flat: read both, or a guard silently stops guarding the moment a caller changes.
  const raw = (input ?? {}) as { id?: string; value?: string; body?: { id?: string; value?: string } }
  const payload = { id: raw.id ?? raw.body?.id, value: raw.value ?? raw.body?.value }
  if (!payload.id) return null
  const tenantId = context.auth?.tenantId ?? null
  const organizationId = context.selectedOrganizationId ?? context.auth?.orgId ?? null
  if (!tenantId || !organizationId) return null

  const em = context.container.resolve('em') as EntityManager
  const entry = await em.fork().findOne(DictionaryEntry, {
    id: payload.id,
    tenantId,
    organizationId,
  } as FilterQuery<DictionaryEntry>)
  if (!entry) return null

  const dictionary = await em.fork().findOne(Dictionary, {
    id: entry.dictionary,
    tenantId,
    organizationId,
  } as FilterQuery<Dictionary>)
  if (!dictionary || !CODE_DICTIONARY_KEYS.includes(dictionary.key)) return null

  if (!options.anyUse) {
    const nextValue = typeof payload.value === 'string' ? payload.value : entry.value
    if (nextValue === entry.value) return null
  }

  const column = dictionary.key === 'product_brand' ? 'brand_value' : 'category_value'
  const db = em.fork().getKysely() as unknown as Kysely<LedgerValueTable>
  const used = await db
    .selectFrom('product_codes_ledger_entries')
    .select(['id'])
    .where('tenant_id', '=', tenantId)
    .where('organization_id', '=', organizationId)
    .where(column, '=', entry.value)
    .limit(1)
    .executeTakeFirst()
  return used ? { dictionaryKey: dictionary.key, value: entry.value } : null
}

const brandValueGuard: CommandInterceptor = {
  id: 'product_codes.issued-dictionary-value',
  targetCommand: 'dictionaries.entries.update',
  priority: 40,
  async beforeExecute(input, context) {
    const atRisk = await frozenValueAtRisk(input, context, { anyUse: false })
    return atRisk ? valueInUse(atRisk.dictionaryKey, atRisk.value) : undefined
  },
}

const brandValueDeleteGuard: CommandInterceptor = {
  id: 'product_codes.issued-dictionary-value-delete',
  targetCommand: 'dictionaries.entries.delete',
  priority: 40,
  async beforeExecute(input, context) {
    const atRisk = await frozenValueAtRisk(input, context, { anyUse: true })
    return atRisk ? valueInUse(atRisk.dictionaryKey, atRisk.value) : undefined
  },
}

export const interceptors: CommandInterceptor[] = [brandValueGuard, brandValueDeleteGuard]

export default interceptors
