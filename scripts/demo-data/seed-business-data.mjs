#!/usr/bin/env node
/**
 * Business-shaped demo data for the cross-border ERP, written through the real HTTP API.
 *
 * Every record goes through the same route/command path the UI uses (validation, server-issued
 * numbers, snapshots, events), so the result behaves like data a buyer typed — not like a fixture
 * inserted behind the app's back. Nothing here touches accounts, roles or passwords.
 *
 *   BASE_URL=https://... TOKEN=<session jwt> ORG=<organization uuid> node seed-business-data.mjs
 *
 * Idempotent by natural key: master data is matched by code/name and skipped when present, documents
 * are matched by their business number or a marker in `notes`, so a second run reports "kept".
 * A manifest of everything created is written to MANIFEST (default /tmp/demo-manifest.json).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
const TOKEN = process.env.TOKEN || ''
const ORG = process.env.ORG || ''
const MANIFEST = process.env.MANIFEST || '/tmp/demo-manifest.json'
const ONLY = new Set((process.env.ONLY || '').split(',').map((value) => value.trim()).filter(Boolean))
const DRY = process.env.DRY === '1'

if (!TOKEN || !ORG) {
  console.error('TOKEN and ORG are required')
  process.exit(2)
}

const cookie = `auth_token=${TOKEN}; om_selected_org=${ORG}`
const manifest = { base: BASE, org: ORG, startedAt: new Date().toISOString(), created: {}, kept: {}, failed: [] }
let calls = 0

const phase = (name) => console.log(`\n=== ${name}`)

async function api(method, path, body) {
  const url = `${BASE}/api/${path.replace(/^\//, '')}`
  const init = { method, headers: { cookie, accept: 'application/json' }, redirect: 'manual' }
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  if (DRY && method !== 'GET') return { status: 200, data: { id: 'dry-run' } }
  calls += 1
  // The public endpoint occasionally resets a fresh connection (Caddy/app restart); retry twice.
  let response
  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await fetch(url, init)
      break
    } catch (error) {
      if (attempt >= 2) throw error
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)))
    }
  }
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text.slice(0, 300) }
  }
  if (!response.ok) {
    const error = new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 300)}`)
    error.status = response.status
    error.data = data
    throw error
  }
  return { status: response.status, data }
}

/** A read that must not abort the run: a failed lookup is reported and treated as "not found". */
const safeList = async (path, params = {}) => {
  try {
    return await list(path, params)
  } catch (error) {
    console.log(`  warn list ${path}: ${String(error.message).slice(0, 140)}`)
    return []
  }
}

const list = async (path, params = {}) => {
  const query = new URLSearchParams({ pageSize: '100', ...params }).toString()
  const { data } = await api('GET', `${path}?${query}`)
  return data?.items ?? []
}

function record(kind, key, id) {
  manifest.created[kind] = manifest.created[kind] || {}
  manifest.created[kind][key] = id
}
function keep(kind, key) {
  manifest.kept[kind] = manifest.kept[kind] || []
  manifest.kept[kind].push(key)
}

/** Run one step; a failure is recorded and reported without aborting the rest of the run. */
async function step(label, fn) {
  try {
    const result = await fn()
    if (result !== undefined) console.log(`  ok   ${label}`)
    return result
  } catch (error) {
    manifest.failed.push({ label, message: String(error.message).slice(0, 400) })
    console.log(`  FAIL ${label}: ${String(error.message).slice(0, 200)}`)
    return null
  }
}

// ---------------------------------------------------------------------------------------------
// The business: a Guangzhou trading company that sources pet goods from Chinese factories and
// sells them to Russia / Southeast Asia, partly through marketplaces.
// ---------------------------------------------------------------------------------------------

const SUPPLIERS = [
  { name: '深圳市小佩科技有限公司', code: 'DEMO-SUP-01', brand: 'PK', contact: '李伟', phone: '+86 755 8888 1234', city: '深圳市南山区科技园北区 3 栋', notes: 'FOB 深圳盐田；智能饮水机与猫砂盆主力工厂。' },
  { name: '东莞市宠物之家实业有限公司', code: 'DEMO-SUP-02', brand: 'DK', contact: '陈静', phone: '+86 769 2233 4455', city: '东莞市长安镇乌沙工业区', notes: '软性用品（航空箱、猫窝、牵引绳）为主。' },
  { name: '宁波超级爪爪宠物用品有限公司', code: 'DEMO-SUP-03', brand: 'SP', contact: '周敏', phone: '+86 574 6688 9900', city: '宁波市鄞州区姜山镇工业园', notes: '猫砂与清洁用品，整柜出货。' },
  { name: '佛山市南海区洁宠猫砂厂', code: 'DEMO-SUP-04', brand: 'SP', contact: '梁国华', phone: '+86 757 8899 1122', city: '佛山市南海区狮山镇', notes: '豆腐砂、膨润土砂；OEM 起订 2 吨。' },
  { name: '中山市爱宠电器有限公司', code: 'DEMO-SUP-05', brand: 'DK', contact: '黄俊', phone: '+86 760 3322 7788', city: '中山市小榄镇工业大道', notes: '喂食器、饮水机小家电，含锂电池需 UN38.3。' },
  { name: '义乌市萌宠日用品有限公司', code: 'DEMO-SUP-06', brand: 'SP', contact: '吴倩', phone: '+86 579 5566 3344', city: '义乌市北苑街道', notes: '配件类小商品，散货拼柜。' },
  { name: '苏州斯玛特宠物科技有限公司', code: 'DEMO-SUP-07', brand: 'PK', contact: '张磊', phone: '+86 512 6677 8899', city: '苏州市工业园区星湖街', notes: '智能猫砂盆整机，木架包装。' },
  { name: '广州市天宠贸易有限公司', code: 'DEMO-SUP-08', brand: 'DK', contact: '林晓东', phone: '+86 20 8388 7766', city: '广州市白云区嘉禾望岗', notes: '本地贸易商，可做小批量补货。' },
]

