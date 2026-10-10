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

每个 agent 一个工作树：各自独立的 `.next/`、`.mercato/generated/`、`.env`（本地副本，见端口一节）；
`node_modules` 不在此列——Yarn 的 store 按机器共享（`.yarnrc.yml` 的 `nmMode: hardlinks-global`），
新工作树装依赖只花目录项（一次性副本实测 768 KB）而不是复制约 1.8 GB，见
[setup.md 的「依赖安装与磁盘占用」](./setup.md)。

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
git worktree add ../kc-cb-digital-base-min-<slug> -b feat/<slug> origin/dev
cd ../kc-cb-digital-base-min-<slug> && yarn install && yarn generate
```

分支命名：新能力 `feat/<slug>`，修缺陷 `fix/<slug>`，纯流程/工具改动 `chore/<slug>`，纯文档 `docs/<slug>`。**不要**在共享的 `main` / `dev` 上直接提交；常规单元的 base 是 `origin/dev`（见下一节），只有紧急修复和必须先落 `main` 的自举类流程改动才 base `origin/main`。

**分支只做加法**：一次性装好本地钩子 `git config core.hooksPath .githooks`（仓库级配置，所有工作树共用），
之后每次 push 都会用 `scripts/guards/guard-tree.mjs` 检查被推的那棵树——空工作树里 `git add -A` 的产物
（整仓变成删除）会在离开本机前被挡住。

## `dev` 集成分支（常驻）

`origin/dev` 是并行的**集成分支**：常规单元从它切出、把 PR 开回它，一个**波次**结束时整条 dev 落回
`main`。`.ai/agentic.config.json` 的 `baseBranch: "dev"` 让流水线技能（`om-auto-create-pr`、`om-open-pr`
等）自动这么做——它们读的是 config，不是写死的 `main`。

**唯一要守住的不变式**：`dev` 不持有 `main` 拿不到的内容，而且它的漂移必须显眼。破坏它，就是重演
`feat/cross-border-erp` 的 270 个路径滞留（`.ai/lessons/squash-merged-base-strands-later-prs.md`）。

| 动作 | 命令 / 判定 |
|---|---|
| 切单元 | `git worktree add ../kc-cb-digital-base-min-<slug> -b feat/<slug> origin/dev` |
| 合单元 | PR 的目标是 `dev`（squash；仓库只允许 squash 合并） |
| 看漂移 | `yarn branches:cleanup` 的 trunk 段：`in-sync` / `carrying` / `behind` / `diverged` |
| 收波次 | trunk 段出现 `carrying` → 开 `dev → main` 的 PR（`gh pr create --base main --head dev`），body 列出本波包含哪些单元 |
| 落地后重置 | `git push --force-with-lease origin origin/main:dev`——内容已经在 `main`，重置是内容保持操作，也是 `dev` 上唯一允许的强制 push |
| `behind` | dev 相对 `main` 没有独有内容（例如 `main` 被别的 PR 直接推进）→ 同一条重置命令 |
| `diverged` | 两边各有对方没有的文件 → 先 `git diff --name-status origin/main origin/dev` 看清，再把 `main` 并/rebase 进 dev，然后收波次 |

- **波次** = 一个 spec 切片 / 一批相关单元，越小越好。`main` 只允许 squash，整条 `dev` 会落成**一个**
  提交（各单元自己的 subject 不进 `main` 历史），所以别把几周的活攒在 dev 上。
- **紧急修复**可以 base `origin/main`、PR 到 `main`（在 `## Assumptions` 写明为什么不进 dev）；`main`
  前进后 trunk 段会告诉你是 `behind` 还是 `diverged`。
- **不允许**直接 push 到 `dev`；唯一例外是上面那条重置（源是 `origin/main`、带 `--force-with-lease`）。
  重置走的是管理员 bypass（`enforce_admins=false`），GitHub 会在输出里提示 `Bypassed rule violations`
  —— 那是这条重置的预期行为，不是绕过评审的通道。
- **`dev` 是 cover ref**：`branch-cleanup` 把 config 里的 `baseBranch` 当作"内容已保住的地方"，所以单元
  分支一合进 `dev` 就能被 `yarn branches:cleanup --apply` 清理；否则它们会被判 `STRANDED` 而永远留在报告里。
