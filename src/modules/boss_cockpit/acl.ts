/**
 * Feature ids of the boss cockpit.
 *
 * One feature and no writes: the cockpit is a read-only surface over the RU projections and the CN
 * ledgers, and its four alert widgets reuse the same gate. There is deliberately no `manage` — the
 * page has nothing to manage, and a write feature nobody can use is how a read-only surface starts
 * growing mutations.
 */
export const features = [
  { id: 'boss_cockpit.view', title: 'View the boss cockpit', module: 'boss_cockpit' },
]

export default features
