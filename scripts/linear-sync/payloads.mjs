// Decomposition of docs/** into Linear issues for the kc-cb-digital-base-main project.
//
// The mapping is intentional and reviewed: one issue per PRD requirement row,
// per plan phase, per dev/ru-petkit document (summary + repo link), plus a
// handful of index/parent issues. Each node carries a stable anchor that is
// also embedded in the issue body as an HTML comment, so re-runs can match.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// Docs may live in a sibling worktree (the current docs state can be ahead of the
// branch the sync tool itself rides on) — pass --docs-root / KC_SYNC_DOCS_ROOT.
const ROOT = process.env.KC_SYNC_DOCS_ROOT ? resolve(process.env.KC_SYNC_DOCS_ROOT) : join(HERE, '..', '..')
const REPO_BLOB = 'https://github.com/KcDevVanness/kc-cb-digital-base-main/blob/dev'
const SYNC_DATE = '2026-10-08'

function readDoc(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

function hasDoc(rel) {
  return existsSync(join(ROOT, rel))
}

function repoLink(rel) {
  return `${REPO_BLOB}/${rel}`
}

// Relative markdown links must become absolute blob URLs or they die in Linear.
function absLinks(md, docRel) {
  const docDir = posix.dirname(docRel)
  return md.replace(/\]\(([^()\s]+)((?:\s+"[^"]*")?)\)/g, (whole, target, title) => {
    const clean = target.replace(/^<|>$/g, '')
    if (/^(https?:|mailto:|#)/.test(clean)) return whole
    const resolved = posix.normalize(posix.join(docDir, clean))
    if (resolved.startsWith('..')) return whole
    return `](<${REPO_BLOB}/${resolved}>${title})`
  })
}

function makeNode(anchor, { title, state, parent, body }) {
  return {
    anchor,
    title,
    state,
    parentAnchor: parent || null,
    body: `<!-- kc-sync:${anchor} -->\n\n${body.trim()}\n`,
  }
}

function sectionBetween(src, startHeading, endHeading) {
  const start = src.indexOf(startHeading)
  if (start < 0) throw new Error(`找不到小节：${startHeading}`)
  const from = start + startHeading.length
  const end = endHeading ? src.indexOf(endHeading, from) : src.length
  return src.slice(from, end < 0 ? src.length : end)
}

function headings(src) {
  return [...src.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim())
}

function truncate(text, max) {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max)}…（全文见来源文档）`
}

function stripBackticks(text) {
  return text.replace(/`/g, '')
}

