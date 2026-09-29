#!/usr/bin/env node
/**
 * branch-cleanup — report (and with --apply, delete) branches whose work has already landed.
 *
 * The parallel-development flow is one work unit = one worktree = one branch = one PR, and a unit
 * is finished when its PR is merged and its branch and worktree are gone. Two shapes leave residue:
 *
 * - squash-merged units: `main` holds the content under a new SHA, so the branch is not an ancestor
 *   of anything, `git branch -d` refuses it and it keeps looking unmerged;
 * - integration branches: a branch that collected unit PRs first, was merged into `main` once, and
 *   kept receiving PRs afterwards. Every commit merged into it after that merge exists nowhere else
 *   (2026-09-29: 270 paths under src/modules/finance, ru_sync, boss_cockpit, trade_docs).
 *
 * A branch is deletable when its work is reachable from a cover ref: the tip is an ancestor of the
 * ref, or its PR is merged and every path it carries already exists in the cover refs — by path, or
 * by blob under a different path (a rename that was later reverted, e.g. trade_docs'
 * productSnapshots.ts → currencyScale.ts → productSnapshots.ts, is not stranded content).
 * `--deep` additionally accepts content that is only in a cover ref's history, which is the shape of
 * a file that was renamed or rewritten after the branch was cut (its old revision still resolves).
 * A branch with unique content is tagged STRANDED and is never deleted. Cover refs default to
 * `origin/main`; add the live integration branch (`--cover origin/feat/<branch>`) when a stacked
 * unit landed there on purpose.
 *
 * A deleted tip stays reachable through GitHub's pull refs: `git fetch origin pull/<n>/head`.
 *
 * Usage: node scripts/git/branch-cleanup.mjs [--apply] [--remote] [--no-fetch]
 *                                            [--cover <ref>]… [--keep <name>]…
 */
import { execFileSync } from 'node:child_process'

const DEFAULT_COVER_REFS = ['origin/main']
const DEFAULT_KEEP = ['main', 'production']
const PULL_REQUEST_LIMIT = 300

function usage() {
  console.error(`Usage: node scripts/git/branch-cleanup.mjs [options]

  --apply          delete the eligible local branches and their clean worktrees (default: report only)
  --remote         also evaluate remote branches; with --apply, delete them on origin
  --deep           also accept content that exists only in a cover ref's history (slow; for branches
                   whose file was renamed or rewritten after they were cut)
  --no-fetch       skip \`git fetch --prune origin\`
  --cover <ref>    cover ref to test landings against, repeatable (default: ${DEFAULT_COVER_REFS.join(', ')})
  --keep <name>    protect one more branch name, repeatable (default: ${DEFAULT_KEEP.join(', ')})
  -h, --help       print this help`)
}

