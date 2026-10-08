#!/usr/bin/env node
// Syncs the repository docs (docs/prd, docs/plans, docs/dev, docs/ru-petkit and the
// docs/plans status board) into the Linear project "kc-cb-digital-base-main" through
// the Orca CLI. Idempotent: each node carries a stable anchor, the committed
// manifest maps anchors to Linear ids, and a body hash decides whether a re-run
// needs to write at all.
//
// Usage:
//   node scripts/linear-sync/sync.mjs                # dry run: build payloads, print the plan
//   node scripts/linear-sync/sync.mjs --apply        # create/update issues, verify, write manifest
//   node scripts/linear-sync/sync.mjs --apply --only prd/cross-border-erp
//   node scripts/linear-sync/sync.mjs --audit        # re-check the tree against Linear, no writes
//   node scripts/linear-sync/sync.mjs --apply --force
//
// Every write is read back and checked (title / state / project / body length):
// Linear writes from this CLI occasionally report `linear_write_unconfirmed`
// even when they landed, so verification — not the write response — is truth.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as linear from './orca.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MANIFEST_PATH = join(HERE, 'manifest.json')

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

// The docs to sync may live in a sibling worktree (--docs-root): the current docs
// state can be ahead of the branch this tool rides on.
const DOCS_ROOT = opt('--docs-root')
if (DOCS_ROOT) process.env.KC_SYNC_DOCS_ROOT = resolve(DOCS_ROOT)

const { buildPayloads } = await import('./payloads.mjs')

const APPLY = flag('--apply')
const FORCE = flag('--force')
const AUDIT = flag('--audit')
const ONLY = opt('--only')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function hashNode(node) {
  return createHash('sha256')
    .update([node.title, node.state, node.parentAnchor || '', node.body].join('\n'))
    .digest('hex')
}

function docsProvenance() {
  const root = process.env.KC_SYNC_DOCS_ROOT ? resolve(process.env.KC_SYNC_DOCS_ROOT) : join(HERE, '..', '..')
  const git = (gitArgs) => {
    const res = spawnSync('git', ['-C', root, ...gitArgs], { encoding: 'utf8' })
    return res.status === 0 ? res.stdout.trim() : null
  }
  return { root, commit: git(['rev-parse', 'HEAD']), branch: git(['rev-parse', '--abbrev-ref', 'HEAD']) }
}

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    return {
      project: { id: linear.PROJECT_ID, name: 'kc-cb-digital-base-main' },
      team: { key: linear.TEAM_KEY },
      workspace: linear.WORKSPACE_ID,
      entries: {},
    }
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
}

function saveManifest(manifest) {
  manifest.updatedAt = new Date().toISOString()
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
}

function normalize(text) {
  return (text || '').replace(/[\s<>]/g, '')
}

function verifyIssue(identifier, node) {
  const issue = linear.readIssue(identifier)
  if (!issue) return { ok: false, reason: '回读不到 issue' }
  if (issue.title !== node.title) return { ok: false, reason: `标题不一致：${issue.title}` }
  const stateName = issue.state?.name
  if (stateName !== node.state) return { ok: false, reason: `状态不一致：${stateName} ≠ ${node.state}` }
  const projectId = issue.project?.id
  if (projectId !== linear.PROJECT_ID) return { ok: false, reason: `项目不一致：${projectId}` }
  const desc = issue.description || ''
  const expected = node.body
  const tolerance = Math.max(64, Math.ceil(expected.length * 0.04))
  if (Math.abs(desc.length - expected.length) > tolerance) {
    return { ok: false, reason: `正文长度偏差过大：${desc.length} vs ${expected.length}` }
  }
  const prefix = normalize(expected).slice(0, 48)
  if (!normalize(desc).startsWith(prefix)) {
    return { ok: false, reason: `正文开头对不上：${desc.slice(0, 60)}` }
  }
  return { ok: true }
}

function childAnchors(nodes) {
  const map = new Map()
  for (const node of nodes) {
    if (!node.parentAnchor) continue
    if (!map.has(node.parentAnchor)) map.set(node.parentAnchor, [])
    map.get(node.parentAnchor).push(node.anchor)
  }
  return map
}

function filterNodes(nodes, only) {
  if (!only) return nodes
  const wanted = new Set(
    nodes
      .filter((n) => n.anchor.includes(only) || (n.parentAnchor || '').includes(only))
      .map((n) => n.anchor),
  )
  // keep parents of wanted nodes so parent resolution still works
  for (const node of nodes) {
    if (node.parentAnchor && wanted.has(node.anchor)) wanted.add(node.parentAnchor)
  }
  return nodes.filter((n) => wanted.has(n.anchor))
}

