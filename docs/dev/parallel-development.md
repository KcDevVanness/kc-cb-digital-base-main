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
- **开工前先认领**：`git worktree list` + `gh pr list --state open` 查这个单元是否已有分支 / 工作树 /
  PR；有就续跑（`om-auto-continue-pr`），不要再开第二个。
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

**分支只做加法**：一次性装好本地钩子 `git config core.hooksPath .githooks`（仓库级配置，所有工作树共用），
之后每次 push 都会用 `scripts/guards/guard-tree.mjs` 检查被推的那棵树——空工作树里 `git add -A` 的产物
（整仓变成删除）会在离开本机前被挡住。分支一律从**目标分支**切（`origin/main` 或
`origin/feat/cross-border-erp`），开 PR 前先看 `git diff --stat origin/<目标分支>`：只应列出你自己的新增。

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

- 迁移只允许加表 / 加列；**禁止**在别人可能运行期间执行破坏性迁移、`yarn db:greenfield`、`yarn dev:reset`（后者只清 dev 构建缓存，但会打断别人正在跑的 dev）。仓里**没有** `yarn db:reset` 这个脚本。
- 需要破坏性改动时另起一套栈：`docker-compose.yml` 的基础服务端口已参数化
  （`POSTGRES_PORT` / `REDIS_PORT` / `MEILISEARCH_PORT` / `MINIO_PORT` / `MERCATO_STACK`；
  `docker-compose.fullapp.dev.yml` 只发布了 `MINIO_PORT`），复制 `.env` 并把端口块换一组即可。
- **每个工作树一份端口块**：`.env` 顶部的 "PROJECT-LOCAL PORT ALLOCATION" 就是为此设计的
  （app 3100 / splash 4100 / postgres 5532 / redis 6479 / meilisearch 7800）。新开工作树时整块 +1000，
  否则第二个 dev server 起不来、UI 冒烟也无法同时跑。
- 集成测试用 `yarn test:integration:ephemeral`（自起环境），不要把共享开发库当测试库。
  自起环境是**生产模式**的 Next 服务，所以它会拒绝 `.env` 里的占位 `JWT_SECRET`
  （`Refusing to run in production with an unsafe signing secret`），表现为
  `Application process exited before readiness check`。本机跑法：
  `JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral`
  （一次性随机密钥，只作用于这次自起的一次性库）；详见
  [pitfalls/ephemeral-integration-needs-a-real-jwt-secret.md](../pitfalls/ephemeral-integration-needs-a-real-jwt-secret.md)。
  想只跑一条：`yarn mercato test:integration <文件名关键词>`；上一次一次性环境还在跑时会拒绝重建，
  等它退出或复用即可。

## PR 与合并

1. 一个工作单元一个 PR，**先以 draft 打开**（第一次 push 就有 PR，进度可见），标题
   `feat(<area>): …` / `fix(<area>): …`；门禁全绿且 Progress 全勾后 `gh pr ready` 转 ready。
2. **PR body 必含**：`Tracking plan:` + `Source doc:`（本仓没有 issue 体系，spec / run 路径就是需求单；
   tracker 开了 issue 之后补 `Closes #N` / `Refs #N`）、`## Goal`（问题 + 根因）、`## What Changed`、
   `## Assumptions`、`## 🧪 Tests`（命令 + 结果计数）、`## 💥 Breaking Changes`、`## Rollback`
   （怎么撤回：迁移 / 开关 / revert，或 None）、`## 📋 Progress`。AI 参与生成的提交在 body 里带
   `[AI-Generated]` trailer（不要写进 subject）；流水线评论以 `🤖` 开头。
3. 合并前：rebase 到最新 `main`，门禁全绿（`.ai/agentic.config.json` 的 `validation.commands`）。
4. **squash 合并**，保持 `main` 线性；合并后删远端分支。
5. **CI**：`.github/workflows/validate.yml` 在**所有 PR**（不限目标分支）与 `main` 上按顺序跑同一组
   门禁命令（`generate` / `typecheck` / `lint` / `lessons` / `ds:check` / `test` / `build`），检查名
   **`validate`**；docs / 部署侧改动的 PR 由 job 内的 scope 步骤跳过重步骤，检查照常报告（required
   check 不会卡在 "Expected — Waiting"）。本地复现同一结论，就按同一顺序跑同一份命令。
   **结构守卫**：另有 `.github/workflows/guard-tree.yml`（检查名 **`guard-tree`**），判定只看两棵树：
   head 里缺 `package.json` / `yarn.lock` / `src/modules.ts` / `.github/workflows/validate.yml` 之一，
   或保留文件数低于基线的 50%，即失败（PR #12 的 `1543 files changed, 593482 deletions(-)` 会被判红）。
   它刻意走 `pull_request`（不是 `pull_request_target`：本仓是 public，GitHub 的默认事件策略自
   2026-11-02 起会拦截 `pull_request_target`，一旦被拦，必需检查永远不上报、PR 会永久卡在 waiting）。
   代价是：连 `.github/workflows/**` 一起删掉的 head 不会跑任何工作流——而那正好落入
   "必需检查没有上报 = 不能合并"，PR 仍然合不进去；本地 `pre-push` 钩子则在这一步之前就拒掉。
6. **标签**：`.ai/agentic.config.json` 里 `labels.enabled=true`，仓库已按
   `.ai/trackers/github.md` 的 `ensure-label-taxonomy` 建好 `review`/`changes-requested`/`qa`/
   `qa-failed`/`merge-queue`/`blocked`/`do-not-merge`/`needs-qa`/`skip-qa`/`in-progress`/
   `priority-*`/`risk-*` 等标签；流水线技能按状态自动打标，N 个 PR 卡在哪一步可以直接筛出来。
7. **分支保护现状**：`main` 要求走 PR、要求 `validate` + `guard-tree` 通过、要求线性历史，禁止 force push 与
   删除分支；必需评审数 0（单人仓不会把自己锁死），`enforce_admins=false`（管理员可应急绕过）。
   仓库只允许 **squash** 合并，合并后自动删远端分支。**直推 `main` / `production` 一律禁止**：
   `main` 的 admin bypass 是应急口子、不是日常通道，`production` 是部署分支（`deploy.yml` 由它的
   push 触发），两者都只接受 PR。
8. **CI 偶发**：`Install dependencies` 步骤见过一次 Yarn 4 的 `onCancel handler was attached after
   the promise settled`（网络抖动，非代码问题）。先 `gh run rerun <run-id> --failed` 重跑一次再改代码。

## 何时不要并行

- 两个 agent 同一模块；
- 同一波次里大家都要动脊柱文件（先集中改完再分波）；
- 需要破坏性迁移或 `db:greenfield`；
- UI QA 需要独占一套前后端（那就串行跑 QA）。

## 吞吐瓶颈

编码可以并行，**评审与 QA 是串行环节**：每个 PR 都要过一遍 review（涉及界面再加 UI QA）。
建议按"波次"推进——一波并行实现 → 集中评审与合并 → 下一波——而不是无限开分支。

## 自查

```bash
git worktree list                  # 每个工作单元一棵树
git -C ../<worktree> branch --show-current
git diff --stat origin/main        # 相对目标分支只应出现自己的新增 / 修改
node scripts/guards/guard-tree.mjs --base origin/main --head HEAD   # 同一判定，本地先跑一遍
gh pr list --state open            # 每个工作单元一个 PR
gh pr checks <n>                   # validate / guard-tree 检查的门禁结论
gh pr ready <n>                    # 门禁绿 + Progress 全勾后把 draft 转 ready
```
