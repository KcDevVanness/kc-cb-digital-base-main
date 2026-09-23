/**
 * The target-field catalog for supplier quotation columns, plus the alias dictionary
 * that maps a supplier's own header text onto it.
 *
 * The alias lists are the product of the two reference files
 * (`PETKIT Quotation Sheet-2026_NEW.xlsx` and `订单表-2026 EXW.xls`) plus the common
 * Chinese and English vocabulary a buyer's price list uses. `kind: 'ignored'` marks a
 * column the wizard should recognize and deliberately not import (images, order
 * quantities, invoice amounts, shipping marks) — an explicit ignore is more honest than
 * an unexplained "unmapped" cell.
 */

export type SourceFieldKey =
  | 'item_no'
  | 'product_name'
  | 'section'
  | 'description'
  | 'hs_code'
  | 'unit'
  | 'unit_cost'
  | 'currency'
  | 'suggested_rsp'
  | 'moq'
  | 'carton_quantity'
  | 'unit_net_weight'
  | 'inner_packing'
  | 'image'
  | 'quantity'
  | 'amount'
  | 'marks'

export type SourceFieldKind = 'text' | 'number' | 'integer' | 'dimensions' | 'ignored'

export type SourceField = {
  key: SourceFieldKey
  labelEn: string
  labelZh: string
  aliases: readonly string[]
  kind: SourceFieldKind
  /** Identity columns decide which row of a two-row header is the real header. */
  identity?: boolean
}

export const SOURCE_FIELDS: readonly SourceField[] = [
  {
    key: 'item_no',
    labelEn: 'Item No. / SKU',
    labelZh: '货号 / SKU',
    kind: 'text',
    identity: true,
    aliases: [
      'item no.',
      'item no',
      'item number',
      'item code',
      'sku',
      'article no.',
      'article number',
      'art. no.',
      'model',
      'model no.',
      'part no.',
      'product code',
      '货号',
      '型号',
      '物料编码',
      '产品编码',
      '商品编码',
      '编号',
    ],
  },
  {
    key: 'product_name',
    labelEn: 'Product name',
    labelZh: '品名',
    kind: 'text',
    identity: true,
    aliases: [
      'item no.& name',
      'item no & name',
      'item no. and name',
      'product name',
      'product',
      'name',
      'description of goods',
      'descriptions of goods and quantities',
      'description of goods and quantities',
      'goods description',
      '品名',
      '产品名称',
      '商品名称',
      '名称',
    ],
  },
  {
    key: 'section',
    labelEn: 'Section / category',
    labelZh: '分类',
    kind: 'text',
    aliases: ['section', 'category', 'product category', 'family', '分类', '类别', '品类'],
  },
  {
    key: 'description',
    labelEn: 'Specification',
    labelZh: '规格描述',
    kind: 'text',
    aliases: [
      'description',
      'spec',
      'specification',
      'specs',
      'remarks',
      'material',
      '规格',
      '描述',
      '产品描述',
      '参数',
      '材质',
    ],
  },
  {
    key: 'hs_code',
    labelEn: 'HS code',
    labelZh: 'HS 编码',
    kind: 'text',
    aliases: ['hs code', 'hscode', 'hs no.', 'commodity code', 'customs code', '海关编码', 'hs编码', '税则号', '商品编码'],
  },
  { key: 'unit', labelEn: 'Unit', labelZh: '单位', kind: 'text', aliases: ['unit', 'uom', 'unit of measure', '单位', '计量单位'] },
  {
    key: 'unit_cost',
    labelEn: 'Unit cost',
    labelZh: '单价',
    kind: 'number',
    aliases: [
      'unit cost',
      'unit price',
      'price',
      'cost',
      'factory price',
      'exw price',
      'fob price',
      '单价',
      '采购价',
      '含税单价',
      '价格',
      '报价',
    ],
  },
  { key: 'currency', labelEn: 'Currency', labelZh: '币种', kind: 'text', aliases: ['currency', 'curr', '币种', '货币'] },
  {
    key: 'suggested_rsp',
    labelEn: 'Suggested RSP',
    labelZh: '建议零售价',
    kind: 'number',
    aliases: ['suggested rsp', 'rsp', 'retail price', 'suggested retail price', 'msrp', 'srp', '建议零售价', '零售价'],
  },
  {
    key: 'moq',
    labelEn: 'MOQ',
    labelZh: '起订量',
    kind: 'integer',
    aliases: ['moq', 'moq pcs', 'moq (pcs)', 'minimum order quantity', 'min order qty', 'min qty', '起订量', '最小起订量', '最小订量'],
  },
  {
    key: 'carton_quantity',
    labelEn: 'Qty per carton',
    labelZh: '装箱数',
    kind: 'integer',
    aliases: [
      'packing qty',
      'packing quantity',
      'qty/box',
      'qty per carton',
      'pcs/ctn',
      'pcs per carton',
      'units per carton',
      '装箱数',
      '每箱数量',
      '每箱',
      '装箱量',
    ],
  },
  {
    key: 'unit_net_weight',
    labelEn: 'Unit net weight (kg)',
    labelZh: '单重 (kg)',
    kind: 'number',
    aliases: ['unit n.w.', 'unit nw', 'unit net weight', 'n.w./pc', 'net weight per unit', '单重', '单品净重', '单位净重'],
  },
  {
    // The app stores this column as the item's own size (`products.dimensions` on promotion), so the
    // target is named 产品尺寸 / "Product size" and the template header spells it the same way; the
    // aliases below keep matching the workbook headers that spell it 内箱尺寸 / Inner Box instead.
    key: 'inner_packing',
    labelEn: 'Product size (cm)',
    labelZh: '产品尺寸 (cm)',
    kind: 'dimensions',
    aliases: ['product size', 'inner packing', 'inner box', 'inner carton', 'inner size', '产品尺寸', '内箱', '内包装', '内箱尺寸'],
  },
  {
    key: 'image',
    labelEn: 'Picture (ignored)',
    labelZh: '图片（忽略）',
    kind: 'ignored',
    aliases: ['picture', 'image', 'photo', 'product image', '图片', '产品图片', '图'],
  },
  {
    key: 'quantity',
    labelEn: 'Order quantity (ignored)',
    labelZh: '数量（忽略）',
    kind: 'ignored',
    aliases: ['quantity', 'qty', 'order qty', '数量', '订购数量'],
  },
  {
    key: 'amount',
    labelEn: 'Amount (ignored)',
    labelZh: '金额（忽略）',
    kind: 'ignored',
    aliases: ['amount', 'total amount', 'total price', '金额', '总价', '小计'],
  },
  {
    key: 'marks',
    labelEn: 'Shipping marks (ignored)',
    labelZh: '唛头（忽略）',
    kind: 'ignored',
    aliases: ['marks &nos', 'marks and nos', 'marks', 'shipping marks', '唛头', '标记'],
  },
]

export const SOURCE_FIELD_BY_KEY: Record<SourceFieldKey, SourceField> = SOURCE_FIELDS.reduce(
  (acc, field) => {
    acc[field.key] = field
    return acc
  },
  {} as Record<SourceFieldKey, SourceField>,
)

/** Target fields that end up on the quotation line (the ignored ones never do). */
export const LINE_FIELD_KEYS: readonly SourceFieldKey[] = SOURCE_FIELDS.filter((field) => field.kind !== 'ignored').map(
  (field) => field.key,
)
