import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { normalizeDictionaryValue } from '@open-mercato/core/modules/dictionaries/lib/utils'

/**
 * Container models the logistics team books (货柜型号). `value` is the code stored on a shipment,
 * `label` what the picker and the lists show.
 */
export const CONTAINER_TYPE_SEEDS = [
  { value: '40HQ', label: '40HQ', position: 10 },
  { value: '120AUTO', label: '120AUTO', position: 20 },
  { value: '40HQ*2', label: '40HQ*2', position: 30 },
  { value: '20GP+40HQ', label: '20GP+40HQ', position: 40 },
  { value: '3*40HQ', label: '3*40HQ', position: 50 },
  { value: '20GP', label: '20GP', position: 60 },
  { value: 'GUANGZHOU_LOGISTICS_KAPRO', label: '广州物流Kapro', position: 70 },
] as const

/** The dictionary a shipment's `container_type` reads its options from. */
export const CONTAINER_TYPE_DICTIONARY_KEY = 'container_type'

/**
 * ACL defaults for newly created tenants. `superadmin`/`admin` receive the module so the first
 * operator can work; `employee` is deliberately left ungranted — warehouse staff get
 * `cross_border.shipments.receive` through their own role, and that is an operational decision.
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['cross_border.*'],
    admin: ['cross_border.*'],
  },
  /**
   * Seeds the container-type dictionary once per organization. Insert-only and idempotent:
   * re-running `yarn mercato seed:defaults --module cross_border` never duplicates a row, and an
   * existing dictionary is left exactly as the operator edited it (values, labels, order).
   */
  async seedDefaults(ctx) {
    const em = ctx.em
    const existing = await em.findOne(Dictionary, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      key: CONTAINER_TYPE_DICTIONARY_KEY,
    })
    if (existing) return

    const now = new Date()
    const dictionary = em.create(Dictionary, {
      key: CONTAINER_TYPE_DICTIONARY_KEY,
      name: 'Container types',
      description: 'Container models booked for cross-border shipments',
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      isSystem: true,
      isActive: true,
      managerVisibility: 'default',
      createdAt: now,
      updatedAt: now,
    })
    em.persist(dictionary)

    for (const seed of CONTAINER_TYPE_SEEDS) {
      em.persist(
        em.create(DictionaryEntry, {
          dictionary,
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
          value: seed.value,
          normalizedValue: normalizeDictionaryValue(seed.label),
          label: seed.label,
          color: null,
          icon: null,
          position: seed.position,
          isDefault: false,
          createdAt: now,
          updatedAt: now,
        }),
      )
    }
    await em.flush()
  },
}

export default setup
