import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
  buildChanges,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { badRequest, conflict, CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE } from '@open-mercato/shared/lib/auth/organizationScope'
import type { CrudEmitContext, CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Party, PartyBankAccount, PartyRole } from '../data/entities'
import { partyCreateSchema, partyUpdateSchema, type PartyBankAccountInput } from '../data/validators'

const ENTITY_ID = 'parties:party' as const
const RESOURCE_KIND = 'parties.party' as const

type SerializedBankAccount = {
  id: string
  beneficiaryBank: string
  accountNumber: string
  swiftCode: string | null
  bankAddress: string | null
  isDefault: boolean
}

type SerializedParty = {
  id: string
  code: string
  name: string
  countryCode: string | null
  status: string
  contactName: string | null
  contactPhone: string | null
  email: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  roles: string[]
  bankAccounts: SerializedBankAccount[]
  tenantId: string
  organizationId: string
}

function serializeBankAccount(entity: PartyBankAccount): SerializedBankAccount {
  return {
    id: String(entity.id),
    beneficiaryBank: entity.beneficiaryBank,
    accountNumber: entity.accountNumber,
    swiftCode: entity.swiftCode ?? null,
    bankAddress: entity.bankAddress ?? null,
    isDefault: entity.isDefault === true,
  }
}

function serializeParty(
  entity: Party,
  roles: PartyRole[],
  bankAccounts: PartyBankAccount[],
): SerializedParty {
  return {
    id: String(entity.id),
    code: entity.code,
    name: entity.name,
    countryCode: entity.countryCode ?? null,
    status: entity.status,
    contactName: entity.contactName ?? null,
    contactPhone: entity.contactPhone ?? null,
    email: entity.email ?? null,
    addressLine1: entity.addressLine1 ?? null,
    addressLine2: entity.addressLine2 ?? null,
    city: entity.city ?? null,
    roles: roles.map((row) => row.role).sort(),
    bankAccounts: bankAccounts.map(serializeBankAccount),
    tenantId: String(entity.tenantId),
    organizationId: String(entity.organizationId),
  }
}

export const partyCrudEvents: CrudEventsConfig<Party> = {
  module: 'parties',
  entity: 'party',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<Party>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    code: ctx.entity?.code ?? null,
  }),
}

export const partyCrudIndexer: CrudIndexerConfig<Party> = {
  entityType: ENTITY_ID,
}

/**
 * Trusted scope only. A command never reads tenant/organization from its payload — the party
 * belongs to the organization the caller is acting in, and a missing scope fails closed instead of
 * defaulting to something wider.
 */
function ensureScope(ctx: CommandRuntimeContext): { tenantId: string; organizationId: string } {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) throw badRequest('Tenant context is required')
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: 'Select an organization to access this resource',
      code: ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE,
    })
  }
  return { tenantId, organizationId }
}

function partyFilter(
  scope: { tenantId: string; organizationId: string },
  id: string,
): FilterQuery<Party> {
  return {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<Party>
}

async function loadParty(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  id: string,
): Promise<Party | null> {
  return em.fork().findOne(Party, partyFilter(scope, id))
}

async function loadChildren(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  partyId: string,
): Promise<{ roles: PartyRole[]; bankAccounts: PartyBankAccount[] }> {
  const fork = em.fork()
  const [roles, bankAccounts] = await Promise.all([
    fork.find(PartyRole, {
      party: partyId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<PartyRole>, { orderBy: { role: 'asc' } }),
    fork.find(PartyBankAccount, {
      party: partyId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<PartyBankAccount>, { orderBy: { createdAt: 'asc' } }),
  ])
  return { roles, bankAccounts }
}

/**
 * `code` is unique per organization — enforced by the database constraint on
 * (tenant, organization, code), which does **not** exclude soft-deleted rows. The check below
 * therefore deliberately looks at deleted rows too: a code that belonged to a deleted party is
 * still taken, and the caller gets a readable 409 instead of the driver's unique-violation error
 * surfacing as a 500.
 */
async function assertCodeAvailable(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  code: string,
  exceptId?: string,
): Promise<void> {
  const existing = await em.fork().findOne(Party, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    code,
  } as FilterQuery<Party>)
  if (existing && String(existing.id) !== exceptId) {
    throw conflict('A party with this code already exists in this organization')
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'UniqueConstraintViolationException'
  )
}

/**
 * `undefined` means "leave unchanged", `null`/empty means "clear". The validator already
 * normalized whitespace, so this only maps the empty string onto an explicit clear.
 */
function toNullableText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Bank block validation. More than one default is a payload mistake the operator can fix, so it is
 * rejected before any write; no default at all is resolved to the first row (deterministic, and the
 * printed block needs exactly one account).
 */
function assertSingleDefault(bankAccounts: PartyBankAccountInput[] | undefined): void {
  if (!bankAccounts || bankAccounts.length === 0) return
  const defaults = bankAccounts.filter((row) => row.isDefault === true)
  if (defaults.length > 1) {
    throw badRequest('Only one bank account can be the default')
  }
}

async function createChildren(
  de: DataEngine,
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  partyId: string,
  roles: string[] | undefined,
  bankAccounts: PartyBankAccountInput[] | undefined,
): Promise<void> {
  const party = em.getReference(Party, partyId)
  for (const role of roles ?? []) {
    await de.createOrmEntity({
      entity: PartyRole,
      data: { tenantId: scope.tenantId, organizationId: scope.organizationId, party, role },
    })
  }
  const rows = bankAccounts ?? []
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const isDefault = rows.some((entry) => entry.isDefault === true) ? row.isDefault === true : index === 0
    await de.createOrmEntity({
      entity: PartyBankAccount,
      data: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        party,
        beneficiaryBank: row.beneficiaryBank,
        accountNumber: row.accountNumber,
        swiftCode: toNullableText(row.swiftCode) ?? null,
        bankAddress: toNullableText(row.bankAddress) ?? null,
        isDefault,
      },
    })
  }
}

