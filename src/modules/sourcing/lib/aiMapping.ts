import { generateObject } from 'ai'
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import {
  AiModelFactoryError,
  createModelFactory,
  type AiModelFactory,
  type AiModelResolution,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import { SOURCE_FIELD_BY_KEY, SOURCE_FIELDS, type SourceFieldKey } from './fieldAliases'
import type { DetectedColumnMapping, MappingConfidence } from './columnMapping'

/**
 * Optional AI assist for column mapping.
 *
 * Only the header row and at most three sample rows are sent, and only when an operator asks for
 * it — supplier cost data is commercially sensitive, so the request is the smallest thing that can
 * still answer "which column is the unit price?". The suggestion is never written to the database:
 * it comes back to the wizard, which shows it and lets the operator apply (or ignore) it through
 * the ordinary `remap` command.
 *
 * The model is resolved through the AI package's model factory, which reads the deployment's
 * `OM_AI_*` configuration; when no provider is configured the feature reports itself unavailable
 * instead of falling back to a hard-coded provider.
 */

const MODULE_ID = 'sourcing'
const AI_TIMEOUT_MS = 30_000
const MAX_SAMPLE_ROWS = 3

export class SourcingAiNotConfiguredError extends Error {
  constructor() {
    super('No AI model provider is configured for this deployment')
    this.name = 'SourcingAiNotConfiguredError'
  }
}

export class SourcingAiUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SourcingAiUnavailableError'
  }
}

export type AiStatus = { available: boolean; provider: string | null; model: string | null }

export type AiMappingSuggestion = {
  columns: DetectedColumnMapping[]
  notes: string | null
  provider: string | null
  model: string | null
}

const suggestionSchema = z.object({
  mappings: z
    .array(
      z.object({
        sourceIndex: z.number().int().min(0).max(255),
        targetField: z.string().max(64).nullable(),
        confidence: z.enum(['exact', 'alias', 'fuzzy', 'none']),
        reason: z.string().max(200).nullable().optional(),
      }),
    )
    .max(80),
  notes: z.string().max(600).nullable().optional(),
})

const SYSTEM_PROMPT = [
  'You map the columns of a supplier quotation spreadsheet onto a fixed target catalog.',
  'You receive the header row, a few sample data rows, and the target fields with their English and Chinese labels.',
  'For every source column return exactly one entry: the target field key, or null when the column should not be imported.',
  'Never invent a target field key that is not in the catalog. Prefer exact matches over guesses, and use confidence "none" with a null target when you are unsure.',
].join(' ')

function isModelFactoryError(error: unknown): boolean {
  if (error instanceof AiModelFactoryError) return true
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AiModelFactoryError'
}

function resolveModel(container: AwilixContainer): AiModelResolution {
  let factory: AiModelFactory
  try {
    factory = createModelFactory(container)
  } catch {
    throw new SourcingAiNotConfiguredError()
  }
  try {
    return factory.resolveModel({ moduleId: MODULE_ID })
  } catch (error) {
    if (isModelFactoryError(error)) throw new SourcingAiNotConfiguredError()
    throw error
  }
}

/** Never throws: the wizard uses this to decide whether to enable the AI button at all. */
export function resolveAiStatus(container: AwilixContainer): AiStatus {
  try {
    const resolution = resolveModel(container)
    return { available: true, provider: resolution.providerId, model: resolution.modelId }
  } catch {
    return { available: false, provider: null, model: null }
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SourcingAiUnavailableError(message)), timeoutMs)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Asks the model to map the columns. `headers` and `sampleRows` are the only data that leaves the
 * deployment; callers pass the *first three* data rows, never the whole sheet.
 */
export async function suggestMappingWithAi(input: {
  container: AwilixContainer
  headers: readonly string[]
  sampleRows: readonly (readonly unknown[])[]
}): Promise<AiMappingSuggestion> {
  const resolution = resolveModel(input.container)
  const catalog = SOURCE_FIELDS.map((field) => ({
    key: field.key,
    labelEn: field.labelEn,
    labelZh: field.labelZh,
    aliases: field.aliases.slice(0, 8),
    kind: field.kind,
  }))
  const columns = input.headers.map((header, sourceIndex) => ({ sourceIndex, header: header ?? '' }))
  const samples = input.sampleRows.slice(0, MAX_SAMPLE_ROWS).map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))))

  let generated: z.infer<typeof suggestionSchema>
  try {
    const result = await withTimeout(
      generateObject({
        // `AiModelInstance` is deliberately SDK-agnostic in the factory's port; the concrete SDK
        // model is what `generateObject` accepts.
        model: resolution.model as Parameters<typeof generateObject>[0]['model'],
        schema: suggestionSchema,
        system: SYSTEM_PROMPT,
        prompt: JSON.stringify({ columns, sampleRows: samples, targetFields: catalog }, null, 2),
        temperature: 0,
      }),
      AI_TIMEOUT_MS,
      'The AI mapping request timed out',
    )
    generated = result.object
  } catch (error) {
    if (error instanceof SourcingAiNotConfiguredError || error instanceof SourcingAiUnavailableError) throw error
    if (isModelFactoryError(error)) throw new SourcingAiNotConfiguredError()
    throw new SourcingAiUnavailableError(error instanceof Error ? error.message : 'The AI mapping request failed')
  }

  const byIndex = new Map<number, { targetField: SourceFieldKey | null; confidence: MappingConfidence; reason?: string | null }>()
  for (const mapping of generated.mappings) {
    const key = mapping.targetField && mapping.targetField in SOURCE_FIELD_BY_KEY ? (mapping.targetField as SourceFieldKey) : null
    byIndex.set(mapping.sourceIndex, { targetField: key, confidence: key ? mapping.confidence : 'none', reason: mapping.reason ?? null })
  }

  const columns2: DetectedColumnMapping[] = input.headers.map((header, sourceIndex) => {
    const sourceHeader = header ?? ''
    const suggestion = byIndex.get(sourceIndex)
    if (!suggestion || !suggestion.targetField) {
      return {
        sourceIndex,
        sourceHeader,
        targetField: null,
        confidence: 'none',
        status: 'unmapped',
        reason: 'no_alias_match',
        matchedOn: suggestion?.reason ?? undefined,
      }
    }
    const field = SOURCE_FIELD_BY_KEY[suggestion.targetField]
    return {
      sourceIndex,
      sourceHeader,
      targetField: suggestion.targetField,
      confidence: suggestion.confidence,
      status: field.kind === 'ignored' ? 'ignored' : 'mapped',
      reason: field.kind === 'ignored' ? 'ignored_by_catalog' : undefined,
      matchedOn: suggestion.reason ?? undefined,
    }
  })

  return {
    columns: columns2,
    notes: generated.notes ?? null,
    provider: resolution.providerId,
    model: resolution.modelId,
  }
}
