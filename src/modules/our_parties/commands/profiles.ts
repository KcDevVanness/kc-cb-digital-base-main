import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
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
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { OurPartyBankAccount, OurPartyProfile } from '../data/entities'
import {
  ourPartyProfileCreateSchema,
  ourPartyProfileUpdateSchema,
  type OurPartyBankAccountInput,
} from '../data/validators'

const ENTITY_ID = 'our_parties:our_party_profile' as const
const RESOURCE_KIND = 'our_parties.our_party_profile' as const

type SerializedBankAccount = {
  id: string
  beneficiaryBank: string
  accountNumber: string
  swiftCode: string | null
  bankAddress: string | null
  isDefault: boolean
}

type SerializedProfile = {
  id: string
  organizationId: string
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  countryCode: string | null
  contactName: string | null
  contactPhone: string | null
  email: string | null
  notes: string | null
  bankAccounts: SerializedBankAccount[]
  tenantId: string
}

function serializeBankAccount(entity: OurPartyBankAccount): SerializedBankAccount {
  return {
    id: String(entity.id),
    beneficiaryBank: entity.beneficiaryBank,
    accountNumber: entity.accountNumber,
    swiftCode: entity.swiftCode ?? null,
    bankAddress: entity.bankAddress ?? null,
    isDefault: entity.isDefault === true,
  }
}

function serializeProfile(
  entity: OurPartyProfile,
  bankAccounts: OurPartyBankAccount[],
): SerializedProfile {
  return {
    id: String(entity.id),
    organizationId: String(entity.organizationId),
    addressLine1: entity.addressLine1 ?? null,
    addressLine2: entity.addressLine2 ?? null,
    city: entity.city ?? null,
    countryCode: entity.countryCode ?? null,
    contactName: entity.contactName ?? null,
    contactPhone: entity.contactPhone ?? null,
    email: entity.email ?? null,
    notes: entity.notes ?? null,
    bankAccounts: bankAccounts.map(serializeBankAccount),
    tenantId: String(entity.tenantId),
  }
}

export const ourPartyCrudEvents: CrudEventsConfig<OurPartyProfile> = {
  module: 'our_parties',
  entity: 'profile',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<OurPartyProfile>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    // The subject company is the row's organization, and the one a consumer cares about.
    organizationId: ctx.identifiers.organizationId,
  }),
}

export const ourPartyCrudIndexer: CrudIndexerConfig<OurPartyProfile> = {
  entityType: ENTITY_ID,
}

/** Trusted scope only: the acting organization never comes from the payload. */
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

/**
 * The profile's `organization_id` is a **subject** (which of our companies this profile describes),
 * so it is validated here instead of being forced to equal the acting organization: a group
 * operator acting in the parent company maintains the subsidiaries' profiles. The check is the
 * caller's own readable organization set (the ACL organization axis), fail-closed — an organization
 * outside it is refused rather than silently written.
 */
async function assertOrganizationAddressable(
  ctx: CommandRuntimeContext,
  scope: { tenantId: string; organizationId: string },
  organizationId: string,
): Promise<void> {
  const auth = ctx.auth ?? null
  // Trusted system context (no end-user actor): the caller already decided the scope.
  if (!auth?.sub) return
  if (auth.isSuperAdmin === true) return
  const em = ctx.container.resolve('em') as EntityManager
  const rbac = ctx.container.resolve('rbacService') as RbacService
  const resolved = await resolveOrganizationScope({
    em,
    rbac,
    auth,
    selectedId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  const allowedIds = Array.isArray(resolved?.allowedIds) ? resolved.allowedIds : null
  // `null` = unrestricted within the tenant.
  if (allowedIds === null) return
  if (!allowedIds.includes(organizationId)) {
    throw new CrudHttpError(403, {
      error: 'That organization is outside your scope',
      code: 'our_parties.organization_outside_scope',
    })
  }
}

function profileFilter(scope: { tenantId: string }, id: string): FilterQuery<OurPartyProfile> {
  return { id, tenantId: scope.tenantId, deletedAt: null } as FilterQuery<OurPartyProfile>
}

async function loadProfile(em: EntityManager, id: string): Promise<OurPartyProfile | null> {
  return em.fork().findOne(OurPartyProfile, { id, deletedAt: null } as FilterQuery<OurPartyProfile>)
}

async function loadBankAccounts(
  em: EntityManager,
  tenantId: string,
  profileId: string,
): Promise<OurPartyBankAccount[]> {
  return findWithDecryption(
    em,
    OurPartyBankAccount,
    { profile: profileId, tenantId } as FilterQuery<OurPartyBankAccount>,
    { orderBy: { createdAt: 'asc' } },
    { tenantId },
  )
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'UniqueConstraintViolationException'
  )
}

function toNullableText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** More than one default is a payload mistake the operator can fix, so it is a 400, not a 500. */
function assertSingleDefault(bankAccounts: OurPartyBankAccountInput[] | undefined): void {
  if (!bankAccounts || bankAccounts.length === 0) return
  const defaults = bankAccounts.filter((row) => row.isDefault === true)
  if (defaults.length > 1) {
    throw badRequest('Only one bank account can be the default')
  }
}

/**
 * Which row of the submitted bank block carries the default flag: the one the operator ticked, or —
 * when none is ticked — the first row, so a company with one account always prints an account and
 * the partial unique index can hold. Exported for the unit test; `assertSingleDefault` has already
 * rejected two explicit ticks by the time this runs.
 */
export function bankAccountIsDefault(rows: OurPartyBankAccountInput[], index: number): boolean {
  if (index < 0 || index >= rows.length) return false
  return rows.some((entry) => entry.isDefault === true) ? rows[index].isDefault === true : index === 0
}

async function createBankAccounts(
  de: DataEngine,
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  profileId: string,
  bankAccounts: OurPartyBankAccountInput[] | undefined,
): Promise<void> {
  const rows = bankAccounts ?? []
  const profile = em.getReference(OurPartyProfile, profileId)
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    await de.createOrmEntity({
      entity: OurPartyBankAccount,
      data: {
        tenantId,
        organizationId,
        profile,
        beneficiaryBank: row.beneficiaryBank,
        accountNumber: row.accountNumber,
        swiftCode: toNullableText(row.swiftCode) ?? null,
        bankAddress: toNullableText(row.bankAddress) ?? null,
        isDefault: bankAccountIsDefault(rows, index),
      },
    })
  }
}

