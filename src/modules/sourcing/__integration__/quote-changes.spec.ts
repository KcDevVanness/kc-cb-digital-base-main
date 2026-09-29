import { expect, request, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * Supplier quotation change analysis (`src/modules/sourcing`).
 *
 * Covers the three read-only projections end to end over the real HTTP surface, driven by the real
 * import path — a CSV per version, uploaded, parsed and approved — because the rules under test only
 * exist once two parsed versions share a layout: the summary the buyer acts on (added / gone / up /
 * down), the version chain that folds repeated imports into one version per day, one item's price
 * history, and the fail-closed organization/feature gates.
 *
 * The two versions must land on **different calendar days** (`quoteDate`), which is what the
 * production data does and what the chain's same-day folding rule makes mandatory: two imports of one
 * layout on one day are one version, so an un-dated fixture pair would compare a version with itself.
 *
 * See `.ai/specs/2026-09-24-supplier-quotation-change-analysis.md` (TEST-002, TEST-003, TEST-004).
 */

const CHANGES_URL = '/api/sourcing/quote-changes'
const VERSIONS_URL = '/api/sourcing/quote-changes/versions'
const TIMELINE_URL = '/api/sourcing/item-timeline'

const STAFF_PASSWORD = 'QuoteChanges!2026'
const VIEWER_PASSWORD = 'QuoteChangesViewer!2026'

const STAFF_FEATURES = [
  'sourcing.quotes.view',
  'sourcing.quotes.manage',
  'sourcing.import.run',
  'sourcing.promote.run',
  'purchasing.suppliers.view',
  'purchasing.suppliers.manage',
  'attachments.view',
  'attachments.manage',
]

/** The standard template header row — the alias dictionary maps exactly this set at full confidence. */
const TEMPLATE_HEADER =
  'SKU / 货号,品名 Product Name,分类 Section,规格 Description,HS编码 HS Code,单位 Unit,单价 Unit Cost,币种 Currency,MOQ 起订量,装箱数 Qty per Carton,单重 Unit N.W.(kg),产品尺寸 Product Size(cm)'

const BASE_URL = process.env.BASE_URL?.trim() || null
const resolveUrl = (path: string): string => (BASE_URL ? `${BASE_URL}${path}` : path)

type ChangeSummary = {
  added: number
  removed: number
  up: number
  down: number
  same: number
  currencyMismatch: number
  noPrice: number
  total: number
  unmatched: number
  duplicateKeys: number
}

type ChangeRow = {
  key: string | null
  itemNo: string | null
  name: string | null
  kind: 'added' | 'removed' | 'up' | 'down' | 'currency_mismatch' | 'no_price' | 'same'
  baseUnitCost: string | null
  targetUnitCost: string | null
  deltaAmount: string | null
  deltaPercent: number | null
}

type CompareResponse = {
  target: { quoteId: string; number: string | null; supplierId: string | null; day?: string }
  base: { quoteId: string; number: string | null; day?: string } | null
  candidates: { quoteId: string }[]
  summary: ChangeSummary
  items: ChangeRow[]
  totalCount: number
}

type VersionItem = {
  quoteId: string
  number: string | null
  day: string
  lineCount: number
  collapsedCount: number
  baseQuoteId: string | null
  summary: ChangeSummary | null
}

type VersionsResponse = { items: VersionItem[]; totalCount: number; truncated: boolean }

type TimelineResponse = {
  item: { key: string; library: { supplierSku: string } | null; purchase: { productSku: string } | null }
  points: {
    quoteId: string
    number: string | null
    day: string
    unitCost: string | null
    kind: string
    deltaPercent: number | null
    first: boolean
  }[]
  latestVersionDay: string | null
  reportedInLatestVersion: boolean
}

test.describe.serial('sourcing — quotation change analysis', () => {
  let api: APIRequestContext
  let rootToken = ''
  let staffToken = ''
  let viewerToken = ''
  let tenantId = ''
  let hqOrgId = ''
  let branchOrgId: string | null = null
  let staffRoleId: string | null = null
  let viewerRoleId: string | null = null
  let staffUserId: string | null = null
  let viewerUserId: string | null = null

  let supplierId = ''
  let versionA = { quoteId: '', number: '' }
  let versionB = { quoteId: '', number: '' }

  const stamp = Date.now().toString(36).toUpperCase()
  const sku = (suffix: string) => `P9${stamp}${suffix}`

  const staffRequest = (method: string, path: string, data?: unknown) =>
    apiRequestWithSelectedOrg(api, method, path, { token: staffToken, selectedOrgId: hqOrgId, data })

  const row = (
    code: string,
    name: string,
    section: string,
    unitCost: string,
  ): string =>
    [code, name, section, 'Material: ABS', '8421219990', 'PCS', unitCost, 'CNY', '1', '8', '1.28', '21.9*21.9*18.5'].join(',')

  const csv = (rows: string[]): Buffer => Buffer.from([TEMPLATE_HEADER, ...rows].join('\n') + '\n', 'utf8')

  /** One version: create the quotation, date it, upload the workbook, parse it and approve it. */
  const importVersion = async (input: {
    label: string
    quoteDate: string
    rows: string[]
  }): Promise<{ quoteId: string; number: string; layoutSignature: string; sourceFileName: string | null }> => {
    const created = await staffRequest('POST', '/api/sourcing/quotes', {
      supplierId,
      currencyCode: 'CNY',
      sourceKind: 'excel_import',
    })
    const createdBody = await readJsonSafe<{ id?: string; error?: string }>(created)
    expect(created.status(), `POST /api/sourcing/quotes answered ${JSON.stringify(createdBody)}`).toBe(201)
    const quoteId = String(createdBody?.id ?? '')
    expect(quoteId).toBeTruthy()

    const listed = await staffRequest('GET', `/api/sourcing/quotes?id=${encodeURIComponent(quoteId)}&pageSize=1`)
    const listedBody = await readJsonSafe<{ items?: { updatedAt?: string }[] }>(listed)
    const updatedAt = String(listedBody?.items?.[0]?.updatedAt ?? '')
    expect(updatedAt, 'the new quotation carries a version for the optimistic lock').toBeTruthy()

    const dated = await apiRequestWithSelectedOrg(api, 'PUT', '/api/sourcing/quotes', {
      token: staffToken,
      selectedOrgId: hqOrgId,
      data: { id: quoteId, quoteDate: input.quoteDate },
    })
    expect(dated.status(), `dating the quotation answered ${await dated.text()}`).toBe(200)

    const fileName = `quotation-${input.label}.csv`
    const upload = await api.fetch(resolveUrl('/api/attachments'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${staffToken}`,
        Cookie: `om_selected_org=${hqOrgId}`,
      },
      multipart: {
        entityId: 'sourcing:sourcing_quote',
        recordId: quoteId,
        partitionCode: 'privateAttachments',
        file: { name: fileName, mimeType: 'text/csv', buffer: csv(input.rows) },
      },
    })
    const uploadBody = await readJsonSafe<{ item?: { id?: string } }>(upload)
    const attachmentId = String(uploadBody?.item?.id ?? '')
    expect(upload.status(), `POST /api/attachments answered ${JSON.stringify(uploadBody)}`).toBe(200)
    expect(attachmentId).toBeTruthy()

    const parsed = await staffRequest('POST', '/api/sourcing/quotes/parse', { quoteId, attachmentId })
    const parsedBody = await readJsonSafe<{
      layoutSignature?: string
      lineCount?: number
      quote?: { sourceFileName?: string | null }
    }>(parsed)
    expect(parsed.status(), `parse answered ${JSON.stringify(parsedBody)}`).toBe(200)
    expect(parsedBody?.lineCount, 'the four data rows become four lines').toBe(input.rows.length)
    const layoutSignature = String(parsedBody?.layoutSignature ?? '')
    expect(layoutSignature, 'the layout signature is what makes the two versions comparable').toBeTruthy()
    // REQ-008: the archive records the workbook's real name, not the `workbook` placeholder.
    expect(parsedBody?.quote?.sourceFileName).toBe(fileName)

    const approved = await staffRequest('POST', '/api/sourcing/quotes/approve', { id: quoteId })
    const approvedBody = await readJsonSafe<{ number?: string }>(approved)
    expect(approved.status(), `approve answered ${JSON.stringify(approvedBody)}`).toBe(200)
    const number = String(approvedBody?.number ?? '')
    expect(number, 'an approved quotation carries its SQ number').toBeTruthy()

    return { quoteId, number, layoutSignature, sourceFileName: fileName }
  }

  test.beforeAll(async () => {
    api = await request.newContext()
    rootToken = await getAuthToken(api, 'superadmin')
    const scope = getTokenContext(rootToken)
    tenantId = scope.tenantId
    hqOrgId = scope.organizationId

    branchOrgId = await createOrganizationFixture(api, rootToken, {
      name: `Quote changes E2E branch ${stamp}`,
      tenantId,
      parentId: hqOrgId,
    })

    staffRoleId = await createRoleFixture(api, rootToken, { name: `Quote changes E2E staff ${stamp}`, tenantId })
    await setRoleAclFeatures(api, rootToken, { roleId: staffRoleId, features: STAFF_FEATURES })
    const staffEmail = `quote-changes-staff-${stamp}@example.com`
    staffUserId = await createUserFixture(api, rootToken, {
      email: staffEmail,
      password: STAFF_PASSWORD,
      organizationId: hqOrgId,
      roles: [staffRoleId],
      name: 'Quote changes E2E staff',
    })
    staffToken = await getAuthToken(api, staffEmail, STAFF_PASSWORD)

    // A role with none of the sourcing features, to prove the read routes fail closed.
    viewerRoleId = await createRoleFixture(api, rootToken, { name: `Quote changes E2E viewer ${stamp}`, tenantId })
    const viewerEmail = `quote-changes-viewer-${stamp}@example.com`
    viewerUserId = await createUserFixture(api, rootToken, {
      email: viewerEmail,
      password: VIEWER_PASSWORD,
      organizationId: hqOrgId,
      roles: [viewerRoleId],
      name: 'Quote changes E2E viewer',
    })
    viewerToken = await getAuthToken(api, viewerEmail, VIEWER_PASSWORD)

    const supplier = await staffRequest('POST', '/api/purchasing/suppliers', {
      name: `E2E quote changes ${stamp}`,
      code: `QC-${stamp}`,
      defaultCurrencyCode: 'CNY',
    })
    const supplierBody = await readJsonSafe<{ id?: string }>(supplier)
    expect(supplier.status(), `POST /api/purchasing/suppliers answered ${JSON.stringify(supplierBody)}`).toBe(201)
    supplierId = String(supplierBody?.id ?? '')
    expect(supplierId).toBeTruthy()

    const first = await importVersion({
      label: 'v1',
      quoteDate: '2026-03-01',
      rows: [
        row(sku('1'), 'Alpha bowl', 'DRINKING', '10'),
        row(sku('2'), 'Beta bowl', 'DRINKING', '20'),
        row(sku('3'), 'Gamma bowl', 'CLEANING', '30'),
        row(sku('4'), 'Delta bowl', 'CLEANING', '40'),
      ],
    })
    versionA = { quoteId: first.quoteId, number: first.number }

    const second = await importVersion({
      label: 'v2',
      quoteDate: '2026-03-02',
      rows: [
        row(sku('1'), 'Alpha bowl', 'DRINKING', '10'),
        row(sku('2'), 'Beta bowl', 'DRINKING', '22'),
        row(sku('3'), 'Gamma bowl', 'CLEANING', '27'),
        row(sku('5'), 'Epsilon bowl', 'FUN', '50'),
      ],
    })
    versionB = { quoteId: second.quoteId, number: second.number }
  })

  test.afterAll(async () => {
    for (const id of [versionA.quoteId, versionB.quoteId]) {
      if (!id) continue
      await staffRequest('DELETE', `/api/sourcing/quotes?id=${encodeURIComponent(id)}`).catch(() => undefined)
    }
    await deleteUserIfExists(api, rootToken, staffUserId)
    await deleteUserIfExists(api, rootToken, viewerUserId)
    await deleteRoleIfExists(api, rootToken, staffRoleId)
    await deleteRoleIfExists(api, rootToken, viewerRoleId)
    await deleteOrganizationIfExists(api, rootToken, branchOrgId)
    await api.dispose()
  })

  test('compares a version with its predecessor, by default and by choice (TEST-002)', async () => {
    const compared = await staffRequest('GET', `${CHANGES_URL}?quoteId=${encodeURIComponent(versionB.quoteId)}`)
    const body = await readJsonSafe<CompareResponse>(compared)
    expect(compared.status(), `GET ${CHANGES_URL} answered ${JSON.stringify(body)}`).toBe(200)

    expect(body?.base?.quoteId, 'the previous version of the same layout is the default base').toBe(versionA.quoteId)
    expect(body?.base?.number).toBe(versionA.number)
    expect(body?.summary).toMatchObject({ added: 1, removed: 1, up: 1, down: 1, same: 1, total: 5, unmatched: 0 })

    const byKey = new Map((body?.items ?? []).map((entry) => [entry.key, entry]))
    expect([...byKey.keys()].sort()).toEqual([sku('1'), sku('2'), sku('3'), sku('4'), sku('5')].sort())

    const added = byKey.get(sku('5'))
    expect(added?.kind, 'a code that only the new version quotes was added').toBe('added')
    expect(added?.baseUnitCost).toBeNull()
    expect(Number(added?.targetUnitCost)).toBe(50)

    const removed = byKey.get(sku('4'))
    expect(removed?.kind, 'a code the new version dropped is gone').toBe('removed')
    expect(Number(removed?.baseUnitCost)).toBe(40)
    expect(removed?.targetUnitCost).toBeNull()

    const up = byKey.get(sku('2'))
    expect(up?.kind).toBe('up')
    expect(Number(up?.baseUnitCost)).toBe(20)
    expect(Number(up?.targetUnitCost)).toBe(22)
    expect(Number(up?.deltaAmount)).toBe(2)
    expect(up?.deltaPercent).toBe(10)

    const down = byKey.get(sku('3'))
    expect(down?.kind).toBe('down')
    expect(Number(down?.deltaAmount)).toBe(-3)
    expect(down?.deltaPercent).toBe(-10)

    expect(byKey.get(sku('1'))?.kind, 'an unchanged price is its own state, not silence').toBe('same')

    // Only-changed drops the unchanged row from the page, while the summary keeps counting it.
    const changesOnly = await staffRequest(
      'GET',
      `${CHANGES_URL}?quoteId=${encodeURIComponent(versionB.quoteId)}&onlyChanged=true`,
    )
    const filtered = await readJsonSafe<CompareResponse>(changesOnly)
    expect(changesOnly.status()).toBe(200)
    expect(filtered?.items).toHaveLength(4)
    expect(filtered?.summary.same, 'the summary still reports the unchanged row').toBe(1)

    // The first version of a layout has nothing to compare against.
    const first = await staffRequest('GET', `${CHANGES_URL}?quoteId=${encodeURIComponent(versionA.quoteId)}`)
    const firstBody = await readJsonSafe<CompareResponse>(first)
    expect(first.status()).toBe(200)
    expect(firstBody?.base, 'the first version reports no base instead of an empty diff').toBeNull()
    expect(firstBody?.candidates, 'a later version is offered as a manual base').toHaveLength(1)
    expect(firstBody?.candidates[0]?.quoteId).toBe(versionB.quoteId)
  })

  test('lists the version chain and measures each version against the one before it (TEST-003)', async () => {
    const listed = await staffRequest('GET', `${VERSIONS_URL}?supplierId=${encodeURIComponent(supplierId)}`)
    const body = await readJsonSafe<VersionsResponse>(listed)
    expect(listed.status(), `GET ${VERSIONS_URL} answered ${JSON.stringify(body)}`).toBe(200)
    expect(body?.totalCount).toBe(2)

    const [newest, oldest] = body?.items ?? []
    expect(newest?.quoteId, 'the chain is newest first').toBe(versionB.quoteId)
    expect(newest?.day).toBe('2026-03-02')
    expect(newest?.summary).toMatchObject({ added: 1, removed: 1, up: 1, down: 1 })
    expect(newest?.baseQuoteId).toBe(versionA.quoteId)
    expect(oldest?.quoteId).toBe(versionA.quoteId)
    expect(oldest?.summary, 'the first version has no predecessor to measure against').toBeNull()
    expect(newest?.collapsedCount, 'one import per day means nothing was folded').toBe(0)

    const timeline = await staffRequest(
      'GET',
      `${TIMELINE_URL}?supplierId=${encodeURIComponent(supplierId)}&sku=${encodeURIComponent(sku('2'))}`,
    )
    const timelineBody = await readJsonSafe<TimelineResponse>(timeline)
    expect(timeline.status(), `GET ${TIMELINE_URL} answered ${JSON.stringify(timelineBody)}`).toBe(200)
    expect(timelineBody?.points).toHaveLength(2)
    expect(timelineBody?.points[0]?.first, 'the first quote is marked as the first').toBe(true)
    expect(Number(timelineBody?.points[0]?.unitCost)).toBe(20)
    expect(timelineBody?.points[1]?.kind).toBe('up')
    expect(timelineBody?.points[1]?.deltaPercent).toBe(10)
    expect(timelineBody?.reportedInLatestVersion, 'the newest version still quotes the item').toBe(true)

    // An item the newest version dropped is not "reported in the latest version", even though its own
    // history is intact — the state a two-version diff shows only once.
    const dropped = await staffRequest(
      'GET',
      `${TIMELINE_URL}?supplierId=${encodeURIComponent(supplierId)}&sku=${encodeURIComponent(sku('4'))}`,
    )
    const droppedBody = await readJsonSafe<TimelineResponse>(dropped)
    expect(dropped.status()).toBe(200)
    expect(droppedBody?.points).toHaveLength(1)
    expect(droppedBody?.latestVersionDay).toBe('2026-03-02')
    expect(droppedBody?.reportedInLatestVersion).toBe(false)
  })

  test('fails closed across organizations and without the feature (TEST-004)', async () => {
    const crossOrg = await apiRequestWithSelectedOrg(api, 'GET', `${CHANGES_URL}?quoteId=${encodeURIComponent(versionB.quoteId)}`, {
      token: staffToken,
      selectedOrgId: String(branchOrgId),
    })
    expect(crossOrg.status(), 'another organization cannot read this quotation’s comparison').toBe(404)

    for (const path of [
      `${CHANGES_URL}?quoteId=${encodeURIComponent(versionB.quoteId)}`,
      `${VERSIONS_URL}?supplierId=${encodeURIComponent(supplierId)}`,
      `${TIMELINE_URL}?supplierId=${encodeURIComponent(supplierId)}&sku=${encodeURIComponent(sku('2'))}`,
    ]) {
      const denied = await apiRequestWithSelectedOrg(api, 'GET', path, {
        token: viewerToken,
        selectedOrgId: hqOrgId,
      })
      expect(denied.status(), `a user without sourcing.quotes.view is refused on ${path}`).toBe(403)
    }
  })
})
