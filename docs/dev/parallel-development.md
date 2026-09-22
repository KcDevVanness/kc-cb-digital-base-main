# 多路并行开发（worktree + PR 流水线）

## 适用范围

多个人 / 多个 agent **同时**改本仓时的工作方式：并行单元怎么切、工作树怎么开、哪些文件会撞、
数据库与端口怎么分、PR 怎么合。

不适用于：单次改动的流程（→ 根 `AGENTS.md` 的三轴路由）、上线与生产环境（→ `../deploy/`）、
故障复盘（→ `../pitfalls/`）。

## 结论

可行，而且本仓的模块边界天然适合并行：一个 app 模块就是一个目录（`src/modules/<id>/**`），
生成物 `.mercato/generated/**` 已被 gitignore、每个工作树自己 `yarn generate`。

真正的瓶颈不是 git，而是**共享脊柱文件**（下面有清单）和**唯一一套开发库**。

## 并行单元与所有权

- **一个模块 / 一个 spec 阶段 = 一个工作单元 = 一个分支 = 一个 PR = 一个 agent。**
- **同一模块禁止并行**：两个 agent 改同一个模块的实体/命令/迁移必然互相覆盖。
- 跨模块协作只走 ID / 快照 / 事件 / enricher / 可选 DI（本仓硬性约束），不要进对方目录改代码。
- 每个工作单元一份 spec（`.ai/specs/<date>-<name>.md`）或一份计划（`docs/plans/`），
  PR 的 body 里写 `Source doc:`，这样中断后任何 agent 都能接手。

## 工作树与分支

每个 agent 一个工作树：各自独立的 `.next/`、`.mercato/generated/`、`.env`（本地副本，见端口一节）。

**Orca（本机已装，`/Applications/Orca.app`）**

```text
ORCA worktree create --name <task> --agent omp --prompt "<brief>" --json   # 开树 + 在该树里起一个 agent
ORCA worktree list --repo id:<repoId> --json
ORCA worktree set --worktree active --comment "…" --workspace-status in-review --json
ORCA terminal read --terminal <handle> --json                              # 读回 agent 进度
ORCA worktree rm --worktree <selector> --force --json
```

> **本机注意**：`/usr/local/bin/orca` 是指向 app 内脚本的符号链接、权限 `lrwx------`（root），
> 普通 shell 解析不了（报 `Unable to determine Orca.app path from symlink`）。直接用
> `/Applications/Orca.app/Contents/Resources/bin/orca`，或在 Orca 自己的终端里用 `$ORCA_CLI_COMMAND`。
> 命令要求 Orca app 正在运行，否则返回 `runtime_unavailable`。

**纯 git 等价（没装 Orca / CI 机器上）**

```bash
git worktree add ../kc-cb-digital-base-min-<slug> -b feat/<slug> origin/main
cd ../kc-cb-digital-base-min-<slug> && yarn install && yarn generate
```

分支命名：新能力 `feat/<slug>`，修缺陷 `fix/<slug>`。**不要**在共享的 `main` 上直接提交。

## 共享脊柱文件（冲突清单）

| 文件 | 为什么撞 | 规则 |
|---|---|---|
| `src/modules.ts` | 每个新模块加一行 | 只追加；后合者 rebase 时保留双方的行 |
| `src/i18n/{en,zh}.json` | app 级字典 | 只追加 key，禁止重排或整体重写 |
| `src/lib/i18n/__tests__/dictionary-fallback.test.ts` | 断言依赖字典内容 | 不要写死具体 key（本仓已因此变红过一次） |
| `docs/*/README.md` 的索引表 | 每篇新文档加一行 | 只追加一行 |
| `.ai/lessons.md` + `.ai/lessons/*.md` | 每个 agent 加一条目录行 | 只追加；`node scripts/check-lessons.mjs` 必须过 |
| `.ds-check-ignore`、`eslint.config.mjs`、`jest.config.cjs`、`next.config.ts` | 工具配置 | 一波内指定一个 owner，其他人不动 |
| `AGENTS.md`、`.ai/agentic.config.json`、`.ai/trackers/*` | 路由与流水线配置 | 同上 |
| `.ai/guides/**`、`.ai/harness/manifest.json`、`.ai/guides/upstream/manifest.json` | harness 重新生成 | 冲突不要手工合：重跑 `yarn mercato agentic:init --update-harness` 取当前版本 |
| `src/app/api/[...slug]/route.ts` | API 统一分发 | 极少改；要改先声明 |
| `src/modules/<id>/migrations/*.ts` | 同模块内迁移顺序 | 同模块不并行即可规避；跨模块各自目录，不撞 |

