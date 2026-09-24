#!/usr/bin/env node
/**
 * Regenerates `0001-lookup-select-dropdown.patch` from the pristine upstream
 * sources in `../orig/` and the candidate sources in `../new/`.
 *
 * Upstream layout is `packages/<package>/src/...` (see the framework's own
 * cross-package comments), so the patch paths are rewritten to that shape and the
 * result applies with `git apply` (or `patch -p1`) inside a framework checkout.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const artifacts = join(here, '..')

/** file → upstream path (relative to the framework repo root). */
const FILES = {
  'LookupSelect.tsx': 'packages/ui/src/backend/inputs/LookupSelect.tsx',
  'LookupSelect.test.tsx': 'packages/ui/src/backend/inputs/__tests__/LookupSelect.test.tsx',
}

function unifiedDiff(file, upstreamPath) {
  let out = ''
  try {
    out = execFileSync(
      'diff',
      ['-u', join(artifacts, 'orig', file), join(artifacts, 'new', file)],
      { encoding: 'utf8' },
    )
  } catch (error) {
    if (error.status !== 1) throw error
    out = error.stdout
  }
  const body = out
    .split('\n')
    .map((line) => {
      if (line.startsWith('--- ')) return `--- a/${upstreamPath}`
      if (line.startsWith('+++ ')) return `+++ b/${upstreamPath}`
      return line
    })
    .join('\n')
  return `diff --git a/${upstreamPath} b/${upstreamPath}\n${body}`
}

const patch = Object.entries(FILES)
  .map(([file, upstreamPath]) => unifiedDiff(file, upstreamPath))
  .join('')

writeFileSync(join(artifacts, '0001-lookup-select-dropdown.patch'), patch)
const changed = readFileSync(join(artifacts, '0001-lookup-select-dropdown.patch'), 'utf8')
  .split('\n')
  .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line)).length
console.log(`0001-lookup-select-dropdown.patch written (${changed} changed lines)`)
