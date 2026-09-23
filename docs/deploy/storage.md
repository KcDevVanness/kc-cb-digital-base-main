# 对象存储（S3 兼容）— 附件存储路径、准备与迁移

**放**：附件字节存哪里、对象存储怎么接、迁移与回滚怎么走、本机怎么彩排。
**不放**：本地开发环境搭建（→ [`../dev/setup.md`](../dev/setup.md)）、部署形态与镜像构建（→ [`runtime.md`](./runtime.md)）。

> 规格（执行口径、阶段与验收）：[`.ai/specs/2026-09-23-local-to-s3-storage-migration.md`](../../.ai/specs/2026-09-23-local-to-s3-storage-migration.md)。
> 本文是运维口径：**当前状态 = 本地上传 + S3 provider 已装好待切换**（Phase 0 已交付，2026-09-23）。

## 1. 现在文件存在哪

| 事实 | 位置 |
|---|---|
| 驱动按**分区**解析，不看单行 | `attachments` 模块 `StorageDriverFactory.resolveForPartition()` |
| 默认驱动 `local`，根目录 | `ATTACHMENTS_PARTITION_<CODE>_ROOT`，未设置则 `<cwd>/storage/attachments/<partitionCode>` |
| 文件相对路径 | `org_<orgId>/tenant_<tenantId>/<时间戳>_<12位随机>_<净化文件名>` |
| 库表 | `attachments` 行只存**相对路径**（不含分区段）+ 写入时的 `storage_driver` |
| 两个默认分区 | `privateAttachments`（私有，业务默认）、`productsMedia`（公开，仅 `catalog:catalog_product`） |
| 缩略图缓存 | `storage/.cache/thumbnails/<partition>/<attachmentId>/<key>`，与存储后端无关，切换驱动无需清理 |
| 前端引用 | `/api/attachments/file/<id>`、`/api/attachments/image/<id>` —— 字节始终经应用层读出，**不需要公开桶** |

**容器部署注意**：`storage/` 必须挂持久卷。仓库的 `docker-compose.fullapp.yml` / `docker-compose.fullapp.dev.yml` 已经这样做（`attachments_storage:/app/storage`）。本地 `docker-compose.yml` 走宿主机目录。

## 2. 前置约束 C-1…C-10（切换成本全在这里）

| # | 约束 | 为什么 |
|---|---|---|
| C-1 | `storage_path` 永远相对、不含分区前缀、带 `org_*`/`tenant_*` 段 | 切换回写就是一条 `partition_code \|\| '/' \|\| storage_path` |
| C-2 | 分区内每行的 `storage_driver` 等于分区驱动；不留 `legacyPublic` 等第三种值 | 否则翻转后这些行解析不到对象（404） |
| C-3 | 窗口时无未完成配额预留、无重复 `committed` 账本行 | core 的 `reconcileStandaloneObjects` 没有调用方，不会自愈；重复行会永久抬高用量 |
| C-4 | 桶布局在**第一个字节之前**冻结：每环境独立桶、`pathPrefix` 留空 | S3 key 永久，改前缀 = 第二次迁移 |
| C-5 | `storage/attachments` 在持久卷上；迁移状态文件放同一卷（`storage/.storage-migration/`） | 容器重建丢文件/丢续跑状态 |
| C-6 | 所有附件字节只走 `/api/attachments`（各业务模块已如此） | 迁移面保持 1 个 |
| C-7 | 磁盘 == 表：缺失文件是硬错误，孤儿文件只报告并需人工确认 | 预检才能把不一致当错误而不是判断题 |
| C-8 | 上传上限/租户配额/反代 body 限制/SSRF 策略记录在案（默认 25 MB / 512 MB） | S3 不改变这些，但会在彩排中暴露 |
| C-9 | 触碰 S3 的工具必须走 `resolveForPartition(partitionCode, scope)`，**不得**手搓驱动配置 | 2026-09-23 探针实测：驱动的租户作用域断言只在配置带 `organizationId`/`tenantId` 时生效，手搓配置会静默放过无 `org_*`/`tenant_*` 段的 key |
| C-10 | `OM_ENABLE_STORAGE_S3` 在**构建期与运行期**必须一致 | 模块加载由生成注册表（`yarn generate` / `yarn build`）决定，而设置页读请求时的 `process.env`；见 §3「部署契约」 |

C-1…C-3 由 `storage_ops audit`/`preflight` 断言；C-4…C-8 是运维约定；C-9/C-10 是 2026-09-23 探针与生产构建实测新增的两条。

