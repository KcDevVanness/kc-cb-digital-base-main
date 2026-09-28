#!/usr/bin/env node
/**
 * Mock trade partners for the internal-trade setup: the branch companies' own external customers
 * and the branch parties' bank/address block.
 *
 * This is **simulated data** (the owner asked for placeholder records until the real customer list
 * arrives): every customer carries the `MOCK-` code prefix and a `（模拟）` name prefix, so a later
 * replacement is a single filtered delete. The branch parties themselves (`RU-AB` / `SEA-AB`) are
 * updated, not created — they already exist as the internal buyers of the head-office org.
 *
 * Everything goes through the same HTTP API the UI uses (validation, roles, encryption), and the
 * script is idempotent by code: an existing code is reported as "kept" and not written again.
 *
 *   BASE_URL=http://localhost:3000 TOKEN=<session jwt> node seed-internal-trade-parties.mjs
 *
 * The org ids come from `GET /api/directory/organization-switcher`, so the script needs no extra
 * configuration: the head-office org is the one whose name matches HQ_ORG_NAME (default 广州凯翠国际贸易有限公司),
 * the branches are its direct children. A manifest is written to MANIFEST (default /tmp/internal-trade-parties.json).
 */
import { writeFileSync } from 'node:fs'

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
const TOKEN = process.env.TOKEN || ''
const HQ_ORG_NAME = process.env.HQ_ORG_NAME || '广州凯翠国际贸易有限公司'
const MANIFEST = process.env.MANIFEST || '/tmp/internal-trade-parties.json'
const DRY = process.env.DRY === '1'

if (!TOKEN) {
  console.error('TOKEN is required (a session JWT for an account that can manage parties)')
  process.exit(2)
}

const manifest = { base: BASE, startedAt: new Date().toISOString(), created: [], kept: [], failed: [] }

