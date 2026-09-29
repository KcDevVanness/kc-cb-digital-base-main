# 自起集成环境起不来：生产模式拒绝占位 JWT_SECRET

## 现象

`yarn test:integration:ephemeral`（或 `yarn mercato test:integration <关键词>`）在
「Building application…」之后立刻失败，看不到任何用例执行：

```
[integration] Starting application on http://127.0.0.1:5001...
💥 Failed: Application process exited before readiness check (exit 1)
Captured output:
  - CACHE_STRATEGY=sqlite (multi-instance-safe: redis)
  ...
[auth.jwt] Refusing to run in production with an unsafe signing secret: JWT_SECRET is set to a placeholder value published in this repository's examples, so anyone can forge tokens for this deployment. Generate a real one with `openssl rand -hex 32`.
💥 Failed: [server] Next.js production server exited unexpectedly with exit code 1.
```

构建、迁移、一次性数据库（`Ephemeral database ready at localhost:5xxxx`）全都正常，**只有应用进程退出**。

## 时间线（本机 2026-09-28，UTC+8）

| 时刻 | 事件 |
|---|---|
| — | 首次跑 `yarn mercato test:integration finance-flow`：构建 54s 成功，应用启动即退出（exit 1） |
| — | 日志里定位到 `[auth.jwt] Refusing to run…`：**生产模式**才做这条校验，dev 模式不校验 |
| — | 加 `JWT_SECRET=$(openssl rand -hex 32)` 前缀重跑：应用 `✓ Ready`，用例开始执行并按预期报断言/ACL 失败（说明护栏生效） |

## 证据

- 失败日志（`.ai/qa` 之外的临时日志）：`[integration] Build cache disabled: source files changed…`
  → `Building application completed in 54s` → `Starting application on http://127.0.0.1:5001` → 退出。
- 点题的那行：`[auth.jwt] Refusing to run in production with an unsafe signing secret`。
- 校验只看「值是不是仓库示例里的占位」，与库是否是一次性的无关：`dotenv` 不覆盖已存在的进程环境变量，
  所以命令行前缀的随机密钥优先生效。

## 根因

一次性集成环境用 `next start`（生产模式）验证，而 `.env` 为了本机 dev 装的是仓库示例里的占位
`JWT_SECRET`。生产模式的启动护栏（`assertJwtSecretPolicy`）宁可拒绝启动也不允许可伪造的签发密钥——
这正是它该做的：本地 dev 用它没问题，生产模式用它等于谁都能伪造 token。

## 处置

一次性随机密钥只作用于这次一次性库（测试里的用户、组织都是当场建的，跑完即弃）：

```bash
JWT_SECRET=$(openssl rand -hex 32) yarn test:integration:ephemeral
JWT_SECRET=$(openssl rand -hex 32) yarn mercato test:integration <文件名关键词>
```

## 如何避免

- 看到 `Application process exited before readiness check` 先往上翻「Captured output」，
  启动护栏的原文都在那里；不要先去怀疑构建或迁移。
- 改 `.env` 里的 `JWT_SECRET` 不是解法：那会让本机 dev 也用一个真实密钥，既没必要也不需要
  （dev 模式不校验），随机前缀才是最小干预。
- 同一时刻只允许一个一次性环境：上一次没退出时，下一次会报
  `Another ephemeral environment is already active started by …`。等它退出，或复用
  （`.ai/qa/ephemeral-env.json` 记录的那套）。构建缓存位于 `.ai/qa/ephemeral-build-cache.json`，
  源码变了会自动重建，别手动清。
