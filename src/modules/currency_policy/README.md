# `currency_policy` — 币种与汇率主数据收敛

app 自有模块，**无实体、无路由、无 UI、无迁移**。只做一件事：在 `customers`/`currencies` 各自的
`seedDefaults` 之后，按公司政策把**币种字典**与**汇率主数据**收敛到同一个集合，避免两个种子互相覆盖。

完整策略（启用哪些币种、汇率来源、重跑命令）见 [`docs/dev/currency-policy.md`](../../../docs/dev/currency-policy.md)。

## 入口

| 文件 | 作用 |
|---|---|
| `lib/policy.ts` | 政策定义：启用币种集合、汇率来源与优先级 |
| `lib/apply.ts` | 收敛实现（对字典与汇率主数据做幂等对齐） |
| `setup.ts` | `seedDefaults`：由框架在模块启用时调用 |
| `cli.ts` | 手工重跑入口（不依赖重新播种） |

## 规则（有意为之）

- **必须排在 `src/modules.ts` 最后**：它的 `seedDefaults` 依赖 `customers`/`currencies` 先播种完成。
- **幂等**：重复执行结果一致；不做删除，只对齐与补齐。
- **不改安装层代码**：政策差异全部落在本模块，`node_modules` 保持只读。

## 验证

```bash
yarn generate && yarn typecheck
yarn mercato currency-policy --help    # CLI 入口
```

## 回滚

从 `src/modules.ts` 移除 `{ id: 'currency_policy', from: '@app' }` 并 `yarn generate`：
后续播种不再收敛；已写入的字典与汇率数据保留。