**不撞的**（可以放心并行）：`src/modules/<id>/**` 整个目录、`docs/<type>/<新文件>.md`、
`.ai/specs/<date>-<name>.md`、`.ai/analysis/*`。

## 数据库与端口

**一套开发库是共享资源**：任何分支跑 `yarn db:migrate` 都会改它。

- 迁移只允许加表 / 加列；**禁止**在别人可能运行期间执行破坏性迁移、`yarn db:reset`、`yarn db:greenfield`。
- 需要破坏性改动时另起一套栈：`docker-compose.fullapp.dev.yml` 已参数化
  （`POSTGRES_PORT` / `REDIS_PORT` / `MEILISEARCH_PORT` / `LOCALSTACK_PORT` / `MERCATO_STACK`），
  复制 `.env` 并把端口块换一组即可。
- **每个工作树一份端口块**：`.env` 顶部的 "PROJECT-LOCAL PORT ALLOCATION" 就是为此设计的
  （app 3100 / splash 4100 / postgres 5532 / redis 6479 / meilisearch 7800）。新开工作树时整块 +1000，
  否则第二个 dev server 起不来、UI 冒烟也无法同时跑。
- 集成测试用 `yarn test:integration:ephemeral`（自起环境），不要把共享开发库当测试库。

## PR 与合并

1. 一个工作单元一个 PR，**ready（非 draft）**打开；标题 `feat(<area>): …` / `fix(<area>): …`。
2. 合并前：rebase 到最新 `main`，门禁全绿（`.ai/agentic.config.json` 的 `validation.commands`）。
3. **squash 合并**，保持 `main` 线性；合并后删远端分支。
4. **CI**：`.github/workflows/validate.yml` 在 PR（→ `main`）与 `main` 上按顺序跑同一组门禁命令
   （`generate` / `typecheck` / `lint` / `ds:check` / `test` / `build`），检查名 **`validate`**；
   `main` 的分支保护要求它通过。本地要复现同一结论，就按顺序跑这 6 条命令。
5. **标签**：`.ai/agentic.config.json` 里 `labels.enabled=true`，仓库已按
   `.ai/trackers/github.md` 的 `ensure-label-taxonomy` 建好 `review`/`changes-requested`/`qa`/
   `qa-failed`/`merge-queue`/`blocked`/`do-not-merge`/`needs-qa`/`skip-qa`/`in-progress`/
   `priority-*`/`risk-*` 等标签；流水线技能按状态自动打标，N 个 PR 卡在哪一步可以直接筛出来。
6. **分支保护现状**：`main` 要求走 PR、要求 `validate` 通过、要求线性历史，禁止 force push 与
   删除分支；必需评审数 0（单人仓不会把自己锁死），`enforce_admins=false`（管理员可应急绕过）。
   仓库只允许 **squash** 合并，合并后自动删远端分支。
7. **CI 偶发**：`Install dependencies` 步骤见过一次 Yarn 4 的 `onCancel handler was attached after
   the promise settled`（网络抖动，非代码问题）。先 `gh run rerun <run-id> --failed` 重跑一次再改代码。

## 何时不要并行

- 两个 agent 同一模块；
- 同一波次里大家都要动脊柱文件（先集中改完再分波）；
- 需要破坏性迁移或 `db:reset`；
- UI QA 需要独占一套前后端（那就串行跑 QA）。

## 吞吐瓶颈

编码可以并行，**评审与 QA 是串行环节**：每个 PR 都要过一遍 review（涉及界面再加 UI QA）。
建议按"波次"推进——一波并行实现 → 集中评审与合并 → 下一波——而不是无限开分支。

## 自查

```bash
git worktree list                  # 每个工作单元一棵树
git -C ../<worktree> branch --show-current
gh pr list --state open            # 每个工作单元一个 PR
gh pr checks <n>                   # validate 检查的门禁结论
```
