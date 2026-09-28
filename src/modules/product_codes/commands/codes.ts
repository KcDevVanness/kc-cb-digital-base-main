import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { badRequest, CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEmitContext, CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { ProductCodeAlias, ProductCodeRule } from '../data/entities'
import { productCodeAliasCreateSchema, productCodeGenerateSchema } from '../data/validators'
import { assertDictionaryValue, loadCodeDictionaries } from '../lib/dictionaryValues'
import { issueCode, peekNextSerial } from '../lib/issuance'
import { breakdownFor, formatCode, readSegments } from '../lib/ruleModel'
import { ensureScope } from './rules'

/**
 * The two commands the supplier product form drives: issuing a code, and recording a code it retired.
 *
 * Issuance is a command rather than logic inside a route because it is the module's only irreversible
 * write — a consumed serial is never returned — so it belongs on the path that owns audit, events and
 * the scope rules, exactly like every other write in this app.
 */

const ALIAS_ENTITY_ID = 'product_codes:product_code_alias' as const

export type IssuedCodeResult = {
  code: string
  ruleId: string
  ruleName: string
  dryRun: boolean
  ledgerId: string | null
  nextSerial: number
  parts: Array<{ key: string; kind: string; value: string; label: string | null; known: boolean }>
}

export type RuleResolution = { rule: ProductCodeRule; values: { brandValue: string; categoryValue: string | null } }

/**
 * Which rule generates this code.
 *
 * Explicit `ruleId` wins; otherwise the single active `generate` rule is used. Ambiguity is refused
 * rather than guessed: silently picking one of two rules would issue numbers under a scheme the
 * operator did not choose, and the number is not reclaimable.
 */
export async function resolveGenerateRule(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  input: { ruleId?: string; brandValue: string; categoryValue?: string },
): Promise<RuleResolution> {
  const scopedEm = em.fork()
  if (input.ruleId) {
    const rule = await scopedEm.findOne(ProductCodeRule, {
      id: input.ruleId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as FilterQuery<ProductCodeRule>)
    if (!rule) throw notFound('Code rule not found')
    if (rule.mode !== 'generate') {
      throw new CrudHttpError(422, { error: 'That rule carries codes over; it cannot issue one', code: 'rule_not_generating' })
    }
    return { rule, values: { brandValue: input.brandValue, categoryValue: input.categoryValue ?? null } }
  }

  const candidates = await scopedEm.find(ProductCodeRule, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    mode: 'generate',
    isActive: true,
    deletedAt: null,
  } as FilterQuery<ProductCodeRule>)
  if (candidates.length === 0) throw notFound('No active code rule is configured for this organization')
  if (candidates.length > 1) {
    throw new CrudHttpError(400, {
      error: 'Several active code rules exist; name the rule to generate with',
      code: 'rule_ambiguous',
    })
  }
  return { rule: candidates[0], values: { brandValue: input.brandValue, categoryValue: input.categoryValue ?? null } }
}

const issueCodeCommand = registerCommand({
  id: 'product_codes.codes.issue',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = productCodeGenerateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    const { rule, values } = await resolveGenerateRule(em, scope, parsed)
    const segments = readSegments(rule.segments)
    if (!segments) throw badRequest('The rule has no readable segments')
    const shape = { segments, separator: rule.separator, serialLength: rule.serialLength }

    const readsBrand = segments.some((segment) => segment.kind === 'dictionary' && segment.key === 'brand')
    const readsCategory = segments.some((segment) => segment.kind === 'dictionary' && segment.key === 'category')
    if (readsBrand) await assertDictionaryValue(em, scope, 'product_brand', parsed.brandValue)
    if (readsCategory) {
      if (!parsed.categoryValue) {
        throw new CrudHttpError(400, { error: 'This rule needs a category to build a code', code: 'category_required' })
      }
      await assertDictionaryValue(em, scope, 'product_category', parsed.categoryValue)
    }

    const { labels } = await loadCodeDictionaries(em, scope)

    if (parsed.dryRun) {
      const serial = await peekNextSerial(em, scope, rule, values)
      const code = formatCode(shape, { ...values, serial })
      if (code === null) {
        throw new CrudHttpError(400, { error: 'This rule needs a brand to build a code', code: 'brand_required' })
      }
      return {
        code,
        ruleId: String(rule.id),
        ruleName: rule.name,
        dryRun: true,
        ledgerId: null,
        nextSerial: serial,
        parts: breakdownFor(shape, { ...values, serial }, labels),
      } satisfies IssuedCodeResult
    }

    const issued = await issueCode({ em, scope, rule, values, labels })
    if (!issued) {
      throw new CrudHttpError(400, { error: 'This rule needs a brand to build a code', code: 'brand_required' })
    }
    return {
      code: issued.code,
      ruleId: String(rule.id),
      ruleName: rule.name,
      dryRun: false,
      ledgerId: issued.ledgerId,
      nextSerial: issued.serial,
      parts: issued.parts,
    } satisfies IssuedCodeResult
  },
})

/** The two tables an alias may point at; only the columns the guard reads are declared. */
type AliasTargetTables = {
  products_products: { id: string; tenant_id: string; organization_id: string }
  purchasing_supplier_products: { id: string; tenant_id: string; organization_id: string }
}

export const aliasCrudEvents: CrudEventsConfig<ProductCodeAlias> = {
  module: 'product_codes',
  entity: 'product_code_alias',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<ProductCodeAlias>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    aliasCode: ctx.entity?.aliasCode ?? null,
    targetKind: ctx.entity?.targetKind ?? null,
  }),
}

export const aliasCrudIndexer: CrudIndexerConfig<ProductCodeAlias> = { entityType: ALIAS_ENTITY_ID }

/**
 * Records a code an operator retired, so the old code keeps resolving to its row.
 *
 * The target is validated in the same transaction that writes the alias: `target_id` is a scalar id
 * across modules with no foreign key, so the database cannot enforce that the product still exists —
 * the check has to share the write's connection, exactly as `purchasing` does when it links a library
 * row to a product.
 */
const createAliasCommand = registerCommand({
  id: 'product_codes.aliases.create',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = productCodeAliasCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    // A cross-module scalar id with no foreign key: the target is read through a declared read
    // projection (the repo's rule for another module's tables), never through its entities.
    const targetTable = parsed.targetKind === 'product' ? 'products_products' : 'purchasing_supplier_products'
    const db = em.fork().getKysely() as unknown as Kysely<AliasTargetTables>
    const target = await db
      .selectFrom(targetTable)
      .select(['id'])
      .where('id', '=', parsed.targetId)
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', '=', scope.organizationId)
      .executeTakeFirst()
    if (!target) throw notFound('The record this code should resolve to was not found in this organization')

    const created = await de.createOrmEntity({
      entity: ProductCodeAlias,
      data: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        aliasCode: parsed.aliasCode,
        targetKind: parsed.targetKind,
        targetId: parsed.targetId,
        note: parsed.note ?? null,
      },
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: created,
      identifiers: { id: String(created.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      events: aliasCrudEvents,
      indexer: aliasCrudIndexer,
    })
    return created
  },
})

export const codeCommands = [issueCodeCommand, createAliasCommand]
