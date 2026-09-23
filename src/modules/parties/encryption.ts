import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

/**
 * Default at-rest encryption for this module's entities.
 *
 * `field` names are **column** names (the installed `customers` map uses the same convention:
 * `address_line1` for the `addressLine1` property).
 *
 * Tenant data encryption is ON unless `TENANT_DATA_ENCRYPTION` is explicitly turned off, but these
 * rows are only *materialized* as `EncryptionMap` records at tenant creation or by
 * `yarn mercato entities seed-encryption --tenant <id>`. Declaring a field here protects new tenants
 * automatically and existing tenants after that CLI runs.
 *
 * Encrypted here: everything that identifies the counterparty (客户名称, contact person, phone,
 * email, 地址, 城市) and the whole bank block — a leaked dump must not hand out counterparty bank
 * accounts, which are the payment-fraud target.
 *
 * Deliberately NOT encrypted: `code` (the uniqueness constraint, the sort key and the audit
 * reference), `country_code`, `status`, and the role values. A column holding ciphertext cannot back
 * a unique index, a sort, or a LIKE filter, and `code` carries all three jobs — that is why the list
 * search and every sort option in `api/parties/route.ts` stay on plaintext columns.
 *
 * Read-path consequence: `name` is therefore excluded from the global-search text in `search.ts`
 * (the search index holds the ciphertext form), and the search presenter shows `code` instead.
 */
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'parties:party',
    fields: [
      { field: 'name' },
      { field: 'contact_name' },
      { field: 'contact_phone' },
      { field: 'email' },
      { field: 'address_line1' },
      { field: 'address_line2' },
      { field: 'city' },
    ],
  },
  {
    entityId: 'parties:party_bank_account',
    fields: [
      { field: 'beneficiary_bank' },
      { field: 'account_number' },
      { field: 'swift_code' },
      { field: 'bank_address' },
    ],
  },
]

export default defaultEncryptionMaps
