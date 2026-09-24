import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from '@jest/globals'

/**
 * One string, one language.
 *
 * The app serves `en` and `zh` (`src/lib/i18n/app-locales.ts`), and what a reader sees comes from
 * the dictionary their locale selects — never from a string that carries both. A label like
 * 「供应商货号 Supplier code」 is wrong in *both* locales: the Chinese reader gets noise, the English
 * one gets Chinese, and the language switcher cannot fix either.
 *
 * Three surfaces write strings a human reads, and all three are checked here:
 *
 * 1. **English dictionaries** — no Chinese, at all.
 * 2. **App-owned Chinese dictionaries** — no English phrase sitting beside the Chinese one.
 * 3. **Seed labels** (`setup.ts`, `index.ts` and the app's own label tables) — dictionary entries are
 *    *data* and cannot switch language, so they are written in one language, as the display name
 *    only: a code the record stores belongs in front of it, rendered by the picker as
 *    `CODE — name` (the currency/unit shape, `products/lib/unitOptions.ts`).
 *
 * Component strings go through `t()` instead; hardcoded ones are `scripts/i18n-check-hardcoded.mjs`.
 *
 * The allowlists are explicit on purpose. A brand, product or protocol name normally written in
 * Latin script inside a Chinese sentence is listed once, with its reason; adding an entry is a
 * deliberate decision, not a way to silence a genuine mix.
 */

const repoRoot = resolve(__dirname, '../../../..')

/**
 * Names that stay Latin inside Chinese text. Not a translation — the thing has no Chinese name in
 * this business (a platform, a tool, a protocol).
 */
const LATIN_NAME_ALLOWLIST = new Set([
  // Marketplaces and carriers this deployment trades on.
  'ozon', 'tiktok', 'temu', 'shein', 'shopify', 'ebay', 'walmart', 'amazon', 'dhl',
  // Tools, hubs and frameworks named in operator-facing messages.
  'yarn', 'node', 'next', 'mikroorm', 'awilix', 'shadcn', 'lucide', 'opencode', 'openai',
  'excel', 'markdown', 'handle', 'petkit', 'postgresql', 'meilisearch', 'ollama', 'minio',
  // Browser vocabulary Chinese keeps in Latin script.
  'cookie',
  // Key names, which a shortcut hint spells out rather than translates.
  'enter', 'esc', 'tab', 'shift', 'ctrl', 'cmd', 'alt', 'delete', 'backspace',
  // Unit symbols: a symbol is not the English name of the unit.
  'mah', 'wh', 'kwh', 'kg', 'mg', 'ml', 'cm', 'mm', 'km', 'hz',
])

/** Multi-word names that stay Latin as a whole (`Open Mercato`). */
const LATIN_PHRASE_ALLOWLIST = ['open mercato']

/** A Latin run is a code, a path, a URL, a placeholder or a shortcut when it carries these. */
const CODE_LIKE = /[0-9_@:/.+*×=<>%~-]/

