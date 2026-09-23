import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { PurchasingScope } from '../commands/shared'

/**
 * Writing `purchasing_supplier_products.product_id` — the 关联已有商品 action.
 *
 * The link is a scalar id with no foreign key across the module boundary (the app-wide rule), so
 * the database cannot enforce that the target exists, is live, and belongs to the caller's scope.
 * It is enforced here instead, **inside the transaction that performs the write**, and the product
 * row is locked (`for update`) while it happens: whichever statement runs second waits for the
 * other to commit and then reads the committed state, so a product soft-deleted between the
 * picker's read and the write is a refusal with nothing written rather than a dangling link.
 *
 * The library row is updated with raw Kysely inside that same transaction because the check and the
 * write have to share a connection; the command emits the row's CRUD side effects afterwards, from
 * the row it re-reads.
 */

type LinkTables = {
  products_products: {
    id: string
    deleted_at: Date | null
    tenant_id: string
    organization_id: string
  }
  purchasing_supplier_products: {
    id: string
    product_id: string | null
    updated_at: Date
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
}

/**
 * `productId: null` clears the link (解除关联); a uuid links or re-points it (建档/换绑).
 */
export async function writeSupplierProductLink(input: {
  em: EntityManager
  scope: PurchasingScope
  supplierProductId: string
  productId: string | null
}): Promise<void> {
  const { em, scope, supplierProductId, productId } = input
  await em.transactional(async (tx) => {
    const db = tx.getKysely() as unknown as Kysely<LinkTables>

    if (productId) {
      const product = await db
        .selectFrom('products_products')
        .select(['id', 'deleted_at'])
        .where('id', '=', productId)
        .where('tenant_id', '=', scope.tenantId)
        .where('organization_id', '=', scope.organizationId)
        .forUpdate()
        .executeTakeFirst()
      if (!product) {
        throw new CrudHttpError(404, {
          error: `Product not found in this organization: ${productId}`,
          code: 'product_not_found',
        })
      }
      if (product.deleted_at) {
        throw new CrudHttpError(422, {
          error: 'The selected product is deleted; restore it or pick another one',
          code: 'product_deleted',
        })
      }
    }

    const updated = await db
      .updateTable('purchasing_supplier_products')
      .set({ product_id: productId, updated_at: new Date() })
      .where('id', '=', supplierProductId)
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', '=', scope.organizationId)
      .where('deleted_at', 'is', null)
      .returning(['id'])
      .executeTakeFirst()
    if (!updated) {
      throw new CrudHttpError(404, { error: 'Supplier product not found', code: 'not_found' })
    }
  })
}
