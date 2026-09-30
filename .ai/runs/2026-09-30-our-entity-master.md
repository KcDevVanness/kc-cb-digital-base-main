# Execution plan — 我方主体 master (our entity profiles keyed by organization) (2026-09-30)

The owner reviewed where the 我方主体（主数据）picker got its data and answered that the source is
wrong: our own side of a document is **an organization** (the group company or one of its
subsidiaries), never a trading party. They chose option **A**: an app-owned profile per organization
(name from the organization, address/contact and encrypted bank accounts from the profile), with the
document pickers reading the organization list.

## Goal

`/backend/our-parties` maintains one profile per company we trade as; the contract / PI / CI /
tax-invoice 我方主体 picker lists our organizations and fills the printed head (name, address,
contact) and the beneficiary bank from the picked company's profile — and says so plainly when a
company has no profile yet. The document snapshot gains `organizationId`; existing `partyId`
snapshots stay readable, nothing is migrated.

## Scope

- New app module **`our_parties`**: entities `OurPartyProfile` (`our_parties_profiles`) and
  `OurPartyBankAccount` (`our_parties_bank_accounts`, encrypted bank block, partial unique default),
  validators, three commands (create/update/delete with subrow replace, optimistic lock, undo,
  events), CRUD + aggregate-detail routes, ACL (`our_parties.view` / `our_parties.manage`),
  `setup.ts` defaults, `encryption.ts`, generated migration, maintenance pages + components + i18n.
- `src/modules.ts`: register the module, add its nav group to the group order.
- `src/lib/orgs/organizationOptions.ts`: `organizationChainEntries` — the set a picker offers when a
  record is *about* one of our companies (self + ancestors + descendants).
- `trade_docs`: `loadOurPartyProfile` loader, `useOurPartyOrganizations` hook, the rewritten
  `OurPartyPicker` (organization options + profile fill + bank select + no-profile hint), and the
  snapshot read/write switch from `partyId` to `organizationId` in both form value mappers.
- Docs: this module's README + the new spec, the trade-docs README's our-party note, the role matrix
  in `docs/dev/multi-company-org-model.md`, the plan rows.
- Non-goals: no change to the counterparty (`parties`) master, no data migration of existing
  documents, no seeding of business data (addresses/bank accounts are the operator's to enter), no
  search surface for the new entity.

## Implementation plan

### Phase 1: module + server

- 1.1 module scaffolding (index/acl/setup/encryption), entities, validators, `src/modules.ts`
  registration, generated migration.
- 1.2 commands with subrow replace + undo + lock + events; CRUD and aggregate-detail routes;
  command unit tests.

### Phase 2: maintenance UI

- 2.1 list / create / edit pages with page metadata, table component, form component (bank block
  reused from `parties`), zh/en dictionaries.

### Phase 3: trade-docs integration

- 3.1 `loadOurPartyProfile` + `useOurPartyOrganizations` + picker rewrite; snapshot key switch in
  both forms; i18n.

### Phase 4: docs, gate, smoke

- 4.1 spec status/changelog, module README, trade-docs README, role matrix, plan rows.
- 4.2 full gate; browser smoke (create → list → edit → encrypted write → delete; contract form
  autofill and the no-profile hint).

## Risks / Assumptions

- The profile's `organization_id` is the **subject** company (not the acting scope), validated
  against the caller's readable organizations; the framework's scoped reads then answer "may I see
  this company's profile" without extra predicates.
- Encryption covers the bank block only: our address/contact is the company's own letterhead.
  Existing tenants need `yarn mercato entities seed-encryption --tenant <id>` once (run on dev).
- A profile-less (or unreadable) company degrades to "name only, fields editable" — the behaviour a
  hand-written document always had.

## Verification

| 项 | 结果 |
|---|---|
| `yarn generate` | ✓ |
| `yarn typecheck` | 0 错 |
| `yarn lint` | 0 error（8 既有 warning） |
| `node scripts/check-lessons.mjs` | ✓ |
| `yarn ds:check` | 976 files passed |
| `yarn test` | 62 suites / 525 passed（含新模块 7 例） |
| `yarn build` | ✓（Next 16.3.3） |
| 浏览器实测（dev server 3002） | 列表页（公司名/城市/联系人由组织 payload 解析）→ 新建（选组织 + 地址/联系人 + 银行行默认勾选）→ 编辑 → 银行改名后 **DB 密文**（`F9j0KCPP…`）且详情接口解密回读 → 删除（软删，`deleted_at` 落库）；合同新建页选同一组织 → 名称/地址/联系人/银行回填；选未建档组织 → 只带名称 + 「该公司还没有档案」提示 |

## Progress

PR: （本单元 PR 建成后补）

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: module + server

- [x] 1.1 scaffolding + entities + migration
- [x] 1.2 commands + routes + unit tests

### Phase 2: maintenance UI

- [x] 2.1 pages + components + i18n

### Phase 3: trade-docs integration

- [x] 3.1 profile loader + picker + snapshot key

### Phase 4: docs, gate, smoke

- [x] 4.1 docs
- [x] 4.2 gate + browser smoke