/**
 * The bank block's replace semantics, mirroring the party master: a named id updates in place, an
 * unnamed row is created, and a stored row the payload no longer names is deleted.
 */
async function replaceBankAccounts(
  de: DataEngine,
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  profileId: string,
  bankAccounts: OurPartyBankAccountInput[],
  existing: OurPartyBankAccount[],
): Promise<void> {
  const wanted = new Set(bankAccounts.map((row) => row.id).filter((id): id is string => typeof id === 'string'))
  for (const row of existing) {
    if (wanted.has(String(row.id))) continue
    await de.deleteOrmEntity({
      entity: OurPartyBankAccount,
      where: { id: String(row.id), tenantId } as FilterQuery<OurPartyBankAccount>,
      soft: false,
    })
  }
  const present = new Map(existing.map((row) => [String(row.id), row]))
  const profile = em.getReference(OurPartyProfile, profileId)
  for (let index = 0; index < bankAccounts.length; index += 1) {
    const row = bankAccounts[index]
    const isDefault = bankAccountIsDefault(bankAccounts, index)
    const current = row.id ? present.get(row.id) : undefined
    if (current) {
      await de.updateOrmEntity({
        entity: OurPartyBankAccount,
        where: { id: String(row.id), tenantId } as FilterQuery<OurPartyBankAccount>,
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
    if (row.id) throw badRequest('Bank account not found on this profile')
    await de.createOrmEntity({
      entity: OurPartyBankAccount,
      data: {
        tenantId,
        organizationId,
        profile,
        beneficiaryBank: row.beneficiaryBank,
        accountNumber: row.accountNumber,
        swiftCode: toNullableText(row.swiftCode) ?? null,
        bankAddress: toNullableText(row.bankAddress) ?? null,
        isDefault,
      },
    })
  }
}

/** Undo path: children are rebuilt exactly as the snapshot recorded them, ids included. */
async function restoreBankAccounts(
  de: DataEngine,
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  profileId: string,
  snapshot: SerializedProfile,
): Promise<void> {
  const existing = await loadBankAccounts(em, tenantId, profileId)
  for (const row of existing) {
    await de.deleteOrmEntity({
      entity: OurPartyBankAccount,
      where: { id: String(row.id), tenantId } as FilterQuery<OurPartyBankAccount>,
      soft: false,
    })
  }
  await createBankAccounts(
    de,
    em,
    tenantId,
    organizationId,
    profileId,
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

const createProfileCommand: CommandHandler<Record<string, unknown>, OurPartyProfile> = {
  id: 'our_parties.profiles.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = ourPartyProfileCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    await assertOrganizationAddressable(ctx, scope, parsed.organizationId)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    assertSingleDefault(parsed.bankAccounts)

    let profile!: OurPartyProfile
    await withAtomicFlush(
      em,
      [
        async () => {
          profile = await de
            .createOrmEntity({
              entity: OurPartyProfile,
              data: {
                tenantId: scope.tenantId,
                organizationId: parsed.organizationId,
                addressLine1: toNullableText(parsed.addressLine1) ?? null,
                addressLine2: toNullableText(parsed.addressLine2) ?? null,
                city: toNullableText(parsed.city) ?? null,
                countryCode: toNullableText(parsed.countryCode) ?? null,
                contactName: toNullableText(parsed.contactName) ?? null,
                contactPhone: toNullableText(parsed.contactPhone) ?? null,
                email: toNullableText(parsed.email) ?? null,
                notes: toNullableText(parsed.notes) ?? null,
              },
            })
            .catch((error: unknown) => {
              if (isUniqueViolation(error)) {
                throw conflict('A profile already exists for this organization')
              }
              throw error
            })
          await createBankAccounts(
            de,
            em,
            scope.tenantId,
            parsed.organizationId,
            String(profile.id),
            parsed.bankAccounts,
          )
        },
      ],
      { transaction: true, label: 'our_parties.profiles.create' },
    )

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: profile,
      identifiers: {
        id: String(profile.id),
        tenantId: scope.tenantId,
        organizationId: String(profile.organizationId),
      },
      syncOrigin: ctx.syncOrigin,
      events: ourPartyCrudEvents,
      indexer: ourPartyCrudIndexer,
    })

    return profile
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('our_parties.audit.profile.create', 'Create our-entity profile'),
      resourceKind: RESOURCE_KIND,
      resourceId: String(result.id),
      tenantId: String(result.tenantId),
      organizationId: String(result.organizationId),
      snapshotAfter: { id: String(result.id), organizationId: String(result.organizationId) },
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ after?: { id: string } }>(logEntry)
    const snapshot = payload?.after ?? (logEntry?.snapshotAfter as { id?: string } | undefined)
    const id = snapshot?.id ?? logEntry?.resourceId
    if (!id) throw new Error('[internal] Missing profile id for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const removed = await de.deleteOrmEntity({
      entity: OurPartyProfile,
      where: profileFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: ourPartyCrudEvents,
      indexer: ourPartyCrudIndexer,
    })
  },
}

