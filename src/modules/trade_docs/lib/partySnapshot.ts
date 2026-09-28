/**
 * The "our party" snapshot a contract, PI or CI prints — name, contact and the beneficiary bank.
 *
 * The values come from the `parties` master (a party plus one of its bank accounts), but they are
 * **copied into a jsonb snapshot** on the document rather than read live at print time: a document
 * is a frozen artefact, so changing an account on the master must not rewrite a PI that was already
 * issued (see the spec's "达标快照" decision — the receiving account is a money-risk surface, so it
 * is taken from the master but archived with the document).
 *
 * `buildOurPartySnapshot` shapes untrusted form values into that snapshot; `readOurPartySnapshot`
 * reads it back tolerantly (stored jsonb is `unknown` and may be missing, or predate a field), so a
 * reprint never throws on a half-filled or legacy snapshot.
 */

export type OurPartySnapshot = {
  partyId: string | null
  name: string | null
  address: string | null
  contact: string | null
  bankAccountId: string | null
  beneficiaryBank: string | null
  accountNumber: string | null
  swiftCode: string | null
  bankAddress: string | null
}

const SNAPSHOT_FIELDS: readonly (keyof OurPartySnapshot)[] = [
  'partyId',
  'name',
  'address',
  'contact',
  'bankAccountId',
  'beneficiaryBank',
  'accountNumber',
  'swiftCode',
  'bankAddress',
]

function normalize(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Trims every field and coerces anything missing/blank to `null`, so the stored snapshot is uniform. */
export function buildOurPartySnapshot(values: Partial<OurPartySnapshot>): OurPartySnapshot {
  const result = {} as OurPartySnapshot
  for (const field of SNAPSHOT_FIELDS) {
    result[field] = normalize(values[field])
  }
  return result
}

/** Tolerant reader for a stored jsonb snapshot: unknown source, every field defaults to `null`. */
export function readOurPartySnapshot(source: unknown): OurPartySnapshot {
  const record = source && typeof source === 'object' && !Array.isArray(source)
    ? (source as Record<string, unknown>)
    : {}
  const result = {} as OurPartySnapshot
  for (const field of SNAPSHOT_FIELDS) {
    result[field] = normalize(record[field])
  }
  return result
}
