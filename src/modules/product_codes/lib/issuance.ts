import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { ProductCodeLedgerEntry, type ProductCodeRule } from '../data/entities'
import { breakdownFor, formatCode, readSegments, type CodePart, type CodeValues } from './ruleModel'

/**
 * Issuance — handing out a code and burning its serial.
 *
 * The ledger's unique index on `(tenant, organization, code)` is the guarantee, exactly like the
 * four existing `prefix + padStart` generators in this repo: this file only picks the next value, so
 * two concurrent issuances can collide and the loser retries with a fresh number. What it adds over
 * those call sites is the retry — an operator clicking 生成 twice at the same moment must get two
 * codes, not a 409 for a number nobody had written yet.
 *
 * The serial is read from the ledger, never from the rows that carry codes: a number consumed by a
 * row that was deleted (or never saved) must stay consumed, and only the ledger knows about it.
 */

/** The ledger as a read projection, for the one grouped aggregate this module needs. */
type LedgerReadTable = {
  product_codes_ledger_entries: {
    id: string
    tenant_id: string
    organization_id: string
    rule_id: string
    brand_value: string
    category_value: string | null
    serial: number
    code: string
  }
}

/** Bounded so a pathological hot loop cannot spin: five collisions in a row means real contention. */
const MAX_ISSUE_ATTEMPTS = 5

export type IssuedCode = {
  code: string
  serial: number
  ledgerId: string
  parts: CodePart[]
}

type Scope = { tenantId: string; organizationId: string }

export type RuleShape = Pick<ProductCodeRule, 'id' | 'segments' | 'separator' | 'serialLength' | 'serialScope'>

/** The values a scope needs — the serial is computed here, so callers never pass one. */
export type CodeScopeValues = Omit<CodeValues, 'serial'>

/**
 * The tuple a serial is unique within, per the rule's `serialScope`.
 *
 * `brand_category` (the default) is what makes `PK-CL001` readable; `brand` and `global` exist because
 * a scheme that numbers projects rather than products needs one counter per brand or per company.
 */
function serialScopeFilter(rule: RuleShape, values: CodeScopeValues): Record<string, unknown> {
  const filter: Record<string, unknown> = { ruleId: rule.id }
  if (rule.serialScope === 'global') return filter
  filter.brandValue = values.brandValue
  if (rule.serialScope === 'brand_category') filter.categoryValue = values.categoryValue ?? null
  return filter
}

/** The next free serial for this rule's scope — advisory: the ledger decides whether it survives. */
export async function peekNextSerial(em: EntityManager, scope: Scope, rule: RuleShape, values: CodeScopeValues): Promise<number> {
  const row = await em.fork().findOne(
    ProductCodeLedgerEntry,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      ruleId: rule.id,
      ...serialScopeFilter(rule, values),
    } as FilterQuery<ProductCodeLedgerEntry>,
    { orderBy: { serial: 'desc' } },
  )
  const highest = row ? Number(row.serial) : 0
  return Number.isFinite(highest) ? highest + 1 : 1
}

/**
 * Issues one code: the next serial for its scope, formatted, written to the ledger.
 *
 * Returns `null` when a segment's value is missing — the caller turns that into `brand_required` /
 * `category_required` rather than inventing a value.
 */
export async function issueCode(input: {
  em: EntityManager
  scope: Scope
  rule: RuleShape
  values: CodeScopeValues
  labels: Record<string, Record<string, string>>
}): Promise<IssuedCode | null> {
  const { em, scope, rule, values, labels } = input
  const segments = readSegments(rule.segments)
  if (!segments) return null
  const shape = { segments, separator: rule.separator, serialLength: rule.serialLength }

  let serial = await peekNextSerial(em, scope, rule, values)
  for (let attempt = 0; attempt < MAX_ISSUE_ATTEMPTS; attempt += 1) {
    const candidate = formatCode(shape, { ...values, serial })
    if (candidate === null) return null
    try {
      const scoped = em.fork()
      const inserted = scoped.create(ProductCodeLedgerEntry, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        ruleId: rule.id,
        code: candidate,
        brandValue: values.brandValue,
        categoryValue: values.categoryValue ?? null,
        serial,
      } as ProductCodeLedgerEntry)
      await scoped.persist(inserted).flush()
      return {
        code: candidate,
        serial,
        ledgerId: String(inserted.id),
        parts: breakdownFor(shape, { ...values, serial }, labels),
      }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      // Someone else took this number between the read and the insert: re-read and try the next one.
      serial = await peekNextSerial(em, scope, rule, values)
    }
  }
  throw new Error(`[internal] code sequence contention for rule ${rule.id} after ${MAX_ISSUE_ATTEMPTS} attempts`)
}

/** The scopes a rule has issued in, for the rule page's sequence panel. */
export async function listIssuedScopes(
  em: EntityManager,
  scope: Scope,
  ruleId: string,
): Promise<Array<{ brandValue: string; categoryValue: string | null; issued: number; nextSerial: number }>> {
  // A grouped aggregate has no ORM shape worth the indirection, so the table is declared as a read
  // projection: the handle is typed, which is what keeps the column names honest.
  const db = em.fork().getKysely() as unknown as Kysely<LedgerReadTable>
  const rows = await db
    .selectFrom('product_codes_ledger_entries')
    .select(['brand_value', 'category_value'])
    .select((eb) => eb.fn.countAll().as('issued'))
    .select((eb) => eb.fn.max('serial').as('highest'))
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('rule_id', '=', ruleId)
    .groupBy(['brand_value', 'category_value'])
    .orderBy('brand_value', 'asc')
    .execute()
  return rows.map((row) => {
    const record = row as { brand_value: string; category_value: string | null; issued: number | string; highest: number | string }
    return {
      brandValue: String(record.brand_value),
      categoryValue: record.category_value === null ? null : String(record.category_value),
      issued: Number(record.issued),
      nextSerial: Number(record.highest) + 1,
    }
  })
}