const updateProfileCommand: CommandHandler<Record<string, unknown>, OurPartyProfile> = {
  id: 'our_parties.profiles.update',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const parsed = ourPartyProfileUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const current = await loadProfile(em, parsed.id)
    if (!current) return {}
    const bankAccounts = await loadBankAccounts(em, scope.tenantId, parsed.id)
    return { before: serializeProfile(current, bankAccounts) }
  },
  async execute(rawInput, ctx) {
    const parsed = ourPartyProfileUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const current = await loadProfile(em, parsed.id)
    if (!current) throw notFound('Profile not found')

    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: String(current.id),
      current: current.updatedAt,
      request: ctx.request ?? null,
    })

    assertSingleDefault(parsed.bankAccounts)

    const existing = await loadBankAccounts(em, scope.tenantId, parsed.id)

    await withAtomicFlush(
      em,
      [
        async () => {
          await de.updateOrmEntity({
            entity: OurPartyProfile,
            where: profileFilter(scope, parsed.id),
            apply: (entity) => {
              // Always advance the version: a bank-only edit changes no parent column, and without
              // this the aggregate lock would not see it (the child block is part of the aggregate).
              entity.updatedAt = new Date()
              const addressLine1 = toNullableText(parsed.addressLine1)
              if (addressLine1 !== undefined) entity.addressLine1 = addressLine1
              const addressLine2 = toNullableText(parsed.addressLine2)
              if (addressLine2 !== undefined) entity.addressLine2 = addressLine2
              const city = toNullableText(parsed.city)
              if (city !== undefined) entity.city = city
              const countryCode = toNullableText(parsed.countryCode)
              if (countryCode !== undefined) entity.countryCode = countryCode
              const contactName = toNullableText(parsed.contactName)
              if (contactName !== undefined) entity.contactName = contactName
              const contactPhone = toNullableText(parsed.contactPhone)
              if (contactPhone !== undefined) entity.contactPhone = contactPhone
              const email = toNullableText(parsed.email)
              if (email !== undefined) entity.email = email
              const notes = toNullableText(parsed.notes)
              if (notes !== undefined) entity.notes = notes
            },
          })
          if (parsed.bankAccounts !== undefined) {
            await replaceBankAccounts(
              de,
              em,
              scope.tenantId,
              String(current.organizationId),
              String(current.id),
              parsed.bankAccounts,
              existing,
            )
          }
        },
      ],
      { transaction: true, label: 'our_parties.profiles.update' },
    )

    const updated = await loadProfile(em, parsed.id)
    if (!updated) throw notFound('Profile not found')

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: {
        id: String(updated.id),
        tenantId: scope.tenantId,
        organizationId: String(updated.organizationId),
      },
      syncOrigin: ctx.syncOrigin,
      events: ourPartyCrudEvents,
      indexer: ourPartyCrudIndexer,
    })

    return updated
  },
  captureAfter: (_input, result) => ({ id: String(result.id) }),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const after = {
      id: String(result.id),
      organizationId: String(result.organizationId),
      addressLine1: result.addressLine1 ?? null,
      city: result.city ?? null,
      contactName: result.contactName ?? null,
      email: result.email ?? null,
    }
    return {
      actionLabel: translate('our_parties.audit.profile.update', 'Update our-entity profile'),
      resourceKind: RESOURCE_KIND,
      resourceId: after.id,
      tenantId: String(result.tenantId),
      organizationId: String(result.organizationId),
      snapshotBefore: snapshots.before ?? null,
      snapshotAfter: after,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ before?: SerializedProfile }>(logEntry)
    const before = payload?.before ?? (logEntry?.snapshotBefore as SerializedProfile | undefined)
    if (!before?.id) throw new Error('[internal] Missing previous profile snapshot for undo')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    await withAtomicFlush(
      em,
      [
        async () => {
          await de.updateOrmEntity({
            entity: OurPartyProfile,
            where: profileFilter(scope, before.id),
            apply: (entity) => {
              entity.addressLine1 = before.addressLine1
              entity.addressLine2 = before.addressLine2
              entity.city = before.city
              entity.countryCode = before.countryCode
              entity.contactName = before.contactName
              entity.contactPhone = before.contactPhone
              entity.email = before.email
              entity.notes = before.notes
            },
          })
          await restoreBankAccounts(de, em, scope.tenantId, before.organizationId, before.id, before)
        },
      ],
      { transaction: true, label: 'our_parties.profiles.update.undo' },
    )

    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: null,
      identifiers: { id: before.id, tenantId: scope.tenantId, organizationId: before.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: ourPartyCrudEvents,
      indexer: ourPartyCrudIndexer,
    })
  },
}

const deleteProfileCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  OurPartyProfile | null
> = {
  id: 'our_parties.profiles.delete',
  isUndoable: true,
  async prepare(input, ctx) {
    const id = requireId(input, 'Profile')
    const em = ctx.container.resolve('em') as EntityManager
    const current = await loadProfile(em, id)
    if (!current) return {}
    const bankAccounts = await loadBankAccounts(em, ctx.auth?.tenantId ?? '', id)
    return { before: serializeProfile(current, bankAccounts) }
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Profile')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine
    const current = await loadProfile(em, id)
    if (!current) throw notFound('Profile not found')

    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: String(current.id),
      current: current.updatedAt,
      request: ctx.request ?? null,
    })

    const removed = await de.deleteOrmEntity({
      entity: OurPartyProfile,
      where: profileFilter(scope, id),
      soft: true,
      softDeleteField: 'deletedAt',
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: removed,
      identifiers: {
        id,
        tenantId: scope.tenantId,
        organizationId: String(current.organizationId),
      },
      syncOrigin: ctx.syncOrigin,
      events: ourPartyCrudEvents,
      indexer: ourPartyCrudIndexer,
    })

    return current
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('our_parties.audit.profile.delete', 'Delete our-entity profile'),
      resourceKind: RESOURCE_KIND,
      resourceId: result ? String(result.id) : undefined,
      tenantId: result ? String(result.tenantId) : undefined,
      organizationId: result ? String(result.organizationId) : undefined,
      snapshotAfter: result ? { id: String(result.id) } : null,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ before?: SerializedProfile }>(logEntry)
    const before = payload?.before ?? (logEntry?.snapshotBefore as SerializedProfile | undefined)
    if (!before?.id) throw new Error('[internal] Missing profile snapshot for undo')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const de = ctx.container.resolve('dataEngine') as DataEngine

    const restored = await de.updateOrmEntity({
      entity: OurPartyProfile,
      where: { id: before.id, tenantId: scope.tenantId },
      apply: (entity) => {
        entity.deletedAt = null
        entity.addressLine1 = before.addressLine1
        entity.addressLine2 = before.addressLine2
        entity.city = before.city
        entity.countryCode = before.countryCode
        entity.contactName = before.contactName
        entity.contactPhone = before.contactPhone
        entity.email = before.email
        entity.notes = before.notes
      },
    })

    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'created',
      entity: restored,
      identifiers: { id: before.id, tenantId: scope.tenantId, organizationId: before.organizationId },
      syncOrigin: ctx.syncOrigin,
      events: ourPartyCrudEvents,
      indexer: ourPartyCrudIndexer,
    })
  },
}

registerCommand(createProfileCommand)
registerCommand(updateProfileCommand)
registerCommand(deleteProfileCommand)