/** Library rows: { supplier code, brand, category, name/nameZh/nameEn, unit, moq, carton, nw, gw, volume, hs, cost CNY, cost USD, discount } */
const SUPPLIER_PRODUCTS = [
  { sup: 'DEMO-SUP-01', brand: 'PK', category: 'CB', name: '智能无线饮水机 W5C', nameEn: 'Wireless Smart Water Fountain W5C', unit: 'PCS', moq: 500, carton: 6, nw: '1.2800', gw: '1.9000', volume: 88642, hs: '8421219090', costCny: '186.000000', costUsd: '25.900000', discount: 3 },
  { sup: 'DEMO-SUP-01', brand: 'PK', category: 'CB', name: '智能饮水机 Eversweet 3 Pro', nameEn: 'Eversweet 3 Pro Wireless Pump', unit: 'PCS', moq: 300, carton: 8, nw: '1.2500', gw: '1.4800', volume: 74250, hs: '8421219090', costCny: '168.000000', costUsd: '23.500000', discount: 5 },
  { sup: 'DEMO-SUP-01', brand: 'PK', category: 'CB', name: '智能饮水机 Eversweet SOLO 2', nameEn: 'Eversweet SOLO 2', unit: 'PCS', moq: 500, carton: 8, nw: '1.1000', gw: '1.3200', volume: 68200, hs: '8421219090', costCny: '132.000000', costUsd: '18.400000', discount: 0 },
  { sup: 'DEMO-SUP-01', brand: 'PK', category: 'CB', name: '无线饮水机滤芯（5 片装）', nameEn: 'Replacement Filter (5-pack)', unit: 'BOX', moq: 1000, carton: 24, nw: '0.1800', gw: '0.2400', volume: 1800, hs: '8421999090', costCny: '18.500000', costUsd: '2.600000', discount: 0 },
  { sup: 'DEMO-SUP-07', brand: 'PK', category: 'LB', name: '智能全自动猫砂盆 PURA MAX', nameEn: 'Self-Cleaning Litter Box PURA MAX', unit: 'SET', moq: 200, carton: 1, nw: '12.5000', gw: '14.2000', volume: 194184, hs: '8479899990', costCny: '1080.000000', costUsd: '150.000000', discount: 4 },
  { sup: 'DEMO-SUP-07', brand: 'PK', category: 'LB', name: '智能全自动猫砂盆 PURA X', nameEn: 'Self-Cleaning Litter Box PURA X', unit: 'SET', moq: 200, carton: 1, nw: '11.2000', gw: '12.8000', volume: 172800, hs: '8479899990', costCny: '960.000000', costUsd: '133.500000', discount: 0 },
  { sup: 'DEMO-SUP-07', brand: 'PK', category: 'LB', name: '猫砂盆专用除臭液', nameEn: 'Litter Box Deodorizer', unit: 'PCS', moq: 2000, carton: 24, nw: '0.5200', gw: '0.6000', volume: 900, hs: '3307490000', costCny: '12.800000', costUsd: '1.800000', discount: 0 },
  { sup: 'DEMO-SUP-04', brand: 'SP', category: 'CL', name: '豆腐猫砂 2.0mm（原味）', nameEn: 'Tofu Cat Litter 2.0mm Original', unit: 'BAG', moq: 2000, carton: 4, nw: '6.0000', gw: '6.4000', volume: 15600, hs: '3824999999', costCny: '24.500000', costUsd: '3.400000', discount: 6 },
  { sup: 'DEMO-SUP-04', brand: 'SP', category: 'CL', name: '豆腐猫砂 1.5mm（绿茶味）', nameEn: 'Tofu Cat Litter 1.5mm Green Tea', unit: 'BAG', moq: 2000, carton: 4, nw: '6.0000', gw: '6.4000', volume: 15600, hs: '3824999999', costCny: '26.000000', costUsd: '3.600000', discount: 0 },
  { sup: 'DEMO-SUP-04', brand: 'SP', category: 'CL', name: '膨润土结团猫砂 10L', nameEn: 'Bentonite Clumping Cat Litter 10L', unit: 'BAG', moq: 1500, carton: 4, nw: '10.0000', gw: '10.4000', volume: 12000, hs: '3824999999', costCny: '26.500000', costUsd: '3.700000', discount: 0 },
  { sup: 'DEMO-SUP-03', brand: 'SP', category: 'CL', name: '混合猫砂（豆腐+膨润土）', nameEn: 'Mixed Cat Litter Tofu + Bentonite', unit: 'BAG', moq: 2000, carton: 4, nw: '7.2000', gw: '7.6000', volume: 16800, hs: '3824999999', costCny: '28.800000', costUsd: '4.000000', discount: 5 },
  { sup: 'DEMO-SUP-03', brand: 'SP', category: 'CL', name: '活性炭除臭豆腐砂 2.0mm', nameEn: 'Activated Carbon Tofu Litter 2.0mm', unit: 'BAG', moq: 2000, carton: 4, nw: '6.2000', gw: '6.6000', volume: 15800, hs: '3824999999', costCny: '29.500000', costUsd: '4.100000', discount: 0 },
  { sup: 'DEMO-SUP-03', brand: 'SP', category: 'LS', name: '不锈钢猫砂铲（长柄）', nameEn: 'Stainless Steel Litter Scoop Long Handle', unit: 'PCS', moq: 1000, carton: 24, nw: '0.3200', gw: '0.4000', volume: 4200, hs: '8215990000', costCny: '15.600000', costUsd: '2.200000', discount: 0 },
  { sup: 'DEMO-SUP-06', brand: 'SP', category: 'LS', name: '自清洁猫砂铲（带底座）', nameEn: 'Self-Cleaning Litter Scoop with Base', unit: 'SET', moq: 800, carton: 12, nw: '0.4800', gw: '0.6000', volume: 6800, hs: '8215990000', costCny: '22.400000', costUsd: '3.150000', discount: 0 },
  { sup: 'DEMO-SUP-05', brand: 'DK', category: 'FD', name: '智能喂食器 FRESH ELEMENT', nameEn: 'Smart Pet Feeder FRESH ELEMENT', unit: 'PCS', moq: 300, carton: 4, nw: '2.4000', gw: '2.9000', volume: 96000, hs: '8509809000', costCny: '268.000000', costUsd: '37.200000', discount: 4 },
  { sup: 'DEMO-SUP-05', brand: 'DK', category: 'FD', name: '双碗倾斜喂食器', nameEn: 'Tilted Double Bowl Feeder', unit: 'PCS', moq: 1000, carton: 12, nw: '0.7600', gw: '0.9200', volume: 12600, hs: '3924900000', costCny: '32.500000', costUsd: '4.550000', discount: 0 },
  { sup: 'DEMO-SUP-05', brand: 'DK', category: 'FD', name: '宠物饮水机 UV 杀菌款', nameEn: 'Pet Fountain with UV Sterilization', unit: 'PCS', moq: 500, carton: 6, nw: '1.3500', gw: '1.6000', volume: 90000, hs: '8421219090', costCny: '198.000000', costUsd: '27.500000', discount: 0 },
  { sup: 'DEMO-SUP-02', brand: 'DK', category: 'AC', name: '宠物航空箱 M 号', nameEn: 'Airline Pet Carrier M', unit: 'PCS', moq: 500, carton: 4, nw: '1.8000', gw: '2.1000', volume: 45000, hs: '4202920000', costCny: '76.000000', costUsd: '10.600000', discount: 3 },
  { sup: 'DEMO-SUP-02', brand: 'DK', category: 'AC', name: '宠物航空箱 L 号', nameEn: 'Airline Pet Carrier L', unit: 'PCS', moq: 300, carton: 2, nw: '2.6000', gw: '3.0000', volume: 78000, hs: '4202920000', costCny: '98.000000', costUsd: '13.700000', discount: 0 },
  { sup: 'DEMO-SUP-02', brand: 'DK', category: 'AC', name: '四季通用猫窝（可拆洗）', nameEn: 'Washable Pet Bed', unit: 'PCS', moq: 800, carton: 8, nw: '0.9000', gw: '1.1000', volume: 32000, hs: '9404909000', costCny: '45.000000', costUsd: '6.300000', discount: 0 },
  { sup: 'DEMO-SUP-02', brand: 'DK', category: 'AC', name: '反光牵引绳 1.5m', nameEn: 'Reflective Leash 1.5m', unit: 'PCS', moq: 2000, carton: 40, nw: '0.1600', gw: '0.2200', volume: 1200, hs: '4201000090', costCny: '9.800000', costUsd: '1.380000', discount: 0 },
  { sup: 'DEMO-SUP-06', brand: 'SP', category: 'AC', name: '猫抓板（瓦楞纸双层）', nameEn: 'Corrugated Cat Scratcher Double Layer', unit: 'PCS', moq: 1000, carton: 10, nw: '0.8500', gw: '1.0500', volume: 24000, hs: '4823909000', costCny: '18.900000', costUsd: '2.650000', discount: 0 },
  { sup: 'DEMO-SUP-06', brand: 'SP', category: 'AC', name: '陶瓷高脚宠物碗', nameEn: 'Ceramic Raised Pet Bowl', unit: 'PCS', moq: 1200, carton: 12, nw: '0.5600', gw: '0.7000', volume: 8800, hs: '6912009000', costCny: '21.500000', costUsd: '3.000000', discount: 0 },
  { sup: 'DEMO-SUP-08', brand: 'DK', category: 'AC', name: '宠物外出背包（透气款）', nameEn: 'Ventilated Pet Backpack', unit: 'PCS', moq: 600, carton: 6, nw: '1.2000', gw: '1.4500', volume: 42000, hs: '4202920000', costCny: '62.000000', costUsd: '8.700000', discount: 0 },
  { sup: 'DEMO-SUP-08', brand: 'DK', category: 'AC', name: '硅胶折叠水碗', nameEn: 'Collapsible Silicone Bowl', unit: 'PCS', moq: 3000, carton: 60, nw: '0.0900', gw: '0.1300', volume: 800, hs: '3924900000', costCny: '6.400000', costUsd: '0.900000', discount: 0 },
]

