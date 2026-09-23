"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Book, Plus, Pencil, Trash2 } from 'lucide-react'

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import {
  buildRecordInjectionContext,
  useSetCurrentRecordInjectionContext,
} from '@open-mercato/ui/backend/injection/recordContext'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import { DictionaryEntriesEditor } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntriesEditor'
import {
  DEFAULT_DICTIONARY_ENTRY_SORT_MODE,
  dictionaryEntrySortModes,
  type DictionaryEntrySortMode,
} from '@open-mercato/core/modules/dictionaries/lib/entrySort'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  flattenOrganizationNodes,
  parseDictionaryRows,
  parseOrganizationSwitcherScope,
  type DictionaryLibraryEntry,
  type OrganizationMenuNode,
} from '../lib/dictionariesLibraryApi'

/**
 * App-owned replacement of the installed `/backend/config/dictionaries` page body
 * (`src/modules.ts` → `overrides.routes.pages['/backend/config/dictionaries']`).
 *
 * The installed manager rendered name + key + an 「Inherited」 badge and never said which
 * organization a dictionary belongs to — while this deployment keeps one copy of every shared
 * vocabulary (`currency`, `supplier_product_unit`, `container_type`, …) per organization under
 * identical names. The rule an operator has to see is therefore organization-first:
 *
 * - a concrete organization is selected → only that organization's dictionaries are editable; the
 *   parent organization's vocabulary is listed with its organization name and an 「Inherited」
 *   badge, and the installed entries editor renders read-only for it;
 * - 「所有组织」 is selected → the page is read-only and says why: the dictionary API rejects
 *   POST/PATCH/DELETE without an organization context (`Organization context is required`), so an
 *   enabled control could only fail on save.
 *
 * Everything below the list and the dictionary dialogs is the installed `DictionaryEntriesEditor`,
 * so entry values, labels, appearance, sort mode, default entry, reordering and label translations
 * keep their behavior and stay owned by the installed module. This page owns the list, the scope
 * rules and the dictionary create/edit/delete dialogs.
 */

const DICTIONARIES_API = '/api/dictionaries'
const ORGANIZATION_SWITCHER_API = '/api/directory/organization-switcher'

const logger = createLogger('dictionaries').child({ component: 'DictionariesLibrary' })

type OrganizationGroup = {
  organizationId: string
  label: string
  isCurrent: boolean
  dictionaries: DictionaryLibraryEntry[]
}

type DialogState = { mode: 'create' } | { mode: 'edit'; dictionary: DictionaryLibraryEntry }

type DictionaryFormState = {
  key: string
  name: string
  description: string
  entrySortMode: DictionaryEntrySortMode
}

const EMPTY_FORM: DictionaryFormState = {
  key: '',
  name: '',
  description: '',
  entrySortMode: DEFAULT_DICTIONARY_ENTRY_SORT_MODE,
}

function buildEntrySortOptions(t: TranslateFn): Array<{ value: DictionaryEntrySortMode; label: string }> {
  const labels: Record<DictionaryEntrySortMode, string> = {
    label_asc: t('dictionaries.config.sortModes.labelAsc', 'A to Z'),
    label_desc: t('dictionaries.config.sortModes.labelDesc', 'Z to A'),
    value_asc: t('dictionaries.config.sortModes.valueAsc', 'Value A to Z'),
    value_desc: t('dictionaries.config.sortModes.valueDesc', 'Value Z to A'),
    created_at_asc: t('dictionaries.config.sortModes.createdAtAsc', 'Oldest first'),
    created_at_desc: t('dictionaries.config.sortModes.createdAtDesc', 'Newest first'),
  }
  return dictionaryEntrySortModes.map((mode) => ({ value: mode, label: labels[mode] }))
}