function stripMarkup(text) {
  return text.replace(/[`*]/g, '')
}

function plainCells(row) {
  return row.split('|').slice(1, -1).map((cell) => cell.trim())
}

// ---------------------------------------------------------------- cross-border PRD

const CB_PRD = 'docs/prd/cross-border-erp.md'

const CB_GROUPS = {
  A: { title: '【需求】A purchasing · 供应商与采购单', state: 'Done', note: '已完成主体，剩余项见实施计划' },
  B: { title: '【需求】B cross_border · 发运 / 在途 / 出口单证', state: 'Done', note: '已实现并验证（Q1–Q3 用可逆默认）' },
  C: { title: '【需求】C platform_ops · 连接器 / 结算 / 分公司视图', state: 'In Progress', note: '核心已实现并验证；C-3（分公司视图）未做，owner 2026-09-30 决定先不做' },
  E: { title: '【需求】E products + trade_docs · 商品主数据与购销合同', state: 'Done', note: '已实现并验证' },
  F: { title: '【需求】F sourcing · 供应商报价与导入', state: 'Done', note: '已实现并验证' },
  G: { title: '【需求】G parties / export_finance / internal_sales · 交易对手与出口财务', state: 'Done', note: '已实现并验证' },
  D: { title: '【需求】D 横向要求 · 组织可见性 / 国际化 / 一致性 / 测试', state: 'Done', note: '横向纪律，持续适用；逐条验收见来源文档' },
}

function crossBorderPrd() {
  const src = readDoc(CB_PRD)
  const nodes = []

  nodes.push(makeNode('prd/cross-border-erp#epic', {
    title: '【需求】跨境 ERP：采购 / 跨境发运 / 平台结算（PRD）',
    state: 'In Progress',
    body: `
> 来源：[${CB_PRD}](<${repoLink(CB_PRD)}>)（仓库 \`dev\` 分支） · 同步于 ${SYNC_DATE}

**定位**：把「国内采购 → 跨境发运 → 海外仓 → 平台履约 → 结算」三条链在系统内闭环并可追溯。

**目标**：三条链闭环；账实以本系统 \`wms\` 为准（平台/3PL 只作同步输入，差异进对账、不静默覆盖）；多主体可见性正确（总部看全部下级、分公司只看自己）；界面中英双语、权限 fail-closed。

**非目标**：不接 EUDR；不做采购审批流与账期/账龄；不做国内仓节点；不做平台库存回写；不 eject 官方模块；不做生产制造（无 BOM / 工单 / 成本核算）。

**子节点**：A–G 需求组（A 采购 / B 跨境发运 / C 平台运营 / E 商品与合同 / F 供应商报价 / G 交易对手与出口财务 / D 横向要求）+ 整体验收清单 + 开放问题。
`,
  }))

  const sectionRe = /^### ([A-G])\. (.+)$/gm
  const matches = [...src.matchAll(sectionRe)]
  if (matches.length !== 7) throw new Error(`cross-border PRD 期待 7 个需求组，实际 ${matches.length}`)

  let leafCount = 0
  matches.forEach((m, index) => {
    const letter = m[1]
    const group = CB_GROUPS[letter]
    if (!group) throw new Error(`未登记的组：${letter}`)
    const from = m.index + m[0].length
    const to = index + 1 < matches.length ? matches[index + 1].index : src.indexOf('\n## 验收标准（整体）')
    const body = src.slice(from, to)
    const rows = [...body.matchAll(/^\|\s*([A-G]-\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/gm)]
    const groupAnchor = `prd/cross-border-erp#grp-${letter}`

    nodes.push(makeNode(groupAnchor, {
      title: group.title,
      state: group.state,
      parent: 'prd/cross-border-erp#epic',
      body: `
> 来源：[${CB_PRD}](<${repoLink(CB_PRD)}>) · 小节「${m[2]}」 · 同步于 ${SYNC_DATE}

**组状态**：${group.note}

**组内需求**：${rows.map((r) => r[1]).join(' / ')}（逐条为子 issue）
`,
    }))

    for (const row of rows) {
      leafCount += 1
      const [, id, requirement, acceptance] = row
      let status
      if (id === 'C-3') {
        status = '未做 —— 方案见实施计划阶段五「分公司仪表盘」（owner 2026-09-30 决定先不做）'
      } else if (id === 'G-1') {
        status = '已实现并验证（Phases 1–3）；Phase 4（服务方专有属性）待 Q-P-004'
      } else {
        status = `已实现并验证（依据来源文档「${letter}」组标注：${group.note}）`
      }
      nodes.push(makeNode(`prd/cross-border-erp#${id}`, {
        title: `【需求】${id} ${stripMarkup(requirement)}`.slice(0, 200),
        state: id === 'C-3' ? 'Todo' : 'Done',
        parent: groupAnchor,
        body: `
> 来源：[${CB_PRD}](<${repoLink(CB_PRD)}>) · 分组 ${letter}（${m[2]}） · 同步于 ${SYNC_DATE}

**需求**：${requirement}

**验收标准**：${acceptance}

**状态**：${status}
`,
      }))
    }
  })
  if (leafCount !== 40) throw new Error(`cross-border PRD 期待 40 条需求，实际 ${leafCount}`)

  const acc = sectionBetween(src, '## 验收标准（整体）', '## 开放问题')
  const accItems = acc.split('\n').map((line) => line.match(/^- \[([ x])\] (.+)$/)).filter(Boolean)
  const checked = accItems.filter((i) => i[1] === 'x').length
  nodes.push(makeNode('prd/cross-border-erp#acceptance', {
    title: `【需求】跨境 ERP · 整体验收清单（${checked}/${accItems.length} 已实测）`,
    state: checked === accItems.length ? 'Done' : 'In Progress',
    parent: 'prd/cross-border-erp#epic',
    body: `
> 来源：[${CB_PRD}](<${repoLink(CB_PRD)}>)「## 验收标准（整体）」 · 同步于 ${SYNC_DATE}

${accItems.map((item, i) => `${i + 1}. [${item[1] === 'x' ? 'x' : ' '}] ${item[2]}`).join('\n')}
`,
  }))

  const open = sectionBetween(src, '## 开放问题', null)
  const openRows = [...open.matchAll(/^\|\s*(Q\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/gm)]
  nodes.push(makeNode('prd/cross-border-erp#open-questions', {
    title: '【需求】跨境 ERP · 开放问题（Q1–Q6）',
    state: 'Backlog',
    parent: 'prd/cross-border-erp#epic',
    body: `
> 来源：[${CB_PRD}](<${repoLink(CB_PRD)}>)「## 开放问题」 · 同步于 ${SYNC_DATE}

Q1–Q3 在实现阶段三时以**可逆默认**先行落地（单证=最小结构化字段+附件；单证挂发运单、可选关联采购单；里程碑手工推进留接口），业务要改口径改这三处即可。Q4–Q6 已答。

${openRows.map((r) => `- **${r[1]}** ${r[2]}\n  - 影响：${r[3]}\n  - 决策方：${r[4]}`).join('\n')}
`,
  }))

  return nodes
}

// ---------------------------------------------------------------- finance PRD

const FIN_PRD = 'docs/prd/finance-and-cockpit.md'
const FIN_SPEC = '.ai/specs/2026-09-28-finance-ledger-and-cockpit-data.md'
const FIN_PLAN = 'docs/plans/finance-and-cockpit.md'

const FIN_AC_NAMES = [
  '到岸成本分摊等式',
  '权重退化与缺汇率处理',
  '库存资金占用三源解析',
  '应付 / 应收台账与收汇金额',
  '损益与俄方对齐',
  'RU 8 端点幂等拉取',
  '驾驶舱 KPI 与 stale 标出',
  '全链脚本验收',
]

function financePrd() {
  const src = readDoc(FIN_PRD)
  const nodes = []

  nodes.push(makeNode('prd/finance-and-cockpit#epic', {
    title: '【需求】财务模块完善 · 数据打通 · 老板驾驶舱（PRD）',
    state: 'Done',
    body: `
> 来源：[${FIN_PRD}](<${repoLink(FIN_PRD)}>)（仓库 \`dev\` 分支） · 同步于 ${SYNC_DATE}
> 执行口径：[${FIN_SPEC}](<${repoLink(FIN_SPEC)}>) · 进度：[${FIN_PLAN}](<${repoLink(FIN_PLAN)}>)

**定位**：把「柜费用 → 到岸成本 → 应付/应收/库存资金占用/损益」算清，接入俄方 supply 8 端点，最后让老板一页看六类数。

**目标**：柜级费用可记、到岸成本分摊总和 == 费用总和（2 位）；四类台账可查且每个数字可指到源；俄方 8 端点可拉、可重放、断点可续；驾驶舱一页六类数、每数带 as_of 与来源；端到端链路脚本化验收。

**非目标**：不做凭证/科目/总账/账期/账龄；不写俄方数据；不做俄文全文翻译、不重建俄方 BI；驾驶舱只读（唯一写口 = 缺口 → 采购单草稿）；不引图表库。

**子节点**：验收标准 1–8 逐条 + 开放问题。
`,
  }))

  const ac = sectionBetween(src, '## 验收标准', '## 开放问题')
  const items = ac.split('\n').map((line) => line.match(/^\d+\. (.+)$/)).filter(Boolean)
  if (items.length !== FIN_AC_NAMES.length) throw new Error(`finance PRD 期待 ${FIN_AC_NAMES.length} 条验收，实际 ${items.length}`)
  items.forEach((item, i) => {
    nodes.push(makeNode(`prd/finance-and-cockpit#ac-${i + 1}`, {
      title: `【需求】财务 · 验收 ${i + 1}｜${FIN_AC_NAMES[i]}`,
      state: 'Done',
      parent: 'prd/finance-and-cockpit#epic',
      body: `
> 来源：[${FIN_PRD}](<${repoLink(FIN_PRD)}>)「## 验收标准」第 ${i + 1} 条 · 同步于 ${SYNC_DATE}

${item[1]}

**状态**：已交付并实测（2026-09-28；证据见 [${FIN_PLAN}](<${repoLink(FIN_PLAN)}>) 的「进度」表与 spec Changelog）。
`,
    }))
  })

  const open = sectionBetween(src, '## 开放问题', null)
  const openRows = [...open.matchAll(/^\|\s*(Q-\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/gm)]
  nodes.push(makeNode('prd/finance-and-cockpit#open-questions', {
    title: '【需求】财务 · 开放问题（Q-006…Q-011）',
    state: 'Backlog',
    parent: 'prd/finance-and-cockpit#epic',
    body: `
> 来源：[${FIN_PRD}](<${repoLink(FIN_PRD)}>)「## 开放问题」 · 同步于 ${SYNC_DATE}

${openRows.map((r) => `- **${r[1]}** ${r[2]}\n  - 决策方：${r[3]}\n  - 影响：${r[4]}`).join('\n')}
`,
  }))

  return nodes
}

// ---------------------------------------------------------------- lookup PRD

const LOOK_PRD = 'docs/prd/lookup-field-dropdown.md'
const LOOK_PLAN = 'docs/plans/lookup-field-dropdown.md'
const LOOK_PATCH = '.ai/analysis/lookup-select-dropdown'

const LOOK_AC_NAMES = [
  '聚焦即见首页选项',
  '选中语义与不泄露 UUID',
  '键盘与 ARIA 语义',
  'minQuery ≥ 1 保持类型搜索',
  'disabled 字段惰性只读',
  '未交互零请求',
  '窄屏面板跟随不跳版',
]

function lookupPrd() {
  const src = readDoc(LOOK_PRD)
  const nodes = []

  nodes.push(makeNode('prd/lookup-field-dropdown#epic', {
    title: '【需求】关联字段选择器改为「下拉 + 搜索」（PRD）',
    state: 'In Progress',
    body: `
> 来源：[${LOOK_PRD}](<${repoLink(LOOK_PRD)}>)（仓库 \`dev\` 分支） · 同步于 ${SYNC_DATE}
> 补丁与验证工具链：[${LOOK_PATCH}](<${repoLink(LOOK_PATCH)}/README.md>) · 进度：[${LOOK_PLAN}](<${repoLink(LOOK_PLAN)}>)

**定位**：框架组件 \`LookupSelect\` 从「纯搜索」改为「聚焦即见首页选项、输入即过滤」，修复面在上游 \`@open-mercato/ui\`。

**目标**：新建流程不输入即可浏览选项；不引入调用方改动、不新增 i18n key、不改变写入值与 API 契约；产出可被上游接受的补丁。

**非目标**：不在本仓复制/覆盖框架页面；不改领域层（entity / 路由 / 命令 / ACL / 迁移）；不顺手改卡片样式与文案体系。

**子节点**：验收标准 1–7 逐条 + 开放问题。
`,
  }))

  const ac = sectionBetween(src, '## 验收标准', '## 开放问题')
  const items = ac.split('\n').map((line) => line.match(/^\d+\. (.+)$/)).filter(Boolean)
  if (items.length !== LOOK_AC_NAMES.length) throw new Error(`lookup PRD 期待 ${LOOK_AC_NAMES.length} 条验收，实际 ${items.length}`)
  items.forEach((item, i) => {
    nodes.push(makeNode(`prd/lookup-field-dropdown#ac-${i + 1}`, {
      title: `【需求】选择器 · 验收 ${i + 1}｜${LOOK_AC_NAMES[i]}`,
      state: 'Todo',
      parent: 'prd/lookup-field-dropdown#epic',
      body: `
> 来源：[${LOOK_PRD}](<${repoLink(LOOK_PRD)}>)「## 验收标准」第 ${i + 1} 条 · 同步于 ${SYNC_DATE}

${item[1]}

**状态**：补丁已产出并自验（组件自带 26 条用例全绿），待上游发版；本仓尚未升级生效（见 [实施计划](${repoLink(LOOK_PLAN)})）。
`,
    }))
  })

  const open = sectionBetween(src, '## 开放问题', null)
  const openItems = open.split('\n').map((line) => line.match(/^\d+\. (.+)$/)).filter(Boolean)
  nodes.push(makeNode('prd/lookup-field-dropdown#open-questions', {
    title: '【需求】选择器 · 开放问题（3 条）',
    state: 'Backlog',
    parent: 'prd/lookup-field-dropdown#epic',
    body: `
> 来源：[${LOOK_PRD}](<${repoLink(LOOK_PRD)}>)「## 开放问题」 · 同步于 ${SYNC_DATE}

${openItems.map((item, i) => `${i + 1}. ${item[1]}`).join('\n')}
`,
  }))

  return nodes
}

// ---------------------------------------------------------------- plans

const PLAN_EPIC = 'plans#epic'
const NUMERALS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8 }

function parsePhases(rel) {
  const lines = readDoc(rel).split('\n')
  const phases = []
  let current = null
  for (const line of lines) {
    const m = line.match(/^- \[([ x])\] \*\*(.+?)\*\*(.*)$/)
    if (m) {
      current = { done: m[1] === 'x', name: m[2].trim(), rest: m[3].trim(), nested: [] }
      phases.push(current)
      continue
    }
    if (!current) continue
    if (/^\s{2,}\S/.test(line)) {
      current.nested.push(line.trim())
      continue
    }
    if (line.trim() !== '') current = null
  }
  return phases
}

function parseProgressRows(rel) {
  const src = readDoc(rel)
  const start = src.indexOf('## 进度')
  const section = start >= 0 ? src.slice(start) : ''
  const rows = []
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = plainCells(line)
    if (cells.length < 3 || /^-+$/.test(cells[0])) continue
    if (cells[0] === '阶段' || cells[0] === '记录' || cells[0] === '项') continue
    rows.push(cells)
  }
  return rows
}