## 3. 当前接线状态（Phase 0，2026-09-23 已交付）

- 依赖：`@open-mercato/storage-s3@0.8.0`（`package.json` 精确版本 + `yarn.lock`）。
- 注册：`src/modules.ts` 里按 `OM_ENABLE_STORAGE_S3` 条件注册 `storage_s3`；`.env` / `.env.example` 已置 `OM_ENABLE_STORAGE_S3=true`。
- 生成物：`yarn generate` 后 DI/路由/worker/i18n/ACL 均已包含该模块（队列 `storage-s3-quota-recovery`，并发 2）。
- 两个分区**仍是** `storage_driver='local'`；业务上传行为零变化。

### 凭据怎么配（二选一）

1. **Integration Marketplace**（推荐）：后台 集成市场 → “S3 Object Storage” → 填 `bucket` / `region` / `endpoint` / `forcePathStyle` / access key。凭证加密存储、按 `(tenantId, organizationId)` 作用域解析。
2. **环境变量预置**（适合无人值守部署）：设置 `OM_INTEGRATION_STORAGE_S3_{ACCESS_KEY_ID,SECRET_ACCESS_KEY,REGION,BUCKET}`（可选 `SESSION_TOKEN`、`ENDPOINT`、`FORCE_PATH_STYLE`），然后：

```bash
yarn mercato storage_s3 configure-from-env --all-tenants     # 幂等，可做 post-deploy hook
# 或指定租户： --tenant <tenantId> --org <organizationId>
```

自建 MinIO 等**内网端点**默认被 SSRF 防护拒绝，需显式 `OM_STORAGE_S3_ALLOW_INTERNAL_ENDPOINTS=true`（仅限自建/内网场景）。

### 部署契约：`OM_ENABLE_STORAGE_S3` 构建期与运行期必须一致

- 生产/runner 镜像**没有** `.env`，所有运行时配置由环境变量注入（[`runtime.md`](./runtime.md)）。
- **模块加载**由 `yarn generate` / `yarn build` 生成的注册表决定（`.mercato/generated/**` 里已固化）；而 `/backend/config/attachments` 的 S3 选项读的是**请求时**的 `process.env`。
- 两个方向：

| 构建期 | 运行期 | 结果 |
|---|---|---|
| true | false | 驱动已注册、UI 不提供 S3 —— 安全（2026-09-23 实测：不带该变量启动的生产构建，`s3Enabled=false`，而 `/api/storage-providers/s3/list` 已返回 401 即路由已注册） |
| false | true | **危险**：UI 提供 S3 但 `s3` 驱动未注册 → 工厂静默回退 local 驱动（见 §1 与 C-9） |

- 因此部署流水线（构建）与运行时环境**都要**给到这个变量；`storage_ops preflight` 会用「解析到的驱动 key == 分区配置的驱动」把危险方向挡在迁移之前。

## 4. 本机彩排环境（MinIO）

```bash
docker compose --profile storage-s3 up -d minio
# S3 API  http://localhost:4666   （MINIO_PORT，见 .env 端口分配块）
# 控制台   http://localhost:4667   （MINIO_CONSOLE_PORT，minioadmin / minioadmin）
# 容器内用的是 MinIO 默认地址（9000 / 9001），宿主端口由 MINIO_PORT / MINIO_CONSOLE_PORT 决定；
# 健康检查用镜像自带的 `mc ready local`（该别名指向容器内 9000）。
```

客户端必须开 `forcePathStyle`（MinIO 不支持虚拟主机风格寻址）；`OM_STORAGE_S3_ALLOW_INTERNAL_ENDPOINTS=true` 是内网端点放行开关。

> **2026-09-23 变更**：原先的 `localstack` 服务已换成 `minio`（三个 compose 文件同步）。`localstack/localstack:latest` 现在启动即要求付费的 `LOCALSTACK_AUTH_TOKEN`（“License activation failed”，退出码 55），该 profile 实际上不可用。MinIO 免费、S3 兼容，且本来就是 provider 文档里支持的端点之一（`forcePathStyle` 必开）。

## 5. Provider 探针证据（Phase 0 实测，2026-09-23）

用应用自己的接缝（`StorageDriverFactory.resolveForAttachment('s3', …)`，驱动由模块 `di.ts` 在 import 时注册）对着 MinIO 实测：

