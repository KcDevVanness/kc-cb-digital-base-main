import { describe, expect, it } from '@jest/globals'
import {
  COLLABORATOR_WRITABLE_FIELDS,
  collaboratorFieldRefused,
  forbiddenCollaboratorFields,
  scopeOrganizationIds,
} from '../collaborators'
import { COMPANY_ORDER_COLLABORATOR_FIELD_CODE } from '../../data/validators'

/**
 * Pure pieces of the collaboration lib: the collaborator write whitelist (REQ-014/REQ-016) and the
 * organization-set derivation the owner/collaborator split is built on. The scoped reads
 * (`loadCollaboratorCompanyOrderIds`, `resolveCompanyOrderAccess`) are covered by the integration
 * suite, which is the only place a real tenant scope exists.
 */
describe('collaborators lib', () => {
  it('lets a collaborator address the row and write status/notes, and nothing else', () => {
    expect(forbiddenCollaboratorFields({})).toEqual([])
    expect(forbiddenCollaboratorFields({ id: 'x', updatedAt: 'v' })).toEqual([])
    expect(forbiddenCollaboratorFields({ id: 'x', status: 'completed' })).toEqual([])
    expect(forbiddenCollaboratorFields({ id: 'x', notes: null, status: 'draft' })).toEqual([])
  })

  it('reports every out-of-whitelist key of a collaborator payload', () => {
    expect(forbiddenCollaboratorFields({ id: 'x', title: 'Renamed' })).toEqual(['title'])
    expect(
      forbiddenCollaboratorFields({
        id: 'x',
        status: 'completed',
        title: 'Renamed',
        etaDate: '2026-11-01',
        customerPartyId: null,
      }),
    ).toEqual(['title', 'etaDate', 'customerPartyId'])
  })

  it('keeps `id`/`updatedAt` in the whitelist as addressing, not as data', () => {
    expect(COLLABORATOR_WRITABLE_FIELDS).toEqual(['id', 'updatedAt', 'status', 'notes'])
  })

  it('refuses with the named code and names the offending fields', () => {
    const error = collaboratorFieldRefused(['title', 'orderDate'])
    expect(error.status).toBe(422)
    expect(error.body).toMatchObject({ code: COMPANY_ORDER_COLLABORATOR_FIELD_CODE })
    expect(String(error.body.error)).toContain('title')
    expect(String(error.body.error)).toContain('orderDate')
  })

  it('derives the caller organization set from the expanded scope, falling back to the selected org', () => {
    expect(scopeOrganizationIds({ tenantId: 't', organizationId: 'a', organizationIds: ['a', 'b', 'a'] })).toEqual([
      'a',
      'b',
    ])
    expect(scopeOrganizationIds({ tenantId: 't', organizationId: 'a' })).toEqual(['a'])
    expect(scopeOrganizationIds({ tenantId: 't', organizationId: 'a', organizationIds: [] })).toEqual(['a'])
  })
})
