/**
 * The variant (SKU) fields the product form renders, in the order it renders them.
 *
 * This is the **only** place that decides which variant columns the form shows. The variants step
 * builds its rows by iterating this list, so a column id can never be written twice and drift — the
 * editor has one renderer per entry (`Record<ProductVariantFormField, …>`), which means adding a
 * field to the list without teaching the editor to draw it, or drawing a field the list does not
 * contain, stops compiling.
 *
 * A field the owner supplies at review (Q-V-001 in `.ai/specs/2026-09-22-product-variants.md`) is
 * therefore a two-file change plus a migration: the column on `ProductsVariant`, the key in
 * `data/validators.ts`, and one entry here. Anything the business has not yet named lives in the
 * variant's `attributes` JSONB instead of earning a column per guess.
 *
 * `id` is deliberately absent: it is identity, not something an operator types.
 */
export const PRODUCT_VARIANT_FORM_FIELDS = ['code', 'name', 'barcode', 'status', 'isDefault'] as const

export type ProductVariantFormField = (typeof PRODUCT_VARIANT_FORM_FIELDS)[number]
