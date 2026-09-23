import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Events emitted by the parties module.
 *
 * `clientBroadcast` keeps open backend lists and pickers in sync without polling; the payload
 * carries identifiers and scope only — never the encrypted contact or bank block.
 */
const events = [
  { id: 'parties.party.created', label: 'Party Created', entity: 'party', category: 'crud', clientBroadcast: true },
  { id: 'parties.party.updated', label: 'Party Updated', entity: 'party', category: 'crud', clientBroadcast: true },
  { id: 'parties.party.deleted', label: 'Party Deleted', entity: 'party', category: 'crud', clientBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'parties',
  events,
})

export type PartiesEventId = (typeof events)[number]['id']

export default eventsConfig
