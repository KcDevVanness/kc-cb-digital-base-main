# 附件存储切换实作手册（Phase 2 本地 → 对象存储）

**放**：把 `privateAttachments`（以及后续分区）从本地磁盘切到对象存储的**可执行步骤**：前置条件、桶与凭据申请参数、窗口内逐条命令与预期输出、失败判据、回滚决策树、保留期、证据记录表。
**不放**：设计决策与验收口径（→ 规格）、日常存储位置说明与彩排环境（→ [`storage.md`](./storage.md)）、部署形态（→ [`runtime.md`](./runtime.md)）。

> 执行口径：[`.ai/specs/2026-09-23-local-to-s3-storage-migration.md`](../../.ai/specs/2026-09-23-local-to-s3-storage-migration.md)（Phase 2、AC-004…AC-009）。
> 工具：`src/modules/storage_ops/`（已交付，2026-09-23），命令别名 `yarn storage:audit` / `yarn storage:migrate`。
> **当前状态**：Phase 0/1 已交付，两个分区仍 `storage_driver='local'`；本文档等云服务到位后执行。

---

## 0. 现状与规模（执行前重新测量）

| 项 | 值（2026-09-23 实测，执行前用 `audit` 复核） |
|---|---|
| `privateAttachments` | 150 行 / 303 MB |
| 本地文件 | 367 个（其中 **217 个孤儿文件**：磁盘上有、表里无引用） |
| `productsMedia` | 0 行（96 个孤儿文件） |
| 配额账本 | 0 条重复 committed 行、0 条在途预留 |
| 缩略图缓存 | `storage/.cache/thumbnails/**`，与后端无关，切换不需要清理 |

> 规模决定窗口长度：`migrate` 的 copy 与 verify 各要完整过一遍字节（本量级为秒级）。真正占时间的是快照与重启，不是拷贝。

---

## 1. 现在就能做（不需要云服务）

- [ ] **确认孤儿文件**：`yarn mercato storage_ops audit --orphans`（全量列出）。孤儿不会被迁移，也不会被 `prune-local` 删除；要么先人工清理，要么在记录里注明「已知悉」。这是约束 C-7 要求的人工确认。
- [ ] **冻结命名决策**：桶名、region、endpoint、`pathPrefix`（**建议留空**）、每环境一个桶。S3 key 是永久的，事后改前缀等于第二次迁移（C-4）。
- [ ] **按 §2 的参数申请服务**（采购/运维可照抄）。
- [ ] **准备凭据落点**：选 Marketplace 表单还是 `OM_INTEGRATION_STORAGE_S3_*` 环境变量（§3）。
- [ ] **确定保留期**：本地文件在切换后保留多久（建议 ≥30 天，见 §7）。
- [ ] **本地彩排一遍**（不需要云）：`docker compose --profile storage-s3 up -d minio` 后按 [`storage.md`](./storage.md) §4 跑一次 `migrate → verify → rollback`，确认工具链在你手上可用。

---

## 2. 对象存储申请参数（给运维/采购的清单）

| 参数 | 要求 | 说明 |
|---|---|---|
| 服务类型 | S3 兼容（AWS S3 / 阿里云 OSS / 腾讯云 COS / DO Spaces / Cloudflare R2 / Backblaze B2 / 自建 MinIO） | 应用走标准 S3 API + `@aws-sdk/client-s3` |
| 桶数量 | **每个环境一个**（prod / staging / dev 分开） | 不共用桶、不用环境前缀（`pathPrefix` 留空） |
| 访问权限 | **私有**；开启「阻止公共访问」 | 读取一律经应用（`/api/attachments/file/<id>`），不需要公开桶、不需要 CDN |
| 加密 | 服务端加密开启（SSE-S3 或 SSE-KMS） | 应用不做客户端加密，字段级加密另见 `TENANT_DATA_ENCRYPTION` |
| 版本控制 | 建议**开启**，至少保留到切换后一个月 | 误删可恢复；稳定后可关 |
| 生命周期 | 可加：清理未完成的分片上传（应用只用简单 PUT，非必需） | 不要配「到期删除对象」类规则，除非业务确认 |
| Region / Endpoint | 与应用同区域；自建/私有端点需额外开 `OM_STORAGE_S3_ALLOW_INTERNAL_ENDPOINTS=true` | SSRF 防护默认拒绝内网端点 |
| Path-style | 自建 MinIO 必开 `forcePathStyle`；云厂商可关 | 写入 `config_json` 的 `forcePathStyle` |
| 最小权限 IAM | 见下方策略 | 只要对象级读写删 + 列表 |

