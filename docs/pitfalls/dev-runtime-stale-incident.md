# dev 面板「运行时已降级」但错误早已修复

## 现象

dev 运行时诊断面板持续显示：

```
运行时已降级 · Runtime error detected
⨯ ./src/lib/i18n/register-dictionary-loader.ts:19:14
```

应用本身完全正常（页面能开、接口 200），但面板一直红着，刷新不掉。

## 时间线（本机 2026-09-21，UTC+8）

| 时刻 | 事件 |
|---|---|
| 10:59:43 | 改 `register-dictionary-loader.ts`，让它 `import('../../i18n/zh.json')` |
| 10:59:43 | Turbopack 同秒重编译 → `Module not found` → 记入 incident `1-1` |
| 11:00:50 | `src/i18n/zh.json` 落盘（晚 67 秒） |
| 11:00 起 | 编译恢复正常，日志里再没有该错误；incident `occurrences` 停在 **1** |
| 11:23:59 | 触发 restart action → generation 1 → 2 → incident 清空，health 回到 `ready` |

## 证据

错误原文（`.mercato/logs/*-app-raw.log`）：

```
⨯ ./src/lib/i18n/register-dictionary-loader.ts:19:14
Error: Module not found: Can't resolve '../../i18n/zh.json'
  18 |     case 'zh':
> 19 |       return import('../../i18n/zh.json').then((module) => module.default)
Import trace:
  App Route: ./src/lib/i18n/register-dictionary-loader.ts → ./src/bootstrap-common.ts → …
```

- 文件 mtime 与事故时间戳对得上：loader `10:59:43`、`zh.json` `11:00:50`
- `.mercato/dev-runtime-status.json`：`occurrences: 1`，`firstSeenAt == lastSeenAt`
- 日志里同一错误重复 25 次（每次 HMR 重试一次），最后一次在第 709 行 / 共 1785 行

## 根因

**两层原因叠加**：

1. **直接原因**：先改了引用、后建了被引用文件，中间 67 秒的编译窗口必然失败。
   这是编辑顺序问题，不是代码问题。
2. **面板不回收**：`scripts/dev-runtime-state.mjs` 里 incident 没有按时间回收的机制，只有三类清理路径——
   `beginGeneration()`（托管进程重启时 `state.incidents.clear()`）、`markReady()`
   （只清**当前代次**且 `blocking` 的 incident）、以及 supervisor 的 `clearIncidentsBySource('probe')`
   （探测恢复时清掉 `probe` 来源的条目）。编译类 incident 既不是 blocking 也不是 probe，于是
   `ready: true / failed: false` 却 `health: degraded`，永远留在状态文件里。

## 处置

用面板自己的 restart action（带 token POST；恢复动作只有 `generate` / `migrate` / `restart` 三个）。
两条等价入口：应用内的 `/api/dev-runtime/actions/<action>`（会校验 token 与 Origin），或 supervisor 自己的
`/runtime/actions/<action>`。端口用 dev 日志 `Local:` 行里的实际端口（见 [setup.md](../dev/setup.md)）：

```bash
T=$(python3 -c "import json;print(json.load(open('.mercato/dev-runtime-status.json'))['token'])")
curl -s -X POST http://localhost:3100/api/dev-runtime/actions/restart \
  -H "x-om-dev-runtime-token: $T" -w '\nHTTP %{http_code}\n'
```

结果：`generation 1 → 2`、`health degraded → ready`、`incidents []`、`issueSummary None`。

面板上的「忽略 / Dismiss」只是前端隐藏，状态文件仍为 `degraded`——想真清掉就重启。

## 如何避免

- **建文件再改引用**：新增字典/模块/生成物目标时，先让文件存在，再改 import。
  中间态会被 dev server 立刻编译。
- 看到这个面板先看 `occurrences` 与 `lastSeenAt`：`occurrences: 1` 且 `lastSeenAt`
  是过去某个时刻 = 陈旧事故，不是活错误；对一下文件 mtime 就能确认。
- 判断「真的还坏着」的可靠办法是直接打接口，不是看面板。
- 注意区分端口：本项目的 dev app 落在哪个端口以 supervisor 日志的 `Local:` 行为准
  （对外基址来自 `.env` 的 `APP_URL`，本机端口块是 `3100`；被占用时会落到空闲端口并打印出来，
  [setup.md](../dev/setup.md)）。别把另一个项目的服务当成自己的。