| 探针项 | 实测结果 |
|---|---|
| 驱动解析 | `driver.key === 's3'` —— 模块注册生效，**没有**静默回退到 local |
| 对象 key 公式 | `probePartition/org_<orgId>/tenant_<tenantId>/<ts>_<rand>_<净化文件名>`（`pathPrefix` 为空时）—— 与规格一致 |
| 文件名净化 | 非 `[a-zA-Z0-9._-]` 字符（含中文）替换为 `_`，与 local 驱动行为一致 |
| store → read | 返回传入的 key；读回字节一致 |
| `toLocalPath()` | 落到 `os.tmpdir()/s3-tmp-*/<文件名>`，字节一致，`cleanup()` 删除临时文件 → **容器 `/tmp` 必须可写** |
| 同 key 二次 `store()` | 抛 `PreconditionFailed`（条件写入 `IfNoneMatch: '*'` 真实存在）→ 续跑必须先读回校验，不能盲目重写 |
| 分区断言 | 用别的分区 code 写同一 key → `[internal] S3 key is not scoped to the requested partition` |
| 作用域断言（驱动带 scope） | 无 `org_/tenant_` 段、或指向别的租户的 key，store/read 均被拒：`[internal] S3 key is not scoped to the active tenant` |
| 作用域断言（驱动无 scope） | **不校验**（见 C-9） |

## 6. 切换与回滚（Phase 1 交付 `storage_ops` 后执行）

一键命令（Phase 1 落地）：

```bash
yarn mercato storage_ops audit    --partition privateAttachments     # 阻断项必须为 0；孤儿单独确认
yarn mercato storage_ops migrate  --partition privateAttachments --dry-run
yarn mercato storage_ops migrate  --partition privateAttachments --yes
yarn mercato storage_ops verify   --partition privateAttachments --sample 20
yarn mercato storage_ops rollback --partition privateAttachments --yes
```

窗口纪律：先 `audit` 清阻断项 → 停应用（或只读）→ `migrate`（单事务翻转）→ 重启 → 抽查一次老文件下载 + 一次新上传 → 本地文件按保留期保留，之后 `prune-local` 才删。

> 本节的完整 runbook（快照、SQL 形状、`config_json` 载荷、回滚语义）在规格 § Rollout, Migration, and Rollback；Phase 2 执行后本节会补齐实测记录。

## 7. 复核当前状态（复现命令）

随时可跑，全部只读：

```bash
# 1) 模块在应用运行时里是否已启用（CLI 会加载 .env，并读同一份生成注册表）
yarn mercato storage_s3 help                       # 应打印 configure-from-env 用法

# 2) 两个分区是否仍在本地驱动（需要登录 cookie；登录只吃 form-urlencoded）
curl -s -c /tmp/c.txt -X POST http://localhost:3100/api/auth/login \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'email=admin@acme.com' --data-urlencode 'password=secret' >/dev/null
curl -s -b /tmp/c.txt http://localhost:3100/api/attachments/partitions | jq -c '.items[] | {code, storageDriver}'

# 3) 设置页是否已开放 S3 选项（载荷里的 s3Enabled 必须为 true）
curl -s -b /tmp/c.txt http://localhost:3100/backend/config/attachments | grep -o 's3Enabled[^,]*'

# 4) 彩排端点是否在跑
docker compose ps --format '{{.Service}} {{.State}} {{.Health}}' | grep minio
```

> 端口以 `yarn dev` / `yarn start` 打印的 `Local:` 行为准（本机 `APP_URL` 是 3100）；用别的端口访问会让同源检查拒绝写请求。
> 注意：**长跑的 `yarn dev` 持有启动时的环境快照**——改完 `.env` 后 `touch .env` 只会重启 Next 子进程，env 不会变；要看到 `s3Enabled: true` 必须重启整个 `yarn dev`（或像 Phase 0 那样另起一个进程）。

## 8. 相关

- 执行口径（阶段、验收、回滚语义）：[`.ai/specs/2026-09-23-local-to-s3-storage-migration.md`](../../.ai/specs/2026-09-23-local-to-s3-storage-migration.md)
- 经验记录（可复用陷阱）：[`.ai/lessons/s3-storage-enablement-traps.md`](../../.ai/lessons/s3-storage-enablement-traps.md)、[`.ai/lessons/module-add-rewrites-modules-ts.md`](../../.ai/lessons/module-add-rewrites-modules-ts.md)
- 部署形态与环境变量契约：[`runtime.md`](./runtime.md)
- 本地开发环境与演示账号：[`../dev/setup.md`](../dev/setup.md)