function parseArgs(argv) {
  const options = { apply: false, remote: false, deep: false, fetch: true, cover: [], keep: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') options.apply = true
    else if (arg === '--remote') options.remote = true
    else if (arg === '--deep') options.deep = true
    else if (arg === '--no-fetch') options.fetch = false
    else if (arg === '--cover') options.cover.push(argv[(index += 1)] ?? '')
    else if (arg === '--keep') options.keep.push(argv[(index += 1)] ?? '')
    else if (arg === '-h' || arg === '--help') {
      usage()
      process.exit(0)
    } else {
      usage()
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  if (options.cover.length === 0) options.cover = [...DEFAULT_COVER_REFS]
  options.keep = [...new Set([...DEFAULT_KEEP, ...options.keep])]
  return options
}

function git(args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    if (allowFailure) return null
    const detail = String(error.stderr ?? '').trim() || error.message
    throw new Error(`git ${args.join(' ')} failed: ${detail}`)
  }
}

/** Map of branch name -> linked worktree entry, for branches checked out outside the main tree. */
function readWorktrees() {
  const byBranch = new Map()
  let entry = null
  for (const line of git(['worktree', 'list', '--porcelain']).split('\n')) {
    if (line.startsWith('worktree ')) {
      entry = { path: line.slice('worktree '.length), branch: null }
    } else if (entry && line.startsWith('branch ')) {
      entry.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
      byBranch.set(entry.branch, entry)
    }
  }
  for (const item of byBranch.values()) {
    item.clean = git(['-C', item.path, 'status', '--porcelain'], { allowFailure: true }) === ''
  }
  return byBranch
}

/**
 * A ref's tree as { paths, blobs }: paths for the direct name match, blobs so a file renamed after
 * the branch was cut still counts as covered. Null when the ref does not resolve.
 */
function readTree(ref) {
  const listing = git(['ls-tree', '-r', ref], { allowFailure: true })
  if (listing === null) return null
  const paths = new Set()
  const blobs = new Set()
  for (const line of listing.split('\n')) {
    const separator = line.indexOf('\t')
    if (separator === -1) continue
    const [, , sha] = line.slice(0, separator).split(' ')
    paths.add(line.slice(separator + 1))
    blobs.add(sha)
  }
  return { paths, blobs }
}

function isAncestor(ancestor, ref) {
  return git(['merge-base', '--is-ancestor', ancestor, ref], { allowFailure: true }) !== null
}

/** `origin/feat/x`, `refs/remotes/origin/feat/x` and `feat/x` name the same branch. */
function shortRef(ref) {
  return ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/origin\//, '').replace(/^origin\//, '')
}

/** Map of head branch name -> pull requests, merged first then newest. Null when gh is unusable. */
function readPullRequests() {
  try {
    const raw = execFileSync(
      'gh',
      ['pr', 'list', '--state', 'all', '--limit', String(PULL_REQUEST_LIMIT), '--json', 'number,state,headRefName,baseRefName,url'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const byHead = new Map()
    for (const pullRequest of JSON.parse(raw)) {
      byHead.set(pullRequest.headRefName, [...(byHead.get(pullRequest.headRefName) ?? []), pullRequest])
    }
    for (const [head, pullRequests] of byHead) {
      pullRequests.sort((left, right) => Number(right.state === 'MERGED') - Number(left.state === 'MERGED') || right.number - left.number)
      byHead.set(head, pullRequests)
    }
    return byHead
  } catch {
    return null
  }
}

/** Paths of `ref` whose content exists in no cover ref (tip, or history when `deepShas` is given). */
function uniquePaths(ref, coverRefs, deepShas) {
  const listing = git(['ls-tree', '-r', ref], { allowFailure: true })
  if (listing === null) return null
  const unique = []
  for (const line of listing.split('\n')) {
    const separator = line.indexOf('\t')
    if (separator === -1) continue
    const [, , sha] = line.slice(0, separator).split(' ')
    const path = line.slice(separator + 1)
    const covered = coverRefs.some((cover) => cover.paths.has(path) || cover.blobs.has(sha))
      || (deepShas !== null && deepShas.has(sha))
    if (!covered) unique.push(path)
  }
  return unique
}

/** Every tree/blob object reachable from the given refs — what `--deep` tests content against. */
function readDeepShas(refs) {
  const shas = new Set()
  for (const ref of refs) {
    for (const line of git(['rev-list', ref, '--objects']).split('\n')) {
      const separator = line.indexOf(' ')
      if (separator > 0) shas.add(line.slice(0, separator))
    }
  }
  return shas
}

function classify({ name, ref, coverRefs, deepShas, prByHead }) {
  const unique = uniquePaths(ref, coverRefs, deepShas)
  const ancestorOf = coverRefs.find((cover) => isAncestor(ref, cover.ref))?.ref ?? null
  const pullRequest = prByHead?.get(name)?.[0] ?? null
  const base = { uniquePaths: unique ?? [], pullRequest }
  if (ancestorOf) {
    return { ...base, verdict: 'landed', eligible: true, detail: `tip is an ancestor of ${ancestorOf}` }
  }
  if (pullRequest?.state === 'MERGED' && unique.length === 0) {
    return { ...base, verdict: 'squash-merged', eligible: true, detail: `PR #${pullRequest.number} merged, no unique content` }
  }
  if (pullRequest?.state === 'MERGED') {
    return {
      ...base,
      verdict: 'STRANDED',
      eligible: false,
      detail: `PR #${pullRequest.number} merged, but ${unique.length} path(s) live only here (first: ${unique[0]})`,
    }
  }
  if (!pullRequest) {
    return { ...base, verdict: 'no-pr', eligible: false, detail: `${unique.length} unique path(s), no pull request found` }
  }
  if (pullRequest.state === 'CLOSED' && unique.length === 0) {
    return {
      ...base,
      verdict: 'closed-pr',
      eligible: false,
      detail: `PR #${pullRequest.number} closed, no unique content — delete only when no comment links its raw URLs`,
    }
  }
  return {
    ...base,
    verdict: `pr-${pullRequest.state.toLowerCase()}`,
    eligible: false,
    detail: `PR #${pullRequest.number} is ${pullRequest.state}${unique.length > 0 ? `, ${unique.length} unique path(s)` : ''}`,
  }
}

function printRow(row) {
  console.log(
    `  ${`${row.kind}/${row.name}`.padEnd(46)} ${row.verdict.padEnd(14)}`
    + ` ${(row.pullRequest ? `#${row.pullRequest.number}` : '—').padEnd(6)}`
    + ` ${String(row.uniquePaths.length).padStart(5)}  ${row.detail}`,
  )
}

const options = parseArgs(process.argv.slice(2))

if (options.fetch && git(['fetch', '--prune', 'origin'], { allowFailure: true }) === null) {
  console.error('branch-cleanup: `git fetch --prune origin` failed — continuing against local refs')
}

const coverRefs = []
for (const ref of options.cover) {
  const tree = readTree(ref)
  if (tree === null) {
    console.error(`branch-cleanup: cover ref ${ref} does not resolve — skipped`)
    continue
  }
  coverRefs.push({ ref, ...tree })
}
if (coverRefs.length === 0) {
  console.error('branch-cleanup: no usable cover ref')
  process.exit(2)
}

const keep = new Set(options.keep)
// A cover ref is the evidence that the work is kept — deleting it would delete the very thing the
// verdict was tested against (a ref is trivially an ancestor of itself).
const covered = new Set(coverRefs.map((cover) => shortRef(cover.ref)))
const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true })
const worktrees = readWorktrees()
const prByHead = readPullRequests()
if (prByHead === null) {
  console.error('branch-cleanup: gh is unavailable or unauthenticated — only tips reachable from a cover ref stay eligible')
}

console.log(`branch-cleanup: cover refs ${coverRefs.map((cover) => cover.ref).join(', ')} (protected)`
  + `${options.apply ? ' (apply)' : ' (report)'}${options.deep ? ' (deep)' : ''}`)

const deepShas = options.deep ? readDeepShas(coverRefs.map((cover) => cover.ref)) : null

const localRows = []
for (const name of git(['for-each-ref', 'refs/heads', '--format=%(refname:short)']).split('\n').filter(Boolean)) {
  if (keep.has(name) || covered.has(name) || name === currentBranch) continue
  localRows.push({ kind: 'local', name, ref: name, ...classify({ name, ref: name, coverRefs, deepShas, prByHead }) })
}
for (const row of localRows) printRow(row)
const localEligible = localRows.filter((row) => row.eligible)
console.log(`  local: ${localEligible.length} removable, ${localRows.length - localEligible.length} need review`)

if (options.apply) {
  for (const row of localEligible) {
    const worktree = worktrees.get(row.name)
    if (worktree && !worktree.clean) {
      console.log(`  keep ${row.name}: worktree ${worktree.path} has uncommitted changes`)
      continue
    }
    if (worktree && row.pullRequest?.state !== 'MERGED') {
      console.log(`  keep ${row.name}: worktree ${worktree.path} has no merged PR — delete the unit by hand when it is done`)
      continue
    }
    if (worktree) git(['worktree', 'remove', worktree.path])
    git(['branch', '-D', row.name])
    console.log(`  deleted local branch ${row.name}${worktree ? ` and worktree ${worktree.path}` : ''}`)
  }
}

if (options.remote) {
  const remoteRows = []
  const remoteRefs = git(['for-each-ref', 'refs/remotes/origin/', '--format=%(refname)'])
    .split('\n')
    .filter(Boolean)
    .map((ref) => ref.slice('refs/remotes/origin/'.length))
    .filter((name) => name !== 'HEAD' && !keep.has(name) && !covered.has(name))
  for (const name of remoteRefs) {
    remoteRows.push({
      kind: 'origin',
      name,
      ref: `origin/${name}`,
      ...classify({ name, ref: `origin/${name}`, coverRefs, deepShas, prByHead }),
    })
  }
  for (const row of remoteRows) printRow(row)
  const remoteEligible = remoteRows.filter((row) => row.eligible)
  console.log(`  origin: ${remoteEligible.length} deletable, ${remoteRows.length - remoteEligible.length} need review`)
  if (options.apply) {
    for (const row of remoteEligible) {
      git(['push', 'origin', '--delete', row.name])
      console.log(`  deleted origin/${row.name}`)
    }
  }
}

console.log('  review rows are never deleted automatically: land their paths (or add a cover ref with --cover) first')