- **`dev` 永不在删除候选里**（`DEFAULT_KEEP`）；trunk 段每次运行都报，`--apply` 也不碰它。
- 注：`.ai/skills/**` 的 override 文档仍写 `baseBranch` 是 `"auto"`（harness 生成，不手改）；以
  `.ai/agentic.config.json` 为准。

### 本地 review 检出（主目录常驻 `dev`）

**所有者要求：功能代码必须在主目录 `yarn dev` 里就能 review，而不是只存在别的 worktree 里。** 因此主目录
`/Users/vanness/Developer/kc-cb-digital-base-min` 的检出分支是**本地 `dev`**（跟踪 `origin/dev`），而不是
`main`：单元在自己的 worktree 里开发、开 PR 到 `origin/dev`，同时把该分支**本地合并进主目录的 `dev`**，
于是 `yarn dev` 立刻能看到在飞的全部改动。

| 事项 | 口径 |
|---|---|
| 主目录分支 | 本地 `dev`（`git branch --set-upstream-to=origin/dev dev`），不切回 `main` |
| 合并进本地 dev | `git merge --no-ff <feat-branch>`（解决冲突：同一锚点的两段新增取并集，竞争同一行的改动必须选边并说明理由） |
| 合并后验证 | 主目录跑一次 `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build`——合并树是新组合，各单元自己绿过不算数 |
| **绝不 push 本地 dev** | 内容进 trunk 只能走 PR；本地 `dev` 领先 `origin/dev` 是预期状态（`git status -sb` 显示 `ahead N`） |
| PR 合并后对齐 | `git fetch origin && git reset --hard origin/dev`（本地合并提交被丢弃，内容已在 trunk） |
| worktree 清理 | 单元合并后用 `yarn branches:cleanup --apply`；主目录的 `dev` 不在候选里 |

主目录的 `.env` 与 worktree 各自独立（端口块、凭据）；集成测试与生产模式启动需要非占位 `JWT_SECRET`。

## 分支生命周期与清理

一条分支只在"内容还没进 `main`"的这段时间里是资产；内容一落地，它就只剩删除这一步。
2026-09-29 审计时的 12 条本地分支里 11 条属于这种状态，而且集成分支还把 270 个文件留在了 `main` 之外
（`.ai/lessons/squash-merged-base-strands-later-prs.md`）。

1. **一个工作单元一个分支，base 一律 `origin/dev`**（紧急修复和必须先落 `main` 的自举类流程改动走
   `origin/main`，在 PR body 的 `## Assumptions` 写明理由）。另一个例外是 `## Assumptions` 里写明
   父子关系的堆叠：子 PR 的 base 是父分支，父 PR 一合并就 `gh pr edit <child> --base dev` 并 rebase
   （GitHub 在父分支被删除时也会自动改 base）。**永远不要**把已经合进 `main` 的分支当 base 继续收 PR：
   那条分支之后收到的每个 commit 都不在 `main` 的历史里，`main` 也不会再自动拿到它们。
2. **文档跟着功能走。** 实现单元的 `docs/**`、`.ai/specs/**`、模块 README 改动放进同一个分支与 PR，
   不要为同一件事另开 `docs/*` 分支——`docs/erp-doc-catchup` 就是这样变成第二条分叉、PR #16 的内容
   从此停在分支上（`main` 上完全没有）。只有确实没有功能归属的纯文档单元才单开 `docs/<slug>` 分支，
   同样合并后立即删除。
3. **合并即清理。** 远端分支由仓库设置 `delete_branch_on_merge=true` 自动删除；本地分叉与工作树用：

   ```bash
   yarn branches:cleanup                    # 只报告：每条分支的判定与理由
   yarn branches:cleanup --apply            # 删可删的本地分支，并移除它们干净的工作树
   yarn branches:cleanup --apply --remote   # 连远端残留一起删（默认不碰远端）
   ```

   判定标准是"内容已在 cover ref 里"：分支 tip 是 `origin/main` 的祖先，或它的 PR 已合并且相对
   `origin/main` 没有独有文件；命中不了的一律列进报告、**绝不自动删**。`--deep` 连 cover ref 的历史
   一起查（处理"文件后来被改名/重写"的旧版本），`--cover <ref>` 把某个长期集成分支也算作"内容已保住
   的地方"，`--keep <name>` 保护正在开发的分支。**cover ref 自身永远不会被删**；被删掉的分支头仍可从
   GitHub 的 pull ref 取回：`git fetch origin pull/<n>/head`。