/** CJK-then-English pairs are labels: 「供应商货号 Supplier code」, 「采购合同 / PURCHASE CONTRACT」. */
const CJK_THEN_LATIN = /[\u3400-\u9fff][^A-Za-z]*([A-Za-z][A-Za-z '’&-]*)$/u

/** The mirrored shape in a seed row: 「Yantian 深圳盐田」 writes the English name first. */
const LATIN_THEN_CJK = /^([A-Za-z][A-Za-z '’&-]*)[^A-Za-z]*[\u3400-\u9fff]/u

/**
 * The Latin text when it is a second language rather than a name, code or abbreviation.
 *
 * A run carrying code punctuation is an identifier (`products.items.view`, `40HQ`), an allowlisted
 * word is a name, and a single short ALL-CAPS token is an abbreviation (`HS`, `MOQ`, `SKU`).
 * Anything else sitting beside Chinese is the same phrase written twice, in two languages.
 */
function secondLanguageLatin(latin: string): string | null {
  const trimmed = latin.trim()
  if (!trimmed || CODE_LIKE.test(trimmed)) return null
  if (LATIN_PHRASE_ALLOWLIST.includes(trimmed.toLowerCase())) return null
  const meaningful = trimmed
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !LATIN_NAME_ALLOWLIST.has(word.toLowerCase()))
  if (meaningful.length === 0) return null
  const isAbbreviation = meaningful.length === 1 && meaningful[0].length <= 5 && meaningful[0] === meaningful[0].toUpperCase()
  return isAbbreviation ? null : trimmed
}

/**
 * The pair a value carries, or null when the Latin part is an annotation rather than a translation.
 *
 * Bracketed, quoted and backticked text is an annotation — 「供应商供货价（PK 单价）」 and
 * 「(⌘/Ctrl+Enter)」 both say what the Chinese already said, in one locale.
 */
function englishPair(value: string): string | null {
  const withoutPlaceholders = value.replace(/\{[^}]*\}/g, ' ')
  const stripped = withoutPlaceholders.replace(/[（(【\[「『“"`][^）)】\]」』”"]*[）)】\]」』”"]/g, ' ')
  const match = CJK_THEN_LATIN.exec(stripped.trim())
  return match ? secondLanguageLatin(match[1]) : null
}

/** App-owned module ids, from the registry that decides who owns the code. */
function appOwnedModuleIds(): string[] {
  const registry = readFileSync(join(repoRoot, 'src/modules.ts'), 'utf8')
  return [...registry.matchAll(/\{\s*id:\s*'([a-z0-9_]+)'[^}]*from:\s*'@app'/g)].map((match) => match[1]).sort()
}

function readJson(path: string): Record<string, string> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>
}

const CJK = /[\u3400-\u9fff]/

type Finding = { file: string; line: number; detail: string }

function englishDictionaryFindings(): Finding[] {
  const files = [
    join(repoRoot, 'src/i18n/en.json'),
    ...appOwnedModuleIds().map((id) => join(repoRoot, 'src/modules', id, 'i18n/en.json')),
  ]
  const findings: Finding[] = []
  for (const file of files) {
    if (!existsSync(file)) continue
    const relativePath = relative(repoRoot, file)
    for (const [key, value] of Object.entries(readJson(file))) {
      if (typeof value === 'string' && CJK.test(value)) {
        findings.push({ file: relativePath, line: 0, detail: `${key} = ${value}` })
      }
    }
  }
  return findings
}

function chineseDictionaryFindings(): Finding[] {
  const files = [
    join(repoRoot, 'src/i18n/zh.json'),
    ...appOwnedModuleIds().map((id) => join(repoRoot, 'src/modules', id, 'i18n/zh.json')),
  ]
  const findings: Finding[] = []
  for (const file of files) {
    if (!existsSync(file)) continue
    const relativePath = relative(repoRoot, file)
    for (const [key, value] of Object.entries(readJson(file))) {
      if (typeof value !== 'string') continue
      const pair = englishPair(value)
      if (pair) findings.push({ file: relativePath, line: 0, detail: `${key} = ${value} — “${pair}”` })
    }
  }
  return findings
}

/**
 * Every app module's `setup.ts` and `index.ts` plus the app's own label tables: the files that write
 * a string a reader meets without a dictionary in front of it (seed labels, the module description).
 */
function seedFiles(): string[] {
  const files = appOwnedModuleIds()
    .flatMap((id) => [join(repoRoot, 'src/modules', id, 'setup.ts'), join(repoRoot, 'src/modules', id, 'index.ts')])
    .filter((file) => existsSync(file))
  for (const extra of [
    'src/modules/currency_policy/lib/policy.ts',
    'src/modules/products/lib/tiers.ts',
    'src/modules/purchasing/lib/priceKinds.ts',
  ]) {
    const file = join(repoRoot, extra)
    if (existsSync(file)) files.push(file)
  }
  return files
}

function seedLabelFindings(): Finding[] {
  const findings: Finding[] = []
  for (const file of seedFiles()) {
    const relativePath = relative(repoRoot, file)
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        const match = /(label|name|description):\s*'([^']+)'/.exec(line)
        if (!match) return
        const [, key, value] = match
        if (!CJK.test(value)) return
        // A **label** is the display name only: a code glued to it (`件 (PCS)`) is the old shape, and
        // the picker renders `CODE — name` instead. A description may name a module or a code in
        // brackets — that is an identifier in prose, not a second label.
        const bracketedCode = /[（(]\s*[A-Za-z0-9_.：:-]{1,16}\s*[）)]/.exec(value)
        if (key === 'label' && bracketedCode) {
          findings.push({ file: relativePath, line: index + 1, detail: `${value} — code in the label (“${bracketedCode[0]}”); render it as \`CODE — name\` in the picker` })
          return
        }
        // The second language may sit either side of the Chinese one; both orders are checked.
        const mirrored = LATIN_THEN_CJK.exec(value.trim())
        const pair = englishPair(value) ?? (mirrored ? secondLanguageLatin(mirrored[1]) : null)
        if (pair) findings.push({ file: relativePath, line: index + 1, detail: `${value} — “${pair}”` })
      })
  }
  return findings
}

const describeFindings = (findings: Finding[]): string =>
  findings.map((finding) => `${finding.file}${finding.line ? `:${finding.line}` : ''} — ${finding.detail}`).join('\n')

describe('language purity', () => {
  it('keeps English dictionaries free of Chinese', () => {
    expect(describeFindings(englishDictionaryFindings())).toBe('')
  })

  it('keeps app-owned Chinese dictionaries free of English phrases', () => {
    expect(describeFindings(chineseDictionaryFindings())).toBe('')
  })

  it('writes seed labels in one language, display name and code at most', () => {
    expect(describeFindings(seedLabelFindings())).toBe('')
  })
})