async function api(orgId, method, path, body) {
  const res = await fetch(`${BASE}/api/${path.replace(/^\//, '')}`, {
    method,
    headers: {
      cookie: `auth_token=${TOKEN}; om_selected_org=${orgId}`,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`)
  return json
}

/** The three orgs this script writes into: the head office and its direct children. */
async function resolveOrgs() {
  const payload = await api('', 'GET', 'directory/organization-switcher')
  const nodes = []
  const walk = (list) => {
    for (const node of list ?? []) {
      nodes.push(node)
      walk(node.children ?? node.nodes ?? [])
    }
  }
  walk(payload.items ?? payload.organizations ?? payload.nodes ?? [])
  const hq = nodes.find((node) => node.name === HQ_ORG_NAME)
  if (!hq) throw new Error(`head-office org "${HQ_ORG_NAME}" not found in the switcher payload`)
  // The payload nests the tree (`children`), it does not carry parent ids.
  const branches = (hq.children ?? []).map((child) => ({ id: child.id, name: child.name }))
  if (branches.length === 0) throw new Error('no branch orgs under the head office')
  return { hq, branches }
}

/** Simulated external customers per branch: a country mix plausible for that market. */
const CUSTOMER_TEMPLATES = {
  '俄罗斯 AB 有限公司': [
    { suffix: '01', name: '（模拟）莫斯科零售客户 01', country: 'RU', city: 'Moscow' },
    { suffix: '02', name: '（模拟）圣彼得堡分销商 02', country: 'RU', city: 'Saint Petersburg' },
    { suffix: '03', name: '（模拟）阿拉木图渠道商 03', country: 'KZ', city: 'Almaty' },
  ],
  '东南亚 AB 有限公司': [
    { suffix: '01', name: '（模拟）新加坡电商客户 01', country: 'SG', city: 'Singapore' },
    { suffix: '02', name: '（模拟）吉隆坡分销商 02', country: 'MY', city: 'Kuala Lumpur' },
    { suffix: '03', name: '（模拟）曼谷渠道商 03', country: 'TH', city: 'Bangkok' },
  ],
}

/** Simulated bank/address block for the branch parties themselves (they are the internal buyers). */
const BRANCH_PARTY_BLOCKS = {
  '俄罗斯 AB 有限公司': {
    code: 'RU-AB',
    addressLine1: '（模拟）Presnenskaya nab. 8, bldg. 1',
    city: 'Moscow',
    bank: { beneficiaryBank: '（模拟）Alfa-Bank', accountNumber: '40702810000000000123', swiftCode: 'ALFARUMMXXX', bankAddress: 'Moscow, Russia', isDefault: true },
  },
  '东南亚 AB 有限公司': {
    code: 'SEA-AB',
    addressLine1: '（模拟）1 Raffles Place, #20-61',
    city: 'Singapore',
    bank: { beneficiaryBank: '（模拟）DBS Bank', accountNumber: '0720000123456', swiftCode: 'DBSSSGSGXXX', bankAddress: 'Singapore', isDefault: true },
  },
}

const { hq, branches } = await resolveOrgs()
console.log(`head office: ${hq.name} (${hq.id})`)
for (const branch of branches) console.log(`branch: ${branch.name} (${branch.id})`)

for (const branch of branches) {
  const templates = CUSTOMER_TEMPLATES[branch.name] ?? []
  const cookieOrg = branch.id
  const existing = await api(cookieOrg, 'GET', 'parties?pageSize=100')
  const existingCodes = new Set((existing.items ?? []).map((party) => String(party.code ?? '')))

  for (const template of templates) {
    const code = `MOCK-${branch.name.slice(0, 2).toUpperCase()}-CUST-${template.suffix}`
    if (existingCodes.has(code)) {
      manifest.kept.push({ org: branch.name, kind: 'customer', code })
      continue
    }
    if (DRY) {
      manifest.created.push({ org: branch.name, kind: 'customer', code, dryRun: true })
      continue
    }
    try {
      const created = await api(cookieOrg, 'POST', 'parties', {
        code,
        name: template.name,
        countryCode: template.country,
        status: 'active',
        city: template.city,
        roles: ['buyer'],
        contactName: '（模拟）联系人',
        email: `mock-${code.toLowerCase()}@example.invalid`,
      })
      manifest.created.push({ org: branch.name, kind: 'customer', code, id: created?.id ?? null })
    } catch (error) {
      manifest.failed.push({ org: branch.name, kind: 'customer', code, error: String(error.message ?? error) })
    }
  }

  // The branch party itself lives in the head-office org (it is the internal buyer of HQ documents).
  const block = BRANCH_PARTY_BLOCKS[branch.name]
  if (block) {
    const hqParties = await api(hq.id, 'GET', 'parties?pageSize=100')
    const party = (hqParties.items ?? []).find((candidate) => String(candidate.code ?? '') === block.code)
    if (!party) {
      manifest.failed.push({ org: hq.name, kind: 'branch-bank-block', code: block.code, error: 'branch party not found in the head-office org' })
    } else if (DRY) {
      manifest.created.push({ org: hq.name, kind: 'branch-bank-block', code: block.code, dryRun: true })
    } else {
      try {
        await api(hq.id, 'PUT', 'parties', {
          id: party.id,
          addressLine1: block.addressLine1,
          city: block.city,
          bankAccounts: [block.bank],
        })
        manifest.created.push({ org: hq.name, kind: 'branch-bank-block', code: block.code, id: party.id })
      } catch (error) {
        manifest.failed.push({ org: hq.name, kind: 'branch-bank-block', code: block.code, error: String(error.message ?? error) })
      }
    }
  }
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2))
console.log(`\ncreated: ${manifest.created.length} | kept: ${manifest.kept.length} | failed: ${manifest.failed.length}`)
for (const failure of manifest.failed) console.error(`  FAILED ${failure.kind} ${failure.code}: ${failure.error}`)
console.log(`manifest: ${MANIFEST}`)
