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

/**
 * Ports (港口) a shipment leaves from and a contract ships to. The first block is what this
 * business loads at, the second the destinations its orders actually name; the operator extends the
 * list in the dictionary library (the label carries the name the documents print beside the port).
 */
export const PORT_SEEDS = [
  { value: '深圳盐田', label: '深圳盐田 Yantian', position: 10 },
  { value: '深圳蛇口', label: '深圳蛇口 Shekou', position: 20 },
  { value: '广州南沙', label: '广州南沙 Nansha', position: 30 },
  { value: '宁波', label: '宁波 Ningbo', position: 40 },
  { value: '上海', label: '上海 Shanghai', position: 50 },
  { value: '青岛', label: '青岛 Qingdao', position: 60 },
  { value: '天津', label: '天津 Tianjin', position: 70 },
  { value: '厦门', label: '厦门 Xiamen', position: 80 },
  { value: '香港', label: '香港 Hong Kong', position: 90 },
  { value: '东方港', label: '东方港 Vostochny', position: 100 },
  { value: '圣彼得堡', label: '圣彼得堡 St. Petersburg', position: 110 },
  { value: '莫斯科', label: '莫斯科 Moscow', position: 120 },
  { value: '新加坡', label: '新加坡 Singapore', position: 130 },
] as const

/** Carriers and forwarders booked on shipments (承运人): the vessel operators first, then the couriers. */
export const CARRIER_SEEDS = [
  { value: '中远海运', label: '中远海运 COSCO', position: 10 },
  { value: '马士基', label: '马士基 Maersk', position: 20 },
  { value: '地中海航运', label: '地中海航运 MSC', position: 30 },
  { value: '达飞', label: '达飞 CMA CGM', position: 40 },
  { value: '长荣', label: '长荣 Evergreen', position: 50 },
  { value: '东方海外', label: '东方海外 OOCL', position: 60 },
  { value: '赫伯罗特', label: '赫伯罗特 Hapag-Lloyd', position: 70 },
  { value: '海洋网联', label: '海洋网联 ONE', position: 80 },
  { value: '海丰', label: '海丰 SITC', position: 90 },
  { value: '顺丰', label: '顺丰 SF Express', position: 100 },
  { value: 'DHL', label: 'DHL', position: 110 },
] as const

/** The dictionary a shipment's `container_type` reads its options from. */
export const CONTAINER_TYPE_DICTIONARY_KEY = 'container_type'
/** The dictionary `departurePort` reads (and `trade_docs` contract destinations reuse). */
export const PORT_DICTIONARY_KEY = 'port'
/** The dictionary `carrierName` reads. */
export const CARRIER_DICTIONARY_KEY = 'carrier'

type DictionarySeedEntry = { value: string; label: string; position: number }
type DictionarySeed = {
  key: string
  name: string
  description: string
  entries: readonly DictionarySeedEntry[]
}

const DICTIONARY_SEEDS: readonly DictionarySeed[] = [
  {
    key: CONTAINER_TYPE_DICTIONARY_KEY,
    name: 'Container types',
    description: 'Container models booked for cross-border shipments',
    entries: CONTAINER_TYPE_SEEDS,
  },
  {
    key: PORT_DICTIONARY_KEY,
    name: 'Ports',
    description: 'Departure and destination ports offered on shipments and contracts (港口)',
    entries: PORT_SEEDS,
  },
  {
    key: CARRIER_DICTIONARY_KEY,
    name: 'Carriers',
    description: 'Carriers and forwarders offered on shipments (承运人)',
    entries: CARRIER_SEEDS,
  },
]

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
   * Seeds the module's dictionaries (container models, ports, carriers) once per organization.
   * Insert-only and idempotent per dictionary: re-running
   * `yarn mercato seed:defaults --module cross_border` never duplicates a dictionary or an entry,
   * and an existing row is left exactly as the operator edited it (values, labels, order). A key the
   * operator has already extended keeps their entries — only the seeds above are added when missing.
   */
  async seedDefaults(ctx) {
    const em = ctx.em
    const now = new Date()

    for (const seed of DICTIONARY_SEEDS) {
      let dictionary = await em.findOne(Dictionary, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        key: seed.key,
      })
      if (!dictionary) {
        dictionary = em.create(Dictionary, {
          key: seed.key,
          name: seed.name,
          description: seed.description,
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
          isSystem: true,
          isActive: true,
          managerVisibility: 'default',
          createdAt: now,
          updatedAt: now,
        })
        em.persist(dictionary)
      }

      const existing = await em.find(DictionaryEntry, {
        dictionary,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })
      const known = new Set(existing.flatMap((entry) => [entry.value, entry.normalizedValue]))
      for (const entry of seed.entries) {
        const normalizedValue = normalizeDictionaryValue(entry.value)
        if (known.has(entry.value) || known.has(normalizedValue)) continue
        known.add(entry.value)
        known.add(normalizedValue)
        em.persist(
          em.create(DictionaryEntry, {
            dictionary,
            tenantId: ctx.tenantId,
            organizationId: ctx.organizationId,
            value: entry.value,
            normalizedValue,
            label: entry.label,
            color: null,
            icon: null,
            position: entry.position,
            isDefault: false,
            createdAt: now,
            updatedAt: now,
          }),
        )
      }
      await em.flush()
    }
  },
}

export default setup
