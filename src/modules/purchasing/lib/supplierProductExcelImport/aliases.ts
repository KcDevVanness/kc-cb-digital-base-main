/**
 * The header dictionary of the supplier product library's Excel import.
 *
 * One entry per column the library's *create* contract can store (`supplierProductCreateSchema` in
 * `data/validators.ts` is the field list, and its keys are the field names here). A header that
 * matches nothing is not an error: unknown columns are reported as 忽略 and simply not imported, so a
 * supplier's own sheet layout never has to be edited before it can be read.
 *
 * Two match levels, because a supplier sheet says the same thing in several ways: `exact` is the
 * business's canonical label (the wording the standard template and the library form use), `alias` is
 * a recognized synonym. An exact hit always beats an alias on the same cell — `供应商货号` is the
 * canonical label of `itemNo`, so that header must never be read as `supplierSku` merely because a
 * synonym list mentions it.
 *
 * Explicitly **not** in the catalog:
 * - price columns (`供货价` / `单价` …) — a library price row is `(price kind, currency, min quantity)`
 *   and a sheet cell does not say which. They are recognized by `isUnsupportedPriceHeader` so the
 *   mapping table can say "not imported yet" instead of pretending the column is unknown.
 * - `innerPacking` (产品尺寸) — a jsonb `{length,width,height,unit}` needs three numbers, and one cell
 *   cannot be read as a set unambiguously.
 * - `notes` / `status` / `imageAttachmentIds` — operator-owned, never a supplier sheet's columns.
 *
 * The browser mapping table imports this catalog, so the module must stay free of Node-only imports.
 */

export const SUPPLIER_PRODUCT_IMPORT_FIELDS = [
  'supplierSku',
  'itemNo',
  'brandValue',
  'name',
  'nameZh',
  'nameEn',
  'description',
  'declarationElements',
  'unit',
  'hsCode',
  'moqQuantity',
  'cartonQuantity',
  'unitNetWeight',
  'unitGrossWeight',
  'unitVolume',
  'discountPercent',
] as const

export type SupplierProductImportField = (typeof SUPPLIER_PRODUCT_IMPORT_FIELDS)[number]

export type AliasMatchLevel = 'exact' | 'alias'

/** How much a hit is trusted. The mapping table shows it; nothing branches on the number. */
export const CONFIDENCE_BY_MATCH_LEVEL: Record<AliasMatchLevel, number> = {
  exact: 1,
  alias: 0.7,
}

/** A target the operator picked on a header the dictionary does not recognize — believed, but unvouched. */
export const MANUAL_MAPPING_CONFIDENCE = 0.5

export type SupplierProductImportAliasEntry = {
  field: SupplierProductImportField
  /** Canonical labels: what the standard template and the library's own form call the column. */
  exact: readonly string[]
  /** Recognized synonyms, never allowed to override another field's exact label. */
  aliases: readonly string[]
}

/**
 * Field order matters only for ties: when two fields claim the *same* label at the same level the
 * earlier entry wins, so the list is also the tie-break rule.
 */
export const SUPPLIER_PRODUCT_IMPORT_ALIASES: readonly SupplierProductImportAliasEntry[] = [
  {
    // The library's own code for the item — the import's required column. `supplierSku`, not
    // `itemNo`: a supplier sheet's 供应商货号 belongs to the supplier and lands on `itemNo`.
    field: 'supplierSku',
    exact: ['商品 SKU', 'Supplier SKU'],
    aliases: ['SKU', '供应商SKU', '产品SKU', '我方SKU', '自编号', '料号', '供应商产品编码', '商品编号'],
  },
  {
    field: 'itemNo',
    exact: ['供应商货号', 'Supplier Item No'],
    aliases: [
      '货号',
      '产品货号',
      '供应商编号',
      '供应商料号',
      '供应商产品编号',
      '厂号',
      '客户货号',
      '客编',
      'item no',
      'part number',
      'supplier part no',
    ],
  },
  {
    field: 'brandValue',
    exact: ['品牌（编码前缀）', 'Brand'],
    aliases: ['品牌', '品牌名', 'brand name'],
  },
  {
    field: 'name',
    exact: ['品名', 'Product Name'],
    aliases: ['商品名称', '产品名称', '货品名称', '产品名', '名称', '品名（中英）'],
  },
  {
    field: 'nameZh',
    exact: ['品名（中文）', '中文品名'],
    aliases: ['中文名称', '品名中文', '中文名', '品名（中）', '商品中文名'],
  },
  {
    field: 'nameEn',
    exact: ['品名（英文）', '英文品名'],
    aliases: ['英文名称', '品名英文', '英文名', '品名（英）', '商品英文名'],
  },
  {
    field: 'description',
    exact: ['规格描述', 'Description'],
    aliases: ['规格', '描述', '产品描述', '规格型号', '规格说明', '产品说明', '材质规格', 'spec', 'specification'],
  },
  {
    field: 'declarationElements',
    exact: ['申报要素', 'Declaration Elements'],
    aliases: ['报关要素', '海关申报要素', '申报说明', 'declaration'],
  },
  {
    field: 'unit',
    exact: ['单位', 'Unit'],
    aliases: ['计量单位', '基本单位', '包装单位', 'unit of measure', 'uom'],
  },
  {
    field: 'hsCode',
    exact: ['海关编码', 'HS Code'],
    aliases: ['HS编码', 'HS 编码', 'H.S.编码', '税则号', '税则号列', '海关商品编码', '商品编码', '产品编码', 'hs code', 'hscode'],
  },
  {
    field: 'moqQuantity',
    exact: ['最小起订量', 'MOQ'],
    aliases: [
      '起订量',
      '最小订量',
      '最少订量',
      '起订数',
      'moq数量',
      'minimum order',
      'minimum order quantity',
      '最小起定量',
    ],
  },
  {
    field: 'cartonQuantity',
    exact: ['每箱数量', 'Qty per Carton'],
    aliases: ['装箱数', '装箱数量', '装箱量', '每箱装箱数', '每箱装箱量', '每箱件数', '每箱数', '箱规', 'qty/ctn', 'pcs/ctn'],
  },
  {
    field: 'unitNetWeight',
    exact: ['单件净重', 'N.W.'],
    aliases: ['净重', '单重', '单件净重（kg）', '净重（kg）', 'N.W', 'NW', 'unit net weight'],
  },
  {
    field: 'unitGrossWeight',
    exact: ['单件毛重', 'G.W.'],
    aliases: ['毛重', '单件毛重（kg）', '毛重（kg）', 'G.W', 'GW', 'unit gross weight'],
  },
  {
    field: 'unitVolume',
    exact: ['单件体积', 'Unit Volume'],
    aliases: ['体积', '单件体积（cm³）', '体积（cm3）', '单件材积', '材积', 'cbm'],
  },
  {
    field: 'discountPercent',
    exact: ['折扣', 'Discount %'],
    aliases: ['折扣率', '折扣百分比', '折扣（%）', '折率', 'discount', 'discount rate'],
  },
]

