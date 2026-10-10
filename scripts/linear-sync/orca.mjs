// Orca CLI ⇄ Linear wrapper for scripts/linear-sync.
//
// Everything goes through the Orca CLI (`orca linear …`) — the same connected
// workspace the agent session uses, so no Linear API token is stored anywhere.
// Writes are single-attempt: `linear_write_unconfirmed` means the write may or
// may not have landed, so every writer here reads back before retrying.
import { spawnSync } from 'node:child_process'

export const WORKSPACE_ID = 'f5d1e884-ac15-4650-b2fd-ad37113bcb3c'
export const TEAM_KEY = 'SP'
export const PROJECT_ID = '574444f8-6aab-4715-b2c4-1e5ebe95d509'

// /usr/local/bin/orca is a root-only symlink on this machine; use the app path
// or ORCA_CLI_COMMAND when running inside an Orca-managed terminal.
const ORCA = process.env.ORCA_CLI_COMMAND || '/Applications/Orca.app/Contents/Resources/bin/orca'

export function orca(args, { input } = {}) {
  const res = spawnSync(ORCA, args, { encoding: 'utf8', input, maxBuffer: 128 * 1024 * 1024 })
  if (res.error) throw new Error(`无法运行 Orca CLI（${ORCA}）：${res.error.message}`)
  const stdout = (res.stdout || '').trim()
  let json = null
  try {
    json = JSON.parse(stdout)
  } catch {
    // non-JSON output (help text, runtime errors) — caller reads stdout/stderr
  }
  return { status: res.status, json, stdout, stderr: (res.stderr || '').trim() }
}

function isUnconfirmed(r) {
  return r.json?.error?.code === 'linear_write_unconfirmed'
}

export function listProjectIssues() {
  const r = orca([
    'linear', 'list-issues',
    '--team', TEAM_KEY,
    '--project', PROJECT_ID,
    '--workspace', WORKSPACE_ID,
    '--json',
  ])
  if (!r.json?.ok) throw new Error(`list-issues 失败：${r.stdout || r.stderr}`)
  const result = r.json.result || {}
  return result.issues || result.nodes || result.data || []
}

export function listChildren(identifier) {
  const r = orca([
    'linear', 'list-issues',
    '--team', TEAM_KEY,
    '--parent-id', identifier,
    '--workspace', WORKSPACE_ID,
    '--json',
  ])
  if (!r.json?.ok) return null
  const result = r.json.result || {}
  return result.issues || result.nodes || result.data || []
}

export function readIssue(identifier) {
  const r = orca(['linear', 'issue', identifier, '--workspace', WORKSPACE_ID, '--json'])
  if (!r.json?.ok) return null
  return r.json.result?.issue || null
}

function findByTitle(title) {
  return listProjectIssues().find((issue) => issue.title === title) || null
}

export function createIssue({ title, body, state, parent }) {
  const args = [
    'linear', 'create',
    '--title', title,
    '--team', TEAM_KEY,
    '--project', PROJECT_ID,
    '--state', state,
    '--body-file', '-',
    '--json',
  ]
  if (parent) args.push('--parent', parent)

  let r = orca(args, { input: body })
  if (r.json?.ok) return r.json.result.issue

  if (isUnconfirmed(r)) {
    const landed = findByTitle(title)
    if (landed) return landed
    const writeId = r.json?.error?.data?.writeId
    if (writeId) {
      r = orca([...args, '--write-id', writeId], { input: body })
      if (r.json?.ok) return r.json.result.issue
    }
  }
  throw new Error(`create 失败：${title}\n${r.stdout || r.stderr}`)
}

export function updateIssue(identifier, { title, body, state, parent }) {
  const args = [
    'linear', 'save-issue', identifier,
    '--title', title,
    '--state', state,
    '--body-file', '-',
    '--json',
  ]
  if (parent) args.push('--parent-id', parent)

  let r = orca(args, { input: body })
  if (r.json?.ok) return r.json.result.issue

  if (isUnconfirmed(r)) {
    const current = readIssue(identifier)
    if (current && current.title === title) return current
    const writeId = r.json?.error?.data?.writeId
    if (writeId) {
      r = orca([...args, '--write-id', writeId], { input: body })
      if (r.json?.ok) return r.json.result.issue
    }
  }
  throw new Error(`save-issue 失败：${identifier}\n${r.stdout || r.stderr}`)
}
