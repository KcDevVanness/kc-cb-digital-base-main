"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  CrudForm,
  type CrudField,
  type CrudFormGroup,
  type CrudFormGroupComponentProps,
} from '@open-mercato/ui/backend/CrudForm'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'

/**
 * The code-rule form.
 *
 * Three things make this form different from a plain CRUD screen, and each has its own block:
 * the **segments** (an ordered structure, edited as a group component), the **preview** (the rule
 * explained by formatting the next code with it) and the **sequences** (how far each counter has run).
 * A rule is validated by the server against the live code lists, so the form shows the server's
 * problem code instead of trying to re-implement the check.
 */

const API_PATH = 'product_codes/rules'
const LIST_HREF = '/backend/product-codes/rules'

type SegmentDraft = {
  kind: 'dictionary' | 'serial'
  key: string
  dictionaryKey: string
  length: number
  upper: boolean
  join: boolean
}

export type CodeRuleValues = {
  id?: string
  name: string
  mode: string
  segments: SegmentDraft[]
  separator: string
  serialLength: number
  serialScope: string
  enforce: string
  isActive: boolean
  updatedAt?: string | null
}

const EMPTY_VALUES: CodeRuleValues = {
  name: '',
  mode: 'generate',
  segments: [
    { kind: 'dictionary', key: 'brand', dictionaryKey: 'product_brand', length: 2, upper: true, join: false },
    { kind: 'dictionary', key: 'category', dictionaryKey: 'product_category', length: 2, upper: true, join: false },
    { kind: 'serial', key: 'serial', dictionaryKey: '', length: 3, upper: false, join: true },
  ],
  separator: '-',
  serialLength: 3,
  serialScope: 'brand_category',
  enforce: 'warn',
  isActive: true,
}

/** Reads a stored rule into the form's shape, tolerating a hand-edited column. */
export function toCodeRuleValues(item: Record<string, unknown> | null | undefined): CodeRuleValues {
  if (!item) return EMPTY_VALUES
  const rawSegments = Array.isArray(item.segments) ? item.segments : []
  const segments = rawSegments.map<SegmentDraft>((entry) => {
    const record = entry as Record<string, unknown>
    const kind = record.kind === 'serial' ? 'serial' : 'dictionary'
    return {
      kind,
      key: typeof record.key === 'string' ? record.key : kind === 'serial' ? 'serial' : '',
      dictionaryKey: typeof record.dictionaryKey === 'string' ? record.dictionaryKey : '',
      length: Number(record.length ?? 2),
      upper: record.upper !== false,
      join: record.join === true,
    }
  })
  return {
    id: typeof item.id === 'string' ? item.id : undefined,
    name: typeof item.name === 'string' ? item.name : '',
    mode: typeof item.mode === 'string' ? item.mode : 'generate',
    segments: segments.length > 0 ? segments : EMPTY_VALUES.segments,
    separator: typeof item.separator === 'string' ? item.separator : '-',
    serialLength: Number(item.serialLength ?? 3),
    serialScope: typeof item.serialScope === 'string' ? item.serialScope : 'brand_category',
    enforce: typeof item.enforce === 'string' ? item.enforce : 'warn',
    isActive: item.isActive !== false,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null,
  }
}

export function buildCodeRulePayload(values: CodeRuleValues): Record<string, unknown> {
  return {
    name: values.name.trim(),
    mode: values.mode,
    segments: values.segments.map((segment) =>
      segment.kind === 'serial'
        ? { kind: 'serial', key: 'serial', length: Number(segment.length) || 3, join: segment.join === true }
        : {
            kind: 'dictionary',
            key: segment.key.trim(),
            dictionaryKey: segment.dictionaryKey.trim(),
            length: Number(segment.length) || 2,
            upper: segment.upper !== false,
            join: segment.join === true,
          },
    ),
    separator: values.separator,
    serialLength: Number(values.serialLength) || 3,
    serialScope: values.serialScope,
    enforce: values.enforce,
    isActive: values.isActive !== false,
  }
}