const PARTIES = [
  { code: 'DEMO-BUY-RU-01', name: 'ООО «ПетМаркет»', country: 'RU', city: 'Москва', roles: ['buyer', 'consignee'], contact: 'Ivan Petrov', phone: '+7 495 123 4567', email: 'sales@petmarket.example', bank: { beneficiaryBank: 'АО «Альфа-Банк»', accountNumber: '40817810099910004312', swiftCode: 'ALFARUMM', bankAddress: 'Москва, ул. Каланчёвская, 27' } },
  { code: 'DEMO-BUY-RU-02', name: 'ООО «ЗооТрейд»', country: 'RU', city: 'Санкт-Петербург', roles: ['buyer'], contact: 'Elena Smirnova', phone: '+7 812 445 8899', email: 'buy@zootrade.example', bank: { beneficiaryBank: 'ПАО Сбербанк', accountNumber: '40702810655000012345', swiftCode: 'SABRRUMM' } },
  { code: 'DEMO-BUY-SG-01', name: 'PetJoy Trading Pte. Ltd.', country: 'SG', city: 'Singapore', roles: ['buyer'], contact: 'Daniel Lim', phone: '+65 6221 8899', email: 'daniel.lim@petjoy.example', bank: { beneficiaryBank: 'DBS Bank Ltd', accountNumber: '0721234567', swiftCode: 'DBSSSGSG' } },
  { code: 'DEMO-FWD-CN-01', name: '深圳市远洋国际货运代理有限公司', country: 'CN', city: '深圳市盐田区', roles: ['forwarder'], contact: '王明', phone: '+86 138 0000 1111', email: 'ops@yuanyang-forwarding.example' },
  { code: 'DEMO-BRK-CN-01', name: '宁波中远报关有限公司', country: 'CN', city: '宁波市北仑区', roles: ['broker'], contact: '赵磊', phone: '+86 574 8123 4567', email: 'customs@nbcustoms.example' },
  { code: 'DEMO-BNK-CN-01', name: '中国银行股份有限公司深圳分行', country: 'CN', city: '深圳市福田区', roles: ['bank'], contact: '客户经理 周涛', phone: '+86 755 2233 6677', email: 'trade@boc-sz.example' },
  { code: 'DEMO-CERT-CN-01', name: 'SGS 通标标准技术服务有限公司', country: 'CN', city: '广州市黄埔区', roles: ['certifier'], contact: '刘芳', phone: '+86 20 8215 5000', email: 'cert.guangzhou@sgs.example' },
]

/** Quotations: { supplier, currency, lines: [{ product: <library name>, cost, moq }] } */
const QUOTES = [
  { sup: 'DEMO-SUP-01', currency: 'CNY', date: '2026-09-08', validUntil: '2026-10-08', notes: 'Q4 补水机补货报价，30 天有效。', items: [
    { product: '智能无线饮水机 W5C', cost: '186.000000', moq: 500, section: 'DRINKING' },
    { product: '智能饮水机 Eversweet 3 Pro', cost: '168.000000', moq: 300, section: 'DRINKING' },
    { product: '无线饮水机滤芯（5 片装）', cost: '18.500000', moq: 1000, section: 'DRINKING' },
  ] },
  { sup: 'DEMO-SUP-04', currency: 'CNY', date: '2026-09-10', validUntil: '2026-10-10', notes: '猫砂整柜价，含木托盘。', items: [
    { product: '豆腐猫砂 2.0mm（原味）', cost: '24.500000', moq: 2000, section: 'CLEANING' },
    { product: '膨润土结团猫砂 10L', cost: '26.500000', moq: 1500, section: 'CLEANING' },
    { product: '豆腐猫砂 1.5mm（绿茶味）', cost: '26.000000', moq: 2000, section: 'CLEANING' },
  ] },
  { sup: 'DEMO-SUP-07', currency: 'USD', date: '2026-09-12', validUntil: '2026-10-12', notes: '整机 USD 报价，木架包装另计 8 USD/台。', items: [
    { product: '智能全自动猫砂盆 PURA MAX', cost: '150.000000', moq: 200, section: 'CLEANING' },
    { product: '智能全自动猫砂盆 PURA X', cost: '133.500000', moq: 200, section: 'CLEANING' },
  ] },
  { sup: 'DEMO-SUP-05', currency: 'CNY', date: '2026-09-15', validUntil: '2026-10-15', notes: '喂食器与 UV 款饮水机报价。', items: [
    { product: '智能喂食器 FRESH ELEMENT', cost: '268.000000', moq: 300, section: 'FEEDING' },
    { product: '宠物饮水机 UV 杀菌款', cost: '198.000000', moq: 500, section: 'FEEDING' },
    { product: '双碗倾斜喂食器', cost: '32.500000', moq: 1000, section: 'FEEDING' },
  ] },
]

