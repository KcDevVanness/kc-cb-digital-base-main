# CI/CD 与 AWS 部署

## 适用范围

`production` 分支的发布流水线、镜像产物、AWS 部署主机的目录与 `.env` 契约、回滚方式。
云账号、安全组、密钥值不在本文范围。

## 分支模型

| 分支 | 作用 | 触发什么 |
|---|---|---|
| `main` | 集成分支 | `validate.yml`（generate/typecheck/lint/ds:check/test/build） |
| `feat/*` | 特性分支 | 开 PR 时跑 `validate.yml` |
| `production` | **发布分支，唯一会部署的分支** | `deploy.yml`（构建镜像 → 部署到 AWS） |

部署不是「合并到 main 的副作用」：把某个提交提升到生产是一次显式的
`git push origin main:production`（或把 main 合并进 production）。这样 main 上的
验证失败或半成品提交不会自动上线。

## 流水线（`.github/workflows/deploy.yml`）

```
push production ─┬─ build  ── docker build --target runner ──▶ ghcr.io/kcdevvanness/kc-cb-digital-base-main:<sha>
                 │                                            ghcr.io/kcdevvanness/kc-cb-digital-base-main:production
                 └─ deploy ── ssh ──▶ 主机 git fetch + checkout <sha>
                                      docker compose -f docker-compose.deploy.yml pull app
                                      docker compose -f docker-compose.deploy.yml up -d
                                      curl 127.0.0.1:$APP_PORT/api/healthz 等到 200
```

**构建为什么在 CI 而不在主机上**：`yarn build` 用 `--max-old-space-size=8192`，
而部署主机是 2 GB 内存的实例。在主机上构建会 OOM，所以主机只做三件事——
拉代码、拉镜像、起容器。

- 镜像标签用 **commit SHA**（不可变），`deploy` 阶段传的就是这个 tag，不是 `latest`
- `concurrency: deploy-production` 且 `cancel-in-progress: false`：正在跑的部署必须跑完，
  否则会停在 `up -d` 中间
- 构建缓存走 GitHub Actions cache（`type=gha`），首次构建后重复构建显著变快

## 主机契约

| 项 | 值 |
|---|---|
| 目录 | `/opt/kc-cb-digital-base`（`APP_DIR`） |
| compose 文件 | `docker-compose.deploy.yml`（与 `fullapp` 的区别：`image:` 取代 `build:`） |
| `.env` | `/opt/kc-cb-digital-base/.env`，**不在 git 里**，首次部署前必须手工创建 |
| 对外端口 | `APP_PORT`（当前 `80`），只有 app 容器发布端口 |
| 部署脚本 | `scripts/deploy/deploy.sh`，由 CI 通过 `ssh ... bash -s` 用 stdin 灌入 |

脚本走 stdin 而不是「先 checkout 再执行」：要部署的版本正是脚本自己 fetch 下来的，
先 checkout 才能拿到脚本会构成先有鸡还是先有蛋。

`.env` 里**必须**有的项：

```
POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB
JWT_SECRET=$(openssl rand -hex 32)     # 生产启动硬校验，占位值直接 exit 1
AUTH_SECRET=$(openssl rand -hex 32)
NEXTAUTH_SECRET=$(openssl rand -hex 32)
TENANT_DATA_ENCRYPTION_FALLBACK_KEY=<32+ 字符随机串>
LOOKUP_HASH_PEPPER=<随机串>
MEILISEARCH_MASTER_KEY=<随机串>
APP_URL=http://<公网地址>              # 必须与实际访问地址一致
APP_PORT=80
OM_INIT_SUPERADMIN_EMAIL / OM_INIT_SUPERADMIN_PASSWORD
```

## 首次部署前置

主机上（一次性，之后由流水线接管）：

1. 2 GB 实例没有 swap，先加 4 GB `/swapfile` 并 `vm.swappiness=10`
2. 装 Docker：Ubuntu 26.04（`resolute`）官方源里**没有** `docker.io`，用 Docker 官方 apt 源
3. `git clone` 仓库到 `/opt/kc-cb-digital-base`
4. 按上面的清单创建 `.env`
5. 仓库 secrets：`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`（私钥全文）

## 回滚

镜像按 SHA 打标签，回滚 = 把 `production` 指回上一个好提交：

```bash
git push --force origin <good-sha>:production
```

流水线会用那个 SHA 重建镜像并部署（缓存命中，通常一两分钟）。**数据库迁移是向前-only 的**，
涉及迁移的回滚不能只回退代码。

## 已知取舍

- `INSTALL_CHROMIUM=0`：镜像不含 Chromium，Documents 的 PDF 导出返回 503。
  需要时给 `docker/build-push-action` 加 `build-args: INSTALL_CHROMIUM=1`，镜像增大约 400 MB。
- `NEXT_PUBLIC_DOCUMENTS_COLLAB_URL` 未设置：文档退化为单人编辑，不跑 `documents-collab` sidecar。
- 内存调优写在 `docker-compose.deploy.yml` 里（`--max-old-space-size=1024`、`DB_POOL_MAX=5`、
  `shared_buffers=192MB`、redis `maxmemory=128mb`）。**换更大的实例要同步调这些值**，
  否则 V8 会在还有余量时先撞上堆上限。

## 验证方式

```bash
# 流水线状态
gh run list --repo KcDevVanness/kc-cb-digital-base-main --workflow deploy

# 主机上：容器与健康检查
ssh -i <key> ubuntu@<host> 'cd /opt/kc-cb-digital-base && docker compose -f docker-compose.deploy.yml ps'
curl -s -o /dev/null -w '%{http_code}\n' http://<host>/api/healthz   # 期望 200

# 部署的确实是目标提交
ssh -i <key> ubuntu@<host> 'git -C /opt/kc-cb-digital-base log --oneline -1'
```

## 相关

- 镜像构建与运行时契约：[runtime.md](./runtime.md)
- 本地环境：[../dev/setup.md](../dev/setup.md)