/**
 * Headers the business knows and this round deliberately does not import.
 *
 * A price cell is only half of a library price row: the amount needs its price kind and its currency,
 * and the sheet carries neither unambiguously (see the report). Recognizing them keeps the mapping
 * table honest — the operator is told the column is understood but not imported, instead of being
 * shown the generic "unknown" state.
 */
const UNSUPPORTED_PRICE_HEADERS: readonly string[] = [
  '供货价',
  '供货单价',
  '供应价',
  '单价',
  '含税单价',
  '未税单价',
  '不含税单价',
  '单价（元）',
  '人民币单价',
  '含税价',
  '不含税价',
  '采购价',
  '采购单价',
  '报价',
  'unit price',
  'price',
  'cost',
]

/** Characters that carry no meaning in a header label: spacing, punctuation and full-width forms. */
const HEADER_NOISE_PATTERN = /[\s\-_.:：*（）()[\]【】,，、/\\|'"“”‘’#·]/g

/**
 * The comparable form of a header label. NFKC folds full-width characters first (`（` becomes `(`),
 * then spacing and punctuation are dropped, so `Single Price (USD)` and `single price usd` are the same
 * key. Both sides of every comparison run through this, so a catalog label never needs pre-normalizing.
 */
export function normalizeHeaderLabel(value: string): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(HEADER_NOISE_PATTERN, '')
}

export type ImportHeaderMatch = {
  field: SupplierProductImportField
  level: AliasMatchLevel
}

function buildHeaderIndex(): Record<string, ImportHeaderMatch> {
  // A null prototype so a header that happens to be spelled like an `Object` member (`constructor`,
  // `toString`) is an ordinary miss instead of an inherited hit.
  const index = Object.create(null) as Record<string, ImportHeaderMatch>
  const register = (label: string, match: ImportHeaderMatch) => {
    const key = normalizeHeaderLabel(label)
    if (!key) return
    const existing = index[key]
    // An exact hit is never displaced, and an alias never displaces anything — only an exact label
    // may upgrade a key that was claimed by an alias first.
    if (existing && (existing.level === 'exact' || match.level === 'alias')) return
    index[key] = match
  }
  // Aliases first: registering the exact labels afterwards is what makes them win on a shared key.
  for (const entry of SUPPLIER_PRODUCT_IMPORT_ALIASES) {
    for (const alias of entry.aliases) register(alias, { field: entry.field, level: 'alias' })
  }
  for (const entry of SUPPLIER_PRODUCT_IMPORT_ALIASES) {
    for (const label of entry.exact) register(label, { field: entry.field, level: 'exact' })
  }
  return index
}

function buildPriceHeaderIndex(): Record<string, true> {
  const index = Object.create(null) as Record<string, true>
  for (const label of UNSUPPORTED_PRICE_HEADERS) {
    const key = normalizeHeaderLabel(label)
    if (key) index[key] = true
  }
  return index
}

const HEADER_INDEX = buildHeaderIndex()
const PRICE_HEADER_INDEX = buildPriceHeaderIndex()

/** The field a header names, at the level it matched. `null` means "unknown column: ignore it". */
export function matchImportHeader(header: string): ImportHeaderMatch | null {
  const key = normalizeHeaderLabel(header)
  if (!key) return null
  return HEADER_INDEX[key] ?? null
}

/** True for a price column: understood, but not written by this import. */
export function isUnsupportedPriceHeader(header: string): boolean {
  const key = normalizeHeaderLabel(header)
  return key.length > 0 && PRICE_HEADER_INDEX[key] === true
}
