import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * The module's CRUD events. Declared here (not only emitted) so the registry knows them: an
 * undeclared emit is logged as a warning and never reaches subscribers, and `clientBroadcast` is
 * what refreshes open lists and pickers when a profile changes.
 */
const events = [
  {
    id: 'our_parties.profile.created',
    label: 'Our-entity profile created',
    entity: 'profile',
    category: 'crud',
    clientBroadcast: true,
  },
  {
    id: 'our_parties.profile.updated',
    label: 'Our-entity profile updated',
    entity: 'profile',
    category: 'crud',
    clientBroadcast: true,
  },
  {
    id: 'our_parties.profile.deleted',
    label: 'Our-entity profile deleted',
    entity: 'profile',
    category: 'crud',
    clientBroadcast: true,
  },
] as const

export default createModuleEvents({ moduleId: 'our_parties', events })
