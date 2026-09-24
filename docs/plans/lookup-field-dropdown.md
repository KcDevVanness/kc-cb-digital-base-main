# 关联字段选择器改为「下拉 + 搜索」实施计划

## 目标

把 `LookupSelect` 从「必须先知道记录才能搜」改成「聚焦即见首页选项、输入即过滤」的下拉形态。
需求与验收标准见 [`../prd/lookup-field-dropdown.md`](../prd/lookup-field-dropdown.md)；
补丁与验证工具链在 `.ai/analysis/lookup-select-dropdown/`。

修复面在上游框架包：补丁已产出并通过验证（把补丁 `git apply` 到安装版 0.8.0 原始文件后，
组件自带的 26 条用例全绿）。本仓不复制框架代码。

## 阶段划分

- [ ] **阶段一：补丁进入上游 / 内部版本** —— 验收：`@open-mercato/ui` 发布含本补丁的版本
  （或产出内部构建），其仓库内 `LookupSelect.test.tsx` 全绿且 lint/typecheck 通过。
  产物：[`0001-lookup-select-dropdown.patch`](../../.ai/analysis/lookup-select-dropdown/0001-lookup-select-dropdown.patch)、
  交接说明 [`README.md`](../../.ai/analysis/lookup-select-dropdown/README.md)。
- [ ] **阶段二：本仓升级依赖并回归** —— 验收：升级 `@open-mercato/*` 版本后，PRD 的 7 条验收
  标准逐条通过（新建流程 7 个受闸门字段可展开；一屏多字段未交互零请求；选中后不泄露 UUID），
  且 `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test && yarn build` 通过。
  本阶段**不改任何业务代码**；若发现某内联布局站点需要旧形态，只加 `variant="inline"`。
- [ ] **阶段三（可选）：后续项** —— 验收：各自独立可验收的小改动。
  1. 上游补 `input:` 组件覆盖句柄（代码草案见交接 README「Deliberately out of scope」）；
  2. `GET /api/customers/addresses`、`GET /api/dictionaries/{id}/entries` 的 list schema 增加
     `search`，让这两类选择器支持服务端过滤；
  3. 未启用模块（eudr / warranty_claims / staff）升版后逐个确认形态，必要时传 `variant="inline"`。

## 依赖与风险

| 依赖 / 风险 | 说明 | 兜底 |
|---|---|---|
| 上游发版节奏 | 补丁需随 `@open-mercato/ui` 发布才可消费 | 用 `resolutions` 或私有 registry 出内部版本；补丁已保证可干净应用到 0.8.0 |
| 上游不接受「默认改下拉」 | 可能要求保持默认形态 | 退化方案：默认保持 `inline`，由调用点显式传 `variant="dropdown"`；本仓只需改 2 个销售页面 + 1 处客户详情（共 7 个字段）的传参 |
| `defaultOpen` 语义微调 | 两处调用点（通知偏好、发运地址）从「挂载即见列表」变为「挂载预取、按意图展开」 | 若产品要求恢复原样，这两处传 `variant="inline"` |
| 契约变更面 | `minQuery` 默认 2→0、新增 `variant`；调用方零改动，但属公开 prop 语义变化 | 交接 README 已列全部行为对照表；上游按 BACKWARD_COMPATIBILITY 流程评审 |

## 进度

| 阶段 | 状态 | 备注 |
|---|---|---|
| 一 | 进行中 | 补丁 + 测试 + 验证工具链已交付并自验通过（26/26）；待上游接受或内部发布 |
| 二 | 未开始 | 依赖阶段一产物 |
| 三 | 未开始 | 可选，按需排期 |
