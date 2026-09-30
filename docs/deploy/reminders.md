# 提醒作业（reminders）

**目的**：到期与逾期提醒**不是隐藏定时器**，而是命令；本部署没有启用 scheduler 模块，由运维（或其 cron）决定何时跑。
已实现两条命令：

| 命令 | 覆盖的条件 |
|---|---|
| `yarn mercato finance due-reminders --org <organizationId> --tenant <tenantId> [--today YYYY-MM-DD]` | 逾期未付款 · 逾期未发运 · 库存低于阈值 |
| `yarn mercato export_finance overdue-reminders --org <organizationId> --tenant <tenantId> [--dry-run] [--today YYYY-MM-DD]` | 收款逾期（订单）· 退税逾期（柜） |

`--dry-run`（仅 export_finance）只打印将要发出的提醒、**不写任何数据**；两条命令的 `--today` 用于补跑或核对历史口径。

## 前提

- **组织与租户 id**：`yarn mercato auth list-orgs` / `list-users` 可查；命令**必须**显式传 `--org` 与 `--tenant`，否则只打印用法。
- **`JWT_SECRET` 必须是真密钥**：`production` 模式（含 `test:integration:ephemeral` 起的临时实例）会拒绝仓库示例里的占位密钥并直接退出
  —— 报错原文 `Refusing to run in production with an unsafe signing secret`。生产环境用部署时注入的密钥即可；本地补跑时用
  `JWT_SECRET=$(openssl rand -hex 32) …` 临时覆盖。
- **数据库**：命令按 `DATABASE_URL` 连接；补跑演练建议指到独立库，避免通知落进开发库。

## 幂等与去向

- 每条提醒带一个 `groupKey`（export_finance 侧 = **资源 + 它变成逾期的那一天**）。同一条条件反复跑只会**刷新同一条通知**，不会堆叠；
  条件不再成立时不再产生新通知（既有通知按类型定义 168 小时后过期）。
- **收件人按功能位解析**：`finance` 的三条投给 `finance.ledger.view` 持有者；`export_finance` 的两条分别投给
  `export_finance.orders.view` / `export_finance.cabinets.view` 持有者。
- **渠道与是否接收由每位用户自己的偏好决定**：后台 `/backend/config/notifications`（通知送达）列出全部类型，用户可在个人偏好里开关。

## 建议的 cron

每日一次（工作时段开始）即可 —— 两条命令都是幂等的，补跑安全：

```cron
# 每天 08:10，先演练再实发（示例；org/tenant 换成生产值）
10 8 * * * cd /opt/kc-cb-digital-base && yarn mercato export_finance overdue-reminders --org <org> --tenant <tenant> --dry-run
15 8 * * * cd /opt/kc-cb-digital-base && yarn mercato export_finance overdue-reminders --org <org> --tenant <tenant>
20 8 * * * cd /opt/kc-cb-digital-base && yarn mercato finance due-reminders --org <org> --tenant <tenant>
```

## 验证与回滚

- **验证**：`--dry-run` 先看条数与非零列表；实发后在 `/backend/config/notifications` 与个人通知中心能看到对应类型；
  再跑一次，条数不变（刷新而非新增）。
- **回滚**：删掉 cron 行即停。已经发出的通知是**读侧记录**，不改变业务数据；它们会按类型定义的过期时间自行过期，
  需要立刻清掉就按 `tenant_id` 删除 `notifications` 中对应类型的行（例如 `group_key like 'collection_overdue:%'`）。

## 已知边界

- `export_finance overdue-reminders` 每次每列表最多读 500 行，命中上限会打一条 warn 日志（**不静默截断**）；数据量增长后应改为按逾期天数排序分页。
- 逾期判定沿用业务侧的规则与阈值（`export_finance/lib/fileRules.ts`，45 天、边界不含、缺失日期不标），提醒命令只消费这个结论。
