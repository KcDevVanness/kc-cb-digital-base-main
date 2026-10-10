# scripts/linear-sync

把 `docs/**` 同步进 Linear 项目 **kc-cb-digital-base-main**（工作区 `sp-kc-dev`，团队 `SP`）的可重跑脚本。
映射规则、用法与注意事项见 [`docs/dev/linear-sync.md`](../../docs/dev/linear-sync.md)。

```bash
node scripts/linear-sync/sync.mjs --docs-root <文档工作树>          # dry-run
node scripts/linear-sync/sync.mjs --apply --docs-root <文档工作树>  # 写入 / 重跑
node scripts/linear-sync/sync.mjs --audit --docs-root <文档工作树>  # 结构审计
```

| 文件 | 作用 |
|---|---|
| `sync.mjs` | 编排：dry-run / apply / audit、manifest、哈希跳过、写后回读校验 |
| `payloads.mjs` | 拆解规则：解析文档、状态映射、标题/正文组装、链接改写 |
| `orca.mjs` | Orca CLI 包装（create / save-issue / 回读 / `linear_write_unconfirmed` 处理） |
| `manifest.json` | anchor → Linear issue ID / 内容哈希 / 文档源提交；提交进仓库，重跑靠它去重 |

前置：Orca app 在运行且已连接 Linear。CLI 路径取 `ORCA_CLI_COMMAND`，缺省
`/Applications/Orca.app/Contents/Resources/bin/orca`（本机 `/usr/local/bin/orca` 是 root 权限符号链接，普通 shell 不可用）。