async function audit(nodes, manifest) {
  const issues = linear.listProjectIssues()
  const byTitle = new Map(issues.map((issue) => [issue.title, issue]))
  const children = childAnchors(nodes)
  let problems = 0
  for (const node of nodes) {
    const entry = manifest.entries[node.anchor]
    if (!entry) {
      console.log(`✗ ${node.anchor} 无 manifest 记录`)
      problems += 1
      continue
    }
    if (!byTitle.has(node.title)) {
      console.log(`✗ ${node.anchor}（${entry.identifier}）不在项目 issue 列表里`)
      problems += 1
    }
  }
  for (const [parentAnchor, expected] of children) {
    const entry = manifest.entries[parentAnchor]
    if (!entry) continue
    const actual = linear.listChildren(entry.identifier)
    if (!actual) {
      console.log(`✗ 无法读取 ${entry.identifier} 的子 issue`)
      problems += 1
      continue
    }
    const actualIds = new Set(actual.map((issue) => issue.identifier))
    for (const anchor of expected) {
      const child = manifest.entries[anchor]
      if (child && !actualIds.has(child.identifier)) {
        console.log(`✗ ${anchor}（${child.identifier}）不在 ${entry.identifier} 之下`)
        problems += 1
      }
    }
  }
  console.log(problems === 0 ? `审计通过：${nodes.length} 条，全部在项目内且父子关系正确` : `审计发现 ${problems} 个问题`)
  return problems
}

async function main() {
  const allNodes = buildPayloads()
  const nodes = filterNodes(allNodes, ONLY)
  const manifest = loadManifest()
  manifest.docs = docsProvenance()
  const childrenOf = childAnchors(nodes)

  console.log(`payload：${nodes.length} 条（全部 ${allNodes.length} 条${ONLY ? `，--only ${ONLY}` : ''}）`)
  console.log(`文档源：${manifest.docs.root} @ ${manifest.docs.commit}（${manifest.docs.branch}）`)
  const states = {}
  for (const node of nodes) states[node.state] = (states[node.state] || 0) + 1
  console.log(`状态分布：${Object.entries(states).map(([k, v]) => `${k} ${v}`).join(' · ')}`)

  if (AUDIT) {
    process.exitCode = (await audit(nodes, manifest)) === 0 ? 0 : 1
    return
  }

  if (!APPLY) {
    console.log('（dry run —— 加 --apply 执行写入）')
    for (const node of nodes) {
      const entry = manifest.entries[node.anchor]
      const action = entry && entry.hash === hashNode(node) && !FORCE ? 'skip' : entry ? 'update' : 'create'
      const indent = node.parentAnchor ? '  ' : ''
      console.log(`${indent}[${action}] ${node.anchor} → ${node.title}（${node.state}）`)
    }
    return
  }

  const existing = linear.listProjectIssues()
  const byTitle = new Map(existing.map((issue) => [issue.title, issue]))

  let created = 0
  let updated = 0
  let adopted = 0
  let skipped = 0
  let repaired = 0
  const failures = []

  for (const node of nodes) {
    const hash = hashNode(node)
    const entry = manifest.entries[node.anchor]

    if (entry && entry.hash === hash && !FORCE) {
      skipped += 1
      continue
    }

    const parentEntry = node.parentAnchor ? manifest.entries[node.parentAnchor] : null
    if (node.parentAnchor && !parentEntry) {
      failures.push(`${node.anchor}：父节点 ${node.parentAnchor} 还未同步`)
      console.log(`✗ ${node.anchor}：缺少父节点，跳过`)
      continue
    }
    const payload = {
      title: node.title,
      body: node.body,
      state: node.state,
      parent: parentEntry ? parentEntry.id : undefined,
    }

    try {
      let issue
      if (entry) {
        issue = linear.updateIssue(entry.identifier, payload)
        updated += 1
      } else if (byTitle.has(node.title)) {
        issue = linear.updateIssue(byTitle.get(node.title).identifier, payload)
        adopted += 1
      } else {
        issue = linear.createIssue(payload)
        created += 1
      }

      let result = verifyIssue(issue.identifier, node)
      if (!result.ok) {
        // one repair attempt with the full payload, then re-verify
        issue = linear.updateIssue(issue.identifier, payload)
        result = verifyIssue(issue.identifier, node)
        if (result.ok) repaired += 1
      }
      if (!result.ok) {
        failures.push(`${node.anchor}：${result.reason}`)
        console.log(`✗ ${issue.identifier} ${node.title} —— ${result.reason}`)
      } else {
        console.log(`✓ ${issue.identifier} ${node.title}`)
      }

      manifest.entries[node.anchor] = {
        id: issue.id,
        identifier: issue.identifier,
        title: node.title,
        state: node.state,
        hash,
        updatedAt: new Date().toISOString(),
      }
      saveManifest(manifest)
    } catch (error) {
      failures.push(`${node.anchor}：${error.message}`)
      console.log(`✗ ${node.anchor} —— ${error.message}`)
    }
    await sleep(150)
  }

  console.log('')
  console.log(`完成：新建 ${created} · 更新 ${updated} · 认领 ${adopted} · 跳过 ${skipped} · 修复后通过 ${repaired} · 失败 ${failures.length}`)
  if (failures.length) {
    for (const failure of failures) console.log(`- ${failure}`)
    process.exitCode = 1
  }
}

await main()