/**
 * Replace semantics for the aggregate's children: rows the payload does not name are removed, rows
 * it names are updated in place, new rows are inserted. Roles and bank accounts are value objects of
 * the party — nothing else references them, so removal is a hard delete and the unique constraints
 * stay simple.
 */
async function replaceChildren(
  de: DataEngine,
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  partyId: string,
  roles: string[] | undefined,
  bankAccounts: PartyBankAccountInput[] | undefined,
  existing: { roles: PartyRole[]; bankAccounts: PartyBankAccount[] },
): Promise<void> {
  if (roles !== undefined) {
    const wanted = new Set(roles)
    for (const row of existing.roles) {
      if (wanted.has(row.role)) continue
      await de.deleteOrmEntity({
        entity: PartyRole,
        where: {
          id: String(row.id),
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        } as FilterQuery<PartyRole>,
        soft: false,
      })
    }
    const present = new Set(existing.roles.map((row) => row.role))
    const party = em.getReference(Party, partyId)
    for (const role of roles) {
      if (present.has(role)) continue
      await de.createOrmEntity({
        entity: PartyRole,
        data: { tenantId: scope.tenantId, organizationId: scope.organizationId, party, role },
      })
    }
  }

  if (bankAccounts !== undefined) {
    const wantedIds = new Set(
      bankAccounts.map((row) => row.id).filter((id): id is string => typeof id === 'string'),
    )
    for (const row of existing.bankAccounts) {
      if (wantedIds.has(String(row.id))) continue
      await de.deleteOrmEntity({
        entity: PartyBankAccount,
        where: {
          id: String(row.id),
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        } as FilterQuery<PartyBankAccount>,
        soft: false,
      })
    }
    const byId = new Map(existing.bankAccounts.map((row) => [String(row.id), row]))
    const party = em.getReference(Party, partyId)
    const hasExplicitDefault = bankAccounts.some((row) => row.isDefault === true)
    for (let index = 0; index < bankAccounts.length; index += 1) {
      const row = bankAccounts[index]
      const current = row.id ? byId.get(row.id) : undefined
      const isDefault = hasExplicitDefault ? row.isDefault === true : index === 0
      if (current) {
        await de.updateOrmEntity({
          entity: PartyBankAccount,
          where: {
            id: String(current.id),
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
          } as FilterQuery<PartyBankAccount>,
          apply: (entity) => {
            entity.beneficiaryBank = row.beneficiaryBank
            entity.accountNumber = row.accountNumber
            entity.swiftCode = toNullableText(row.swiftCode) ?? null
            entity.bankAddress = toNullableText(row.bankAddress) ?? null
            entity.isDefault = isDefault
          },
        })
        continue
      }
      if (row.id) throw badRequest('Bank account not found on this party')
      await de.createOrmEntity({
        entity: PartyBankAccount,
        data: {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          party,
          beneficiaryBank: row.beneficiaryBank,
          accountNumber: row.accountNumber,
          swiftCode: toNullableText(row.swiftCode) ?? null,
          bankAddress: toNullableText(row.bankAddress) ?? null,
          isDefault,
        },
      })
    }
  }
}

