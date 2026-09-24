import { describe, expect, it } from '@jest/globals'
import {
  canonicalPathProblem,
  hasScopeSegments,
  objectKeyFor,
  objectKeyProblem,
  sha256,
  withPartitionPrefix,
  withoutPartitionPrefix,
} from '../paths'

const ORG = 'bf4ccd1a-76e4-47b5-a2dd-6e6f45601fbc'
const TENANT = '212721cf-fbea-4fdd-b99a-95e4890a92f8'
const CANONICAL = `org_${ORG}/tenant_${TENANT}/1790144681897_20bf2b6cf505_invoice.pdf`

describe('canonical attachment paths (spec C-1)', () => {
  it('accepts what the local driver writes', () => {
    expect(canonicalPathProblem(CANONICAL, 'privateAttachments')).toBeNull()
    expect(hasScopeSegments(CANONICAL)).toBe(true)
  })

  it('rejects the shapes the flip rewrite cannot survive', () => {
    expect(canonicalPathProblem('', 'privateAttachments')).toBe('empty')
    expect(canonicalPathProblem(`/${CANONICAL}`, 'privateAttachments')).toBe('absolute')
    expect(canonicalPathProblem(`org_${ORG}/../tenant_${TENANT}/x.pdf`, 'privateAttachments')).toBe('traversal')
    expect(canonicalPathProblem(`org_${ORG}\\tenant_${TENANT}\\x.pdf`, 'privateAttachments')).toBe('backslash')
    expect(canonicalPathProblem(`privateAttachments/${CANONICAL}`, 'privateAttachments')).toBe('already-prefixed')
    expect(canonicalPathProblem('public/uploads/legacy.pdf', 'privateAttachments')).toBe('missing-scope-segments')
  })

  it('treats a path that already carries the partition segment as non-canonical, not as a second flip', () => {
    const flipped = withPartitionPrefix('privateAttachments', CANONICAL)
    expect(flipped).toBe(`privateAttachments/${CANONICAL}`)
    expect(canonicalPathProblem(flipped, 'privateAttachments')).toBe('already-prefixed')
  })
})

describe('object keys (spec: [pathPrefix]<partition>/<canonical path>)', () => {
  it('prefixes the partition code and nothing else by default', () => {
    expect(objectKeyFor('privateAttachments', CANONICAL)).toBe(`privateAttachments/${CANONICAL}`)
  })

  it('honours a configured pathPrefix with or without a trailing slash', () => {
    expect(objectKeyFor('privateAttachments', CANONICAL, 'prod')).toBe(`prod/privateAttachments/${CANONICAL}`)
    expect(objectKeyFor('privateAttachments', CANONICAL, 'prod/')).toBe(`prod/privateAttachments/${CANONICAL}`)
  })

  it('mirrors the S3 driver assertions before any network call', () => {
    const key = objectKeyFor('privateAttachments', CANONICAL)
    expect(objectKeyProblem('privateAttachments', key)).toBeNull()
    expect(objectKeyProblem('privateAttachments', `privateAttachments/org_${ORG}/x.pdf`)).toContain(
      'not scoped to the active tenant',
    )
    expect(objectKeyProblem('otherPartition', key)).toContain('not scoped to the requested partition')
  })
})

describe('flip and rollback rewrites are inverse', () => {
  it('round trips the canonical path', () => {
    const prefixed = withPartitionPrefix('privateAttachments', CANONICAL)
    expect(withoutPartitionPrefix('privateAttachments', prefixed)).toBe(CANONICAL)
  })

  it('is idempotent in both directions', () => {
    const prefixed = withPartitionPrefix('privateAttachments', CANONICAL)
    expect(withPartitionPrefix('privateAttachments', prefixed)).toBe(prefixed)
    expect(withoutPartitionPrefix('privateAttachments', CANONICAL)).toBe(CANONICAL)
  })
})

describe('content hashes', () => {
  it('hashes bytes deterministically', () => {
    expect(sha256(Buffer.from('probe'))).toBe(sha256(Buffer.from('probe')))
    expect(sha256(Buffer.from('probe'))).not.toBe(sha256(Buffer.from('probe ')))
  })
})