function SegmentRow({
  segment,
  index,
  total,
  onChange,
  onMove,
  onRemove,
  t,
}: {
  segment: SegmentDraft
  index: number
  total: number
  onChange: (next: SegmentDraft) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
  t: TranslateFn
}) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card px-3 py-2">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t('product_codes.form.segment.kind')}</span>
        <Select
          value={segment.kind}
          onValueChange={(value) => onChange({ ...segment, kind: value === 'serial' ? 'serial' : 'dictionary' })}
        >
          <SelectTrigger className="w-32" aria-label={t('product_codes.form.segment.kind')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="dictionary">{t('product_codes.form.segment.dictionary')}</SelectItem>
            <SelectItem value="serial">{t('product_codes.form.segment.serial')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t('product_codes.form.segment.key')}</span>
        <Input
          value={segment.key}
          disabled={segment.kind === 'serial'}
          aria-label={t('product_codes.form.segment.key')}
          onChange={(event) => onChange({ ...segment, key: event.target.value })}
          className="w-32"
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t('product_codes.form.segment.dictionaryKey')}</span>
        <Input
          value={segment.dictionaryKey}
          disabled={segment.kind === 'serial'}
          aria-label={t('product_codes.form.segment.dictionaryKey')}
          placeholder={segment.kind === 'serial' ? '—' : 'product_brand'}
          onChange={(event) => onChange({ ...segment, dictionaryKey: event.target.value })}
          className="w-44"
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t('product_codes.form.segment.length')}</span>
        <Input
          value={String(segment.length)}
          inputMode="numeric"
          aria-label={t('product_codes.form.segment.length')}
          onChange={(event) => onChange({ ...segment, length: Number(event.target.value) || 1 })}
          className="w-20"
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t('product_codes.form.segment.join')}</span>
        <Select value={segment.join ? 'yes' : 'no'} onValueChange={(value) => onChange({ ...segment, join: value === 'yes' })}>
          <SelectTrigger className="w-28" aria-label={t('product_codes.form.segment.join')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="yes">{t('product_codes.form.segment.joinYes')}</SelectItem>
            <SelectItem value="no">{t('product_codes.form.segment.joinNo')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <Button type="button" variant="ghost" size="sm" disabled={index === 0} aria-label={t('product_codes.form.segment.moveUp')} onClick={() => onMove(-1)}>
          ↑
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={index === total - 1} aria-label={t('product_codes.form.segment.moveDown')} onClick={() => onMove(1)}>
          ↓
        </Button>
        <Button type="button" variant="ghost" size="sm" aria-label={t('product_codes.form.segment.remove')} onClick={onRemove}>
          ×
        </Button>
      </div>
    </div>
  )
}