const PURCHASE_ORDERS = [
  { sup: 'DEMO-SUP-01', currency: 'CNY', category: 'pet_supplies', business: 'PI-2026-0912', deposit: 30, items: [ { product: '智能无线饮水机 W5C', qty: 1200, price: '186.000000' }, { product: '智能饮水机 Eversweet 3 Pro', qty: 800, price: '168.000000' } ], notes: 'Q4 首批；30% 定金，发货前付尾款。' },
  { sup: 'DEMO-SUP-01', currency: 'CNY', category: 'pet_supplies', business: 'PI-2026-0918', deposit: 30, items: [ { product: '智能饮水机 Eversweet SOLO 2', qty: 1500, price: '132.000000' }, { product: '无线饮水机滤芯（5 片装）', qty: 6000, price: '18.500000' } ], notes: '配合滤芯补货。' },
  { sup: 'DEMO-SUP-04', currency: 'CNY', category: 'cat_litter', business: 'PI-2026-0914', deposit: 50, items: [ { product: '豆腐猫砂 2.0mm（原味）', qty: 8000, price: '24.500000' }, { product: '豆腐猫砂 1.5mm（绿茶味）', qty: 4000, price: '26.000000' } ], notes: '整柜 40HQ，深圳盐田出。' },
  { sup: 'DEMO-SUP-03', currency: 'CNY', category: 'cat_litter', business: 'PI-2026-0920', deposit: 50, items: [ { product: '混合猫砂（豆腐+膨润土）', qty: 6000, price: '28.800000' }, { product: '活性炭除臭豆腐砂 2.0mm', qty: 4000, price: '29.500000' } ], notes: '宁波出运，拼柜。' },
  { sup: 'DEMO-SUP-07', currency: 'USD', category: 'litter_box', business: 'PI-2026-0916', deposit: 40, items: [ { product: '智能全自动猫砂盆 PURA MAX', qty: 400, price: '150.000000' }, { product: '智能全自动猫砂盆 PURA X', qty: 300, price: '133.500000' } ], notes: '木架包装，按 USD 结算。' },
  { sup: 'DEMO-SUP-05', currency: 'CNY', category: 'pet_supplies', business: 'PI-2026-0922', deposit: 30, items: [ { product: '智能喂食器 FRESH ELEMENT', qty: 600, price: '268.000000' }, { product: '双碗倾斜喂食器', qty: 3000, price: '32.500000' } ], notes: '含锂电池，需 UN38.3 报告。' },
  { sup: 'DEMO-SUP-02', currency: 'CNY', category: 'pet_supplies', business: 'PI-2026-0924', deposit: 0, items: [ { product: '宠物航空箱 M 号', qty: 1000, price: '76.000000' }, { product: '宠物航空箱 L 号', qty: 500, price: '98.000000' }, { product: '四季通用猫窝（可拆洗）', qty: 1500, price: '45.000000' } ], notes: '100% 预付，散货拼柜。' },
  { sup: 'DEMO-SUP-06', currency: 'CNY', category: 'pet_supplies', business: 'PI-2026-0926', deposit: 0, items: [ { product: '自清洁猫砂铲（带底座）', qty: 2000, price: '22.400000' }, { product: '猫抓板（瓦楞纸双层）', qty: 3000, price: '18.900000' }, { product: '陶瓷高脚宠物碗', qty: 3000, price: '21.500000' } ], notes: '小商品整柜，义乌集货。' },
  { sup: 'DEMO-SUP-08', currency: 'CNY', category: 'pet_supplies', business: 'PI-2026-0928', deposit: 30, items: [ { product: '宠物外出背包（透气款）', qty: 1200, price: '62.000000' }, { product: '硅胶折叠水碗', qty: 6000, price: '6.400000' } ], notes: '广州仓自提，30% 定金。' },
  { sup: 'DEMO-SUP-03', currency: 'CNY', category: 'cat_litter', business: 'PI-2026-0930', deposit: 50, items: [ { product: '不锈钢猫砂铲（长柄）', qty: 2000, price: '15.600000' } ], notes: '补货单。' },
  { sup: 'DEMO-SUP-05', currency: 'CNY', category: 'pet_supplies', business: 'PI-2026-1002', deposit: 30, items: [ { product: '宠物饮水机 UV 杀菌款', qty: 800, price: '198.000000' } ], notes: 'UV 款首发试单。' },
  { sup: 'DEMO-SUP-02', currency: 'CNY', category: 'pet_supplies', business: 'PI-2026-1004', deposit: 0, items: [ { product: '反光牵引绳 1.5m', qty: 5000, price: '9.800000' }, { product: '宠物航空箱 L 号', qty: 800, price: '98.000000' } ], notes: '配件补货。' },
  // The four below carry the shipments: their lines are created after the catalog links exist.
  { sup: 'DEMO-SUP-01', currency: 'CNY', category: 'pet_supplies', business: 'PI-2026-1010', deposit: 30, items: [ { product: '智能无线饮水机 W5C', qty: 600, price: '186.000000' }, { product: '智能饮水机 Eversweet 3 Pro', qty: 400, price: '168.000000' } ], notes: '发运批次一：饮水机，深圳盐田出。' },
  { sup: 'DEMO-SUP-04', currency: 'CNY', category: 'cat_litter', business: 'PI-2026-1011', deposit: 50, items: [ { product: '豆腐猫砂 2.0mm（原味）', qty: 4000, price: '24.500000' }, { product: '膨润土结团猫砂 10L', qty: 3000, price: '26.500000' } ], notes: '发运批次二：猫砂整柜。' },
  { sup: 'DEMO-SUP-07', currency: 'USD', category: 'litter_box', business: 'PI-2026-1012', deposit: 40, items: [ { product: '智能全自动猫砂盆 PURA MAX', qty: 200, price: '150.000000' } ], notes: '发运批次三：猫砂盆。' },
  { sup: 'DEMO-SUP-03', currency: 'CNY', category: 'cat_litter', business: 'PI-2026-1013', deposit: 50, items: [ { product: '混合猫砂（豆腐+膨润土）', qty: 3000, price: '28.800000' }, { product: '不锈钢猫砂铲（长柄）', qty: 2000, price: '15.600000' } ], notes: '发运批次四：混合猫砂与铲子。' },
  { sup: 'DEMO-SUP-06', currency: 'CNY', category: 'pet_supplies', business: 'PI-2026-1014', deposit: 0, items: [ { product: '猫抓板（瓦楞纸双层）', qty: 3000, price: '18.900000' }, { product: '自清洁猫砂铲（带底座）', qty: 1200, price: '22.400000' } ], notes: '发运批次五：配件拼车（卡派）。' },
]

const SHIPMENTS = [
  { carrier: '中远海运', forwarder: '王明 / +86 138 0000 1111', port: '深圳盐田', containerType: '40HQ', container: 'CSNU7654321', seal: 'SL-0098231', booking: 'COSU6399841720', etd: '2026-09-29', eta: '2026-10-19', notes: '拼柜：饮水机 + 滤芯两张采购单共用一个 40HQ。', orders: ['PI-2026-1010'], milestones: ['export_customs', 'in_transit'] },
  { carrier: '马士基', forwarder: '陈曦 / +86 139 0000 2222', port: '深圳蛇口', containerType: '40HQ*2', container: 'MSKU1234567', seal: 'SL-0098312', booking: 'MAEU5511234000', etd: '2026-10-02', eta: '2026-10-24', notes: '猫砂整柜，两个 40HQ。', orders: ['PI-2026-1011'], milestones: ['export_customs', 'in_transit', 'arrived'] },
  { carrier: '东方海外', forwarder: '李娜 / +86 137 0000 3333', port: '宁波', containerType: '20GP+40HQ', container: 'OOLU9988776', seal: 'SL-0098444', booking: 'OOCL7788990011', etd: '2026-10-05', eta: '2026-10-27', notes: '宁波拼柜，猫砂 + 猫砂铲。', orders: ['PI-2026-1013'], milestones: [] },
  { carrier: '地中海航运', forwarder: '张伟 / +86 136 0000 4444', port: '广州南沙', containerType: '40HQ', container: 'MSCU4455667', seal: 'SL-0098555', booking: 'MEDU3344556677', etd: '2026-10-08', eta: '2026-10-31', notes: '猫砂盆整机，木架包装。', orders: ['PI-2026-1012'], milestones: [] },
  { carrier: '顺丰', forwarder: '刘洋 / +86 135 0000 5555', port: '深圳盐田', containerType: 'GUANGZHOU_LOGISTICS_KAPRO', container: null, seal: null, booking: 'SF-KAPRO-20261010', etd: '2026-10-10', eta: '2026-10-16', notes: '广州物流拼车（卡派），配件类小商品。', orders: ['PI-2026-1014'], milestones: [] },
]

const CONTRACTS = [
  { direction: 'purchase', sup: 'DEMO-SUP-01', currency: 'CNY', terms: '30% 定金 + 70% 发货前付清', method: '海运', destination: '深圳盐田', delivery: '2026-11-15', marks: 'KC/26Q4/01', items: [ { product: '智能无线饮水机 W5C', qty: '1200', price: '186.000000' }, { product: '智能饮水机 Eversweet 3 Pro', qty: '800', price: '168.000000' } ] },
  { direction: 'purchase', sup: 'DEMO-SUP-04', currency: 'CNY', terms: '50% 定金 + 50% 见提单副本付款', method: '海运', destination: '深圳盐田', delivery: '2026-11-20', marks: 'KC/26Q4/02', items: [ { product: '豆腐猫砂 2.0mm（原味）', qty: '8000', price: '24.500000' }, { product: '豆腐猫砂 1.5mm（绿茶味）', qty: '4000', price: '26.000000' } ] },
  { direction: 'purchase', sup: 'DEMO-SUP-07', currency: 'USD', terms: '40% 定金 + 60% 发货前付清', method: '海运', destination: '广州南沙', delivery: '2026-11-25', marks: 'KC/26Q4/03', items: [ { product: '智能全自动猫砂盆 PURA MAX', qty: '400', price: '150.000000' }, { product: '智能全自动猫砂盆 PURA X', qty: '300', price: '133.500000' } ] },
  { direction: 'sales', buyer: 'DEMO-BUY-RU-01', currency: 'USD', terms: '30% 定金 + 70% 见提单副本付款', method: '海运', destination: '东方港', delivery: '2026-11-30', marks: 'RU/26Q4/01', items: [ { product: '智能无线饮水机 W5C', qty: '600', price: '32.900000' }, { product: '智能饮水机 Eversweet 3 Pro', qty: '400', price: '29.500000' } ] },
  { direction: 'sales', buyer: 'DEMO-BUY-RU-01', currency: 'USD', terms: '60 天账期', method: '海运', destination: '圣彼得堡', delivery: '2026-12-05', marks: 'RU/26Q4/02', items: [ { product: '豆腐猫砂 2.0mm（原味）', qty: '4000', price: '5.400000' }, { product: '膨润土结团猫砂 10L', qty: '3000', price: '5.900000' } ] },
  { direction: 'sales', buyer: 'DEMO-BUY-SG-01', currency: 'USD', terms: '即期信用证 (L/C at sight)', method: '海运', destination: '新加坡', delivery: '2026-12-10', marks: 'SG/26Q4/01', items: [ { product: '智能全自动猫砂盆 PURA MAX', qty: '150', price: '215.000000' }, { product: '智能喂食器 FRESH ELEMENT', qty: '200', price: '79.000000' } ] },
]