export default function DictionariesLibrary() {
  const t = useT()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'dictionaries:dictionary',
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const [dictionaries, setDictionaries] = React.useState<DictionaryLibraryEntry[]>([])
  const [organizationNodes, setOrganizationNodes] = React.useState<OrganizationMenuNode[]>([])
  const [selectedOrganizationId, setSelectedOrganizationId] = React.useState<string | null>(null)
  const [canViewAllOrganizations, setCanViewAllOrganizations] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [dialog, setDialog] = React.useState<DialogState | null>(null)
  const [form, setForm] = React.useState<DictionaryFormState>(EMPTY_FORM)
  const [formErrors, setFormErrors] = React.useState<{ key?: string; name?: string }>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [deleting, setDeleting] = React.useState<string | null>(null)
  const selectionFromQueryApplied = React.useRef(false)

  const inheritedManageMessage = t(
    'dictionaries.config.error.inheritedManage',
    'Inherited dictionaries must be managed at the parent organization.',
  )
  const selectOrganizationMessage = t(
    'dictionaries.library.scope.selectOrganizationRequired',
    'Select a concrete organization in the top bar first — a dictionary always belongs to exactly one organization.',
  )
  const entrySortOptions = React.useMemo(() => buildEntrySortOptions(t), [t])

  const loadData = React.useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [dictionariesCall, switcherCall] = await Promise.all([
        apiCall<{ items?: unknown[]; error?: string }>(DICTIONARIES_API),
        apiCall<Record<string, unknown>>(ORGANIZATION_SWITCHER_API),
      ])
      if (!dictionariesCall.ok) {
        throw new Error(
          typeof dictionariesCall.result?.error === 'string'
            ? dictionariesCall.result.error
            : 'Failed to load dictionaries',
        )
      }
      const list = parseDictionaryRows(dictionariesCall.result?.items).filter(
        (dictionary) => dictionary.managerVisibility !== 'hidden',
      )
      setDictionaries(list)
      setSelectedId((current) =>
        current && list.some((dictionary) => dictionary.id === current) ? current : (list[0]?.id ?? null),
      )
      if (switcherCall.ok && switcherCall.result) {
        const scope = parseOrganizationSwitcherScope(switcherCall.result)
        setOrganizationNodes(scope.organizations)
        setSelectedOrganizationId(scope.selectedId)
        setCanViewAllOrganizations(scope.canViewAllOrganizations)
      } else {
        // Fail closed: without the switcher payload the page cannot name the organization a write
        // would land in, so every write stays disabled.
        logger.warn('Organization switcher payload unavailable; dictionary writes disabled')
        setOrganizationNodes([])
        setSelectedOrganizationId(null)
        setCanViewAllOrganizations(false)
      }
    } catch (err) {
      logger.error('Failed to load dictionaries', { err })
      setLoadError(t('dictionaries.config.error.load', 'Failed to load dictionaries.'))
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    loadData().catch(() => {})
  }, [loadData, scopeVersion])

  const requestedDictionaryId = searchParams?.get('dictionaryId') ?? null
  const requestedDictionaryKey = searchParams?.get('key')?.trim().toLowerCase() ?? null
  const returnTo = searchParams?.get('returnTo') ?? null

  // Deep links (`?dictionaryId=` / `?key=`) are the two the installed manager honoured; the
  // installed dictionary field editor links here with `?returnTo=` from the form it was opened in.
  // A key can exist once per organization under the same name, so the key form prefers the copy the
  // selected organization owns before falling back to the first match.
  React.useEffect(() => {
    if (selectionFromQueryApplied.current) return
    if (loading) return
    if (!dictionaries.length) return
    if (requestedDictionaryId) {
      const match = dictionaries.find((dictionary) => dictionary.id === requestedDictionaryId)
      if (match) setSelectedId(match.id)
      selectionFromQueryApplied.current = true
      return
    }
    if (!requestedDictionaryKey) return
    const matches = dictionaries.filter(
      (dictionary) => dictionary.key.toLowerCase() === requestedDictionaryKey,
    )
    const match =
      matches.find((dictionary) => dictionary.organizationId === selectedOrganizationId) ?? matches[0]
    if (match) setSelectedId(match.id)
    selectionFromQueryApplied.current = true
  }, [
    dictionaries,
    loading,
    requestedDictionaryId,
    requestedDictionaryKey,
    selectedOrganizationId,
  ])

  const flatOrganizations = React.useMemo(
    () => flattenOrganizationNodes(organizationNodes),
    [organizationNodes],
  )
  const organizationById = React.useMemo(
    () => new Map(flatOrganizations.map((node) => [node.id, node])),
    [flatOrganizations],
  )
  const organizationLabel = React.useCallback(
    (organizationId: string) =>
      organizationById.get(organizationId)?.name ??
      t('dictionaries.library.group.parent', 'Parent organization'),
    [organizationById, t],
  )

  const writesRequireOrganization = selectedOrganizationId === null
  const canWriteDictionary = React.useCallback(
    (dictionary: DictionaryLibraryEntry) =>
      selectedOrganizationId !== null && dictionary.organizationId === selectedOrganizationId,
    [selectedOrganizationId],
  )

  const selectedDictionary = React.useMemo(
    () => dictionaries.find((dictionary) => dictionary.id === selectedId) ?? null,
    [dictionaries, selectedId],
  )
  const selectedDictionaryEditable = selectedDictionary ? canWriteDictionary(selectedDictionary) : false

  // Parity with the installed manager: the enterprise record-locks widget resolves which record the
  // operator has open from this context, keyed on `dictionaries.dictionary` + id.
  useSetCurrentRecordInjectionContext(
    buildRecordInjectionContext({
      resourceKind: 'dictionaries.dictionary',
      resourceId: selectedDictionary?.id ?? null,
      updatedAt: selectedDictionary?.updatedAt ?? null,
      data: (selectedDictionary ?? null) as Record<string, unknown> | null,
      path: pathname,
    }),
  )

  const groups = React.useMemo<OrganizationGroup[]>(() => {
    const term = search.trim().toLowerCase()
    const matching = term.length
      ? dictionaries.filter((dictionary) =>
          `${dictionary.name} ${dictionary.key} ${organizationLabel(dictionary.organizationId)}`
            .toLowerCase()
            .includes(term),
        )
      : dictionaries
    const byOrganization = new Map<string, DictionaryLibraryEntry[]>()
    for (const dictionary of matching) {
      const bucket = byOrganization.get(dictionary.organizationId)
      if (bucket) bucket.push(dictionary)
      else byOrganization.set(dictionary.organizationId, [dictionary])
    }
    const order: string[] = []
    if (selectedOrganizationId && byOrganization.has(selectedOrganizationId)) {
      order.push(selectedOrganizationId)
    }
    for (const node of flatOrganizations) {
      if (node.id !== selectedOrganizationId && byOrganization.has(node.id)) order.push(node.id)
    }
    for (const organizationId of byOrganization.keys()) {
      if (!order.includes(organizationId)) order.push(organizationId)
    }
    return order.map((organizationId) => ({
      organizationId,
      label: organizationLabel(organizationId),
      isCurrent: organizationId === selectedOrganizationId,
      dictionaries: byOrganization.get(organizationId) ?? [],
    }))
  }, [dictionaries, flatOrganizations, organizationLabel, search, selectedOrganizationId])

  const openCreateDialog = React.useCallback(() => {
    if (writesRequireOrganization) {
      flash(selectOrganizationMessage, 'info')
      return
    }
    setForm(EMPTY_FORM)
    setFormErrors({})
    setDialog({ mode: 'create' })
  }, [selectOrganizationMessage, writesRequireOrganization])

  const openEditDialog = React.useCallback(
    (dictionary: DictionaryLibraryEntry) => {
      if (!canWriteDictionary(dictionary)) {
        flash(inheritedManageMessage, 'info')
        return
      }
      setForm({
        key: dictionary.key,
        name: dictionary.name,
        description: dictionary.description ?? '',
        entrySortMode: dictionary.entrySortMode,
      })
      setFormErrors({})
      setDialog({ mode: 'edit', dictionary })
    },
    [canWriteDictionary, inheritedManageMessage],
  )

  const closeDialog = React.useCallback(() => {
    setDialog(null)
    setForm(EMPTY_FORM)
    setFormErrors({})
  }, [])

  const handleSubmit = React.useCallback(async () => {
    if (!dialog) return
    if (dialog.mode === 'edit' && !canWriteDictionary(dialog.dictionary)) {
      flash(inheritedManageMessage, 'info')
      return
    }
    const trimmedKey = form.key.trim()
    const trimmedName = form.name.trim()
    const nextErrors: { key?: string; name?: string } = {}
    if (!trimmedKey) {
      nextErrors.key = t('dictionaries.config.dialog.keyErrorRequired', 'Key is required.')
    } else if (trimmedKey.length > 100) {
      nextErrors.key = t(
        'dictionaries.config.dialog.keyErrorLength',
        'Key must be at most 100 characters long.',
      )
    } else if (!/^[a-z0-9][a-z0-9_-]*$/.test(trimmedKey)) {
      nextErrors.key = t(
        'dictionaries.config.dialog.keyErrorPattern',
        'Use lowercase letters, numbers, hyphen, or underscore.',
      )
    }
    if (!trimmedName) {
      nextErrors.name = t('dictionaries.config.dialog.nameErrorRequired', 'Name is required.')
    }
    if (nextErrors.key || nextErrors.name) {
      setFormErrors(nextErrors)
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        key: trimmedKey,
        name: trimmedName,
        description: form.description.trim() || undefined,
        entrySortMode: form.entrySortMode,
      }
      if (dialog.mode === 'create') {
        await runMutation({
          operation: async () => {
            const call = await apiCall<Record<string, unknown>>(DICTIONARIES_API, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            })
            if (!call.ok) {
              throw Object.assign(
                new Error(
                  typeof call.result?.error === 'string' ? call.result.error : 'Failed to create dictionary',
                ),
                { status: call.status, ...(call.result ?? {}) },
              )
            }
            return call
          },
          context: {
            formId: 'dictionaries:dictionary',
            resourceKind: 'dictionaries.dictionary',
            retryLastMutation,
          },
          mutationPayload: payload,
        })
        flash(t('dictionaries.config.success.create', 'Dictionary created.'), 'success')
      } else {
        const dictionary = dialog.dictionary
        await runMutation({
          operation: () =>
            withScopedApiRequestHeaders(buildOptimisticLockHeader(dictionary.updatedAt), async () => {
              const call = await apiCall<Record<string, unknown>>(`${DICTIONARIES_API}/${dictionary.id}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
              })
              if (!call.ok) {
                throw Object.assign(
                  new Error(
                    typeof call.result?.error === 'string' ? call.result.error : 'Failed to update dictionary',
                  ),
                  { status: call.status, ...(call.result ?? {}) },
                )
              }
              return call
            }),
          context: {
            formId: 'dictionaries:dictionary',
            resourceKind: 'dictionaries.dictionary',
            resourceId: dictionary.id,
            retryLastMutation,
          },
          mutationPayload: payload,
        })
        flash(t('dictionaries.config.success.update', 'Dictionary updated.'), 'success')
      }
      closeDialog()
      await loadData()
    } catch (err) {
      if (surfaceRecordConflict(err, t)) return
      logger.error('Failed to save dictionary', { err })
      flash(t('dictionaries.config.error.save', 'Failed to save dictionary.'), 'error')
    } finally {
      setSubmitting(false)
    }
  }, [
    canWriteDictionary,
    closeDialog,
    dialog,
    form.description,
    form.entrySortMode,
    form.key,
    form.name,
    inheritedManageMessage,
    loadData,
    retryLastMutation,
    runMutation,
    t,
  ])

  const handleDelete = React.useCallback(
    async (dictionary: DictionaryLibraryEntry) => {
      if (!canWriteDictionary(dictionary)) {
        flash(inheritedManageMessage, 'info')
        return
      }
      if (dictionary.isSystem) {
        flash(t('dictionaries.config.error.system', 'System dictionaries cannot be deleted.'), 'error')
        return
      }
      const rawConfirm = t('dictionaries.config.delete.confirm', { name: dictionary.name })
      const confirmTitle =
        rawConfirm && rawConfirm !== 'dictionaries.config.delete.confirm'
          ? rawConfirm
          : `Delete dictionary "${dictionary.name}"?`
      const confirmed = await confirm({ title: confirmTitle, variant: 'destructive' })
      if (!confirmed) return
      setDeleting(dictionary.id)
      try {
        await runMutation({
          operation: () =>
            withScopedApiRequestHeaders(buildOptimisticLockHeader(dictionary.updatedAt), async () => {
              const call = await apiCall<Record<string, unknown>>(`${DICTIONARIES_API}/${dictionary.id}`, {
                method: 'DELETE',
              })
              if (!call.ok) {
                throw Object.assign(
                  new Error(
                    typeof call.result?.error === 'string' ? call.result.error : 'Failed to delete dictionary',
                  ),
                  { status: call.status, ...(call.result ?? {}) },
                )
              }
              return call
            }),
          context: {
            formId: 'dictionaries:dictionary',
            resourceKind: 'dictionaries.dictionary',
            resourceId: dictionary.id,
            retryLastMutation,
          },
          mutationPayload: { id: dictionary.id },
        })
        flash(t('dictionaries.config.success.delete', 'Dictionary deleted.'), 'success')
        await loadData()
      } catch (err) {
        if (surfaceRecordConflict(err, t)) return
        logger.error('Failed to delete dictionary', { err })
        flash(t('dictionaries.config.error.delete', 'Failed to delete dictionary.'), 'error')
      } finally {
        setDeleting(null)
      }
    },
    [canWriteDictionary, confirm, inheritedManageMessage, loadData, retryLastMutation, runMutation, t],
  )

  const renderDictionaryRow = (dictionary: DictionaryLibraryEntry) => {
    const editable = canWriteDictionary(dictionary)
    const isSelected = dictionary.id === selectedId
    const updatedAt = formatDisplayDateTime(dictionary.updatedAt)
    const manageHint = editable ? undefined : inheritedManageMessage
    return (
      <li key={dictionary.id}>
        <div
          role="button"
          tabIndex={0}
          aria-pressed={isSelected}
          className={`flex w-full cursor-pointer select-none items-start justify-between gap-2 rounded border px-3 py-2 text-left text-sm transition ${
            isSelected ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted'
          }`}
          onClick={() => setSelectedId(dictionary.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setSelectedId(dictionary.id)
            }
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 font-medium">
              <span className="truncate">{dictionary.name}</span>
              {dictionary.isInherited && selectedOrganizationId !== null ? (
                <Badge tone="neutral" appearance="stroke" size="sm" title={inheritedManageMessage}>
                  {t('dictionaries.config.list.inherited', 'Inherited')}
                </Badge>
              ) : null}
              {editable ? (
                <Badge tone="info" appearance="lighter" size="sm">
                  {t('dictionaries.library.badge.currentOrganization', 'This organization')}
                </Badge>
              ) : null}
            </div>
            <div className="truncate text-xs text-muted-foreground">{dictionary.key}</div>
            <div className="truncate text-xs text-muted-foreground">
              {organizationLabel(dictionary.organizationId)}
            </div>
            {updatedAt ? (
              <div className="text-xs text-muted-foreground">
                {t('dictionaries.library.row.updatedAt', 'Updated {{date}}', { date: updatedAt })}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t('dictionaries.library.actions.edit', 'Edit dictionary')}
              title={manageHint}
              disabled={!editable}
              onClick={(event) => {
                event.stopPropagation()
                openEditDialog(dictionary)
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t('dictionaries.library.actions.delete', 'Delete dictionary')}
              title={manageHint}
              disabled={!editable || deleting === dictionary.id}
              onClick={(event) => {
                event.stopPropagation()
                handleDelete(dictionary)
              }}
            >
              {deleting === dictionary.id ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </li>
    )
  }

  return (
    <Page>
      <PageBody className="space-y-6">
        {returnTo ? (
          <Button asChild variant="outline" size="sm">
            <Link href={returnTo}>{t('common.back', 'Back')}</Link>
          </Button>
        ) : null}

        {writesRequireOrganization ? (
          <Alert status="information">
            {canViewAllOrganizations
              ? t(
                  'dictionaries.library.scope.allOrganizations',
                  'All organizations are selected, so dictionaries are listed read-only. Pick a concrete organization in the top bar to create or change one — a dictionary always belongs to exactly one organization, and every write has to land in one.',
                )
              : t(
                  'dictionaries.library.scope.noOrganization',
                  'No organization is selected, so dictionaries are read-only. Pick one in the top bar to create or change a dictionary.',
                )}
          </Alert>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t(
              'dictionaries.library.scope.currentOrganization',
              'Current organization: {{name}}. Its dictionaries can be edited; dictionaries from a parent organization are read-only here.',
              { name: organizationLabel(selectedOrganizationId) },
            )}
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="lg:col-span-1" aria-label={t('dictionaries.config.list.title', 'Dictionaries')}>
            <div className="rounded-lg border bg-card p-4 shadow-sm lg:sticky lg:top-16 lg:flex lg:flex-col lg:pane-below-header">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold">
                  {t('dictionaries.config.list.title', 'Dictionaries')}
                </h2>
                <Button
                  type="button"
                  size="sm"
                  onClick={openCreateDialog}
                  disabled={writesRequireOrganization}
                  title={writesRequireOrganization ? selectOrganizationMessage : undefined}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t('dictionaries.config.list.add', 'New dictionary')}
                </Button>
              </div>
              <div className="mt-3 space-y-1">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t(
                    'dictionaries.library.search.placeholder',
                    'Search name, key, or organization',
                  )}
                  aria-label={t(
                    'dictionaries.library.search.placeholder',
                    'Search name, key, or organization',
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  {t('dictionaries.library.list.count', '{{count}} dictionaries', {
                    count: dictionaries.length,
                  })}
                </p>
              </div>
              {/* Only the grouped list scrolls: the header, search and count stay pinned, and the
                  card itself sticks below the backend header on wide screens, so a long dictionary
                  list never stretches the page next to a long entries pane. */}
              <div className="mt-4 max-h-96 space-y-4 overflow-y-auto pr-1 lg:min-h-0 lg:max-h-none lg:flex-1">
                {loading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner className="h-4 w-4" />
                    {t('dictionaries.config.list.loading', 'Loading dictionaries…')}
                  </div>
                ) : loadError ? (
                  <Alert
                    status="error"
                    action={
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => loadData().catch(() => {})}
                      >
                        {t('common.retry', 'Retry')}
                      </Button>
                    }
                  >
                    {loadError}
                  </Alert>
                ) : groups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t(
                      'dictionaries.config.list.empty',
                      'No dictionaries yet. Create one to get started.',
                    )}
                  </p>
                ) : (
                  groups.map((group) => (
                    <div key={group.organizationId} className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {group.label}
                        </h3>
                        {group.isCurrent ? (
                          <Badge tone="info" appearance="lighter" size="sm">
                            {t('dictionaries.library.group.current', 'Current organization')}
                          </Badge>
                        ) : null}
                      </div>
                      <ul className="space-y-1">{group.dictionaries.map(renderDictionaryRow)}</ul>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          <section
            className="lg:col-span-2"
            aria-label={t('dictionaries.config.entries.subtitle', 'Dictionary entries')}
          >
            {selectedDictionary ? (
              <div className="space-y-3">
                <div className="rounded-lg border bg-card p-4 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold">{selectedDictionary.name}</h2>
                    {selectedDictionaryEditable ? null : (
                      <Badge tone="neutral" appearance="stroke" size="sm">
                        {t('dictionaries.config.list.inherited', 'Inherited')}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedDictionary.key} · {organizationLabel(selectedDictionary.organizationId)}
                  </p>
                  {selectedDictionaryEditable ? null : (
                    <div className="mt-3">
                      <Alert status="information">
                        {writesRequireOrganization
                          ? selectOrganizationMessage
                          : t(
                              'dictionaries.config.entries.readOnly',
                              'Inherited dictionaries are managed at the parent organization.',
                            )}
                      </Alert>
                    </div>
                  )}
                </div>
                <DictionaryEntriesEditor
                  dictionaryId={selectedDictionary.id}
                  dictionaryName={selectedDictionary.name}
                  readOnly={!selectedDictionaryEditable}
                />
              </div>
            ) : (
              <EmptyState
                icon={<Book className="h-8 w-8" aria-hidden="true" />}
                title={t(
                  'dictionaries.config.entries.placeholder',
                  'Select a dictionary to manage its entries.',
                )}
                className="h-full"
              />
            )}
          </section>
        </div>
      </PageBody>

      <Dialog open={dialog != null} onOpenChange={(open) => (open ? undefined : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'edit'
                ? t('dictionaries.config.dialog.editTitle', 'Edit dictionary')
                : t('dictionaries.config.dialog.createTitle', 'Create dictionary')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dictionary-library-key">
                {t('dictionaries.config.dialog.keyLabel', 'Key')}
              </Label>
              <Input
                id="dictionary-library-key"
                value={form.key}
                onChange={(event) => {
                  const next = event.target.value
                  setForm((prev) => ({ ...prev, key: next }))
                  if (formErrors.key) setFormErrors((prev) => ({ ...prev, key: undefined }))
                }}
                placeholder={t('dictionaries.config.dialog.keyPlaceholder', 'slug_name')}
                disabled={dialog?.mode === 'edit'}
                aria-invalid={formErrors.key ? 'true' : 'false'}
                aria-describedby="dictionary-library-key-hint"
              />
              <p
                id="dictionary-library-key-hint"
                className={`text-xs ${formErrors.key ? 'text-status-error-text' : 'text-muted-foreground'}`}
              >
                {formErrors.key ??
                  t(
                    'dictionaries.config.dialog.keyHint',
                    'Use lowercase letters, numbers, hyphen, or underscore.',
                  )}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dictionary-library-name">
                {t('dictionaries.config.dialog.nameLabel', 'Name')}
              </Label>
              <Input
                id="dictionary-library-name"
                value={form.name}
                onChange={(event) => {
                  const next = event.target.value
                  setForm((prev) => ({ ...prev, name: next }))
                  if (formErrors.name) setFormErrors((prev) => ({ ...prev, name: undefined }))
                }}
                placeholder={t('dictionaries.config.dialog.namePlaceholder', 'Display name')}
                aria-invalid={formErrors.name ? 'true' : 'false'}
              />
              {formErrors.name ? <p className="text-xs text-status-error-text">{formErrors.name}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="dictionary-library-description">
                {t('dictionaries.config.dialog.descriptionLabel', 'Description')}
              </Label>
              <Textarea
                id="dictionary-library-description"
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder={t(
                  'dictionaries.config.dialog.descriptionPlaceholder',
                  'Explain how this dictionary is used (optional).',
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dictionary-library-sort-mode">
                {t('dictionaries.config.dialog.entrySortModeLabel', 'Entry sort order')}
              </Label>
              <Select
                value={form.entrySortMode}
                onValueChange={(next) =>
                  setForm((prev) => ({
                    ...prev,
                    entrySortMode: dictionaryEntrySortModes.includes(next as DictionaryEntrySortMode)
                      ? (next as DictionaryEntrySortMode)
                      : DEFAULT_DICTIONARY_ENTRY_SORT_MODE,
                  }))
                }
              >
                <SelectTrigger id="dictionary-library-sort-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {entrySortOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t(
                  'dictionaries.config.dialog.entrySortModeHelp',
                  'Controls the order returned by dictionary entry APIs and dropdowns.',
                )}
              </p>
            </div>
            {selectedOrganizationId ? (
              <p className="text-xs text-muted-foreground">
                {t('dictionaries.library.dialog.organization', 'Organization: {{name}}', {
                  name: organizationLabel(selectedOrganizationId),
                })}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeDialog} disabled={submitting}>
              {t('dictionaries.config.dialog.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={() => handleSubmit().catch(() => {})} disabled={submitting}>
              {submitting ? <Spinner className="mr-2 h-4 w-4" /> : null}
              {t('dictionaries.config.dialog.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {ConfirmDialogElement}
    </Page>
  )
}
