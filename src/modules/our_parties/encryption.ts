import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

/**
 * Default at-rest encryption for this module's entities.
 *
 * `field` names are **column** names, the same convention `parties/encryption.ts` uses.
 *
 * Encrypted here: the **bank block** only. A leaked dump must not hand out where this company banks
 * — that is the payment-fraud target — while the address and the contact person are the company's
 * own printed letterhead (they appear on every contract by design) and are deliberately left
 * plaintext, unlike a counterparty's identifying data in `parties`.
 *
 * The entity id follows the engine's `<module>:<module>_<entity>` convention (its table lookup
 * converts the snake-case name back to the entity class), so it must stay in step with the class
 * name `OurPartyBankAccount`.
 *
 * Rows are materialized as `EncryptionMap` records at tenant creation or by
 * `yarn mercato entities seed-encryption --tenant <id>`; existing tenants need that CLI run once
 * after this module ships.
 */
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'our_parties:our_party_bank_account',
    fields: [
      { field: 'beneficiary_bank' },
      { field: 'account_number' },
      { field: 'swift_code' },
      { field: 'bank_address' },
    ],
  },
]

export default defaultEncryptionMaps
