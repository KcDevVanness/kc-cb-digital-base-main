#!/usr/bin/env node
/**
 * Applies `0001-lookup-select-dropdown.patch` to a pristine copy of the installed
 * `@open-mercato/ui` 0.8.0 sources and runs the patched component's test file
 * against it.
 *
 * What this proves:
 *   1. the patch applies cleanly to the installed version (no fuzz, no manual fix-up);
 *   2. the patched component compiles and every pinned behaviour still holds
 *      (keyboard, Escape, selection visibility, disabled, onReady stability);
 *   3. the new behaviour is real: the panel opens on focus/ArrowDown and loads a
 *      first page with an empty query, mount fires no request, an explicit
 *      threshold still gates on typed characters.
 *
 * Usage: node .ai/analysis/lookup-select-dropdown/verify/verify.mjs
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..', '..', '..', '..')
const ui = join(appRoot, 'node_modules', '@open-mercato', 'ui', 'src')
const work = join(here, '.work')
const inputs = join(work, 'packages', 'ui', 'src', 'backend', 'inputs')

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', encoding: 'utf8' })

rmSync(work, { recursive: true, force: true })
mkdirSync(join(inputs, '__tests__'), { recursive: true })
mkdirSync(join(work, 'packages', 'ui', 'src', 'primitives'), { recursive: true })

// 1. pristine upstream sources
cpSync(join(ui, 'backend', 'inputs', 'LookupSelect.tsx'), join(inputs, 'LookupSelect.tsx'))
cpSync(
  join(ui, 'backend', 'inputs', '__tests__', 'LookupSelect.test.tsx'),
  join(inputs, '__tests__', 'LookupSelect.test.tsx'),
)

// 2. apply the patch inside a throwaway git repo (proves a clean application)
run('git', ['init', '-q'], work)
run('git', ['apply', join(here, '..', '0001-lookup-select-dropdown.patch')], work)

// 3. the sibling primitives the component imports
for (const primitive of ['button.tsx', 'popover.tsx']) {
  cpSync(join(ui, 'primitives', primitive), join(work, 'packages', 'ui', 'src', 'primitives', primitive))
}
writeFileSync(join(work, '.gitignore'), 'node_modules\n')

// 4. run the patched test file
run('node', [join(appRoot, 'node_modules', 'jest', 'bin', 'jest.js'), '--config', join(here, 'jest.config.cjs')], appRoot)