function planPhaseNode(planShort, rel, phase, index, state, extraBody) {
  const rest = phase.rest.replace(/^——\s*/, '')
  const label = /^验收[:：]/.test(rest) ? '验收' : '内容'
  return makeNode(`plans/${planShortSlug(rel)}#phase-${index + 1}`, {
    title: `【里程碑】${planShort} · ${stripMarkup(phase.name)}`,
    state,
    parent: PLAN_EPIC,
    body: `
> 来源：[${rel}](<${repoLink(rel)}>)「## 阶段划分」 · 同步于 ${SYNC_DATE}

**阶段**：${stripBackticks(phase.name)}

**${label}**：${rest.replace(/^验收[:：]\s*/, '')}

${phase.nested.length ? `**阶段内记录**：\n${phase.nested.map((n) => `- ${n.replace(/^[-*]\s*/, '')}`).join('\n')}\n` : ''}${extraBody || ''}
`,
  })
}

function planShortSlug(rel) {
  return rel.split('/').pop().replace(/\.md$/, '')
}

function plansNodes() {
  const nodes = []
  nodes.push(makeNode(PLAN_EPIC, {
    title: '【里程碑】实施计划（docs/plans：跨境 ERP / 财务与驾驶舱 / 关联字段选择器）',
    state: 'In Progress',
    body: `
> 来源：[docs/plans/](<${repoLink('docs/plans/README.md')}>)（仓库 \`dev\` 分支） · 同步于 ${SYNC_DATE}

**定位**：把 PRD 落成可执行的阶段计划——阶段划分、每阶段交付、依赖、风险、进度；面向人的排期与验收口径（执行口径在 \`.ai/specs/\`）。

**三份计划**：
- [跨境 ERP 实施计划](<${repoLink('docs/plans/cross-border-erp.md')}>)：阶段一~四完成、阶段五（收尾）进行中
- [财务与驾驶舱实施计划](<${repoLink('docs/plans/finance-and-cockpit.md')}>)：阶段一~八全部完成并实测
- [关联字段选择器实施计划](<${repoLink('docs/plans/lookup-field-dropdown.md')}>)：阶段一进行中、二/三未开始

**子节点**：逐阶段 issue + 跨境 ERP 阶段五历史补记。
`,
  }))

  // cross-border plan
  {
    const rel = 'docs/plans/cross-border-erp.md'
    const states = { 1: 'Done', 2: 'Done', 3: 'Done', 4: 'Done', 5: 'In Progress' }
    const phases = parsePhases(rel)
    if (phases.length !== 5) throw new Error(`${rel} 期待 5 个阶段，实际 ${phases.length}`)
    phases.forEach((phase, i) => {
      const n = NUMERALS[phase.name.replace(/^阶段/, '').charAt(0)]
      nodes.push(planPhaseNode('跨境 ERP', rel, phase, i, states[n]))
    })

    const suppRows = [...readDoc(rel).matchAll(/^\|\s*(六·补\d+[^|]*?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm)]
      .map((m) => [m[1].trim(), m[2].trim(), m[3].trim()])
    if (suppRows.length === 0) throw new Error(`${rel} 未找到六·补行`)
    nodes.push(makeNode('plans/cross-border-erp#supplements', {
      title: '【里程碑】跨境 ERP · 阶段五历史补记（六·补48–52）',
      state: 'Done',
      parent: PLAN_EPIC,
      body: `
> 来源：[${rel}](<${repoLink(rel)}>) 的「六·补」记录行 · 同步于 ${SYNC_DATE}

${suppRows.map((cells) => `- **${cells[0]}**（${cells[1]}）：${truncate(cells[2], 400)}`).join('\n')}
`,
    }))
  }

  // finance plan
  {
    const rel = 'docs/plans/finance-and-cockpit.md'
    const phases = parsePhases(rel)
    if (phases.length !== 8) throw new Error(`${rel} 期待 8 个阶段，实际 ${phases.length}`)
    const progress = parseProgressRows(rel)
    const byNumeral = new Map()
    for (const cells of progress) {
      const m = cells[0].match(/^([一二三四五六七八])(?:[\s`]|$)/)
      if (m) byNumeral.set(NUMERALS[m[1]], cells)
    }
    phases.forEach((phase, i) => {
      const row = byNumeral.get(i + 1)
      const extra = row
        ? `**进度表摘录**：${truncate(row[1], 120)} —— ${truncate(row[2], 700)}\n`
        : ''
      nodes.push(planPhaseNode('财务与驾驶舱', rel, phase, i, 'Done', extra))
    })
  }

  // lookup plan
  {
    const rel = 'docs/plans/lookup-field-dropdown.md'
    const states = { 1: 'In Progress', 2: 'Todo', 3: 'Todo' }
    const phases = parsePhases(rel)
    if (phases.length !== 3) throw new Error(`${rel} 期待 3 个阶段，实际 ${phases.length}`)
    const progress = parseProgressRows(rel)
    phases.forEach((phase, i) => {
      const row = progress[i]
      const extra = row ? `**进度表摘录**：${truncate(row[1], 120)} —— ${truncate(row[2], 300)}\n` : ''
      nodes.push(planPhaseNode('关联字段选择器', rel, phase, i, states[i + 1], extra))
    })
  }

  return nodes
}

// ---------------------------------------------------------------- dev docs

const DEV_DOCS = [
  {
    rel: 'docs/dev/setup.md',
    gist: '本地开发环境搭建：依赖服务、首次初始化、日常命令、演示账号与验证清单。',
    points: [
      'Node ≥ 24、Yarn（Corepack）、Docker；依赖服务 postgres 与 redis 的端口取自 `.env`（本机实测 5532/6479）',
      '首次初始化：`cp .env.example .env` → `yarn install` → `yarn initialize`（建表 + 种子）',
      '演示账号 `admin@acme.com` 等是多个组件写死的开发约定；登录接口只接受 form-urlencoded；改 superadmin 密码要两边同步',
      '`yarn dev` 端口以启动日志 `Local:` 行为准；未配发信 provider，联调设 `OM_DISABLE_EMAIL_DELIVERY=true`',
      '提交前跑全套：`yarn generate && yarn typecheck && yarn lint && node scripts/check-lessons.mjs && yarn ds:check && yarn test && yarn build`',
    ],
  },
  {
    rel: 'docs/dev/architecture.md',
    gist: '目录职责、模块启用方式、请求链路与生成物边界。',
    points: [
      '`src/modules.ts` 是模块启用的唯一权威（当前 39 个 = 官方 23 + 自建 16）',
      '官方 UI 隐藏用 `routes.pages` + `metadata.navHidden`（不用 `null`，通知深链要保留可解析）',
      '请求链路：layout → bootstrap → API 分片 → `makeCrudRoute` / 命令 / 服务；`src/di.ts` 是唯一「所有模块 DI 之后」的钩子',
      '哪些改动要重跑 `yarn generate`；`.mercato/generated/**`、`node_modules/**` 只读',
      '硬性约束：不跨模块 ORM 关联、实体放 `data/entities.ts`、可编辑记录带版本与 409',
    ],
  },
  {
    rel: 'docs/dev/business-architecture.md',
    gist: '公司实际业务与系统落地的对应关系：业务链路、模块归属、数据主源约定、已定决策与依据。',
    points: [
      '业务全景：国内采购 → 供应商直发 → 出口/在途 → 海外仓收货 → 平台履约 → 平台结算（多对多的采购单 ↔ 发运单）',
      '模块归属地图（自建 / 复用 / 按需启用）与「新增业务流程时的对齐规则」',
      '自建模块对官方模块的消费清单（界面层 API 调用 + 服务端实体/命令两处）',
      '业务术语 ↔ 系统单据对照表（PO / PI / CI / TI / SQ / PL / 合同 / 柜 …）',
      '开放问题清单（parties Phase 4、wms 轮、货代轨迹等）',
    ],
  },
  {
    rel: 'docs/dev/i18n.md',
    gist: '本部署只服务 en / zh 的语言体系与三个收窄入口。',
    points: [
      '三个收窄入口（layout filter / supported-locales resolver 槽 / 字典 default 分支）缺一不可',
      '硬规则「一条字符串只用一种语言」：界面走 `t()`、字典/种子只写显示名、导出文档按生成时语言',
      '字典位置与合并顺序（app 级 / 模块级 / 包内）；加一个新语言的步骤',
      '门禁：`language-purity.test.ts`（混排）与 `yarn i18n:check-hardcoded`（硬编码）',
    ],
  },
  {
    rel: 'docs/dev/currency-policy.md',
    gist: '启用币种清单（15 个外币 + CNY）与两份币种数据的收敛、汇率抓取与 CNY 换算显示。',
    points: [
      '两份币种存储分工：币种字典（`dictionaries`，自建下拉读它）与汇率主数据（`currencies`）',
      '清单唯一 owner `lib/policy.ts`；`yarn mercato currency_policy apply` 收敛规则（清单外关停/删除、幂等）',
      'OPEN_ER_API 抓取（CNY 基准）与 `yarn mercato currency_policy fetch-rates`；没有汇率不显示换算、绝不编数',
      '金额恒 2 位、单价恒 4 位（2026-09-28 统一）；已知边界：字典 label 由清单覆盖',
    ],
  },
  {
    rel: 'docs/dev/multi-company-org-model.md',
    gist: '一租户 + 组织树的多公司建模、角色矩阵、配置步骤与自查。',
    points: [
      '租户是隔离边界；分公司一律挂总部之下；本部署已有总部 / 俄罗斯 / 东南亚三组织',
      '角色矩阵：group-admin / hq-sales / hq-finance / 分公司 admin·operator·warehouse / hq-operator',
      '可见性三机制：组织白名单（含后代展开）、组织树、选中组织 cookie（`om_selected_org`）',
      '配置七步（组织 → 种子 → 角色 → 分发 → 仓库 → 账号 → 汇总）与三条自查；组织树写操作只留给总部',
    ],
  },
  {
    rel: 'docs/dev/navigation.md',
    gist: '自绘「域 → 模块 → 页面」侧边栏树：结构、维护入口、偏好与权限语义、已知限制与回滚。',
    points: [
      '8 个域：公司订单 / 财务 / 经营概览 / 仓储与库存 / 平台运营 / 数据同步 / 基础数据 / 系统',
      '单点真源 `nav_shell/lib/navTree.ts`；不进树的页面在 `TREE_EXCLUDED` 登记（coverage 测试兜底）',
      '权限：页面 `requireFeatures` 服务端过滤；偏好层级 = 角色 → 用户；隐藏与授权无关',
      '已知限制（设置类页面切侧栏、四层结构排序限制）与回滚步骤',
    ],
  },
  {
    rel: 'docs/dev/parallel-development.md',
    gist: '多单元并行开发：工作单元切分、worktree、dev 集成分支与波次收口、共享脊柱文件与 PR 规则。',
    points: [
      '一个模块 / 一个 spec 阶段 = 一个工作单元 = 一个分支 = 一个 PR = 一个 agent；开工前先认领',
      'worktree 两条路（Orca 命令与纯 git）；分支只做加法（`core.hooksPath` + `guard-tree` 钩子）',
      '`dev` 集成分支与「波次」收口：`yarn branches:cleanup` 的 trunk 段（in-sync / carrying / behind / diverged）',
      '共享脊柱文件清单与唯一开发库 / 端口分配注意点',
    ],
  },
]

// ---------------------------------------------------------------- ru-petkit docs

const RU_DOCS = [
  {
    rel: 'docs/ru-petkit/prd.md',
    title: '【外部系统】RU PETKIT · 系统功能 PRD（F-01…F-11）',
    state: 'Done',
    gist: '外部系统 RU PETKIT 的功能 PRD：11 页 F-01…F-11 的定位、口径、分级与验收（中文为准）。',
    points: [
      '11 条路由逐页功能 + 筛选维度 + 指标清单 + 可判定验收',
      '决策 × 频率 × 粒度（日 / 周 / 月）与对接价值分级',
      '核心指标口径（ДРР、两种 маржа、удержания、себестоимость、CPO/CPC/CTR、ROI 等）',
      '开放问题（发给俄方确认的清单）',
    ],
  },
  {
    rel: 'docs/ru-petkit/supply-sync-tech.md',
    title: '【外部系统】RU PETKIT · 对接需求总包 v2（17 个端点技术规范）',
    state: 'In Progress',
    gist: '给俄方技术团队的对接需求总包 v2：4 问直答 + 业务一页纸 + 术语对照 + 17 个逻辑端点技术规范。',
    points: [
      '语言约定：线上 JSON 只用英文；本文中文为对照，俄文仅在说明与原页引用',
      '金额口径强制：金额 2 位 / 单价 4 位、HALF_UP、链路只舍入一次',
      '第一阶段 supply 7 端点 + 第二阶段 ads 9 端点，端点级 schema、幂等与验收',
      '§A 勾选状态：成本毛利已放开；ФБО `data_updated_at`、`updated_since` 待俄方',
      '状态：Draft（等快照逐字段打勾后冻结）',
    ],
  },
  {
    rel: 'docs/ru-petkit/system-analysis.md',
    title: '【外部系统】RU PETKIT · 系统功能分析（逐页长文）',
    state: 'Done',
    gist: '逐页功能分析长文：页面功能、数据来源、决策 × 频率与价值分级（2026-09-28 只读取证）。',
    points: [
      '双子系统：АНАЛИТИКА（10 路由）+ ПОСТАВКИ（1 路由 4 tab）',
      '数据来源总表（Яндекс Директ / Я.Кит / Метрика / Ozon / Маркет / Вебмастер / Wordstat / 手工填报）',
      '页面级证据锚点（截图与导出样本）',
    ],
  },
  {
    rel: 'docs/ru-petkit/field-mapping.md',
    title: '【外部系统】RU PETKIT · 字段与维度需求清单 + 中方映射',
    state: 'Done',
    gist: '字段与维度需求清单 + 中方 7 模块映射锚点（只读源码、字段名照抄）。',
    points: [
      '中方锚点表：模块 → 实体/表 → 关键字段 → 幂等/编号规则',
      '6 域字段需求表（俄文原名 / 类型 / 粒度 / 必填 / 映射到中方 / 快照状态）',
      '未知格一律 `待快照确认`，不猜 `/api/v1` 结构',
    ],
  },
  {
    rel: 'docs/ru-petkit/integration-brief.md',
    title: '【外部系统】RU PETKIT · 发俄方对接 brief（架构 + 模块 + 接口规范）',
    state: 'Done',
    gist: '发俄方：本系统架构 + 10 模块清单 + HTTP 接口规范 + 分工待办（中文先行）。',
    points: [
      '架构要点：app 模块为业务面、installed 为引擎；跨模块只用标量 id + 快照；错误码语义（422/409/404）',
      '10 模块对外路由与幂等键（platform_ops / cross_border / export_finance / purchasing / …）',
      '订单 ingest 与结算 import 的字段规范与批量上限（500 / 批、2000 行 / 单）',
      '技术对接人单点：待用户确认',
    ],
  },
  {
    rel: 'docs/ru-petkit/evidence.md',
    title: '【外部系统】RU PETKIT · 取证证据包',
    state: 'Done',
    gist: '取证证据包：逐路由来源行、筛选器、指标、口径表、流转图与网络快照。',
    points: [
      '每条结论的来源行与截图锚点（11 张全页截图 + 导出样本）',
      '指标口径表（算式已用页数字验算）',
      '网络快照（如 `/ads/summary/daily.json`）与未知项标记',
    ],
  },
]

function docSummaryNode(anchor, rel, { gist, points, state = 'Done', title }) {
  const src = readDoc(rel)
  const nav = headings(src).map((h) => `- ${h}`).join('\n')
  return makeNode(anchor, {
    title: title || gistTitle(rel, '【开发文档】'),
    state,
    body: `
> 来源：[${rel}](<${repoLink(rel)}>)（仓库 \`dev\` 分支） · 同步于 ${SYNC_DATE} · 本 issue 为只读镜像，改动以仓库为准

**定位**：${gist}

**关键内容**：
${points.map((p) => `- ${p}`).join('\n')}

**章节导航**：
${nav}
`,
  })
}

function gistTitle(rel, prefix) {
  const src = readDoc(rel)
  const h1 = src.match(/^# (.+)$/m)
  if (!h1) throw new Error(`${rel} 缺少 H1`)
  return `${prefix}${h1[1].trim()}`
}

function devNodes() {
  const docs = DEV_DOCS.filter((doc) => hasDoc(doc.rel))
  if (docs.length < DEV_DOCS.length) {
    console.warn(`⚠ 文档源里缺少 ${DEV_DOCS.length - docs.length} 份 dev 文档，跳过（用 --docs-root 指向完整的工作树）`)
  }
  const nodes = []
  nodes.push(makeNode('dev#epic', {
    title: `【开发文档】docs/dev 开发文档集（${docs.length} 份）`,
    state: 'Done',
    body: `
> 来源：[docs/dev/](<${repoLink('docs/dev/README.md')}>)（仓库 \`dev\` 分支） · 同步于 ${SYNC_DATE}

**定位**：环境搭建、架构说明、关键机制的实现方式、本地调试手法。

**文档清单**：
${docs.map((d) => `- [${d.rel.split('/').pop()}](${repoLink(d.rel)})`).join('\n')}
`,
  }))
  for (const doc of docs) {
    nodes.push(docSummaryNode(`dev/${doc.rel.split('/').pop()}`, doc.rel, doc))
  }
  return nodes
}

function ruNodes() {
  const docs = RU_DOCS.filter((doc) => hasDoc(doc.rel))
  if (docs.length < RU_DOCS.length) {
    console.warn(`⚠ 文档源里缺少 ${RU_DOCS.length - docs.length} 份 ru-petkit 文档，跳过`)
  }
  const nodes = []
  nodes.push(makeNode('ru-petkit#epic', {
    title: '【外部系统】RU PETKIT 对接（docs/ru-petkit，外部系统调研）',
    state: 'In Progress',
    body: `
> 来源：[docs/ru-petkit/](<${repoLink('docs/ru-petkit/README.md')}>)（仓库 \`dev\` 分支） · 同步于 ${SYNC_DATE}

**定位**：俄罗斯 PETKIT 外部系统（\`report.petkit-api.ru\`）的只读调研与对接文档——**不是**本仓库自研 ERP。本仓对接实现见 \`ru_sync\` / \`finance\` / \`boss_cockpit\`。

**文档清单**：
${docs.map((d) => `- [${d.rel.split('/').pop()}](${repoLink(d.rel)})`).join('\n')}
`,
  }))
  for (const doc of docs) {
    nodes.push(docSummaryNode(`ru-petkit/${doc.rel.split('/').pop()}`, doc.rel, doc))
  }
  return nodes
}

// ---------------------------------------------------------------- spec status board

function indexNodes() {
  const rel = 'docs/plans/README.md'
  const src = readDoc(rel)
  const board = sectionBetween(src, '## 规格状态板（`.ai/specs/`）', '## 索引')
  const index = src.slice(src.indexOf('## 索引'))
  return [makeNode('index/spec-status-board', {
    title: '【索引】规格状态板（.ai/specs 快照）',
    state: 'Backlog',
    body: `
> 来源：[${rel}](<${repoLink(rel)}>)（仓库 \`dev\` 分支） · 同步于 ${SYNC_DATE}

**定位**：\`.ai/specs\` 规格状态的快照；**权威状态是每份 spec 自身的 \`**Status**\` 行**，本 issue 只作人读总览。状态随时会变，重跑同步即可刷新。

## 规格状态板

${board.trim()}

${index.trim()}
`,
  })]
}

// ---------------------------------------------------------------- assembly

export function buildPayloads() {
  const nodes = [
    ...crossBorderPrd(),
    ...financePrd(),
    ...lookupPrd(),
    ...plansNodes(),
    ...devNodes(),
    ...ruNodes(),
    ...indexNodes(),
  ].map((node) => ({ ...node, body: absLinks(node.body, anchorDoc(node.anchor)) }))

  const seen = new Set()
  for (const node of nodes) {
    if (seen.has(node.anchor)) throw new Error(`anchor 重复：${node.anchor}`)
    seen.add(node.anchor)
    if (node.parentAnchor && !seen.has(node.parentAnchor)) {
      throw new Error(`父节点必须先于子节点：${node.anchor} → ${node.parentAnchor}`)
    }
  }
  return nodes
}

// Prefer the most specific doc path for relative-link resolution.
function anchorDoc(anchor) {
  const withMd = (p) => (p.endsWith('.md') ? p : `${p}.md`)
  const mapping = {
    'prd/': (a) => withMd(`docs/prd/${a.split('/')[1].split('#')[0]}`),
    'plans/': (a) => withMd(`docs/plans/${a.split('/')[1].split('#')[0]}`),
    'plans#': () => 'docs/plans/README.md',
    'dev#': () => 'docs/dev/README.md',
    'dev/': (a) => withMd(`docs/dev/${a.split('/')[1]}`),
    'ru-petkit#': () => 'docs/ru-petkit/README.md',
    'ru-petkit/': (a) => withMd(`docs/ru-petkit/${a.split('/')[1]}`),
    'index/': () => 'docs/plans/README.md',
  }
  for (const [prefix, resolve] of Object.entries(mapping)) {
    if (anchor.startsWith(prefix)) return resolve(anchor)
  }
  throw new Error(`无法定位 anchor 来源文档：${anchor}`)
}