最小权限策略（把 `<bucket>` 换成实际桶名）：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": ["arn:aws:s3:::<bucket>"] },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::<bucket>/*"]
    }
  ]
}
```

> 应用另有一条可选能力：为直传生成预签名 URL（`storage_s3` 的 signed-url 路由）。若不用直传，上面的策略已足够。

---

## 3. 凭据的两种落点（二选一）

| 方式 | 适用 | 步骤 |
|---|---|---|
| **Integration Marketplace**（推荐） | 有人值守、想按租户/组织分别配 | 后台 → 集成市场 → “S3 Object Storage” → 填 bucket / region / endpoint / forcePathStyle / access key。凭证加密存储，按 `(tenantId, organizationId)` 作用域解析 |
| **环境变量预置** | 无人值守部署（Dokploy/Coolify/Kamal 等） | 设 `OM_INTEGRATION_STORAGE_S3_{ACCESS_KEY_ID,SECRET_ACCESS_KEY,REGION,BUCKET}`（可选 `SESSION_TOKEN`、`ENDPOINT`、`FORCE_PATH_STYLE`），然后 `yarn mercato storage_s3 configure-from-env --all-tenants`（幂等，可做 post-deploy hook；`--force` 覆盖已存凭证） |

**部署契约（C-10）**：`OM_ENABLE_STORAGE_S3` 必须在**构建/生成期与运行期一致**——模块加载来自 `yarn generate` / `yarn build` 固化的注册表，而设置页读请求时的 `process.env`。生产镜像没有 `.env`，必须由部署环境注入。危险组合是「构建期 false + 运行期 true」（UI 提供 S3 但驱动未注册 → 静默回退本地驱动）；`storage_ops preflight` 会用「解析到的驱动 key == 分区配置的驱动」把这条挡住。

---

## 4. 切换窗口 runbook（预计 15–30 分钟，含快照与重启）

### 4.1 窗口前（T-1 天）

```bash
# 1) 阻断项必须为 0；孤儿全量确认一次
yarn mercato storage_ops audit --partition privateAttachments --orphans

# 2) 用真实桶做一次「演练分区」验证（不碰 privateAttachments）
#    新建一个临时分区：后台 /backend/config/attachments 新建，或 POST /api/attachments/partitions（驱动选 local）
#    往该分区传几个文件（任一带附件的页面，或 POST /api/attachments 指定 partitionCode）
yarn mercato storage_ops migrate --partition <演练分区> --dry-run --s3-config '<真实桶配置>'
yarn mercato storage_ops migrate --partition <演练分区> --yes   --s3-config '<真实桶配置>'
yarn mercato storage_ops verify  --partition <演练分区> --sample 20
yarn mercato storage_ops rollback --partition <演练分区> --yes
#    演练完删除该分区的行/文件与桶内对象（或直接删分区后手工清理 storage/attachments/<分区> 与桶前缀）
```

### 4.2 窗口内（应用停写）

```bash
# 0) 备份：数据库快照 + 字节快照（两者缺一不可）
pg_dump "$DATABASE_URL" > pre-cutover-$(date +%F).sql
rsync -a storage/attachments/privateAttachments/ /backup/privateAttachments-$(date +%F)/

