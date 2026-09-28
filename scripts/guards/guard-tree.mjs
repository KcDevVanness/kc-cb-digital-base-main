#!/usr/bin/env node
/**
 * guard-tree — refuse a tree that lost the repository instead of adding to it.
 *
 * A branch built in an empty worktree and committed with `git add -A` records the *absence* of
 * every file that was never checked out. PR #12 (2026-09-28, branch `qa-evidence-pr-11`) was one
 * such commit: its tree held two `.webp` files while the base held 1541 files — `1543 files
 * changed, 593482 deletions(-)` against `main`, `yarn.lock` and `src/**` included. Nothing warned,
 * because a head that deletes `.github/workflows/**` runs no `pull_request` workflow at all.
 *
 * Two tree-based checks (no history walk, so a `--depth=1` fetch is enough):
 *   1. every path in SENTINEL_PATHS exists in the head tree;
 *   2. the head tree keeps at least MIN_KEPT_RATIO of the base tree's files.
 *
 * Usage: node scripts/guards/guard-tree.mjs --base <rev> --head <rev> [--min-kept-ratio 0.5]
 * Exit:  0 clean · 1 violation · 2 bad usage or unknown revision
 */
import { execFileSync } from 'node:child_process'

/** Paths without which the head tree is not this application any more. */
const SENTINEL_PATHS = ['package.json', 'yarn.lock', 'src/modules.ts', '.github/workflows/validate.yml']
const DEFAULT_MIN_KEPT_RATIO = 0.5

function usage() {
  console.error('Usage: node scripts/guards/guard-tree.mjs --base <rev> --head <rev> [--min-kept-ratio 0.5]')
}

function parseArgs(argv) {
  const parsed = { base: null, head: null, minKeptRatio: DEFAULT_MIN_KEPT_RATIO }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]
    if (arg === '--base' && value) { parsed.base = value; index += 1 } else if (arg === '--head' && value) { parsed.head = value; index += 1 } else if (arg === '--min-kept-ratio' && value) {
      const ratio = Number(value)
      if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
        console.error(`guard-tree: --min-kept-ratio must be a number in (0, 1], got ${JSON.stringify(value)}`)
        process.exit(2)
      }
      parsed.minKeptRatio = ratio
      index += 1
    } else {
      console.error(`guard-tree: unexpected argument ${JSON.stringify(arg)}`)
      usage()
      process.exit(2)
    }
  }
  if (!parsed.base || !parsed.head) {
    usage()
    process.exit(2)
  }
  return parsed
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function resolveCommit(rev) {
  try {
    return git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]).trim()
  } catch {
    return null
  }
}

function treePaths(commit) {
  return git(['ls-tree', '-r', '-z', '--name-only', commit]).split('\0').filter(Boolean)
}

const { base, head, minKeptRatio } = parseArgs(process.argv.slice(2))

const baseCommit = resolveCommit(base)
const headCommit = resolveCommit(head)
for (const [rev, commit] of [[base, baseCommit], [head, headCommit]]) {
  if (!commit) {
    console.error(`guard-tree: cannot resolve ${JSON.stringify(rev)} to a commit in this clone`)
    process.exit(2)
  }
}

const basePaths = treePaths(baseCommit)
const headPaths = treePaths(headCommit)
const headSet = new Set(headPaths)

const violations = []
const missingSentinels = SENTINEL_PATHS.filter((sentinel) => !headSet.has(sentinel))
if (missingSentinels.length > 0) {
  violations.push(`head tree is missing required path(s): ${missingSentinels.join(', ')}`)
}
const keptRatio = basePaths.length === 0 ? 1 : headPaths.length / basePaths.length
if (keptRatio < minKeptRatio) {
  violations.push(
    `head tree keeps only ${headPaths.length} of the base's ${basePaths.length} files`
    + ` (${(keptRatio * 100).toFixed(1)}% < ${(minKeptRatio * 100).toFixed(1)}%)`,
  )
}

if (violations.length > 0) {
  console.error(`guard-tree: REFUSED — ${baseCommit.slice(0, 7)} (${basePaths.length} files) -> ${headCommit.slice(0, 7)} (${headPaths.length} files)`)
  for (const violation of violations) console.error(`  - ${violation}`)
  console.error('  A tree that lost the repository is almost always a commit made from an empty or partial')
  console.error('  checkout with `git add -A`. Compare with: git diff --stat <base>..<head>')
  console.error('  Deliberate deletions: rebuild the branch from the target branch, or push with --no-verify locally.')
  process.exit(1)
}

console.log(
  `guard-tree: OK — ${baseCommit.slice(0, 7)} (${basePaths.length} files) -> ${headCommit.slice(0, 7)} (${headPaths.length} files),`
  + ` sentinels present`,
)
