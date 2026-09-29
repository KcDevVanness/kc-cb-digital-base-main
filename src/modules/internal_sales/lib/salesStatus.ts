/**
 * The tenant dictionary the installed sales chain keeps quote/order statuses in.
 *
 * Shared by the list's status column and the source-quote preview drawer, so the two surfaces
 * cannot drift onto different dictionaries (the engine stores one status vocabulary per tenant).
 */
export const SALES_STATUS_DICTIONARY_KEY = 'sales.order_status'
