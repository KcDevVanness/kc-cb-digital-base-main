/**
 * Feature ids of the order hub.
 *
 * `order_hub.view` gates the reads (the workbench list, the stage projection, the link list);
 * `order_hub.manage` gates the writes (company-order CRUD and the link commands). The two are
 * separate so a finance or shop-floor role can see the overview without being able to re-link or
 * edit roots.
 */
export const features = [
  { id: 'order_hub.view', title: 'View the order workbench', module: 'order_hub' },
  { id: 'order_hub.manage', title: 'Manage company orders', module: 'order_hub' },
]

export default features
