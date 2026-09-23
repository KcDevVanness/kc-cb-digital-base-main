"use client"

import * as React from 'react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import { SOURCE_FIELDS } from '../lib/fieldAliases'
import type { MappingColumn, MappingConfidence } from '../types'

/**
 * The column-mapping table of the import wizard.
 *
 * One row per source column, each with the target field it feeds. A target field belongs to exactly
 * one column — assigning it here clears it from whichever column held it before — because the line
 * builder reads one source index per field. Confidence is shown rather than hidden: `none` and
 * `fuzzy` are exactly the rows an operator has to look at before the review.
 */

const CONFIDENCE_VARIANT: Record<MappingConfidence, 'success' | 'neutral' | 'warning' | 'error'> = {
  exact: 'success',
  alias: 'neutral',
  fuzzy: 'warning',
  none: 'error',
}

const IGNORED_VALUE = '__ignored__'
const UNMAPPED_VALUE = '__unmapped__'

/** Assigns a target field to one column and takes it away from any other column that held it. */
export function assignTargetField(
  columns: readonly MappingColumn[],
  sourceIndex: number,
  targetField: string | null,
): MappingColumn[] {
  return columns.map((column) => {
    if (column.sourceIndex === sourceIndex) {
      return {
        ...column,
        targetField,
        status: targetField === null ? 'unmapped' : column.status === 'ignored' ? 'mapped' : column.status,
        confidence: targetField === null ? 'none' : column.confidence === 'none' ? 'alias' : column.confidence,
        reason: undefined,
      }
    }
    if (targetField !== null && column.targetField === targetField) {
      return { ...column, targetField: null, status: 'unmapped', confidence: 'none', reason: 'duplicate_target' }
    }
    return column
  })
}

function confidenceLabel(t: TranslateFn, confidence: MappingConfidence): string {
  return t(`sourcing.mapping.confidence.${confidence}`, confidence)
}

/**
 * The target field's name **in the reader's language**. `fieldAliases` carries a Chinese and an
 * English label for every field because the workbook may print either, but a reader picks one
 * language: 「货号 / SKU」 in a select is a second language, not a bilingual feature.
 */
function targetFieldLabel(key: string, locale: Locale): string {
  const field = SOURCE_FIELDS.find((entry) => entry.key === key)
  if (!field) return key
  return locale === 'zh' ? field.labelZh : field.labelEn
}

export function ColumnMappingTable({
  columns,
  onChange,
  disabled,
}: {
  columns: readonly MappingColumn[]
  onChange: (next: MappingColumn[]) => void
  disabled?: boolean
}) {
  const t = useT()
  const locale = useLocale()

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <div className="min-w-160">
        <div className="grid grid-cols-12 gap-2 border-b border-border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
          <span className="col-span-4">{t('sourcing.wizard.mapping.sourceColumn', 'Source column')}</span>
          <span className="col-span-5">{t('sourcing.wizard.mapping.targetField', 'Target field')}</span>
          <span className="col-span-3">{t('sourcing.wizard.mapping.confidence', 'Confidence')}</span>
        </div>
        <div className="divide-y divide-border">
          {columns.map((column) => {
            const ignored = column.status === 'ignored'
            const value = column.targetField ? column.targetField : ignored ? IGNORED_VALUE : UNMAPPED_VALUE
            return (
              <div key={column.sourceIndex} className="grid grid-cols-12 items-center gap-2 px-3 py-2 text-sm">
                <div className="col-span-4 min-w-0">
                  <div className="truncate font-medium" title={column.sourceHeader}>
                    {column.sourceHeader || t('sourcing.lines.noValue', '—')}
                  </div>
                  {column.matchedOn ? (
                    <div className="truncate text-xs text-muted-foreground">← {column.matchedOn}</div>
                  ) : null}
                </div>
                <div className="col-span-5">
                  <Select
                    value={value}
                    disabled={disabled}
                    onValueChange={(next) => {
                      if (next === UNMAPPED_VALUE) {
                        onChange(assignTargetField(columns, column.sourceIndex, null))
                        return
                      }
                      onChange(assignTargetField(columns, column.sourceIndex, next === IGNORED_VALUE ? column.targetField : next))
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNMAPPED_VALUE}>{t('sourcing.wizard.mapping.unmapped', 'Unmapped')}</SelectItem>
                      {SOURCE_FIELDS.map((field) => (
                        <SelectItem key={field.key} value={field.key}>
                          {targetFieldLabel(field.key, locale)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-3 flex flex-wrap items-center gap-1">
                  {column.targetField ? (
                    <Badge variant={CONFIDENCE_VARIANT[column.confidence]}>{confidenceLabel(t, column.confidence)}</Badge>
                  ) : null}
                  {ignored ? <Badge variant="neutral">{t('sourcing.wizard.mapping.ignored', '(ignored)')}</Badge> : null}
                  {column.reason === 'duplicate_target' && column.duplicateOfField ? (
                    <span className="text-xs text-muted-foreground">
                      {t('sourcing.wizard.mapping.duplicateTarget', 'Duplicate target: {field}', {
                        field: targetFieldLabel(column.duplicateOfField, locale),
                      })}
                    </span>
                  ) : null}
                  {column.reason === 'all_zero_values' ? (
                    <span className="text-xs text-muted-foreground">{t('sourcing.wizard.mapping.allZero', 'Column is all zeros')}</span>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default ColumnMappingTable