4. **集成分支只有一个出口。** 常驻集成分支只有 `dev` 一条，它靠"每次落地后重置"收尾（见上一节），
   **不是**靠删除；`production` 是部署分支，不是收单元的地方。其它任何集成分支（曾经的
   `feat/cross-border-erp`）要么在合并窗口内把内容全部并回 `main` 后删除，要么就别把它当 trunk。收尾前先跑
   `git diff --diff-filter=A --name-only origin/main <branch> | wc -l`，**必须为 0 才能删**；
   不为 0 说明还有内容只在分支上，那是"并回 `main`"的工作，不是删除。

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
  `docker-compose.fullapp.dev.yml` 另外发布了 `APP_PORT`、`DOCUMENTS_COLLAB_PORT`、`OPENCODE_PORT`、`MCP_PORT` 与两个 MinIO 端口 `MINIO_PORT`/`MINIO_CONSOLE_PORT`），复制 `.env` 并把端口块换一组即可。
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

1. 一个工作单元一个 PR，**base 一律 `dev`**（紧急修复/自举走 `main`；堆叠例外见"分支生命周期与清理"），**先以 draft 打开**
   （第一次 push 就有 PR，进度可见），标题 `feat(<area>): …` / `fix(<area>): …`；**本地**门禁
   （`.ai/agentic.config.json` 的 `validation.commands`）全绿且 Progress 全勾后 `gh pr ready` 转 ready
   ——单元 PR 的 CI 不再复跑这套命令（见第 5 点），本地这一跑就是它的验证证据。
2. **PR body 必含**：`Tracking plan:` + `Source doc:`（本仓没有 issue 体系，spec / run 路径就是需求单；
   tracker 开了 issue 之后补 `Closes #N` / `Refs #N`）、`## Goal`（问题 + 根因）、`## What Changed`、
   `## Assumptions`、`## 🧪 Tests`（命令 + 结果计数）、`## 💥 Breaking Changes`、`## Rollback`
   （怎么撤回：迁移 / 开关 / revert，或 None）、`## 📋 Progress`。AI 参与生成的提交在 body 里带
   `[AI-Generated]` trailer（不要写进 subject）；流水线评论以 `🤖` 开头。
3. 合并前：rebase 到最新 `main`，门禁全绿（`.ai/agentic.config.json` 的 `validation.commands`）。
4. **squash 合并**，保持 `main` 线性；合并后删除远端分支（仓库 `delete_branch_on_merge=true` 自动做），
   本地分支与工作树紧接着 `yarn branches:cleanup --apply` 收尾。
