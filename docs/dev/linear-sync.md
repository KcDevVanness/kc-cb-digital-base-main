# 文档 → Linear 同步（scripts/linear-sync）

## 适用范围

- 把 `docs/**` 的文档同步进 Linear 项目 **kc-cb-digital-base-main**（工作区 `sp-kc-dev`，团队 `SP`）时。
- 文档更新后**重跑**同步、或核对 Linear 上的内容与仓库是否一致时。

不适用于：Linear 上的 issue 状态回写仓库（单向：仓库 → Linear）；Linear 日常工单操作（那用 Orca 的
`orca linear …` 命令即可，见 `skill://orca-linear`）。

## 它做什么

`node scripts/linear-sync/sync.mjs` 读取文档并生成 **104 条**（当前口径）issue 的 payload：

| 来源 | Linear 映射 |
|---|---|
| `docs/prd/cross-border-erp.md` | 1 个需求 epic + A–G 需求组 + 逐条需求（A-1…D-4，共 40 条）+ 整体验收清单 + 开放问题 |
| `docs/prd/finance-and-cockpit.md` | 1 个需求 epic + 验收 1–8 逐条 + 开放问题 |
| `docs/prd/lookup-field-dropdown.md` | 1 个需求 epic + 验收 1–7 逐条 + 开放问题 |
| `docs/plans/*.md` | 1 个里程碑 epic + 阶段逐条（跨境 ERP 5 + 财务与驾驶舱 8 + 选择器 3）+ 历史补记 |
| `docs/dev/*.md` | 每份文档 1 条【开发文档】：摘要 + 章节导航 + 仓库链接（只读镜像） |
| `docs/ru-petkit/*.md` | 每份文档 1 条【外部系统】摘要 issue |
| `docs/plans/README.md` | 1 条【索引】规格状态板快照 |

规则：

- **标题前缀**（Linear 里无法用 CLI 建中文 label）：`【需求】【里程碑】【开发文档】【外部系统】【索引】`。
- **状态映射**：文档写「已实现并验证 / ✅」→ `Done`；「进行中」→ `In Progress`；「未开始」→ `Todo`；开放问题/索引 → `Backlog`。
- **正文首行**埋 `<!-- kc-sync:<anchor> -->` 标记，`scripts/linear-sync/manifest.json` 记录 anchor → issue ID 与内容哈希；重跑时哈希一致就跳过，变了才 `save-issue` 更新。
- 文档里的相对链接会被改写成 `https://github.com/KcDevVanness/kc-cb-digital-base-main/blob/dev/<路径>`（Linear 不解析相对链接）。
- 写入会逐条**回读校验**（标题 / 状态 / 项目 / 正文长度）：Orca→Linear 的写入偶发 `linear_write_unconfirmed`（报错但实际已落库），以回读结果为准。

## 用法

```bash
# 预览（不写）：打印每条 issue 的 action 与标题
node scripts/linear-sync/sync.mjs --docs-root <文档所在工作树>

# 写入 / 重跑（幂等，按 manifest 哈希跳过未变化的条目）
node scripts/linear-sync/sync.mjs --apply --docs-root <文档所在工作树>

# 只同步某个子树（anchor 含该子串）
node scripts/linear-sync/sync.mjs --apply --only prd/cross-border-erp --docs-root <文档所在工作树>

# 强制重写（忽略哈希）；或只做结构与父子关系审计
node scripts/linear-sync/sync.mjs --apply --force --docs-root <文档所在工作树>
node scripts/linear-sync/sync.mjs --audit --docs-root <文档所在工作树>
```

- **`--docs-root` 什么时候要**：文档当前状态领先于本分支时可指向另一个工作树（例如 2026-10-08 同步时
  `docs/dev/navigation.md` 只存在于本地 `dev`，指向了 `../kc-cb-digital-base-min`）；缺省的根是脚本所在仓库。
  指向哪个根、哪个提交，会记进 manifest 的 `docs` 字段。
- **前置**：Orca app 在运行且已连接 Linear；CLI 路径取 `ORCA_CLI_COMMAND`，缺省用
  `/Applications/Orca.app/Contents/Resources/bin/orca`（`/usr/local/bin/orca` 在本机是 root 权限的符号链接，普通 shell 解析不了）。
- 写入是顺序的（约 1–3 秒/条，104 条约 5–10 分钟）；中断后直接重跑，manifest 已落库的条目会自动跳过。

## 注意事项

- **单向**：Linear 是仓库的只读镜像；改内容改仓库文档，然后重跑同步。
- **不删 issue**：同步只创建/更新；文档里删掉的内容不会自动移除对应 issue（Orca CLI 没有删除命令，需要在 Linear 界面处理）。
- 项目里程碑（Milestones）与 Linear 文档（Documents）没有 CLI 接口，所以「阶段」用父 issue（epic）表达；
  若要在 Linear 建真 milestone，需要在界面手动建，且 CLI 无法把 issue 挂到 milestone。
- 首次同步的 104 条之外，Linear 里另有 SP-1…SP-4（Linear 自带 onboarding 样例）与 SP-5/6/7（调研期自检探针，
  已置 Canceled）——都可直接在界面删除。

## 文件

| 文件 | 作用 |
|---|---|
| `sync.mjs` | 编排：dry-run / apply / audit、manifest、哈希跳过、写后回读校验 |
| `payloads.mjs` | 拆解规则：解析文档、状态映射、标题/正文组装、链接改写 |
| `orca.mjs` | Orca CLI 包装（create / save-issue / 回读 / unconfirmed 处理） |
| `manifest.json` | anchor → Linear issue ID / 哈希 / 文档源提交（提交进仓库，重跑靠它） |

## 验证方式

```bash
# 1) dry-run 应打印 104 条（含状态分布）；全部为 create 或 skip，不应有 update（除非文档有改动）
node scripts/linear-sync/sync.mjs --docs-root /Users/vanness/Developer/kc-cb-digital-base-min

# 2) 审计：项目内 104 条齐全、父子关系正确
node scripts/linear-sync/sync.mjs --audit --docs-root /Users/vanness/Developer/kc-cb-digital-base-min

# 3) Linear 侧抽查：项目 kc-cb-digital-base-main 的 issue 数 = 104（另有探针/样例除外）
```

```bash
orca=/Applications/Orca.app/Contents/Resources/bin/orca
$orca linear list-issues --team SP --project 574444f8-6aab-4715-b2c4-1e5ebe95d509 \
  --workspace f5d1e884-ac15-4650-b2fd-ad37113bcb3c --json | jq '.result.issues | length'
```