const CHANNELS = [
  { name: 'Amazon US', code: 'DEMO-AMZ-US', platform: 'amazon', currency: 'USD', external: 'A2X9K4M7Q1DEMO', notes: '北美自营店，14 天结算周期。' },
  { name: 'Ozon RU', code: 'DEMO-OZON-RU', platform: 'ozon', currency: 'USD', external: 'OZON-DEMO-001', notes: '俄罗斯主力渠道，走海外仓。' },
  { name: 'TikTok Shop SEA', code: 'DEMO-TTS-SEA', platform: 'tiktok_shop', currency: 'USD', external: 'TTS-SEA-DEMO', notes: '东南亚直播店。' },
]

const INTERNAL_ORDERS = [
  { ref: 'INT-2026-Q4-001', currency: 'CNY', comments: '总部 → 华东仓调拨：饮水机与滤芯。', items: [ { product: '智能无线饮水机 W5C', qty: 120, price: '215.000000' }, { product: '无线饮水机滤芯（5 片装）', qty: 600, price: '24.000000' } ] },
  { ref: 'INT-2026-Q4-002', currency: 'CNY', comments: '总部 → 华东仓调拨：猫砂。', items: [ { product: '豆腐猫砂 2.0mm（原味）', qty: 800, price: '32.000000' }, { product: '混合猫砂（豆腐+膨润土）', qty: 600, price: '36.000000' } ] },
  { ref: 'INT-2026-Q4-003', currency: 'CNY', comments: '内部展示样机（猫砂盆）。', items: [ { product: '智能全自动猫砂盆 PURA MAX', qty: 10, price: '1280.000000' } ] },
  { ref: 'INT-2026-Q4-004', currency: 'CNY', comments: '总部 → 华南仓调拨：喂食器。', items: [ { product: '智能喂食器 FRESH ELEMENT', qty: 80, price: '315.000000' }, { product: '双碗倾斜喂食器', qty: 200, price: '42.000000' } ] },
]

// ---------------------------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------------------------

const STATE_FILE = process.env.STATE || '/tmp/demo-state.json'

/**
 * Run state, persisted between invocations so the phases can be executed (and verified) one at a
 * time. Maps are serialised as plain objects.
 */
const state = {
  suppliers: new Map(), library: new Map(), products: new Map(), parties: new Map(),
  orders: new Map(), shipments: new Map(), contracts: new Map(), channels: new Map(), quote: new Map(),
  warehouse: null, location: null,
}
if (existsSync(STATE_FILE)) {
  const saved = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  for (const [key, value] of Object.entries(saved)) {
    state[key] = value && typeof value === 'object' && !Array.isArray(value) ? new Map(Object.entries(value)) : value
  }
}
const saveState = () => {
  const plain = Object.fromEntries(Object.entries(state).map(([key, value]) => [key, value instanceof Map ? Object.fromEntries(value) : value]))
  writeFileSync(STATE_FILE, JSON.stringify(plain, null, 2))
}

/**
 * Suppliers are matched by **name**: the create command issues `SUP-####` itself, so the demo's own
 * label never reaches the database and searching for it would create a duplicate on every run.
 */
async function findSupplier(name) {
  const rows = await safeList('purchasing/suppliers', { search: name, pageSize: '100' })
  return rows.find((row) => row.name === name) ?? null
}

async function phaseSuppliers() {
  phase('suppliers')
  for (const supplier of SUPPLIERS) {
    const existing = await step(`find ${supplier.name}`, () => findSupplier(supplier.name))
    if (existing) {
      state.suppliers.set(supplier.code, existing.id)
      keep('suppliers', `${existing.code ?? '?'} ${supplier.name}`)
      continue
    }
    const created = await step(`create ${supplier.name}`, async () => {
      const { data } = await api('POST', 'purchasing/suppliers', {
        name: supplier.name,
        contactName: supplier.contact,
        phone: supplier.phone,
        address: supplier.city,
        defaultCurrencyCode: 'CNY',
        brandValue: supplier.brand,
        isActive: true,
        notes: supplier.notes,
      })
      return data.id
    })
    if (created) {
      state.suppliers.set(supplier.code, created)
      record('suppliers', supplier.code, created)
    }
  }
}

/** The canonical code a library row got from `product_codes` (its `supplierSku`). */
const skuFromName = (item) => item.demoSku ?? item.nameEn.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40).toUpperCase()

async function issueCode(brand, category) {
  const { data } = await api('POST', 'product_codes/generate', { brandValue: brand, categoryValue: category })
  return data.code
}

async function phaseSupplierProducts() {
  phase('supplier products (library + prices)')
  for (const item of SUPPLIER_PRODUCTS) {
    const supplierId = state.suppliers.get(item.sup)
    if (!supplierId) continue
    const existing = (await list('purchasing/supplier-products', { supplierId })).find((row) => row.name === item.name)
    if (existing) {
      state.library.set(item.name, existing.id)
      keep('library', item.name)
      continue
    }
    const created = await step(`library ${item.name}`, async () => {
      const code = await issueCode(item.brand, item.category)
      const { data } = await api('POST', 'purchasing/supplier-products', {
        supplierId,
        supplierSku: code,
        brandValue: item.brand,
        name: item.name,
        nameZh: item.name,
        nameEn: item.nameEn,
        unit: item.unit,
        hsCode: item.hs,
        moqQuantity: item.moq,
        cartonQuantity: item.carton,
        unitNetWeight: item.nw,
        unitGrossWeight: item.gw,
        unitVolume: String(item.volume),
        discountPercent: String(item.discount),
        declarationElements: `${item.nameZh ?? item.name};宠物用品;${item.unit}`,
        status: 'active',
        notes: '演示数据：供应商产品库行。',
      })
      await api('PUT', 'purchasing/supplier-products/prices', {
        supplierProductId: data.id,
        rows: [
          { priceKind: 'supplier_cost', currencyCode: 'CNY', minQuantity: 1, unitPrice: item.costCny, isActive: true },
          { priceKind: 'supplier_cost', currencyCode: 'USD', minQuantity: 1, unitPrice: item.costUsd, isActive: true },
          ...(item.moq > 1 ? [{ priceKind: 'supplier_cost', currencyCode: 'CNY', minQuantity: item.moq, unitPrice: (Number(item.costCny) * 0.96).toFixed(6), isActive: true }] : []),
        ],
      })
      return data.id
    })
    if (created) {
      state.library.set(item.name, created)
      record('library', item.name, created)
    }
  }
}

async function phasePromoteProducts() {
  phase('product master (建商品档案 + three price tiers)')
  const wanted = [
    '智能无线饮水机 W5C',
    '智能饮水机 Eversweet 3 Pro',
    '智能饮水机 Eversweet SOLO 2',
    '智能全自动猫砂盆 PURA MAX',
    '智能全自动猫砂盆 PURA X',
    '豆腐猫砂 2.0mm（原味）',
    '膨润土结团猫砂 10L',
    '智能喂食器 FRESH ELEMENT',
    '宠物航空箱 M 号',
    '不锈钢猫砂铲（长柄）',
    '猫抓板（瓦楞纸双层）',
    '宠物外出背包（透气款）',
    '宠物饮水机 UV 杀菌款',
  ]
  for (const name of wanted) {
    const libraryId = state.library.get(name)
    if (!libraryId) continue
    const promoted = await step(`promote ${name}`, async () => {
      const { data } = await api('POST', 'purchasing/supplier-products/promote', { id: libraryId })
      return data.productId ?? null
    })
    if (!promoted) continue
    state.products.set(name, promoted)
    record('products', name, promoted)
    // Export/internal tiers on top of the purchase tier the promotion wrote.
    const item = SUPPLIER_PRODUCTS.find((row) => row.name === name)
    if (item) {
      const costUsd = Number(item.costUsd)
      await step(`prices ${name}`, () => api('POST', 'products/prices', {
        productId: promoted,
        rows: [
          { priceTier: 'purchase', currencyCode: 'CNY', minQuantity: 1, unitPrice: item.costCny, isActive: true },
          { priceTier: 'internal', currencyCode: 'USD', minQuantity: 1, unitPrice: (costUsd * 1.15).toFixed(6), isActive: true },
          { priceTier: 'export', currencyCode: 'USD', minQuantity: 1, unitPrice: (costUsd * 1.45).toFixed(6), isActive: true },
          { priceTier: 'export', currencyCode: 'USD', minQuantity: 240, unitPrice: (costUsd * 1.32).toFixed(6), isActive: true },
        ],
      }))
    }
  }
}

