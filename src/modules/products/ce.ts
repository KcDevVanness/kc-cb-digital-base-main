/**
 * Custom fields the business keeps on a product/variant.
 *
 * Declared in code (`entities` with `fields`) and installed by `yarn mercato entities install`
 * (`installCustomEntitiesFromModules` aggregates them into `customFieldSets` and writes
 * `custom_field_defs` rows). The fields land on the **installed** catalog entities — the product
 * store is `catalog` and the app owns no product tables.
 *
 * Values are written through any catalog command payload as `cf_<key>` values, so every write
 * still goes through the official commands (events, audit, index). Keys are snake_case and stable:
 * they are the storage contract the app's read layer (`lib/store.ts`) projects back into the app's
 * own field names.
 */
import type { CustomEntitySpec, CustomFieldDefinition } from '@open-mercato/shared/modules/entities'
import { cf } from '@open-mercato/shared/modules/dsl'

/** Fieldset code: the business fields all sit in one set, so a product form can render them together. */
export const PRODUCT_ERP_FIELDSET = 'product_erp'

const productFields: CustomFieldDefinition[] = [
  // Names and identity the business keeps beside the platform title.
  cf.text('name_en', { label: 'English name', fieldset: PRODUCT_ERP_FIELDSET, formEditable: true, filterable: true }),
  cf.text('brand', { label: 'Brand', fieldset: PRODUCT_ERP_FIELDSET, formEditable: true, filterable: true }),
  cf.text('series', { label: 'Series', fieldset: PRODUCT_ERP_FIELDSET, formEditable: true, filterable: true }),
  cf.text('manufacturer_model', {
    label: 'Model',
    description: 'The model code printed on the contract line (e.g. W5C).',
    fieldset: PRODUCT_ERP_FIELDSET,
    formEditable: true,
    filterable: true,
  }),
  cf.text('spec_summary', {
    label: 'Spec summary',
    description: 'Contract / declaration spec string, e.g. 白色 / 1.5L / 含滤芯.',
    fieldset: PRODUCT_ERP_FIELDSET,
    formEditable: true,
  }),
  cf.text('barcode', { label: 'Barcode', fieldset: PRODUCT_ERP_FIELDSET, formEditable: true, filterable: true }),
  // Packing and unit measurements that purchasing and export declarations read.
  cf.integer('carton_quantity', { label: 'Units per carton', fieldset: PRODUCT_ERP_FIELDSET, formEditable: true }),
  cf.float('unit_net_weight', { label: 'Unit net weight (kg)', fieldset: PRODUCT_ERP_FIELDSET, formEditable: true }),
  cf.float('unit_gross_weight', { label: 'Unit gross weight (kg)', fieldset: PRODUCT_ERP_FIELDSET, formEditable: true }),
  cf.integer('unit_volume', { label: 'Unit volume (cm³)', fieldset: PRODUCT_ERP_FIELDSET, formEditable: true }),
  cf.text('certifications', {
    label: 'Certifications',
    description: 'Comma-separated certification codes/names.',
    fieldset: PRODUCT_ERP_FIELDSET,
    formEditable: true,
  }),
  cf.integer('battery_capacity_mah', {
    label: 'Battery capacity (mAh)',
    fieldset: PRODUCT_ERP_FIELDSET,
    formEditable: true,
  }),
  cf.float('battery_wh', { label: 'Battery energy (Wh)', fieldset: PRODUCT_ERP_FIELDSET, formEditable: true }),
  cf.multiline('notes', { label: 'Notes', fieldset: PRODUCT_ERP_FIELDSET, formEditable: true }),
  // Provenance of a distributed copy (`products.items.distribute`): the catalog product id this
  // row was copied from. Written by the distribution command only.
  cf.text('source_product_id', {
    label: 'Source product',
    description: 'Set on a distributed copy: the catalog product it was copied from.',
    fieldset: PRODUCT_ERP_FIELDSET,
    formEditable: false,
  }),
]

export const entities: CustomEntitySpec[] = [
  {
    id: 'catalog:catalog_product',
    label: 'Product',
    description: 'Business fields the ERP keeps on a catalog product.',
    fields: productFields,
  },
]

export default entities
