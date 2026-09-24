# deploy — 部署文档

**放**：构建方式、运行时形态、环境变量契约、上线/回滚步骤、线上运维动作。

**不放**：本地开发环境（→ `../dev/setup.md`）、产品需求（→ `../prd/`）。

命名与章节骨架见 [`../README.md`](../README.md)。

## 索引

| 文档 | 内容 |
|---|---|
| [runtime.md](./runtime.md) | 镜像构建、启动入口、Railway/compose 差异、环境变量与启动守卫 |
| [storage.md](./storage.md) | 附件字节存哪、S3 兼容对象存储的接线/迁移/回滚、C-1…C-10 约束、MinIO 彩排环境 |
| [storage-cutover-runbook.md](./storage-cutover-runbook.md) | Phase 2 切换实作手册：桶/凭据申请参数、窗口内逐条命令与预期输出、失败判据、回滚决策树、保留期、证据记录表 |
| [cicd.md](./cicd.md) | production 分支流水线、AWS 主机契约、`.env` 清单、回滚 |
