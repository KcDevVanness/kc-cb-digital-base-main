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
 * Encrypted here: the supplier's whole bank block — the account our payments go to. A leaked dump
 * must not hand out payment targets, which is the payment-fraud scenario; the same decision `parties`
 * made for its own bank rows (Q-P-007 in `.ai/specs/2026-09-22-app-owned-party-master.md`).
 *
 * Deliberately NOT encrypted: the supplier's `name`, `code` and the contact block. The supplier list
 * searches and sorts on them, and unlike a party there is no regulated identifier here — a column
 * holding ciphertext cannot back a unique index, a sort, or a LIKE filter.
 *
 * Read-path consequence: the bank rows are never part of a list projection, an option source, search
 * or an export; they are read through `GET /api/purchasing/suppliers/[id]` and the forms, and the
 * reads use the framework decryption find helpers.
 */
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'purchasing:purchasing_supplier_bank_account',
    fields: [
      { field: 'beneficiary_bank' },
      { field: 'account_number' },
      { field: 'swift_code' },
      { field: 'bank_address' },
    ],
  },
]

export default defaultEncryptionMaps
