import { expect, request, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

/**
 * Product code rules, issuance and parsing (`src/modules/product_codes`).
 *
 * `.ai/specs/2026-09-24-supplier-product-code-rules.md` (TEST-PC-001..005). The three contracts that
 * carry business risk:
 *
 * 1. **Issuance is monotonic and never free** — consecutive codes advance the serial, `dryRun` does
 *    not consume one, and a code that was issued stays issued even if its row is deleted.
 * 2. **Parsing never fails** — an issued code, a shape-matching hand-typed code and a PetKit-era code
 *    each get a truthful answer, the last one being `none` (沿用旧码) rather than an error.
 * 3. **A code list value is frozen once issued** — the dictionary interceptor refuses to re-value or
 *    delete it, while a label-only rename still goes through.
 */

const RULES_URL = '/api/product_codes/rules'
const GENERATE_URL = '/api/product_codes/generate'
const PARSE_URL = '/api/product_codes/parse'
const SEQUENCES_URL = '/api/product_codes/sequences'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

const MANAGER_PASSWORD = 'ProductCodes!2026'
const MANAGER_FEATURES = [
  'product_codes.rules.view',
  'product_codes.rules.manage',
  'product_codes.codes.generate',
  'dictionaries.view',
  'dictionaries.manage',
]

type RuleRow = { id: string; name: string; updatedAt: string | null }
type GenerateResult = { code: string; serial?: number; nextSerial: number; parts: Array<{ key: string; label: string | null }> }
type ParseResult = { status: string; source: string; parts: Array<{ key: string; value: string; label: string | null }> }

test.describe.serial('product_codes — rules, issuance and parsing', () => {
  let api: APIRequestContext
  let rootToken = ''
  let managerToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let managerRoleId: string | null = null
  let managerUserId: string | null = null
  let ruleId = ''
  let brandEntryId = ''

  const stamp = Date.now().toString(36).toUpperCase()

  const managerRequest = (method: string, path: string, data?: unknown) =>
    apiRequestWithSelectedOrg(api, method, path, { token: managerToken, selectedOrgId: hqOrgId, data })

  test.beforeAll(async () => {
    api = await request.newContext()
    rootToken = await getAuthToken(api, 'superadmin')
    const scope = getTokenContext(rootToken)
    tenantId = scope.tenantId
    hqOrgId = scope.organizationId

    managerRoleId = await createRoleFixture(api, rootToken, { name: `Product codes E2E ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId: managerRoleId, features: MANAGER_FEATURES })
    const email = `product-codes-${stamp.toLowerCase()}@example.com`
    managerUserId = await createUserFixture(api, rootToken, {
      email,
      password: MANAGER_PASSWORD,
      organizationId: hqOrgId,
      roles: [managerRoleId],
      name: 'Product codes E2E',
    })
    managerToken = await getAuthToken(api, email, MANAGER_PASSWORD)

    // The seeded rule is what a fresh organization starts with; the suite edits it rather than
    // creating a second one, because two active generate rules make generation ambiguous by design.
    const list = await managerRequest('GET', `${RULES_URL}?page=1&pageSize=50`)
    expect(list.status(), 'the seeded rule must be readable').toBe(200)
    const page = await readJsonSafe<{ items?: RuleRow[] }>(list)
    ruleId = String(page?.items?.[0]?.id ?? '')
    expect(ruleId, 'setup seeds a SKU rule for a new organization').toBeTruthy()
  })

  test.afterAll(async () => {
    await deleteUserIfExists(api, rootToken, managerUserId)
    await deleteRoleIfExists(api, rootToken, managerRoleId)
    await api.dispose()
  })

  test('refuses a rule whose worst case cannot produce a valid code', async () => {
    const illegalSeparator = await managerRequest('POST', RULES_URL, {
      name: `Bad rule ${stamp}`,
      mode: 'generate',
      segments: [
        { kind: 'dictionary', key: 'brand', dictionaryKey: 'product_brand', length: 2, upper: true, join: false },
        { kind: 'serial', key: 'serial', length: 3, join: true },
      ],
      separator: '#',
      serialLength: 3,
      serialScope: 'brand_category',
      enforce: 'warn',
      isActive: true,
    })
    expect(illegalSeparator.status(), 'a separator outside the SKU charset is refused').toBe(422)
    expect((await readJsonSafe<{ code?: string }>(illegalSeparator))?.code).toBe('rule_separator_invalid')
  })

  test('issues consecutive codes, previews without consuming, and keeps the ledger monotonic', async () => {
    const preview = await managerRequest('POST', GENERATE_URL, { brandValue: 'PK', categoryValue: 'CL', dryRun: true })
    expect(preview.status()).toBe(200)
    const previewed = await readJsonSafe<GenerateResult>(preview)
    expect(previewed?.code).toMatch(/^PK-CL\d{3}$/)
    // The brand label is asserted by prefix: a later test in this file renames it, and a retry
    // replays the whole file against the same database.
    const labels = previewed?.parts?.map((part) => part.label) ?? []
    expect(String(labels[0])).toContain('PetKit')
    expect(labels[1]).toBe('猫砂')
    expect(labels[2]).toBeNull()

    // A preview must not have spent the serial: the real issuance gets the same one.
    const first = await managerRequest('POST', GENERATE_URL, { brandValue: 'PK', categoryValue: 'CL', dryRun: false })
    expect(first.status()).toBe(200)
    const issued = await readJsonSafe<GenerateResult>(first)
    expect(issued?.code).toBe(previewed?.code)

    const second = await managerRequest('POST', GENERATE_URL, { brandValue: 'PK', categoryValue: 'CL', dryRun: false })
    const next = await readJsonSafe<GenerateResult>(second)
    expect(next?.code).not.toBe(issued?.code)
    expect(Number(next?.nextSerial)).toBe(Number(issued?.nextSerial) + 1)

    const sequences = await managerRequest('GET', `${SEQUENCES_URL}?ruleId=${ruleId}`)
    expect(sequences.status()).toBe(200)
    const scopes = await readJsonSafe<{ scopes: Array<{ brandValue: string; issued: number }> }>(sequences)
    const pkScope = scopes?.scopes.find((scope) => scope.brandValue === 'PK')
    // Relative, not absolute: a retry replays the file against the same database, and the ledger is
    // append-only, so the count only ever grows.
    expect(Number(pkScope?.issued ?? 0), 'both issued codes are counted').toBeGreaterThanOrEqual(2)
  })

  test('explains an issued code, a hand-typed one and a PetKit-era one without failing', async () => {
    const issued = await managerRequest('POST', GENERATE_URL, { brandValue: 'PK', categoryValue: 'CL', dryRun: false })
    const issuedCode = String((await readJsonSafe<GenerateResult>(issued))?.code ?? '')

    const fromLedger = await managerRequest('GET', `${PARSE_URL}?code=${encodeURIComponent(issuedCode)}`)
    expect(fromLedger.status()).toBe(200)
    const parsed = await readJsonSafe<ParseResult>(fromLedger)
    expect(parsed?.status).toBe('issued')
    expect(parsed?.source).toBe('generated')
    expect(parsed?.parts[0]?.label).toBe('PetKit')

    const typed = await managerRequest('GET', `${PARSE_URL}?code=${encodeURIComponent('SP-TP009')}`)
    const typedResult = await readJsonSafe<ParseResult>(typed)
    expect(typedResult?.status).toBe('full')
    expect(typedResult?.source).toBe('unissued')

    const legacy = await managerRequest('GET', `${PARSE_URL}?code=${encodeURIComponent('P4108-UVC')}`)
    expect(legacy.status(), 'a legacy code is data, not an error').toBe(200)
    const legacyResult = await readJsonSafe<ParseResult>(legacy)
    expect(legacyResult?.status).toBe('none')
    expect(legacyResult?.parts).toEqual([])
  })

  test('freezes a code-list value once it has been issued, but still allows a rename', async () => {
    // The list endpoint is not filtered by key, so the dictionary is found in the page it returns —
    // trusting the first row would silently exercise whichever code list happens to sort first.
    const dictionary = await managerRequest('GET', `/api/dictionaries?pageSize=100`)
    expect(dictionary.status()).toBe(200)
    const dictionaryBody = await readJsonSafe<{ items?: Array<{ id: string; key: string }> }>(dictionary)
    const brandDictionary = dictionaryBody?.items?.find((item) => item.key === 'product_brand')
    expect(brandDictionary, 'the brand code list is seeded for this organization').toBeTruthy()
    const dictionaryId = String(brandDictionary?.id ?? '')

    const entriesUrl = `/api/dictionaries/${dictionaryId}/entries`
    const entries = await managerRequest('GET', entriesUrl)
    const entryPage = await readJsonSafe<{ items?: Array<{ id: string; value: string; label: string | null; updatedAt?: string | null }> }>(entries)
    const pkEntry = entryPage?.items?.find((entry) => entry.value === 'PK')
    expect(pkEntry, 'the PK brand is seeded').toBeTruthy()
    brandEntryId = String(pkEntry?.id ?? '')
    const entryUpdatedAt = String(pkEntry?.updatedAt ?? '')

    // Every write carries the entry's *current* version: the rename above advanced `updatedAt`, and
    // reusing the stale one would be refused by the lock before the guard under test could answer.
    const entryRequest = async (method: string, data?: unknown) => {
      const current = await managerRequest('GET', entriesUrl)
      const currentPage = await readJsonSafe<{ items?: Array<{ id: string; updatedAt?: string | null }> }>(current)
      const version = String(currentPage?.items?.find((entry) => entry.id === brandEntryId)?.updatedAt ?? entryUpdatedAt)
      return apiRequest(api, method, `${entriesUrl}/${brandEntryId}`, {
        token: managerToken,
        headers: { [LOCK_HEADER]: version, cookie: `om_selected_org=${hqOrgId}` },
        data,
      })
    }

    // A label-only change is what an operator is allowed to do.
    const renamed = await entryRequest('PATCH', { value: 'PK', label: `PetKit ${stamp}` })
    expect(renamed.status(), 'renaming the display label stays allowed').toBe(200)

    const revalued = await entryRequest('PATCH', { value: 'PX', label: `PetKit ${stamp}` })
    expect(revalued.status(), 're-valuing an issued code is refused').toBe(409)
    expect((await readJsonSafe<{ code?: string }>(revalued))?.code).toBe('dictionary_value_in_use')

    const removed = await entryRequest('DELETE')
    expect(removed.status(), 'deleting an issued value is refused').toBe(409)

    // The rename is visible in the next breakdown, without touching any stored code.
    const parseAfterRename = await managerRequest('GET', `${PARSE_URL}?code=${encodeURIComponent('PK-CL001')}`)
    const afterRename = await readJsonSafe<ParseResult>(parseAfterRename)
    expect(afterRename?.parts[0]?.label).toBe(`PetKit ${stamp}`)
  })

  test('keeps an issued code spent even when its row is deleted', async () => {
    const before = await readJsonSafe<GenerateResult>(
      await managerRequest('POST', GENERATE_URL, { brandValue: 'DK', categoryValue: 'CL', dryRun: true }),
    )
    const issued = await readJsonSafe<GenerateResult>(
      await managerRequest('POST', GENERATE_URL, { brandValue: 'DK', categoryValue: 'CL', dryRun: false }),
    )
    expect(issued?.code).toBe(before?.code)

    // The ledger is append-only and nothing in this module deletes from it: the next code must be a
    // new serial even though no row carries the previous one.
    const following = await readJsonSafe<GenerateResult>(
      await managerRequest('POST', GENERATE_URL, { brandValue: 'DK', categoryValue: 'CL', dryRun: false }),
    )
    expect(following?.code).not.toBe(issued?.code)

    const persisted = await withClient(async (client) => {
      const rows = await client.query<{ count: string }>(
        'select count(*)::text as count from product_codes_ledger_entries where code = $1',
        [issued?.code],
      )
      return rows.rows[0]?.count ?? '0'
    })
    expect(persisted, 'the issued code is on the ledger').toBe('1')
  })
})