/**
 * The shipment chain (allocation → receive) books stock at the catalog variant level, so a product
 * has to be linked to a catalog row before any purchase-order line that carries it can be shipped.
 * The catalog module is hidden in this deployment; the rows exist only to satisfy that chain.
 */
async function phaseCatalogLinks() {
  phase('catalog links (needed by shipments and stock receipts)')
  const existing = await safeList('catalog/products', { pageSize: '100' })
  const bySku = new Map(existing.map((row) => [row.sku, row]))
  const productRows = await safeList('products/items', { pageSize: '100' })
  const productById = new Map(productRows.map((row) => [row.id, row]))
  for (const [name, productId] of state.products) {
    const item = SUPPLIER_PRODUCTS.find((row) => row.name === name)
    if (!item) continue
    // the catalog row carries the master's own SKU (the canonical code the library issued)
    const sku = productById.get(productId)?.sku ?? skuFromName(item)
    let catalogId = bySku.get(sku)?.id ?? null
    if (!catalogId) {
      catalogId = await step(`catalog ${name}`, async () => {
        const { data } = await api('POST', 'catalog/products', {
          title: name,
          subtitle: item.nameEn,
          sku,
          primary_currency_code: 'CNY',
          status: 'published',
        })
        return data.id
      })
      if (catalogId) record('catalogProducts', name, catalogId)
    }
    if (!catalogId) continue
    await step(`link ${name}`, () => api('PUT', 'products/items', { id: productId, catalogProductId: catalogId }))
  }
}

async function phaseParties() {
  phase('trading parties')
  const existingRows = await safeList('parties')
  const byCode = new Map(existingRows.map((row) => [row.code, row]))
  for (const party of PARTIES) {
    if (byCode.has(party.code)) {
      state.parties.set(party.code, byCode.get(party.code).id)
      keep('parties', party.code)
      continue
    }
    const created = await step(`party ${party.name}`, async () => {
      const { data } = await api('POST', 'parties', {
        code: party.code,
        name: party.name,
        countryCode: party.country,
        city: party.city,
        roles: party.roles,
        contactName: party.contact,
        contactPhone: party.phone,
        email: party.email,
        status: 'active',
        ...(party.bank ? { bankAccounts: [{ ...party.bank, isDefault: true }] } : {}),
      })
      return data.id
    })
    if (created) {
      state.parties.set(party.code, created)
      record('parties', party.code, created)
    }
  }
}

async function phaseQuotes() {
  phase('supplier quotations (sourcing)')
  const existing = await safeList('sourcing/quotes', { pageSize: '100' })
  const libraryRows = await safeList('purchasing/supplier-products', { pageSize: '100' })
  const skuByName = new Map(libraryRows.map((row) => [row.name, row.supplierSku]))
  for (const quote of QUOTES) {
    const supplierId = state.suppliers.get(quote.sup)
    const marker = `演示数据：${quote.sup} ${quote.date}`
    const already = existing.find((row) => String(row.notes ?? '').includes(marker))
    if (already) {
      state.quote.set(quote.sup + quote.date, already.id)
      const lines = await safeList('sourcing/quote-lines', { quoteId: already.id, pageSize: '100' })
      if (String(already.status) === 'approved' || String(already.status) === 'archived') {
        keep('quotes', marker)
        continue
      }
      await step(`quote ${quote.sup} ${quote.date} (repair lines)`, async () => {
        const have = new Set(lines.map((line) => line.productName ?? line.product_name))
        for (const item of quote.items.filter((row) => !have.has(row.product))) {
          await api('POST', 'sourcing/quote-lines', {
            quoteId: already.id,
            sectionLabel: item.section,
            productName: item.product,
            derivedSku: skuByName.get(item.product) ?? null,
            description: `${item.product}｜演示报价行`,
            unit: SUPPLIER_PRODUCTS.find((row) => row.name === item.product)?.unit ?? 'PCS',
            unitCost: item.cost,
            moqQuantity: item.moq,
            selected: true,
          })
        }
        await api('POST', 'sourcing/quotes/approve', { id: already.id })
        return already.id
      })
      continue
    }
    const created = await step(`quote ${quote.sup} ${quote.date}`, async () => {
      const { data } = await api('POST', 'sourcing/quotes', {
        supplierId,
        quoteDate: quote.date,
        validUntil: quote.validUntil,
        currencyCode: quote.currency,
        sourceKind: 'manual',
        notes: `${marker}｜${quote.notes}`,
      })
      for (const item of quote.items) {
        const libraryItem = SUPPLIER_PRODUCTS.find((row) => row.name === item.product)
        await api('POST', 'sourcing/quote-lines', {
          quoteId: data.id,
          sectionLabel: item.section,
          productName: item.product,
          derivedSku: skuByName.get(item.product) ?? null,
          description: `${item.product}｜演示报价行`,
          unit: libraryItem?.unit ?? 'PCS',
          unitCost: item.cost,
          moqQuantity: item.moq,
          cartonQuantity: libraryItem?.carton ?? null,
          unitNetWeight: libraryItem?.nw ?? null,
          innerPacking: { length: '40', width: '30', height: '25', unit: 'cm' },
          selected: true,
        })
      }
      await api('POST', 'sourcing/quotes/approve', { id: data.id })
      return data.id
    })
    if (created) {
      state.quote.set(quote.sup + quote.date, created)
      record('quotes', marker, created)
    }
  }
}

async function phasePurchaseOrders() {
  phase('purchase orders')
  const existing = await safeList('purchasing/purchase-orders', { pageSize: '100' })
  const byBusiness = new Map(existing.map((row) => [row.businessNumber ?? row.business_number, row]))
  for (const order of PURCHASE_ORDERS) {
    if (byBusiness.has(order.business)) {
      const row = byBusiness.get(order.business)
      state.orders.set(order.business, row.id)
      keep('purchaseOrders', order.business)
      continue
    }
    const created = await step(`PO ${order.business}`, async () => {
      const lines = order.items.map((item) => {
        const productId = state.products.get(item.product)
        const libraryId = state.library.get(item.product)
        return productId
          ? { productId, quantity: item.qty, unitPrice: Number(item.price), taxRate: 13, priceIncludesTax: true }
          : { supplierProductId: libraryId, quantity: item.qty, unitPrice: Number(item.price), taxRate: 13, priceIncludesTax: true }
      })
      const { data } = await api('POST', 'purchasing/purchase-orders', {
        supplierId: state.suppliers.get(order.sup),
        businessNumber: order.business,
        productCategory: order.category,
        currencyCode: order.currency,
        depositPercent: order.deposit || null,
        depositAmount: order.deposit ? Number((order.items.reduce((sum, item) => sum + item.qty * Number(item.price), 0) * order.deposit / 100).toFixed(2)) : null,
        expectedShipAt: '2026-10-20T00:00:00.000Z',
        notes: `演示数据｜${order.notes}`,
        lines,
      })
      await api('POST', 'purchasing/purchase-orders/transitions', { id: data.id, action: 'place' })
      if (order.deposit) {
        await api('POST', 'purchasing/purchase-orders/payments', {
          orderId: data.id,
          stage: 'deposit',
          amount: Number((order.items.reduce((sum, item) => sum + item.qty * Number(item.price), 0) * order.deposit / 100).toFixed(2)),
          paidAt: '2026-09-26',
          reference: `${order.business}-DEP`,
          methodNote: 'T/T 电汇',
        })
      }
      await api('POST', 'purchasing/purchase-orders/documents', {
        orderId: data.id,
        docType: 'supplier_invoice',
        documentNumber: `${order.business}-INV`,
        issuedAt: '2026-09-26',
        note: '供应商形式发票',
      })
      return data.id
    })
    if (created) {
      state.orders.set(order.business, created)
      record('purchaseOrders', order.business, created)
    }
  }
}