5. **CI**：`.github/workflows/validate.yml` 在**所有 PR**（触发不带分支过滤，必需检查必须上报）与
   `main` 推送上报同一个检查名 **`validate`**，但**只对发布目标真跑命令**（2026-09-30 的取舍）：

   - base 是 `main` / `production` 的 PR（波次 PR、生产同步 PR）与 `main` 的推送 → 跑全套
     （`generate` / `typecheck` / `lint` / `lessons` / `ds:check` / `test` / `build`，再按 docs/部署侧
     白名单跳过）；
   - base 是集成分支的 PR（`dev`，以及堆叠在别的单元分支上的子 PR）→ `scope` 判定 `needed=false`，
     `checks` / `build` 直接 skipped，汇总 job 秒级报绿。**这类 PR 的实际验证是作者本地那一跑**，
     CI 只是转发结论、不再花三分钟复证——`om-auto-create-pr` 第 8 步和 `AGENTS.md` 的 Validation
     一节把本地门禁定为硬要求，就是为了让这条成立。

   结构是「先判定、再并行两半、最后汇总」：

   - `scope`：先看 PR 的 base 是不是发布目标，再按 diff 白名单判定这套命令是否**可能**失败；
   - `checks`：install → generate → typecheck → lint → lessons → ds:check → test；
   - `build`：install → build（`yarn build` 本身就是 `yarn generate && next build`，不重复 generate）；
   - `validate`：汇总 job，**名字就是分支保护要求的那个检查名**，只在两半都通过（或按范围跳过）时报绿。

   代价写在这里：单元 PR 合进 `dev` 时 CI 不证明它绿，红只能等到波次 PR（`dev → main`）或 `main`
   推送才暴露，届时修的是已经落地的代码。换来的是每个单元 PR 的合并不再等 3 分钟（实测 2.6–3.4
   分钟/次；`main` 推送、发布目标 PR 的成本不变）。

   `checks` 与 `build` 同时起跑，所以 app 源码改动的墙钟时间约等于 `install + build` 这条最长路径，
   而不是所有步骤相加（2026-09-29 之前是单 job 串行：每次 4:49–6:06）。**必需检查按 job 名匹配**，
   所以汇总 job 不能改名、也不能换成 matrix——名字一旦不存在，每个 PR 会永久卡在 "Expected — Waiting"；
   同理触发不能改成 `paths-ignore` 或分支过滤，跳过只能发生在 `scope` 里。
   docs / 部署侧改动的 PR 由 `scope` 判定 `needed=false`：两个 job 直接 skipped，汇总 job 照常上报成功。
   跨运行复用的缓存三份：yarn 缓存、`tsconfig.tsbuildinfo`、`next build` 自己那份
   `.mercato/next/cache/.tsbuildinfo`（`next build` 内部还会再做一次类型检查，只是记录文件不同）。
   缓存的是**增量记录**而不是结果：类型检查照跑，TypeScript 按文件内容与编译选项失效，陈旧条目只花
   时间、不漏错误。本地复现同一结论：按 `.ai/agentic.config.json` 的 `validation.commands` 顺序跑同一份
   命令（CI 只是把它拆开并行，命令本身没变）。
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
7. **分支保护现状**：`main` 与 `production` 从 2026-09-29 起套用**同一套**——要求走 PR、要求
   `validate` + `guard-tree` 通过、要求线性历史，禁止 force push 与删除分支；必需评审数 0（单人仓
   不会把自己锁死），`enforce_admins=false`（管理员可应急绕过，`docs/deploy/cicd.md` 的 force push
   回滚路径因此仍然可用）。`dev`（集成分支）同样要求走 PR、要求同样两个必需检查、要求线性历史、
   禁止删除分支，但**允许 force push**——只为落地后的重置，不是给单元分支用的。
   注意这两条必需检查在两个目标上的含义不同：`guard-tree` 每次都真跑（6 秒级），而 base 是 `dev`
   的 PR 里 `validate` 只是「这里没有要跑的东西」的秒级结论——不阻塞、也不证明代码绿（第 5 点）。
   仓库只允许 **squash** 合并，合并后自动删远端分支。**直推 `main` / `production` / `dev` 一律禁止**：
   `main` 的 admin bypass 是应急口子、不是日常通道，`production` 是部署分支（`deploy.yml` 由它的
   push 触发），`dev` 只收 PR、只在波次落地后被重置。
   特例要当心 **head 就是 `production` 的 PR**（`production` → `main` 的同步 PR，PR #21 的形状）：
   `delete_branch_on_merge` 会把 head 当成合并后要删的分支，所以合并前先确认删除保护生效
   （`allow_deletions=false`），或按 2026-09-29 的先例临时关掉该设置、合并后立刻恢复——当时
   `production` 还没有保护，处置就是后者（`.ai/runs/2026-09-29-production-sync.md`）。
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
波次还有一个串行出口：`dev → main` 的落地 PR（整条 dev squash 成一条），所以一波别攒太大——一个
spec 切片一波最稳；`yarn branches:cleanup` 的 trunk 段是"这波该收了"的信号灯。

## 自查

```bash
git worktree list                  # 每个工作单元一棵树
git -C ../<worktree> branch --show-current
git diff --stat origin/dev         # 相对目标分支只应出现自己的新增 / 修改（base 为 main 的单元用 origin/main）
node scripts/guards/guard-tree.mjs --base origin/dev --head HEAD   # 同一判定，本地先跑一遍
gh pr list --state open            # 每个工作单元一个 PR
gh pr checks <n>                   # validate / guard-tree 检查的门禁结论
gh pr ready <n>                    # 门禁绿 + Progress 全勾后把 draft 转 ready
yarn branches:cleanup              # 合并后：本地分叉该不该删 + trunk 段（dev 报 carrying 就该收波次）
yarn branches:cleanup --remote     # 远端残留（dev / production 永不在候选里）
git diff --diff-filter=A --name-only origin/main origin/feat/<branch> | wc -l   # 其它集成分支收尾必须为 0
```