function SegmentsEditor({ values, setValue, t }: CrudFormGroupComponentProps & { t: TranslateFn }) {
  const segments = ((values as CodeRuleValues).segments ?? []) as SegmentDraft[]
  const write = (next: SegmentDraft[]) => setValue('segments', next)
  return (
    <div className="flex flex-col gap-2">
      {segments.map((segment, index) => (
        <SegmentRow
          key={`${segment.kind}-${segment.key}-${index}`}
          segment={segment}
          index={index}
          total={segments.length}
          t={t}
          onChange={(next) => write(segments.map((current, position) => (position === index ? next : current)))}
          onMove={(direction) => {
            const target = index + direction
            if (target < 0 || target >= segments.length) return
            const next = [...segments]
            const [moved] = next.splice(index, 1)
            next.splice(target, 0, moved)
            write(next)
          }}
          onRemove={() => write(segments.filter((_, position) => position !== index))}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={segments.length >= 8}
        onClick={() =>
          write([...segments, { kind: 'dictionary', key: '', dictionaryKey: '', length: 2, upper: true, join: false }])
        }
      >
        {t('product_codes.form.segment.add')}
      </Button>
    </div>
  )
}

/**
 * The rule explained by its own output.
 *
 * It calls the real generator with `dryRun`, so the preview cannot disagree with what 生成 will
 * produce — and it consumes nothing, which is what makes it safe to open a rule and look.
 */
function RulePreviewPanel({ values, t }: { values: CodeRuleValues; t: TranslateFn }) {
  const [brand, setBrand] = React.useState('')
  const [category, setCategory] = React.useState('')
  const [state, setState] = React.useState<{ code?: string; parts?: Array<{ key: string; value: string; label: string | null; known: boolean }>; error?: string; busy?: boolean }>({})

  const preview = async () => {
    setState({ busy: true })
    try {
      const payload = await readApiResultOrThrow<{
        code: string
        parts: Array<{ key: string; value: string; label: string | null; known: boolean }>
      }>('/api/product_codes/generate', {
        method: 'POST',
        body: JSON.stringify({ brandValue: brand.trim(), categoryValue: category.trim() || undefined, dryRun: true }),
      })
      setState({ code: payload.code, parts: payload.parts })
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : t('product_codes.form.preview.failed') })
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          value={brand}
          aria-label={t('product_codes.form.preview.brand')}
          placeholder={t('product_codes.form.preview.brandPlaceholder')}
          onChange={(event) => setBrand(event.target.value)}
          className="w-40"
        />
        <Input
          value={category}
          aria-label={t('product_codes.form.preview.category')}
          placeholder={t('product_codes.form.preview.categoryPlaceholder')}
          onChange={(event) => setCategory(event.target.value)}
          className="w-40"
        />
        <Button type="button" variant="outline" disabled={state.busy === true || brand.trim().length === 0} onClick={() => void preview()}>
          {t('product_codes.form.preview.action')}
        </Button>
      </div>
      {state.busy ? <Spinner /> : null}
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      {state.code ? (
        <div className="flex flex-col gap-1" aria-live="polite">
          <span className="font-mono text-lg">{state.code}</span>
          <span className="text-sm text-muted-foreground">
            {(state.parts ?? [])
              .map((part) => (part.label ? `${part.label}（${part.value}）` : part.value))
              .join(' · ')}
          </span>
        </div>
      ) : null}
    </div>
  )
}

/** How far the rule's counters have run: an issued number is never returned, so gaps are visible. */
function SequencePanel({ ruleId, t }: { ruleId: string; t: TranslateFn }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['product-code-sequences', ruleId],
    queryFn: async () =>
      readApiResultOrThrow<{ scopes: Array<{ brandValue: string; categoryValue: string | null; issued: number; nextSerial: number }> }>(
        `/api/product_codes/sequences?ruleId=${encodeURIComponent(ruleId)}`,
      ),
    enabled: ruleId.length > 0,
  })
  if (isLoading) return <Spinner />
  if (error) return <Alert variant="destructive">{error instanceof Error ? error.message : t('product_codes.form.sequences.failed')}</Alert>
  const scopes = data?.scopes ?? []
  if (scopes.length === 0) return <p className="text-sm text-muted-foreground">{t('product_codes.form.sequences.empty')}</p>
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {scopes.map((scope) => (
        <li key={`${scope.brandValue}-${scope.categoryValue ?? ''}`} className="flex gap-2">
          <span className="font-mono">{`${scope.brandValue}${scope.categoryValue ? ` · ${scope.categoryValue}` : ''}`}</span>
          <span className="text-muted-foreground">
            {t('product_codes.form.sequences.issued', { count: String(scope.issued) })} · {t('product_codes.form.sequences.next', { code: String(scope.nextSerial) })}
          </span>
        </li>
      ))}
    </ul>
  )
}

