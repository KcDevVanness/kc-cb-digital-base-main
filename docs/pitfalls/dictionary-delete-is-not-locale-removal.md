# 删掉语言字典 ≠ 去掉一门语言

## 现象

要把平台基线 `en | pl | es | de | ko` 收成 `en + zh`。删掉
`src/i18n/{pl,es,de,ko}.json` 之后：

- 界面看起来没问题（英文正常显示）
- 但 `Accept-Language: de` 或 `locale=de` cookie 会渲染出一个**英文页面**，
  而它自己的语言切换器里**仍然列着德语**——用户切过去等于什么也没发生
- `POST /api/auth/locale {"locale":"de"}` 返回 200 并写入一年期 cookie

## 时间线

| 时刻 | 事件 |
|---|---|
| T | 删除 `src/i18n/{pl,es,de,ko}.json`，以为收窄完成 |
| T+ | `locale=de` cookie 实测：`<html lang="en">`，但切换器仍列德语 → 说明没生效 |
| T++ | 补上三处收窄后：`de/pl/es/ko` → 400，`locale=de` → `<html lang="en">`，切换器只剩两项 |

## 证据

```bash
# 收窄前：de 被接受
curl -X POST .../api/auth/locale -H 'content-type: application/json' -d '{"locale":"de"}'
# {"ok":true}  HTTP 200

# 收窄后
# {"error":"Invalid locale"}  HTTP 400
```

## 根因

「能渲染什么语言」不是一个开关，而是三个各自独立的判定，删字典一个都没碰到：

1. **字典解析**：`loadDictionary` 对找不到的语言**回落到默认语言**。所以删字典只会让
   德语界面变成英文界面，不会让德语不可选。
2. **请求期可选集合**：`detectLocale` 只在调用方给它的集合里匹配 cookie / `Accept-Language`；
   而两个 layout 之前传的是进程级全集。
3. **路由处理器**：`POST /api/auth/locale` 用 `resolveSupportedLocalesForRequest()` 校验要写进
   cookie 的语言，这条路径**不经过 layout**，改 layout 管不到它。

更深一层：`getSupportedLocales()` = 平台基线 ∪ 已注册，框架**没有减法接口**。
唯一的收窄口是按租户的 `translations.supported_locales`，而它的默认值是全基线——
新租户不保存选择就会把德语放回来。所以产品级的「永不出德语」只能由 app 占住
resolver 槽来表达。

## 处置

见 [docs/dev/i18n.md](../dev/i18n.md)。要点：一个 owner（`app-locales.ts`）+ 三处接线
（layout filter、resolver 槽、字典 loader 的 `default` 分支），缺一处就会漏。

## 如何避免

- 「删资源」类改动先问：**有几个地方在独立判定它的存在？** 删文件通常只影响其中一处。
- 验收要打**端到端**证据（接口状态码 + 渲染出的 `lang` + 切换器选项），
  不要只看「界面变成英文了」——那正是回退机制制造的假象。
- 占用了框架的单例槽（resolver），就要继续回答槽原本的问题，
  否则会静默丢掉一层能力（这里是租户级收窄），只在启动时留一条 warning。
