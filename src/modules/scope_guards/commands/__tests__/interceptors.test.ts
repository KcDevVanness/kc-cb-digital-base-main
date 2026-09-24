import { describe, expect, it } from '@jest/globals'
import type { AwilixContainer } from 'awilix'
import type { CommandInterceptorContext } from '@open-mercato/shared/lib/commands/command-interceptor'
import { interceptors } from '../../commands/interceptors'

function contextFor(overrides: {
  auth: CommandInterceptorContext['auth']
  resolve?: () => never
}): CommandInterceptorContext {
  return {
    commandId: 'test.command',
    auth: overrides.auth,
    selectedOrganizationId: null,
    container: {
      resolve: overrides.resolve ?? (() => { throw new Error('container must not be touched') }),
    } as unknown as AwilixContainer,
  }
}

function guardById(id: string) {
  const guard = interceptors.find((entry) => entry.id === id)
  if (!guard?.beforeExecute) throw new Error(`guard ${id} is not registered`)
  return guard.beforeExecute
}

describe('scope_guards interceptors', () => {
  it('registers one guard per hardened command with stable ids', () => {
    expect(interceptors.map((entry) => entry.id)).toEqual([
      'scope_guards.user-create-destination',
      'scope_guards.acl-target-ownership-role',
      'scope_guards.acl-target-ownership-user',
    ])
    expect(interceptors.map((entry) => entry.targetCommand)).toEqual([
      'auth.users.create',
      'auth.role-acl.update',
      'auth.user-acl.update',
    ])
  })

  it('lets trusted system contexts through without touching the container', async () => {
    const beforeExecute = guardById('scope_guards.user-create-destination')
    const result = await beforeExecute({ organizationId: '00000000-0000-4000-8000-000000000001' }, contextFor({ auth: null }))
    expect(result?.ok).toBe(true)
  })

  it('rejects a tenant-less actor instead of reading it as unrestricted', async () => {
    const beforeExecute = guardById('scope_guards.user-create-destination')
    const result = await beforeExecute(
      { organizationId: '00000000-0000-4000-8000-000000000001' },
      contextFor({ auth: { sub: 'user-1', tenantId: null, orgId: null } as CommandInterceptorContext['auth'] }),
    )
    expect(result?.ok).toBe(false)
    expect(result?.status).toBe(403)
    expect((result?.body as { code?: string } | undefined)?.code).toBe('scope_guards.user_destination_outside_scope')
  })

  it('fails closed when the actor scope cannot be resolved', async () => {
    const beforeExecute = guardById('scope_guards.user-create-destination')
    const result = await beforeExecute(
      { organizationId: '00000000-0000-4000-8000-000000000001' },
      contextFor({
        auth: { sub: 'user-1', tenantId: '00000000-0000-4000-8000-0000000000aa', orgId: null } as CommandInterceptorContext['auth'],
        resolve: () => { throw new Error('rbac unavailable') },
      }),
    )
    expect(result?.ok).toBe(false)
    expect(result?.status).toBe(403)
    expect((result?.body as { code?: string } | undefined)?.code).toBe('scope_guards.scope_resolution_failed')
  })

  it('fails closed for ACL writes when the tenant cannot be resolved', async () => {
    const beforeExecute = guardById('scope_guards.acl-target-ownership-role')
    const result = await beforeExecute(
      { roleId: '00000000-0000-4000-8000-000000000002' },
      contextFor({ auth: { sub: 'user-1', tenantId: null, orgId: null } as CommandInterceptorContext['auth'] }),
    )
    expect(result?.ok).toBe(false)
    expect(result?.status).toBe(403)
    expect((result?.body as { code?: string } | undefined)?.code).toBe('scope_guards.scope_resolution_failed')
  })
})