function RuleFields({
  mode,
  ruleId,
  values,
  t,
}: {
  mode: 'create' | 'edit'
  ruleId?: string
  values: CodeRuleValues
  t: TranslateFn
}) {
  const router = useRouter()
  const fields = React.useMemo<CrudField[]>(
    () => [
      { id: 'name', label: t('product_codes.form.field.name'), type: 'text', required: true, maxLength: 120 },
      {
        id: 'mode',
        label: t('product_codes.form.field.mode'),
        type: 'select',
        options: [
          { value: 'generate', label: t('product_codes.mode.generate') },
          { value: 'carry_over', label: t('product_codes.mode.carry_over') },
        ],
      },
      { id: 'separator', label: t('product_codes.form.field.separator'), type: 'text', maxLength: 1 },
      { id: 'serialLength', label: t('product_codes.form.field.serialLength'), type: 'number' },
      {
        id: 'serialScope',
        label: t('product_codes.form.field.serialScope'),
        type: 'select',
        options: [
          { value: 'brand_category', label: t('product_codes.scope.brand_category') },
          { value: 'brand', label: t('product_codes.scope.brand') },
          { value: 'global', label: t('product_codes.scope.global') },
        ],
      },
      {
        id: 'enforce',
        label: t('product_codes.form.field.enforce'),
        type: 'select',
        options: [
          { value: 'warn', label: t('product_codes.enforce.warn') },
          { value: 'strict', label: t('product_codes.enforce.strict') },
        ],
      },
      { id: 'isActive', label: t('product_codes.form.field.isActive'), type: 'checkbox' },
    ],
    [t],
  )

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      { id: 'identity', title: t('product_codes.form.group.identity'), fields: ['name', 'mode', 'isActive'] },
      { id: 'shape', title: t('product_codes.form.group.shape'), fields: ['separator', 'serialLength', 'serialScope', 'enforce'] },
      {
        id: 'segments',
        title: t('product_codes.form.group.segments'),
        component: (context) => <SegmentsEditor {...context} t={t} />,
      },
      {
        id: 'preview',
        title: t('product_codes.form.group.preview'),
        component: (context) => <RulePreviewPanel values={context.values as CodeRuleValues} t={t} />,
      },
      ...(ruleId
        ? [
            {
              id: 'sequences',
              title: t('product_codes.form.sequences.title'),
              component: () => <SequencePanel ruleId={ruleId} t={t} />,
            } satisfies CrudFormGroup,
          ]
        : []),
    ],
    [ruleId, t],
  )

  return (
    <CrudForm<CodeRuleValues>
      title={mode === 'create' ? t('product_codes.form.createTitle') : t('product_codes.form.editTitle')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      cancelHref={LIST_HREF}
      successRedirect={LIST_HREF}
      fields={fields}
      groups={groups}
      initialValues={values}
      submitLabel={t('product_codes.form.save')}
      onSubmit={async (submitted) => {
        const payload = buildCodeRulePayload(submitted)
        if (mode === 'create') {
          await createCrud(API_PATH, payload)
        } else if (ruleId) {
          await updateCrud(API_PATH, { id: ruleId, ...payload })
        }
        router.push(LIST_HREF)
      }}
    />
  )
}

function CodeRuleEditForm({ ruleId, t }: { ruleId: string; t: TranslateFn }) {
  const [values, setValues] = React.useState<CodeRuleValues | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const payload = await fetchCrudList<Record<string, unknown>>(API_PATH, { ids: ruleId, pageSize: 1 })
        const row = payload.items?.[0]
        if (!cancelled) setValues(row ? toCodeRuleValues(row) : null)
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error && loadError.message ? loadError.message : t('product_codes.form.loadFailed'))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ruleId, t])

  if (error) return <Alert variant="destructive">{error}</Alert>
  if (!values) return <Spinner />
  return <RuleFields mode="edit" ruleId={ruleId} values={values} t={t} />
}

export default function CodeRuleForm({ mode, ruleId }: { mode: 'create' | 'edit'; ruleId?: string }) {
  const t = useT()
  if (mode === 'edit') return ruleId ? <CodeRuleEditForm ruleId={ruleId} t={t} /> : null
  return <RuleFields mode="create" values={EMPTY_VALUES} t={t} />
}