/** Undo path: children are rebuilt exactly as the snapshot recorded them, ids included. */
async function restoreChildren(
  de: DataEngine,
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  snapshot: SerializedParty,
  existing: { roles: PartyRole[]; bankAccounts: PartyBankAccount[] },
): Promise<void> {
  for (const row of existing.roles) {
    await de.deleteOrmEntity({
      entity: PartyRole,
      where: {
        id: String(row.id),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      } as FilterQuery<PartyRole>,
      soft: false,
    })
  }
  for (const row of existing.bankAccounts) {
    await de.deleteOrmEntity({
      entity: PartyBankAccount,
      where: {
        id: String(row.id),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      } as FilterQuery<PartyBankAccount>,
      soft: false,
    })
  }
  await createChildren(
    de,
    em,
    scope,
    snapshot.id,
    snapshot.roles,
    snapshot.bankAccounts.map((row) => ({
      id: row.id,
      beneficiaryBank: row.beneficiaryBank,
      accountNumber: row.accountNumber,
      swiftCode: row.swiftCode,
      bankAddress: row.bankAddress,
      isDefault: row.isDefault,
    })),
  )
}

const createPartyCommand: CommandHandler<Record<string, unknown>, Party> = {
  id: 'parties.parties.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = partyCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    await assertCodeAvailable(em, scope, parsed.code)
    assertSingleDefault(parsed.bankAccounts)

    let party!: Party
    await withAtomicFlush(
      em,
      [
        async () => {
          party = await de
            .createOrmEntity({
              entity: Party,
              data: {
                tenantId: scope.tenantId,
                organizationId: scope.organizationId,
                code: parsed.code,
                name: parsed.name,
                countryCode: toNullableText(parsed.countryCode) ?? null,
                status: parsed.status ?? 'active',
                contactName: toNullableText(parsed.contactName) ?? null,
                contactPhone: toNullableText(parsed.contactPhone) ?? null,
                email: toNullableText(parsed.email) ?? null,
                addressLine1: toNullableText(parsed.addressLine1) ?? null,
                addressLine2: toNullableText(parsed.addressLine2) ?? null,
                city: toNullableText(parsed.city) ?? null,
              },
            })
            .catch((error: unknown) => {
              if (isUniqueViolation(error)) {
                throw conflict('A party with this code already exists in this organization')
              }
              throw error
            })
          await createChildren(de, em, scope, String(party.id), parsed.roles, parsed.bankAccounts)
        },
      ],
      { transaction: true, label: 'parties.parties.create' },
    )

    const children = await loadChildren(em, scope, String(party.id))

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: party,
      identifiers: {
        id: String(party.id),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      syncOrigin: ctx.syncOrigin,
      events: partyCrudEvents,
      indexer: partyCrudIndexer,
    })

    return party
  },
  captureAfter: (_input, result) => ({ id: String(result.id), code: result.code }),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('parties.audit.parties.create', 'Create party'),
      resourceKind: RESOURCE_KIND,
      resourceId: String(result.id),
      tenantId: String(result.tenantId),
      organizationId: String(result.organizationId),
      snapshotAfter: { id: String(result.id), code: result.code },
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ after?: { id: string } }>(logEntry)
    const snapshot = payload?.after ?? (logEntry?.snapshotAfter as { id?: string } | undefined)
    const id = snapshot?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing party id for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const removed = await de.deleteOrmEntity({
      entity: Party,
      where: partyFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: partyCrudEvents,
      indexer: partyCrudIndexer,
    })
  },
}

