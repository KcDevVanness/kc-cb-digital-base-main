# dev — 开发文档

**放**：环境搭建、架构说明、关键机制的实现方式、本地调试手法。

**不放**：产品需求（→ `../prd/`）、上线步骤与生产环境（→ `../deploy/`）、故障复盘（→ `../pitfalls/`）。

命名与章节骨架见 [`../README.md`](../README.md)。

## 索引

| 文档 | 内容 |
|---|---|
| [setup.md](./setup.md) | 依赖服务、首次初始化、日常命令、验证命令清单 |
| [architecture.md](./architecture.md) | 目录职责、启用模块、请求链路、生成物边界 |
| [i18n.md](./i18n.md) | 语言集、字典位置、三个收窄入口、扩展步骤 |
| [parallel-development.md](./parallel-development.md) | 多路并行开发：并行单元、worktree、共享脊柱文件清单、数据库与端口分配、PR 与合并规则 |
