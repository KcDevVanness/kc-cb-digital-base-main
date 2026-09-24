/**
 * The product form's visible shape, as data.
 *
 * The owner's review of the first build was "字段偏多，有些功能点不需要" — but the declaration fields
 * (HS/CN code, origin, per-unit weights, carton quantity, lithium) are exactly what a contract line
 * snapshot and an export declaration read later, so the answer is not to delete them: they move one
 * step away from the everyday fields.
 *
 * This file is the **only** place that decides which group appears on which step. A later field
 * whitelist is a one-file edit here (or in `useProductGroups` for removing a field outright), with
 * no change to `CrudForm`, the commands or the API — the API contract stays the full schema, so a
 * value written by another integration is never rejected for being "not on the form".
 */

export const PRODUCT_FORM_STEPS = ['basics', 'declaration', 'prices', 'variants'] as const

export type ProductFormStep = (typeof PRODUCT_FORM_STEPS)[number]

export const PRODUCT_FORM_STEP_TITLE_KEYS: Record<ProductFormStep, string> = {
  basics: 'products.items.form.step.basics',
  declaration: 'products.items.form.step.declaration',
  prices: 'products.items.form.step.prices',
  variants: 'products.variants.step',
}

/**
 * Group ids (`useProductGroups`) rendered on each step, in order.
 *
 * A step renders **alone**, so every group it lists must be a full-width (`column: 1`) card:
 * `CrudForm` renders any `column: 2` group into a right-hand `3fr` sidebar, and a step whose groups
 * were all sidebar groups would draw its whole content in that narrow rail with the wide column
 * empty beside it. That is why the declaration step's groups no longer carry the sidebar column they
 * had when the form was one long two-column page.
 */
export const PRODUCT_FORM_STEP_GROUPS: Record<ProductFormStep, readonly string[]> = {
  basics: ['details'],
  declaration: [
    'packaging',
    // The single-unit measurement is its own self-titled card (a bare group renders its component
    // without group chrome, so the component draws the card), which is why it is not a field of
    // `packaging`: `CrudForm` renders a group's component *before* its fields, so an inline
    // measurement editor could not sit between scalar fields inside one card.
    'dimensions',
    'carton',
    'battery',
    // The catalog link lives with the declaration data because its only purpose is the logistics
    // half (variant resolution on receipt), not everyday product maintenance.
    'catalogLink',
  ],
  prices: ['prices'],
  // The SKUs come last: they are the operational detail of a product that already exists on paper,
  // and the step is the one place a whole child table is edited.
  variants: ['variants'],
}

/**
 * Columns the product list renders, in order, keyed by the column id the table component declares
 * (`updatedAt` is the screen id; that column is sorted through the API's `updated_at` spelling).
 *
 * Kept beside the form steps so "what this module shows" is one file: a column removed here simply
 * stops being rendered (the export columns are configured separately on the API route, because an
 * export is a data contract rather than a screen).
 */
export const PRODUCT_TABLE_COLUMNS = ['sku', 'name', 'typeId', 'categoryId', 'unit', 'status', 'updatedAt'] as const

export type ProductTableColumn = (typeof PRODUCT_TABLE_COLUMNS)[number]

/**
 * Field id → owning step, used to jump to the step that produced a server-side validation error.
 *
 * `rows` covers the price grid: the prices command reports issues as `rows.<index>.<field>`, and its
 * own bare group is the only thing on that step.
 */
export const PRODUCT_FORM_FIELD_STEPS: Record<string, ProductFormStep> = {
  sku: 'basics',
  name: 'basics',
  nameEn: 'basics',
  brand: 'basics',
  series: 'basics',
  manufacturerModel: 'basics',
  typeId: 'basics',
  categoryId: 'basics',
  specSummary: 'basics',
  barcode: 'basics',
  unit: 'basics',
  status: 'basics',
  notes: 'basics',
  hsCode: 'declaration',
  cnCode: 'declaration',
  countryOfOriginCode: 'declaration',
  netWeight: 'declaration',
  grossWeight: 'declaration',
  dimensions: 'declaration',
  cartonQuantity: 'declaration',
  containsLithiumBattery: 'declaration',
  batteryCapacityMah: 'declaration',
  batteryWh: 'declaration',
  certifications: 'declaration',
  catalogProductId: 'declaration',
  prices: 'prices',
  rows: 'prices',
  // The variants command reports a bad row as `variants.<index>.<field>`; `resolveStepForField`
  // reads the leading segment, so this entry is what makes the form jump to the variants step.
  variants: 'variants',
}

export function resolveStepForField(field: string): ProductFormStep | null {
  const direct = PRODUCT_FORM_FIELD_STEPS[field]
  if (direct) return direct
  // A dotted/bracketed path (`rows.0.unitPrice`) still names its step through its first segment.
  const head = field.split(/[.[]/, 1)[0] ?? field
  return PRODUCT_FORM_FIELD_STEPS[head] ?? null
}

/** Keeps the configured order and drops the groups this step does not own. */
export function groupsForStep<T extends { id: string }>(groups: T[], step: ProductFormStep): T[] {
  const allowed = PRODUCT_FORM_STEP_GROUPS[step]
  return groups.filter((group) => allowed.includes(group.id))
}

/**
 * Marks a field `required` only on the step that owns it.
 *
 * `CrudForm` refuses a submit whose required fields are empty and puts the message on the field —
 * which is right on the step you are looking at and useless from any other step: the field is not
 * rendered there, so the operator gets "请修正标红的字段" with nothing highlighted anywhere. A field
 * owned by another step therefore travels to the API unmarked, the 400 names its path, and the form
 * jumps to that step with the message attached to the field (`revealInvalidStep`). The required
 * markers and the instant client-side check stay exactly where they can be seen; the API remains the
 * authority either way.
 *
 * A field with no declared step (an injected custom field, say) keeps whatever it declared.
 */
export function scopeRequiredToStep<T extends { id: string; required?: boolean }>(
  fields: T[],
  step: ProductFormStep,
): T[] {
  return fields.map((field) => {
    if (!field.required) return field
    const owner = resolveStepForField(field.id)
    return owner !== null && owner !== step ? { ...field, required: false } : field
  })
}

/** First field id mentioned by a server validation failure, so the form can reveal its step. */
export function firstInvalidField(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const body = 'body' in error ? (error.body as unknown) : error
  const details = body && typeof body === 'object' && 'details' in body ? (body as { details?: unknown }).details : null
  if (!Array.isArray(details)) return null
  for (const detail of details) {
    if (!detail || typeof detail !== 'object') continue
    const path = 'path' in detail ? (detail as { path?: unknown }).path : null
    if (Array.isArray(path) && path.length > 0) return String(path[0])
  }
  return null
}

/** First human-readable validation message, so the flash says more than "save failed". */
export function firstValidationMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const body = 'body' in error ? (error.body as unknown) : error
  // Indexing an unknown payload: the object shape was just checked, so this only re-types it.
  const source = body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  const details = source?.details
  if (Array.isArray(details)) {
    for (const detail of details) {
      if (!detail || typeof detail !== 'object') continue
      const message = 'message' in detail ? (detail as { message?: unknown }).message : null
      if (typeof message === 'string' && message.trim().length > 0) return message
    }
  }
  // A rejected command (400/409) carries its reason as `{ error }` instead of a path-tagged detail, so
  // without this fallback a duplicate SKU code would only ever say "could not save".
  if (source) {
    const serverMessage = typeof source.error === 'string' ? source.error.trim() : ''
    if (serverMessage.length > 0 && (source.status === 400 || source.status === 409)) return serverMessage
  }
  return null
}