const updatePartyCommand: CommandHandler<Record<string, unknown>, Party> = {
  id: 'parties.parties.update',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const parsed = partyUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const current = await loadParty(em, scope, parsed.id)
    if (!current) return {}
    const children = await loadChildren(em, scope, parsed.id)
    return { before: serializeParty(current, children.roles, children.bankAccounts) }
  },
  async execute(rawInput, ctx) {
    const parsed = partyUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const current = await loadParty(em, scope, parsed.id)
    if (!current) throw notFound('Party not found')

    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: String(current.id),
      current: current.updatedAt,
      request: ctx.request ?? null,
    })

    if (parsed.code !== undefined && parsed.code !== current.code) {
      await assertCodeAvailable(em, scope, parsed.code, String(current.id))
    }
    assertSingleDefault(parsed.bankAccounts)

    const existing = await loadChildren(em, scope, parsed.id)

    await withAtomicFlush(
      em,
      [
        async () => {
          const updated = await de.updateOrmEntity({
            entity: Party,
            where: partyFilter(scope, parsed.id),
            apply: (entity) => {
              if (parsed.code !== undefined) entity.code = parsed.code
              if (parsed.name !== undefined) entity.name = parsed.name
              if (parsed.status !== undefined) entity.status = parsed.status
              const countryCode = toNullableText(parsed.countryCode)
              if (countryCode !== undefined) entity.countryCode = countryCode
              const contactName = toNullableText(parsed.contactName)
              if (contactName !== undefined) entity.contactName = contactName
              const contactPhone = toNullableText(parsed.contactPhone)
              if (contactPhone !== undefined) entity.contactPhone = contactPhone
              const email = toNullableText(parsed.email)
              if (email !== undefined) entity.email = email
              const addressLine1 = toNullableText(parsed.addressLine1)
              if (addressLine1 !== undefined) entity.addressLine1 = addressLine1
              const addressLine2 = toNullableText(parsed.addressLine2)
              if (addressLine2 !== undefined) entity.addressLine2 = addressLine2
              const city = toNullableText(parsed.city)
              if (city !== undefined) entity.city = city
            },
          })
          if (!updated) throw notFound('Party not found')
          await replaceChildren(de, em, scope, parsed.id, parsed.roles, parsed.bankAccounts, existing)
        },
      ],
      { transaction: true, label: 'parties.parties.update' },
    )

    const updated = await loadParty(em, scope, parsed.id)
    if (!updated) throw notFound('Party not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: {
        id: String(updated.id),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      syncOrigin: ctx.syncOrigin,
      events: partyCrudEvents,
      indexer: partyCrudIndexer,
    })

    return updated
  },
  captureAfter: (_input, result) => ({ id: String(result.id), code: result.code, name: result.name, status: result.status }),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as SerializedParty | undefined
    const after = { id: String(result.id), code: result.code, name: result.name, status: result.status }
    return {
      actionLabel: translate('parties.audit.parties.update', 'Update party'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: String(result.tenantId),
      organizationId: String(result.organizationId),
      changes: buildChanges(
        (before ?? null) as unknown as Record<string, unknown> | null,
        after as unknown as Record<string, unknown>,
        ['code', 'name', 'status'],
      ),
      snapshotBefore: before ?? null,
      snapshotAfter: after,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ before?: SerializedParty }>(logEntry)
    const before = payload?.before ?? (logEntry?.snapshotBefore as SerializedParty | undefined)
    if (!before?.id) throw new Error('[internal] Missing previous party snapshot for undo')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const existing = await loadChildren(em, scope, before.id)

    await withAtomicFlush(
      em,
      [
        async () => {
          await de.updateOrmEntity({
            entity: Party,
            where: partyFilter(scope, before.id),
            apply: (entity) => {
              entity.code = before.code
              entity.name = before.name
              entity.countryCode = before.countryCode
              entity.status = before.status
              entity.contactName = before.contactName
              entity.contactPhone = before.contactPhone
              entity.email = before.email
              entity.addressLine1 = before.addressLine1
              entity.addressLine2 = before.addressLine2
              entity.city = before.city
            },
          })
          await restoreChildren(de, em, scope, before, existing)
        },
      ],
      { transaction: true, label: 'parties.parties.update.undo' },
    )

    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: null,
      identifiers: { id: before.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: partyCrudEvents,
      indexer: partyCrudIndexer,
    })
  },
}

const deletePartyCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  Party
> = {
  id: 'parties.parties.delete',
  isUndoable: true,
  async prepare(input, ctx) {
    const id = requireId(input, 'Party id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const existing = await loadParty(em, scope, id)
    if (!existing) return {}
    const children = await loadChildren(em, scope, id)
    return { before: serializeParty(existing, children.roles, children.bankAccounts) }
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Party id required')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const current = await loadParty(em, scope, id)
    if (!current) throw notFound('Party not found')

    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: String(current.id),
      current: current.updatedAt,
      request: ctx.request ?? null,
    })

    const removed = await de.deleteOrmEntity({
      entity: Party,
      where: partyFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!removed) throw notFound('Party not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: {
        id: String(removed.id),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      syncOrigin: ctx.syncOrigin,
      events: partyCrudEvents,
      indexer: partyCrudIndexer,
    })

    return removed
  },
  captureAfter: (_input, result) => ({ id: String(result.id), code: result.code }),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('parties.audit.parties.delete', 'Delete party'),
      resourceKind: RESOURCE_KIND,
      resourceId: String(result.id),
      tenantId: String(result.tenantId),
      organizationId: String(result.organizationId),
      snapshotAfter: { id: String(result.id), code: result.code },
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ before?: SerializedParty }>(logEntry)
    const snapshot = payload?.before ?? (logEntry?.snapshotBefore as SerializedParty | undefined)
    const id = snapshot?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing party id for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const restored = await de.updateOrmEntity({
      entity: Party,
      where: {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      } as FilterQuery<Party>,
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
      events: partyCrudEvents,
      indexer: partyCrudIndexer,
    })
  },
}

registerCommand(createPartyCommand)
registerCommand(updatePartyCommand)
registerCommand(deletePartyCommand)

export { createPartyCommand, updatePartyCommand, deletePartyCommand }
