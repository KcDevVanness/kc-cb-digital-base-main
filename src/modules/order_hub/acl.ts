/**
 * Feature ids of the order workbench.
 *
 * One feature and no writes: the workbench reads the order lists and the stage projection, and every
 * downstream action it offers is a link into the module that owns that write. There is deliberately
 * no `manage` — a write feature nobody can use is how a read surface starts growing mutations.
 */
export const features = [
  { id: 'order_hub.view', title: 'View the order workbench', module: 'order_hub' },
]

export default features
