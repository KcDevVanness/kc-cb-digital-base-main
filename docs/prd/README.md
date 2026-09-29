# prd — 产品需求文档

**放**：要解决什么问题、给谁用、成功长什么样、明确不做什么。

**不放**：技术方案与任务拆解（→ `../plans/`）、实现细节（→ `../dev/`）。

命名与章节骨架见 [`../README.md`](../README.md)。文件名 kebab-case，一个特性一份。

## 骨架

```md
# <特性名>

## 背景与问题
现在是什么样、痛点在哪、为什么现在做。

## 目标 / 非目标
目标写成可验证的结果；非目标明确写出来，防止范围蔓延。

## 用户与场景
谁、在什么场景下、用它完成什么。

## 验收标准
逐条可判定（能写测试或能手工复现），不要写「体验良好」这类无法判定的句子。

## 开放问题
还没定的决策，标上谁来定、什么时候必须定。
```

## 索引

| 文档 | 状态 |
|---|---|
| [lookup-field-dropdown.md](./lookup-field-dropdown.md) | 待上游发版（补丁已产出并自验；已确认安装版 `@open-mercato/ui` 0.8.0 未含该改动） |
| [cross-border-erp.md](./cross-border-erp.md) | 已实现：阶段一~四、六、七完成并验证；阶段五收尾进行中；平台传输层待业务答 Q4 |
| [finance-and-cockpit.md](./finance-and-cockpit.md) | 已交付：财务模块（费用/到岸成本/台账/损益）+ 俄方数据打通 + 老板驾驶舱；执行口径见 `.ai/specs/2026-09-28-finance-ledger-and-cockpit-data.md`，进度见 [../plans/finance-and-cockpit.md](../plans/finance-and-cockpit.md) |
