import type { CommandInterceptor, CommandInterceptorBeforeResult, CommandInterceptorContext } from '@open-mercato/shared/lib/commands/command-interceptor'
import { isOrganizationAccessAllowed } from '@open-mercato/shared/lib/auth/organizationAccess'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  hasAclOwnershipViolation,
  resolveActorScope,
  type AclTargetKind,
} from '../lib/scopeGuard'

const logger = createLogger('scope_guards').child({ component: 'auth-scope' })

type GuardMeta = Record<string, unknown>

async function rejection(
  code: string,
  messageKey: string,
  fallback: string,
  meta: GuardMeta,
): Promise<CommandInterceptorBeforeResult> {
  logger.warn('Blocked out-of-scope write', { ...meta, code })
  let message = fallback
  try {
    const { translate } = await resolveTranslations()
    message = translate(messageKey, fallback)
  } catch {
    // Translation is best effort — the fallback keeps the rejection observable.
  }
  return { ok: false, status: 403, body: { error: message, code } }
}

async function resolutionFailure(meta: GuardMeta, error: unknown): Promise<CommandInterceptorBeforeResult> {
  logger.error('Scope guard could not resolve the actor scope', { err: error, ...meta })
  return rejection(
    'scope_guards.scope_resolution_failed',
    'scope_guards.errors.scopeResolutionFailed',
    'Your organization scope could not be verified, so the operation was rejected.',
    meta,
  )
}

/**
 * `auth.users.create` — the installed update path validates the destination organization,
 * the create path does not. Re-apply the same rule on the command so every caller is covered.
 */
const userCreateDestinationInterceptor: CommandInterceptor = {
  id: 'scope_guards.user-create-destination',
  targetCommand: 'auth.users.create',
  features: ['auth.users.create'],
  priority: 60,
  async beforeExecute(input, context) {
    const payload = (input ?? {}) as Record<string, unknown>
    const targetOrganizationId = typeof payload.organizationId === 'string' ? payload.organizationId : null
    const meta: GuardMeta = {
      commandId: context.commandId,
      actorUserId: context.auth?.sub ?? null,
      tenantId: context.auth?.tenantId ?? null,
      targetOrganizationId,
    }
    try {
      const actor = await resolveActorScope({
        container: context.container,
        auth: context.auth,
        selectedOrganizationId: context.selectedOrganizationId,
      })
      if (!actor) return { ok: true }
      const allowed = isOrganizationAccessAllowed({
        isSuperAdmin: actor.isSuperAdmin,
        allowedOrganizationIds: actor.allowedOrganizationIds,
        targetOrganizationId,
      })
      if (allowed) return { ok: true }
      return await rejection(
        'scope_guards.user_destination_outside_scope',
        'scope_guards.errors.userDestinationOutsideScope',
        'Cannot assign a user to a destination organization outside your scope.',
        meta,
      )
    } catch (error) {
      return resolutionFailure(meta, error)
    }
  },
}

async function guardAclOwnership(
  input: unknown,
  context: CommandInterceptorContext,
  kind: AclTargetKind,
): Promise<CommandInterceptorBeforeResult> {
  const payload = (input ?? {}) as Record<string, unknown>
  const rawTarget = kind === 'role' ? payload.roleId : payload.userId
  const targetId = typeof rawTarget === 'string' && rawTarget.length > 0 ? rawTarget : null
  if (!targetId) return { ok: true }
  const meta: GuardMeta = {
    commandId: context.commandId,
    actorUserId: context.auth?.sub ?? null,
    tenantId: context.auth?.tenantId ?? null,
    targetKind: kind,
    targetId,
  }
  try {
    const actor = await resolveActorScope({
      container: context.container,
      auth: context.auth,
      selectedOrganizationId: context.selectedOrganizationId,
    })
    if (!actor) return { ok: true }
    const tenantId = typeof context.auth?.tenantId === 'string' && context.auth.tenantId.trim().length > 0
      ? context.auth.tenantId.trim()
      : null
    if (!tenantId) {
      return await rejection(
        'scope_guards.scope_resolution_failed',
        'scope_guards.errors.scopeResolutionFailed',
        'Your organization scope could not be verified, so the operation was rejected.',
        meta,
      )
    }
    const violation = await hasAclOwnershipViolation({
      container: context.container,
      tenantId,
      kind,
      targetId,
      actor,
    })
    if (!violation) return { ok: true }
    return await rejection(
      'scope_guards.acl_target_outside_scope',
      'scope_guards.errors.aclTargetOutsideScope',
      'The target permission record is scoped outside the organizations you may manage.',
      meta,
    )
  } catch (error) {
    return resolutionFailure(meta, error)
  }
}

const roleAclOwnershipInterceptor: CommandInterceptor = {
  id: 'scope_guards.acl-target-ownership-role',
  targetCommand: 'auth.role-acl.update',
  features: ['auth.acl.manage'],
  priority: 60,
  async beforeExecute(input, context) {
    return guardAclOwnership(input, context, 'role')
  },
}

const userAclOwnershipInterceptor: CommandInterceptor = {
  id: 'scope_guards.acl-target-ownership-user',
  targetCommand: 'auth.user-acl.update',
  features: ['auth.acl.manage'],
  priority: 60,
  async beforeExecute(input, context) {
    return guardAclOwnership(input, context, 'user')
  },
}

export const interceptors: CommandInterceptor[] = [
  userCreateDestinationInterceptor,
  roleAclOwnershipInterceptor,
  userAclOwnershipInterceptor,
]
