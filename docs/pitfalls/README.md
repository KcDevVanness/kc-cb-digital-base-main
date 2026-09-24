# pitfalls — 踩坑经验沉淀

**放**：值得写给下一个人的故障复盘——现象、时间线、日志证据、根因、处置、怎么避免。

**不放**：一句话就能说清的代码规则（→ `.ai/lessons/`）、需求与计划。

命名与章节骨架见 [`../README.md`](../README.md)。

## 与 `.ai/lessons/` 的分工

踩坑只留**一处**：

| | `.ai/lessons/<slug>.md` | `docs/pitfalls/<slug>.md` |
|---|---|---|
| 读者 | 编码 agent | 人 |
| 形态 | 短，`Context / Problem / Rule / Applies to` | 长，含时间线与证据 |
| 判据 | 能写成一条可执行规则 | 需要还原现场才能说清 |
| 校验 | `node scripts/check-lessons.mjs` | 人工评审 |
| 触发 | 根 `AGENTS.md` 要求每个任务先扫 | 事后沉淀 |

同一件事两边都写必然漂移。若 `docs/pitfalls/` 里的事已经有对应 lesson，
正文里链接过去，不要重写。

## 索引

| 文档 | 一句话 | 对应 lesson |
|---|---|---|
| [dev-runtime-stale-incident.md](./dev-runtime-stale-incident.md) | dev 面板显示「运行时已降级」，但错误早已修复——incident 只在进程代次变更时回收 | — |
| [dictionary-delete-is-not-locale-removal.md](./dictionary-delete-is-not-locale-removal.md) | 删掉语言字典 ≠ 去掉一门语言，切换器仍会列出它 | `.ai/lessons/locale-served-set-seams.md` |
| [agent-sandbox-scripts-break-the-build.md](./agent-sandbox-scripts-break-the-build.md) | 沙箱脚本被 tsc 当全局脚本，`yarn build` 报 TS2393 | `.ai/lessons/agent-sandbox-sources-tsconfig.md` |
| [radix-popover-spins-jsdom-event-loop.md](./radix-popover-spins-jsdom-event-loop.md) | jsdom 下挂载 Radix 浮层会自旋饿死定时器，用例极慢或 findBy 超时 | — |
