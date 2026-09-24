# deploy — 部署文档

**放**：构建方式、运行时形态、环境变量契约、上线/回滚步骤、线上运维动作。

**不放**：本地开发环境（→ `../dev/setup.md`）、产品需求（→ `../prd/`）。

命名与章节骨架见 [`../README.md`](../README.md)。

## 索引

| 文档 | 内容 |
|---|---|
| [runtime.md](./runtime.md) | 镜像构建、启动入口、Railway/compose 差异、环境变量与启动守卫 |
| [cicd.md](./cicd.md) | production 分支流水线、AWS 主机契约、`.env` 清单、回滚 |
| [host-access.md](./host-access.md) | 公网地址契约（必须用 Elastic IP）、四层可达性诊断、SSH 与 AWS 侧访问 |
