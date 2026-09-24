# 沙箱脚本让 `yarn build` 失败

## 现象

`yarn build` 在 `Running TypeScript` 阶段失败，18 个错误全在
`src/modules/agent_examples/agents/**/{scripts,tools}/*.ts`：

```
src/modules/agent_examples/agents/company_researcher/skills/deal_qualification/scripts/score.ts(8,10):
  error TS2393: Duplicate function implementation.
src/modules/agent_examples/agents/company_researcher/skills/deal_qualification/scripts/score.ts(8,14):
  error TS7006: Parameter 'args' implicitly has an 'any' type.
```

`yarn dev` 一切正常，只有构建挂。

## 时间线

| 时刻 | 事件 |
|---|---|
| 首次 clone 后 | `yarn dev` 可用，没人跑过 `yarn build` |
| `yarn build` | `Creating an optimized production build` 成功 → `Running TypeScript` 失败 |
| 排查 | 在 HEAD 的独立 worktree 里只编译 `agent_examples/**` → 同样 18 个错误，确认与本次改动无关 |

## 证据

错误文件里**没有任何 import/export**：

```ts
// Sandboxed skill helper. Pure function of its args — no fs/net/imports.
function run(args) { … }
function numberOr(value, fallback) { … }
function clamp01(value) { … }
```

没有 import/export 的 `.ts` 会被 tsc 当作**全局脚本**，于是多个文件里同名的
`clamp01` / `numberOr` / `run` 互相冲突 → `TS2393`；没标注类型的参数 → `TS7006`。

## 根因

这些文件**不是模块**，是数据。file-agent 生成器用 `fs` 读它们的源码，
包成 `async () => { <source>; run(__args) }` 后在 `isolated-vm` 里执行。
它们躺在 `tsconfig.json` 的 `include: ["**/*.ts"]` 覆盖范围内，于是被 tsc 收进了程序。

框架的 `agent_orchestrator/AGENTS.md` 已把这条写成硬约束：

> Never let `agents/**/scripts/**` or `agents/**/tools/**` into a package/app's typed build
> — they are raw sandbox sources read by the generator via `fs`, never imported.
> The consuming `tsconfig.json` MUST `exclude` those globs.

本仓的 `tsconfig.json` 少了这个 `exclude`——这是脚手架的缺口，不是使用者写错代码。

## 处置

```jsonc
// tsconfig.json
"exclude": [
  "node_modules",
  "src/modules/*/agents/**/scripts/**",
  "src/modules/*/agents/**/tools/**"
]
```

改完 `yarn typecheck` 与 `yarn build` 都通过。

## 相关规则

同一条规则的可执行版本：`.ai/lessons/agent-sandbox-sources-tsconfig.md`（agent 读的短规则，本文只留现场证据）。

## 如何避免

- **不要**在那些文件里加 `export {}`、类型标注或 `@ts-nocheck` 来「修」错误：
  源码会被原样包进沙箱执行，改动会直接改变沙箱里的行为（`export {}` 在
  `async () => { … }` 体内是语法错误，会让脚本彻底不可用）。
- 启用任何带 `agents/**` 的模块（这里是 `agent_examples`，随
  `OM_ENABLE_ENTERPRISE_MODULES_AGENTS` 打开）后，把 `yarn build` 纳入验收，
  别只验 `yarn dev`——dev 不做类型检查（见 [dev/setup.md](../dev/setup.md)）。
- 判断一个构建错误是不是自己引入的：在 HEAD 的独立 worktree 里用最小 `tsconfig`
  只编译出错目录，能立刻区分「历史遗留」与「本次引入」。