async function phaseShipments() {
  phase('shipments (allocations, depart, milestones)')
  const existing = await safeList('cross_border/shipments', { pageSize: '100' })
  const byBooking = new Map(existing.map((row) => [row.bookingNumber ?? row.booking_number, row]))
  const warehouses = await safeList('wms/warehouses')
  const locations = await safeList('wms/locations')
  state.warehouse = warehouses[0]?.id
  state.location = locations[0]?.id

  for (const shipment of SHIPMENTS) {
    if (shipment.booking && byBooking.has(shipment.booking)) {
      state.shipments.set(shipment.booking, byBooking.get(shipment.booking).id)
      keep('shipments', shipment.booking)
      continue
    }
    const created = await step(`shipment ${shipment.booking}`, async () => {
      const allocations = []
      for (const business of shipment.orders) {
        const orderId = state.orders.get(business)
        if (!orderId) continue
        const lines = await list('purchasing/purchase-orders/lines', { orderId })
        for (const line of lines) {
          const ordered = Number(line.quantity ?? 0)
          const already = Number(line.receivedQuantity ?? line.received_quantity ?? 0)
          const remaining = ordered - already
          if (remaining <= 0) continue
          if (!(line.catalogProductId ?? line.catalog_product_id)) continue // allocations need a catalog link
          allocations.push({ purchaseOrderLineId: line.id, quantity: remaining })
        }
      }
      if (allocations.length === 0) throw new Error('no catalog-linked lines to allocate')
      const { data } = await api('POST', 'cross_border/shipments', {
        carrierName: shipment.carrier,
        forwarderContact: shipment.forwarder,
        departurePort: shipment.port,
        containerType: shipment.containerType,
        containerNumber: shipment.container,
        sealNumber: shipment.seal,
        bookingNumber: shipment.booking,
        destinationWarehouseId: state.warehouse ?? null,
        destinationLocationId: state.location ?? null,
        etd: shipment.etd,
        eta: shipment.eta,
        notes: `演示数据｜${shipment.notes}`,
        allocations,
      })
      await api('POST', 'cross_border/shipments/depart', { id: data.id })
      for (const milestone of shipment.milestones) {
        await api('POST', 'cross_border/shipments/milestones', { shipmentId: data.id, milestone, note: `演示：${milestone}` })
      }
      await api('POST', 'cross_border/shipments/documents', {
        shipmentId: data.id,
        docType: 'customs_declaration',
        documentNumber: `${shipment.booking}-CD`,
        issuedAt: shipment.etd,
        note: '出口报关单（演示）',
      })
      return data.id
    })
    if (created) {
      state.shipments.set(shipment.booking, created)
      record('shipments', shipment.booking, created)
    }
  }
}

async function phaseContracts() {
  phase('contracts + invoices (trade_docs)')
  const existing = await safeList('trade_docs/contracts', { pageSize: '100' })
  for (const [index, contract] of CONTRACTS.entries()) {
    const marker = `演示数据｜contract-${index + 1}`
    const already = existing.find((row) => String(row.notes ?? '').includes(marker))
    if (already) {
      state.contracts.set(marker, already.id)
      keep('contracts', marker)
      continue
    }
    const created = await step(`contract ${index + 1} (${contract.direction})`, async () => {
      const counterpartyId = contract.direction === 'purchase'
        ? state.suppliers.get(contract.sup)
        : state.parties.get(contract.buyer)
      const counterpartyName = contract.direction === 'purchase'
        ? SUPPLIERS.find((row) => row.code === contract.sup)?.name
        : PARTIES.find((row) => row.code === contract.buyer)?.name
      const { data } = await api('POST', 'trade_docs/contracts', {
        direction: contract.direction,
        counterpartyKind: contract.direction === 'purchase' ? 'supplier' : 'customer',
        counterpartyId: counterpartyId ?? null,
        counterpartySnapshot: { name: counterpartyName },
        ourPartySnapshot: { name: '广州凯翠国际贸易有限公司' },
        priceTier: contract.direction === 'purchase' ? 'purchase' : 'export',
        currencyCode: contract.currency,
        sourceKind: 'manual',
        deliveryDate: contract.delivery,
        paymentTerms: contract.terms,
        shippingMethod: contract.method,
        destination: contract.destination,
        marks: contract.marks,
        notes: marker,
        lines: contract.items.map((item) => ({
          ...(state.products.get(item.product) ? { productId: state.products.get(item.product) } : {}),
          name: item.product,
          quantity: item.qty,
          unitPrice: item.price,
          note: '演示合同行',
        })),
      })
      await api('POST', 'trade_docs/contracts/transitions', { id: data.id, action: 'issue' })
      await api('POST', 'trade_docs/contracts/transitions', { id: data.id, action: 'sign' })
      return data.id
    })
    if (created) {
      state.contracts.set(marker, created)
      record('contracts', marker, created)
      await step(`invoice for contract ${index + 1}`, async () => {
        const contractLines = await list('trade_docs/contracts/lines', { contractId: created })
        const { data } = await api('POST', 'trade_docs/invoices', {
          number: `DEMO-INV-2026-${String(index + 1).padStart(3, '0')}`,
          direction: contract.direction === 'purchase' ? 'inbound' : 'outbound',
          counterpartyKind: contract.direction === 'purchase' ? 'supplier' : 'customer',
          counterpartyId: (contract.direction === 'purchase' ? state.suppliers.get(contract.sup) : state.parties.get(contract.buyer)) ?? null,
          contractId: created,
          currencyCode: contract.currency,
          issuedAt: '2026-10-06',
          notes: `演示数据｜发票 contract-${index + 1}`,
          lines: contractLines.map((line) => ({
            description: line.name ?? line.productSnapshot?.title ?? '合同行',
            sku: line.sku ?? null,
            unit: line.unit ?? 'PCS',
            quantity: line.quantity,
            unitPrice: line.unitPrice ?? line.unit_price,
            amount: (Number(line.quantity) * Number(line.unitPrice ?? line.unit_price ?? 0)).toFixed(4),
            contractLineId: line.id,
          })),
        })
        await api('POST', 'trade_docs/invoices/transitions', { id: data.id, action: 'confirm' })
        return data.id
      })
    }
  }
}

async function phaseExportFinance() {
  phase('export finance (collections + tax refunds)')
  const orders = await safeList('purchasing/purchase-orders', { pageSize: '100' })
  const mine = orders.filter((row) => String(row.businessNumber ?? row.business_number ?? '').startsWith('PI-2026-'))
  for (const [index, order] of mine.entries()) {
    await step(`collection ${order.number ?? order.id.slice(0, 8)}`, () => api('PUT', 'export_finance/collections', {
      purchaseOrderId: order.id,
      purchaseOrderNumber: order.number ?? null,
      currencyCode: order.currencyCode ?? order.currency_code ?? 'CNY',
      collectionStatus: index % 3 === 0 ? 'not_received' : 'received',
    }))
  }
  const shipments = await safeList('cross_border/shipments', { pageSize: '100' })
  const mineShipments = shipments.filter((row) => String(row.bookingNumber ?? row.booking_number ?? '').includes('COSU') || String(row.bookingNumber ?? row.booking_number ?? '').includes('MAEU') || String(row.bookingNumber ?? row.booking_number ?? '').includes('OOCL'))
  for (const [index, shipment] of mineShipments.entries()) {
    await step(`refund ${shipment.number ?? shipment.id.slice(0, 8)}`, () => api('PUT', 'export_finance/refunds', {
      shipmentId: shipment.id,
      shipmentNumber: shipment.number ?? null,
      currencyCode: 'CNY',
      taxRefundStatus: index % 2 === 0 ? 'applied' : 'completed',
      taxRefundAmount: String(12800 + index * 1750) + '.50',
      taxRefundNote: '演示：出口退税（按柜归集）',
    }))
  }
}

