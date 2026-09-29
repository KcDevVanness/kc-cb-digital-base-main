import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
  buildChanges,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { badRequest, conflict, CrudHttpError, isUniqueViolation, notFound } from '@open-mercato/shared/lib/crud/errors'
import { ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE } from '@open-mercato/shared/lib/auth/organizationScope'
import type { CrudEmitContext, CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { PRODUCT_BRAND_DICTIONARY_KEY, assertDictionaryValue } from '../../product_codes/lib/dictionaryValues'
import { PurchasingSupplier, PurchasingSupplierBankAccount } from '../data/entities'
import { assertCurrencyInDictionary } from '../lib/currencyDictionary'
import { supplierCreateSchema, supplierUpdateSchema, type SupplierBankAccountInput } from '../data/validators'
import { ensureScope } from './shared'

const ENTITY_ID = 'purchasing:purchasing_supplier' as const
const RESOURCE_KIND = 'purchasing.supplier' as const

type SerializedBankAccount = {
  id: string
  beneficiaryBank: string
  accountNumber: string
  swiftCode: string | null
  bankAddress: string | null
  isDefault: boolean
}

function serializeBankAccount(row: PurchasingSupplierBankAccount): SerializedBankAccount {
  return {
    id: String(row.id),
    beneficiaryBank: row.beneficiaryBank,
    accountNumber: row.accountNumber,
    swiftCode: row.swiftCode ?? null,
    bankAddress: row.bankAddress ?? null,
    isDefault: row.isDefault === true,
  }
}

type SerializedSupplier = {
  id: string
  name: string
  code: string
  contactName: string | null
  phone: string | null
  email: string | null
  address: string | null
  defaultCurrencyCode: string
  brandValue: string | null
  isActive: boolean
  notes: string | null
  tenantId: string
  organizationId: string
  /**
   * Bank rows travel with the update snapshot so undo can rebuild them exactly (the same shape
   * `parties` records for its bank block). Create/delete snapshots carry the head only — their undo
   * never has to restore an account list.
   */
  bankAccounts?: SerializedBankAccount[]
}

function serializeSupplier(
  entity: PurchasingSupplier,
  bankAccounts: PurchasingSupplierBankAccount[] = [],
): SerializedSupplier {
  return {
    id: String(entity.id),
    name: entity.name,
    code: entity.code,
    contactName: entity.contactName ?? null,
    phone: entity.phone ?? null,
    email: entity.email ?? null,
    address: entity.address ?? null,
    defaultCurrencyCode: entity.defaultCurrencyCode,
    brandValue: entity.brandValue ?? null,
    isActive: entity.isActive,
    notes: entity.notes ?? null,
    tenantId: String(entity.tenantId),
    organizationId: String(entity.organizationId),
    bankAccounts: bankAccounts.map(serializeBankAccount),
  }
}

/**
 * Bank rows of one supplier, oldest first. The columns are encrypted at rest (`encryption.ts`), so
 * every direct read goes through the framework decryption helper with the same scope the write uses.
 */
async function loadBankAccounts(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  supplierId: string,
): Promise<PurchasingSupplierBankAccount[]> {
  return findWithDecryption(
    em.fork(),
    PurchasingSupplierBankAccount,
    {
      supplier: supplierId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<PurchasingSupplierBankAccount>,
    { orderBy: { createdAt: 'asc' } },
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
}

/**
 * More than one default is a payload mistake the operator can fix, so it is rejected before any
 * write; no default at all is resolved to the first row (deterministic, and the printed block needs
 * exactly one account).
 */
function assertSingleDefault(bankAccounts: SupplierBankAccountInput[] | undefined): void {
  if (!bankAccounts || bankAccounts.length === 0) return
  const defaults = bankAccounts.filter((row) => row.isDefault === true)
  if (defaults.length > 1) {
    throw badRequest('Only one bank account can be the default')
  }
}

function toNullableText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Insert every row of a create payload; `id` values (if any) are ignored on purpose. */
async function createBankAccounts(
  de: DataEngine,
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  supplierId: string,
  rows: SupplierBankAccountInput[] | undefined,
): Promise<void> {
  const list = rows ?? []
  if (list.length === 0) return
  const supplier = em.getReference(PurchasingSupplier, supplierId)
  const hasExplicitDefault = list.some((row) => row.isDefault === true)
  for (let index = 0; index < list.length; index += 1) {
    const row = list[index]
    await de.createOrmEntity({
      entity: PurchasingSupplierBankAccount,
      data: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        supplier,
        beneficiaryBank: row.beneficiaryBank,
        accountNumber: row.accountNumber,
        swiftCode: toNullableText(row.swiftCode),
        bankAddress: toNullableText(row.bankAddress),
        isDefault: hasExplicitDefault ? row.isDefault === true : index === 0,
      },
    })
  }
}

/**
 * First replace boundary: rows the payload does not name are deleted and every kept row loses its
 * default flag. Clearing first is what keeps the partial unique index satisfiable: Postgres checks it
 * per statement, so a batch that flips the default from one row to another could transiently see two.
 */
async function clearBankAccountsBeforeReplace(
  de: DataEngine,
  scope: { tenantId: string; organizationId: string },
  rows: SupplierBankAccountInput[],
  existing: PurchasingSupplierBankAccount[],
): Promise<void> {
  const wantedIds = new Set(
    rows.map((row) => row.id).filter((id): id is string => typeof id === 'string'),
  )
  for (const row of existing) {
    const where = {
      id: String(row.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<PurchasingSupplierBankAccount>
    if (!wantedIds.has(String(row.id))) {
      await de.deleteOrmEntity({ entity: PurchasingSupplierBankAccount, where, soft: false })
      continue
    }
    await de.updateOrmEntity({
      entity: PurchasingSupplierBankAccount,
      where,
      apply: (entity) => {
        entity.isDefault = false
      },
    })
  }
}

/** Second replace boundary: insert the unnamed rows and write the final values, default included. */
async function applyBankAccountsAfterReplace(
  de: DataEngine,
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  supplierId: string,
  rows: SupplierBankAccountInput[],
  existing: PurchasingSupplierBankAccount[],
): Promise<void> {
  const byId = new Map(existing.map((row) => [String(row.id), row]))
  const supplier = em.getReference(PurchasingSupplier, supplierId)
  const hasExplicitDefault = rows.some((row) => row.isDefault === true)
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const isDefault = hasExplicitDefault ? row.isDefault === true : index === 0
    const current = row.id ? byId.get(row.id) : undefined
    if (!current) {
      if (row.id) throw badRequest('Bank account not found on this supplier')
      await de.createOrmEntity({
        entity: PurchasingSupplierBankAccount,
        data: {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          supplier,
          beneficiaryBank: row.beneficiaryBank,
          accountNumber: row.accountNumber,
          swiftCode: toNullableText(row.swiftCode),
          bankAddress: toNullableText(row.bankAddress),
          isDefault,
        },
      })
      continue
    }
    await de.updateOrmEntity({
      entity: PurchasingSupplierBankAccount,
      where: {
        id: String(current.id),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      } as FilterQuery<PurchasingSupplierBankAccount>,
      apply: (entity) => {
        entity.beneficiaryBank = row.beneficiaryBank
        entity.accountNumber = row.accountNumber
        entity.swiftCode = toNullableText(row.swiftCode)
        entity.bankAddress = toNullableText(row.bankAddress)
        entity.isDefault = isDefault
      },
    })
  }
}

/** Undo path: the previous bank block is rebuilt exactly as the snapshot recorded it, ids included. */
async function restoreBankAccounts(
  de: DataEngine,
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  supplierId: string,
  snapshotRows: SerializedBankAccount[] | undefined,
  existing: PurchasingSupplierBankAccount[],
): Promise<void> {
  for (const row of existing) {
    await de.deleteOrmEntity({
      entity: PurchasingSupplierBankAccount,
      where: {
        id: String(row.id),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      } as FilterQuery<PurchasingSupplierBankAccount>,
      soft: false,
    })
  }
  await createBankAccounts(
    de,
    em,
    scope,
    supplierId,
    (snapshotRows ?? []).map((row) => ({
      id: row.id,
      beneficiaryBank: row.beneficiaryBank,
      accountNumber: row.accountNumber,
      swiftCode: row.swiftCode,
      bankAddress: row.bankAddress,
      isDefault: row.isDefault,
    })),
  )
}

export const supplierCrudEvents: CrudEventsConfig<PurchasingSupplier> = {
  module: 'purchasing',
  entity: 'supplier',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<PurchasingSupplier>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    code: ctx.entity?.code ?? null,
  }),
}

export const supplierCrudIndexer: CrudIndexerConfig<PurchasingSupplier> = {
  entityType: ENTITY_ID,
}


function scopeFilter(scope: { tenantId: string; organizationId: string }, id: string): FilterQuery<PurchasingSupplier> {
  return {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<PurchasingSupplier>
}

/**
 * `code` is unique per organization — enforced by the database constraint on
 * (tenant, organization, code), which does **not** exclude soft-deleted rows. The check below
 * therefore deliberately looks at deleted rows too: a code that belonged to a deleted supplier
 * is still taken, and the caller gets a readable 409 instead of the driver's unique-violation
 * error surfacing as a 500. Reusing such a code requires restoring the supplier or choosing a
 * new code.
 */
async function assertCodeAvailable(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  code: string,
  exceptId?: string,
): Promise<void> {
  const existing = await em.fork().findOne(PurchasingSupplier, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    code,
  } as FilterQuery<PurchasingSupplier>)
  if (existing && String(existing.id) !== exceptId) {
    throw conflict('A supplier with this code already exists in this organization')
  }
}

/**
 * The supplier number this module issues: `SUP-0001`, `SUP-0002`, … — our own number for the
 * supplier, never the number the supplier prints on its own documents (that is 供应商货号 /
 * `supplier_sku` on a library row).
 */
const SUPPLIER_CODE_PREFIX = 'SUP-'
const SUPPLIER_CODE_WIDTH = 4
const ISSUED_SUPPLIER_CODE = /^SUP-(\d+)$/
/** Bounded like the SKU issuance (`product_codes/lib/issuance.ts`): five collisions is real contention. */
const MAX_CODE_ISSUE_ATTEMPTS = 5

/**
 * The next `SUP-####` for this organization.
 *
 * The scan reads **every** row, soft-deleted ones included, for two reasons the schema already
 * states: the unique index on (tenant, organization, code) covers deleted rows too, and the code is
 * frozen into historical purchase-order snapshots (`supplierSnapshotFor` below) — so a number must
 * never come back. Taking the highest issued serial, rather than probing for a free one, is what
 * makes that true in a single query. Hand-typed or imported values simply do not match the issued
 * shape and are skipped, which is why the old numbering can coexist with this one.
 */
async function nextSupplierCode(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<string> {
  const rows = await (em.fork().getKysely<any>())
    .selectFrom('purchasing_suppliers')
    .select('code')
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('code', 'like', `${SUPPLIER_CODE_PREFIX}%`)
    .execute()
  let highest = 0
  for (const row of rows as Array<{ code: string | null }>) {
    const match = row.code ? ISSUED_SUPPLIER_CODE.exec(row.code) : null
    if (!match) continue
    const serial = Number.parseInt(match[1], 10)
    if (Number.isFinite(serial) && serial > highest) highest = serial
  }
  return `${SUPPLIER_CODE_PREFIX}${String(highest + 1).padStart(SUPPLIER_CODE_WIDTH, '0')}`
}

/**
 * Creates the supplier, issuing the code when the caller did not supply one.
 *
 * Two paths, one rule: the unique index is the real guarantee and this only picks the value. An
 * **issued** code retries (bounded) because the operator never typed it — "this code already
 * exists" would be a sentence about a field they cannot see; an **explicit** code fails on the
 * first collision with the same readable 409 the availability check above produces.
 *
 * Each attempt creates in its own fork: a failed flush leaves the request-scoped identity map
 * holding the rejected entity, and reusing that EM would replay the collision.
 */
async function createSupplierRow(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  data: Record<string, unknown>,
  explicitCode: string | null,
): Promise<PurchasingSupplier> {
  const attempts = explicitCode ? 1 : MAX_CODE_ISSUE_ATTEMPTS
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = explicitCode ?? (await nextSupplierCode(em, scope))
    try {
      const scoped = em.fork()
      const supplier = scoped.create(PurchasingSupplier, { ...data, code } as PurchasingSupplier)
      await scoped.persist(supplier).flush()
      return supplier
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      if (explicitCode) throw conflict('A supplier with this code already exists in this organization')
    }
  }
  throw conflict('A supplier code could not be issued; please retry')
}

const createSupplierCommand: CommandHandler<Record<string, unknown>, PurchasingSupplier> = {
  id: 'purchasing.suppliers.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = supplierCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    // A blank or omitted code is the normal path from the form (the field is not rendered on
    // create): the command issues the next `SUP-####`. An explicit value keeps the old contract.
    const explicitCode = parsed.code && parsed.code.length > 0 ? parsed.code : null
    if (explicitCode) await assertCodeAvailable(em, scope, explicitCode)
    await assertCurrencyInDictionary(em, scope, parsed.defaultCurrencyCode)
    // The brand is the prefix of every generated code, so it must be a value the `product_brand`
    // dictionary lists — the same restriction the form's picker applies. Without this check an API
    // caller could save a supplier whose rows can never generate, and the refusal would only surface
    // much later, at 生成 time.
    if (parsed.brandValue) await assertDictionaryValue(em, scope, PRODUCT_BRAND_DICTIONARY_KEY, parsed.brandValue)
    assertSingleDefault(parsed.bankAccounts)

    const supplier = await createSupplierRow(
      em,
      scope,
      {
        name: parsed.name,
        contactName: parsed.contactName ?? null,
        phone: parsed.phone ?? null,
        email: parsed.email ?? null,
        address: parsed.address ?? null,
        defaultCurrencyCode: parsed.defaultCurrencyCode,
        brandValue: parsed.brandValue ?? null,
        isActive: parsed.isActive,
        notes: parsed.notes ?? null,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      explicitCode,
    )

    // The code-issuance retry above commits the supplier in its own fork per attempt, so the bank
    // block is written in a following atomic boundary. A failure here leaves the supplier without
    // accounts — visible and fixable by re-saving — never a half-written account row.
    if (parsed.bankAccounts && parsed.bankAccounts.length > 0) {
      await withAtomicFlush(
        em,
        [
          async () => {
            await createBankAccounts(de, em, scope, String(supplier.id), parsed.bankAccounts)
          },
        ],
        { transaction: true, label: 'purchasing.suppliers.create.bank-accounts' },
      )
    }

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: supplier,
      identifiers: {
        id: String(supplier.id),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      syncOrigin: ctx.syncOrigin,
      events: supplierCrudEvents,
      indexer: supplierCrudIndexer,
    })

    return supplier
  },
  captureAfter: (_input, result) => serializeSupplier(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    const after = serializeSupplier(result)
    return {
      actionLabel: translate('purchasing.audit.suppliers.create', 'Create supplier'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ after?: SerializedSupplier }>(logEntry)
    const snapshot = payload?.after ?? (logEntry?.snapshotAfter as SerializedSupplier | undefined)
    const id = snapshot?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing supplier id for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const removed = await de.deleteOrmEntity({
      entity: PurchasingSupplier,
      where: scopeFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: supplierCrudEvents,
      indexer: supplierCrudIndexer,
    })
  },
}

const updateSupplierCommand: CommandHandler<Record<string, unknown>, PurchasingSupplier> = {
  id: 'purchasing.suppliers.update',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const parsed = supplierUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const current = await em.fork().findOne(PurchasingSupplier, scopeFilter(scope, parsed.id))
    if (!current) return {}
    const bankAccounts = await loadBankAccounts(em, scope, parsed.id)
    return { before: serializeSupplier(current, bankAccounts) }
  },
  async execute(rawInput, ctx) {
    const parsed = supplierUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const current = await em.fork().findOne(PurchasingSupplier, scopeFilter(scope, parsed.id))
    if (!current) throw notFound('Supplier not found')

    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: String(current.id),
      current: current.updatedAt,
      request: ctx.request ?? null,
    })

    if (parsed.code !== undefined && parsed.code !== current.code) {
      await assertCodeAvailable(em, scope, parsed.code, String(current.id))
    }
    if (parsed.defaultCurrencyCode !== undefined && parsed.defaultCurrencyCode !== current.defaultCurrencyCode) {
      await assertCurrencyInDictionary(em, scope, parsed.defaultCurrencyCode)
    }
    // Only a *new* brand is checked: clearing it stays allowed (the field is optional) and a value
    // that predates the dictionary is left alone until the operator picks a listed one.
    if (parsed.brandValue && parsed.brandValue !== current.brandValue) {
      await assertDictionaryValue(em, scope, PRODUCT_BRAND_DICTIONARY_KEY, parsed.brandValue)
    }
    assertSingleDefault(parsed.bankAccounts)

    const existingBankAccounts = parsed.bankAccounts !== undefined
      ? await loadBankAccounts(em, scope, parsed.id)
      : []

    const updatedRows: PurchasingSupplier[] = []
    await withAtomicFlush(
      em,
      [
        async () => {
          const result = await de.updateOrmEntity({
            entity: PurchasingSupplier,
            where: scopeFilter(scope, parsed.id),
            apply: (entity) => {
              if (parsed.name !== undefined) entity.name = parsed.name
              if (parsed.code !== undefined) entity.code = parsed.code
              if (parsed.contactName !== undefined) entity.contactName = parsed.contactName
              if (parsed.phone !== undefined) entity.phone = parsed.phone
              if (parsed.email !== undefined) entity.email = parsed.email
              if (parsed.address !== undefined) entity.address = parsed.address
              if (parsed.defaultCurrencyCode !== undefined) entity.defaultCurrencyCode = parsed.defaultCurrencyCode
              if (parsed.brandValue !== undefined) entity.brandValue = parsed.brandValue ?? null
              if (parsed.isActive !== undefined) entity.isActive = parsed.isActive
              if (parsed.notes !== undefined) entity.notes = parsed.notes
            },
          })
          if (result) updatedRows.push(result as PurchasingSupplier)
        },
        // Two boundaries for the bank block: the default flag is cleared first and written second, so
        // the partial unique index never sees two default rows in one statement batch.
        async () => {
          if (parsed.bankAccounts === undefined) return
          await clearBankAccountsBeforeReplace(de, scope, parsed.bankAccounts, existingBankAccounts)
        },
        async () => {
          if (parsed.bankAccounts === undefined) return
          await applyBankAccountsAfterReplace(de, em, scope, parsed.id, parsed.bankAccounts, existingBankAccounts)
        },
      ],
      { transaction: true, label: 'purchasing.suppliers.update' },
    )
    const updated = updatedRows[0]
    if (!updated) throw notFound('Supplier not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: { id: String(updated.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: supplierCrudEvents,
      indexer: supplierCrudIndexer,
    })

    return updated
  },
  captureAfter: (_input, result) => serializeSupplier(result),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as SerializedSupplier | undefined
    const after = serializeSupplier(result)
    const changes = buildChanges(
      (before ?? null) as unknown as Record<string, unknown> | null,
      after as unknown as Record<string, unknown>,
      ['name', 'code', 'contactName', 'phone', 'email', 'address', 'defaultCurrencyCode', 'brandValue', 'isActive', 'notes'],
    )
    return {
      actionLabel: translate('purchasing.audit.suppliers.update', 'Update supplier'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      changes,
      snapshotBefore: before ?? null,
      snapshotAfter: after,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ before?: SerializedSupplier }>(logEntry)
    const before = payload?.before ?? (logEntry?.snapshotBefore as SerializedSupplier | undefined)
    if (!before?.id) throw new Error('[internal] Missing previous supplier snapshot for undo')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const existingBanks = await loadBankAccounts(em, scope, before.id)
    const updatedRows: PurchasingSupplier[] = []
    await withAtomicFlush(
      em,
      [
        async () => {
          const result = await de.updateOrmEntity({
            entity: PurchasingSupplier,
            where: scopeFilter(scope, before.id),
            apply: (entity) => {
              entity.name = before.name
              entity.code = before.code
              entity.contactName = before.contactName
              entity.phone = before.phone
              entity.email = before.email
              entity.address = before.address
              entity.defaultCurrencyCode = before.defaultCurrencyCode
              entity.brandValue = before.brandValue
              entity.isActive = before.isActive
              entity.notes = before.notes
            },
          })
          if (result) updatedRows.push(result as PurchasingSupplier)
        },
        async () => {
          if (before.bankAccounts === undefined) return
          await restoreBankAccounts(de, em, scope, before.id, before.bankAccounts, existingBanks)
        },
      ],
      { transaction: true, label: 'purchasing.suppliers.update.undo' },
    )
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updatedRows[0] ?? null,
      identifiers: { id: before.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: supplierCrudEvents,
      indexer: supplierCrudIndexer,
    })
  },
}

const deleteSupplierCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  PurchasingSupplier
> = {
  id: 'purchasing.suppliers.delete',
  isUndoable: true,
  async prepare(input, ctx) {
    const id = requireId(input, 'Supplier id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const existing = await em.fork().findOne(PurchasingSupplier, scopeFilter(scope, id))
    if (!existing) return {}
    return { before: serializeSupplier(existing) }
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Supplier id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const current = await em.fork().findOne(PurchasingSupplier, scopeFilter(scope, id))
    if (!current) throw notFound('Supplier not found')

    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: String(current.id),
      current: current.updatedAt,
      request: ctx.request ?? null,
    })

    const removed = await de.deleteOrmEntity({
      entity: PurchasingSupplier,
      where: scopeFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!removed) throw notFound('Supplier not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id: String(removed.id), tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: supplierCrudEvents,
      indexer: supplierCrudIndexer,
    })

    return removed
  },
  captureAfter: (_input, result) => serializeSupplier(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    const after = serializeSupplier(result)
    return {
      actionLabel: translate('purchasing.audit.suppliers.delete', 'Delete supplier'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ after?: SerializedSupplier }>(logEntry)
    const snapshot = payload?.after ?? (logEntry?.snapshotAfter as SerializedSupplier | undefined)
    const id = snapshot?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing supplier id for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const restored = await de.updateOrmEntity({
      entity: PurchasingSupplier,
      where: {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      } as FilterQuery<PurchasingSupplier>,
      apply: (entity) => {
        entity.deletedAt = null
      },
    })
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'created',
      entity: restored,
      identifiers: { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: supplierCrudEvents,
      indexer: supplierCrudIndexer,
    })
  },
}

registerCommand(createSupplierCommand)
registerCommand(updateSupplierCommand)
registerCommand(deleteSupplierCommand)

export { createSupplierCommand, updateSupplierCommand, deleteSupplierCommand }
