import type { AwilixContainer } from 'awilix'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { runWithCacheTenant } from '@open-mercato/cache'

/**
 * CRUD list cache invalidation for this module's collections.
 *
 * The platform caches CRUD list payloads per resource + tenant + organization when
 * `ENABLE_CRUD_API_CACHE` is on, and only the nonsense-free *same-resource* case is covered by the
 * factory: a write through the invoice route clears the invoice collection, but the **contract**
 * collection it also rewrote (the confirmed invoice line replaces the contract line's financial
 * amount) keeps answering the pre-write payload until its TTL. The same holds for the child
 * collections of a shipment and for this module's own `[id]/…` action routes, which bypass the
 * factory entirely.
 *
 * Every command that writes one of these rows therefore has to name the collections it invalidated.
 * The tag building, tenant scoping and TTL are the platform's; this file only states which
 * resources a trade_docs write can move, so no caller has to remember it.
 */

/** Resource strings match the factory's own derivation (`<module>.<entity>`, canonicalized). */
const CONTRACT = 'trade_docs.contract'
const CONTRACT_LINE = 'trade_docs.contract.line'
const INVOICE = 'trade_docs.invoice'
const INVOICE_LINE = 'trade_docs.invoice.line'
const DOCUMENT = 'trade_docs.document'
const DOCUMENT_LINE = 'trade_docs.document.line'

export type CacheScope = {
  container: AwilixContainer
  tenantId: string | null
  organizationId: string | null
}

export type CacheIdentifiers = {
  id: string
  tenantId: string
  organizationId: string
}

/**
 * The cache is tenant-scoped (`tenant:<id>:…` keys/tags), so an invalidation outside the tenant
 * context would silently reach nothing — the installed `customers` bulk path wraps its calls for
 * exactly this reason.
 */
async function invalidate(
  scope: CacheScope,
  resources: string[],
  identifiers: CacheIdentifiers,
  reason: string,
): Promise<void> {
  const [resource, ...aliases] = resources
  await runWithCacheTenant(scope.tenantId ?? identifiers.tenantId, async () => {
    await invalidateCrudCache(
      scope.container,
      resource,
      { id: identifiers.id, tenantId: identifiers.tenantId, organizationId: identifiers.organizationId },
      scope.tenantId ?? identifiers.tenantId,
      reason,
      aliases,
    )
  })
}

/** Contracts: the contract list and its line surface. */
export async function invalidateContractCaches(
  scope: CacheScope,
  identifiers: CacheIdentifiers,
  reason: string,
): Promise<void> {
  await invalidate(scope, [CONTRACT, CONTRACT_LINE], identifiers, reason)
}

/** Invoices: their own collections **and** the contract money columns a confirmation rewrites. */
export async function invalidateInvoiceCaches(
  scope: CacheScope,
  identifiers: CacheIdentifiers,
  reason: string,
): Promise<void> {
  await invalidate(scope, [INVOICE, INVOICE_LINE, CONTRACT, CONTRACT_LINE], identifiers, reason)
}

/** PI/CI documents: the document list and its line surface. */
export async function invalidateDocumentCaches(
  scope: CacheScope,
  identifiers: CacheIdentifiers,
  reason: string,
): Promise<void> {
  await invalidate(scope, [DOCUMENT, DOCUMENT_LINE], identifiers, reason)
}