async function phasePlatformOps() {
  phase('platform ops (channels, order mirrors, settlements, reconciliation)')
  for (const channel of CHANNELS) {
    const existing = await safeList('platform_ops/channels', { search: channel.code })
    const found = existing.find((row) => row.code === channel.code)
    if (found) {
      state.channels.set(channel.code, found.id)
      keep('channels', channel.code)
      continue
    }
    const created = await step(`channel ${channel.name}`, async () => {
      const { data } = await api('POST', 'platform_ops/channels', {
        name: channel.name,
        code: channel.code,
        platform: channel.platform,
        externalAccountId: channel.external,
        currencyCode: channel.currency,
        isActive: true,
        notes: channel.notes,
      })
      return data.id
    })
    if (created) {
      state.channels.set(channel.code, created)
      record('channels', channel.code, created)
    }
  }

  const shipmentNumbers = [...state.shipments.keys()]
  for (const [code, channelId] of state.channels) {
    const orders = Array.from({ length: 16 }, (_, index) => {
      const gross = 180 + ((index * 137) % 900)
      const fee = Number((gross * 0.15).toFixed(2))
      const day = 10 + (index % 18)
      return {
        externalOrderId: `${code}-2026-${String(1000 + index)}`,
        status: index % 4 === 0 ? 'shipped' : 'delivered',
        currencyCode: 'USD',
        grossAmount: gross,
        feeAmount: fee,
        netAmount: Number((gross - fee).toFixed(2)),
        placedAt: `2026-09-${String(day).padStart(2, '0')}`,
        ...(shipmentNumbers[index % shipmentNumbers.length] ? { shipmentNumber: shipmentNumbers[index % shipmentNumbers.length] } : {}),
      }
    })
    await step(`ingest orders ${code}`, () => api('POST', 'platform_ops/orders/ingest', { channelId, orders }))

    const lines = orders.slice(0, 10).map((order) => ({
      externalOrderId: order.externalOrderId,
      grossAmount: order.grossAmount,
      feeAmount: order.feeAmount,
      netAmount: order.netAmount,
    }))
    // one line deliberately has no mirror (missing_in_erp) and one carries a different net (amount_mismatch)
    lines.push({ externalOrderId: `${code}-2026-9999`, grossAmount: 320, feeAmount: 48, netAmount: 272 })
    lines[1] = { ...lines[1], netAmount: Number((lines[1].netAmount - 12.5).toFixed(2)) }

    await step(`settlement ${code}`, () => api('POST', 'platform_ops/settlements/import', {
      channelId,
      settlement: {
        externalSettlementId: `${code}-SET-2026-09`,
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        currencyCode: 'USD',
        grossAmount: orders.reduce((sum, order) => sum + order.grossAmount, 0),
        feeAmount: orders.reduce((sum, order) => sum + order.feeAmount, 0),
        netAmount: orders.reduce((sum, order) => sum + order.netAmount, 0),
        receivedAt: '2026-10-01',
      },
      lines,
    }))
  }

  // A second, partly unmatched settlement keeps the queue alive for the demo: a few items are decided
  // (resolved / ignored) and the rest stay open, which is what an operator actually sees.
  for (const [code, channelId] of state.channels) {
    await step(`settlement ${code} (open items)`, () => api('POST', 'platform_ops/settlements/import', {
      channelId,
      settlement: {
        externalSettlementId: `${code}-SET-2026-10`,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-15',
        currencyCode: 'USD',
        grossAmount: 1860,
        feeAmount: 279,
        netAmount: 1581,
        receivedAt: '2026-10-16',
      },
      lines: [
        { externalOrderId: `${code}-2026-1000`, grossAmount: 420, feeAmount: 63, netAmount: 357 },
        { externalOrderId: `${code}-2026-1001`, grossAmount: 380, feeAmount: 57, netAmount: 323 },
        { externalOrderId: `${code}-2026-2001`, grossAmount: 560, feeAmount: 84, netAmount: 476 },
        { externalOrderId: `${code}-2026-2002`, grossAmount: 500, feeAmount: 75, netAmount: 425 },
      ],
    }))
  }

  const queue = await safeList('platform_ops/reconciliation', { status: 'open', pageSize: '50' })
  for (const [index, item] of queue.slice(0, 3).entries()) {
    await step(`reconciliation ${index + 1}`, () => api('POST', index === 2 ? 'platform_ops/reconciliation/ignore' : 'platform_ops/reconciliation/resolve', {
      id: item.id,
      note: index === 2 ? '演示：平台多计一笔已退款订单，忽略。' : '演示：平台按含税口径结算，差额为代扣税，已核对。',
    }))
  }
  console.log(`  note ${Math.max(queue.length - 3, 0)} reconciliation item(s) left open for the demo`)
}

async function phaseInternalSales() {
  phase('internal sales (installed sales engine)')
  const existing = await safeList('sales/orders', { pageSize: '100' })
  for (const order of INTERNAL_ORDERS) {
    const found = existing.find((row) => String(row.customerReference ?? row.customer_reference ?? '') === order.ref)
    if (found) {
      keep('internalOrders', order.ref)
      continue
    }
    const created = await step(`internal order ${order.ref}`, async () => {
      const lines = order.items.map((item) => ({
        kind: 'product',
        ...(state.products.get(item.product) ? { productId: state.products.get(item.product) } : {}),
        name: item.product,
        currencyCode: order.currency,
        quantity: item.qty,
        unitPriceNet: Number(item.price),
      }))
      const { data } = await api('POST', 'sales/orders', {
        currencyCode: order.currency,
        customerSnapshot: { name: '广州凯翠国际贸易有限公司 · 内部调拨' },
        customerReference: order.ref,
        comments: `演示数据｜${order.comments}`,
        lines,
      })
      return data.id
    })
    if (created) record('internalOrders', order.ref, created)
  }
}

const PHASES = [
  ['suppliers', phaseSuppliers],
  ['library', phaseSupplierProducts],
  ['products', phasePromoteProducts],
  ['catalogLinks', phaseCatalogLinks],
  ['parties', phaseParties],
  ['quotes', phaseQuotes],
  ['purchaseOrders', phasePurchaseOrders],
  ['shipments', phaseShipments],
  ['contracts', phaseContracts],
  ['exportFinance', phaseExportFinance],
  ['platformOps', phasePlatformOps],
  ['internalSales', phaseInternalSales],
]

for (const [name, run] of PHASES) {
  if (ONLY.size > 0 && !ONLY.has(name)) continue
  await run()
}

saveState()
manifest.finishedAt = new Date().toISOString()
manifest.calls = calls
manifest.counts = Object.fromEntries(Object.entries(manifest.created).map(([kind, rows]) => [kind, Object.keys(rows).length]))
manifest.keptCounts = Object.fromEntries(Object.entries(manifest.kept).map(([kind, rows]) => [kind, rows.length]))
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2))
console.log(`\nAPI calls: ${calls}`)
console.log('created:', JSON.stringify(manifest.counts))
console.log('kept   :', JSON.stringify(manifest.keptCounts))
if (manifest.failed.length) {
  console.log(`failed : ${manifest.failed.length}`)
  for (const failure of manifest.failed.slice(0, 12)) console.log('  -', failure.label, '::', failure.message.slice(0, 160))
}
console.log(`manifest: ${MANIFEST}`)