# 1) 预览（不写任何东西）：应打印 preflight/probe/对象 key 清单
yarn mercato storage_ops migrate --partition privateAttachments --dry-run --s3-config '<配置>'

# 2) 执行：preflight → copy → verify → flip（单事务）
yarn mercato storage_ops migrate --partition privateAttachments --yes --s3-config '<配置>'

# 3) 抽样哈希复核
yarn mercato storage_ops verify --partition privateAttachments --sample 20
```

预期输出（本量级参考值，行数/字节以实际为准）：

```
preflight: partition=privateAttachments rows=150 bytes=… duplicateLedgerRowsRemoved=0 manifest=storage/.storage-migration/privateAttachments.jsonl
probe: key=privateAttachments/org_…/tenant_…/<ts>_<rand>_.storage-ops-probe-… bytes=… roundTrip=true
copy: copied=150 skipped=0 bytes=…
verify: checked=150 hashed=20 mismatches=0
flip: rows=150 ledgerRows=0 stragglers=0 orphanObjects=0
```

**失败判据（出现即按 §5 回滚，不要继续）**：

- `probe … roundTrip=false` 或 `S3 endpoint host … is not allowed`（凭据/端点/内网放行问题）
- `blocking violation(s)`（先清干净再开窗口）
- `copy` 阶段任何 `read-back mismatch` / `PreconditionFailed` 无法用读回解释
- `verify: … mismatches=N>0`
- `flip` 阶段 `the flip rewrote X row(s) but the verified set has Y`（窗口内有人写入 → 重跑或回滚）

### 4.3 窗口后

```bash
# 1) 重启应用；然后抽查
#    a. 老文件：浏览器/接口下载一个切换前的附件，字节应与备份一致
#    b. 新文件：传一个新附件，检查行与对象
docker compose exec -T postgres psql -U postgres -d <db> -c \
  "select storage_driver, storage_path from attachments where partition_code='privateAttachments' order by created_at desc limit 3;"
# 2) 确认分区行
docker compose exec -T postgres psql -U postgres -d <db> -c \
  "select code, storage_driver, config_json from attachment_partitions where code='privateAttachments';"
# 3) 用量未变（迁移本身不改用量；preflight 若删过重复行会打印条数）
```

---

## 5. 回滚决策树

```text
窗口内或窗口后发现问题
  ├─ 只是凭据/端点问题（还没 flip 成功）
  │    → 什么都不用做：分区仍是 local，本地文件完好；修配置后重跑
  ├─ flip 已成功，但下载/上传异常
  │    → yarn mercato storage_ops rollback --partition privateAttachments --yes
  │      （对象 → 本地重落盘；行/账本/分区行单事务还原；本地文件已存在且一致时跳过）
  │      然后重启 + 抽查 + 记录
  └─ 已 prune 掉本地文件
       → rollback 仍可用：它会从桶里把文件重新落盘（sha256 校验通过才写）
