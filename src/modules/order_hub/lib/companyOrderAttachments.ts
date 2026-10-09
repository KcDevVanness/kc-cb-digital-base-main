import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'
import { resolveCompanyOrderAccess } from './collaborators'

/**
 * Company-order files, read as a **root-visibility** projection (REQ-018).
 *
 * The installed `attachments` list route scopes its read by the caller's *own* organization
 * (`organizationId = <selected org>`), which is exactly what hides an owner's files from a
 * collaborating organization. This module's read therefore drops that organization filter and keeps
 * the tenant one, then authorizes on the **root**: the caller may read the files of a company order
 * only when `resolveCompanyOrderAccess` says they own or collaborate on it. That keeps the single
 * place the owner/collaborator split is decided (`lib/collaborators.ts`) as the only authorization
 * input — the projection itself never decides who may see what.
 *
 * The columns are declared locally (a projection, not an entity dependency); the handle is cast once
 * because MikroORM types `getKysely()`'s DB generic as `never` (see lesson
 * `.ai/lessons/kysely-bare-handle-types-tables-away.md`).
 */
export const COMPANY_ORDER_ATTACHMENT_ENTITY_ID = 'order_hub:company_order'

export type OrderAttachmentScope = {
  tenantId: string
  organizationIds: readonly string[]
}

type AttachmentReadTables = {
  attachments: {
    id: string
    entity_id: string
    record_id: string
    file_name: string
    file_size: number
    mime_type: string
    created_at: Date | string
    tenant_id: string | null
  }
}

const readDb = (em: EntityManager): Kysely<AttachmentReadTables> =>
  em.fork().getKysely() as unknown as Kysely<AttachmentReadTables>

/** One file of a company order, as the hub's files block lists it. */
export type CompanyOrderAttachmentSummary = {
  id: string
  fileName: string
  fileSize: number
  createdAt: string
}

function toIsoTimestamp(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' ? value : ''
}

/**
 * Whether the caller's organizations may see this company order — the owner organization is in the
 * expanded scope, or one of their organizations is a collaborator. `false` covers both "no such
 * root" and "not mine"; the callers must never tell the two apart.
 */
export async function isCompanyOrderVisibleToScope(
  em: EntityManager,
  scope: OrderAttachmentScope,
  companyOrderId: string,
): Promise<boolean> {
  if (!companyOrderId || !scope.tenantId || scope.organizationIds.length === 0) return false
  const access = await resolveCompanyOrderAccess(
    em,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationIds[0] ?? '',
      organizationIds: scope.organizationIds,
    },
    companyOrderId,
  )
  return access !== null
}

/**
 * The files filed under one company order (`entityId='order_hub:company_order'`,
 * `recordId=<root id>`), newest first. An invisible or unknown root answers an empty list — the
 * response never confirms that a foreign root exists.
 */
export async function loadCompanyOrderAttachments(
  em: EntityManager,
  scope: OrderAttachmentScope,
  companyOrderId: string,
): Promise<CompanyOrderAttachmentSummary[]> {
  if (!(await isCompanyOrderVisibleToScope(em, scope, companyOrderId))) return []

  const rows = (await readDb(em)
    .selectFrom('attachments')
    .select(['id', 'file_name', 'file_size', 'mime_type', 'created_at'])
    .where('entity_id', '=', COMPANY_ORDER_ATTACHMENT_ENTITY_ID)
    .where('record_id', '=', companyOrderId)
    .where('tenant_id', '=', scope.tenantId)
    .orderBy('created_at', 'desc')
    .execute()) as Array<{
    id: string
    file_name: string
    file_size: number
    mime_type: string
    created_at: Date | string
  }>

  return rows.map((row) => ({
    id: String(row.id),
    fileName: String(row.file_name),
    fileSize: Number.isFinite(row.file_size) ? Number(row.file_size) : 0,
    createdAt: toIsoTimestamp(row.created_at),
  }))
}