```

回滚后注意：**桶里的对象不会自动删除**（它们是回滚的安全网）。确认稳定后再由运维清理，或保留到下次切换直接复用。

---

## 6. 切换成功的定义（对应规格 AC）

- [ ] 老文件下载字节一致（抽查 ≥1 个切换前的附件）
- [ ] 新上传落桶：行 `storage_driver='s3'`、`storage_path` 带分区前缀、对象在 `[pathPrefix]<partition>/org_*/tenant_*/…`
- [ ] `verify --sample 20` 零 mismatch
- [ ] 用量（`sum(attachments.file_size)` + 账本）与切换前一致（减去 preflight 打印的重复行）
- [ ] `attachment_partitions.config_json` 与预期载荷一致，设置页能正确渲染
- [ ] 无 schema 变更、无业务模块代码改动
- [ ] 证据表（§9）填写完毕，规格 Changelog 与状态板同步

---

## 7. 保留期与清理（切换后）

```bash
# 建议：先只读观察 ≥30 天，期间不动本地文件（回滚零成本）
yarn mercato storage_ops prune-local --partition privateAttachments --dry-run --older-than 30
yarn mercato storage_ops prune-local --partition privateAttachments --older-than 30 --yes
```

- `prune-local` **默认 dry-run**；只删「对象可读且长度与行一致」的文件（证明字节已在桶里）。
- 孤儿文件不在删除范围（它们没有行引用）——要清理请单独人工处理。
- 删除后 `rollback` 依然可行（从桶重新落盘），但耗时与流量回到一次完整下载。

---

## 8. 陷阱速查（现象 → 处理）

| 现象 | 原因 | 处理 |
|---|---|---|
| `the "s3" driver is not registered (resolved "local")` | `OM_ENABLE_STORAGE_S3` 没进**当前进程**的环境（含任何 shell 调 CLI 的子进程；bootstrap 会用子进程环境重新生成注册表，C-10） | 在该进程/CI/部署环境注入该变量后 `yarn generate`，再重试 |
| `S3 endpoint host "…" is not allowed` | 内网/私有端点被 SSRF 防护拦下 | 仅自建/内网场景设 `OM_STORAGE_S3_ALLOW_INTERNAL_ENDPOINTS=true` |
| `[internal] S3 key is not scoped to the requested partition / active tenant` | key 布局不对（少了分区段或 `org_/tenant_` 段） | 不要手搓 key；用工具（它会按 `[pathPrefix]<partition>/<canonical>` 生成） |
| `PreconditionFailed` | 同 key 重复写入（对象已存在） | 正常路径：工具会读回校验并跳过；若报错则说明对象内容不一致，人工核查 |
| `N blocking violation(s)` | 路径形状/驱动不一致/缺文件/账本异常 | `audit` 看明细；重复账本行由 `migrate` 自动修复（会打印条数） |
| `… is still in flight` | 有未完成的配额预留 | 等它过期/完成，或按配额恢复流程处理后再开窗口 |
| `verify` 报 `object is missing or unreadable` | 分区还没切（`verify` 只用于已切到 s3 的分区） | 用 `migrate`（它自带翻转前验证） |

---

## 9. 证据记录表（执行时填写）

| 项 | 值 |
|---|---|
| 执行日期 / 操作人 | |
| 桶 / region / endpoint / pathPrefix | |
| 凭据落点（Marketplace / env 前缀） | |
| 窗口起止时间 / 应用停写方式 | |
| 快照位置（SQL / 字节） | |
| `audit` 结果（blocking / orphans / ledger） | |
| `migrate` 输出（preflight / probe / copy / verify / flip 五行） | |
| `verify --sample 20` 结果 | |
| 老文件抽查（附件 id + sha256 对比） | |
| 新上传抽查（附件 id + 行/对象状态） | |
| 用量对比（切换前 / 切换后） | |
| 是否发生回滚 / 原因 | |
| 保留期决策与 `prune-local` 执行日 | |

> 填完把结论写回规格 Changelog 与 [`storage.md`](./storage.md) §6，并同步 [`../plans/README.md`](../plans/README.md) 状态板。

---

## 10. 相关

- 存储位置、约束 C-1…C-10、彩排环境、探针证据：[`storage.md`](./storage.md)
- 执行口径与验收（Phase 2 / AC-004…AC-009）：[`.ai/specs/2026-09-23-local-to-s3-storage-migration.md`](../../.ai/specs/2026-09-23-local-to-s3-storage-migration.md)
- 工具契约（命令、退出码、安全模型）：[`../../src/modules/storage_ops/README.md`](../../src/modules/storage_ops/README.md)
- 环境变量契约与镜像形态：[`runtime.md`](./runtime.md)
- 可复用陷阱：[`.ai/lessons/s3-storage-enablement-traps.md`](../../.ai/lessons/s3-storage-enablement-traps.md)
