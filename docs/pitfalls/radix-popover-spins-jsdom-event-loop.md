# jsdom 下挂载 Radix 浮层会自旋，饿死定时器

## 现象

给带浮层（Radix Popover）的组件写 jest 用例时：

- 用例**不报错但极慢**：单条 220ms 防抖的用例要跑十几秒，整套文件被拖到 2 分钟以上；
- 断言里等待元素总是超时（`Unable to find role="option"`），但把超时调大也没用；
- `setTimeout(cb, 220)` 的回调在 11 秒后才执行，且同一时刻所有定时器一起触发；
- CPU 打满：`user 11.34s / real 11.74s`。

## 时间线

1. 2026-09-21：为 `LookupSelect` 产出上游补丁（下拉面板，改用 `Popover` 承载结果列表），在
   本仓 jest（`testEnvironment: 'jsdom'`）里跑补丁自带用例：26 条中 9 条失败，全部是「需要选项
   渲染出来」的用例。
2. 加日志定位：`setItems(result)` 已调用、`.then` 未被取消，但 React 之后再无渲染 —— 说明
   更新没被 flush。
3. 用最小探针隔离（不涉及被改组件）：**只要 Radix Popover 同时挂了 anchor 与 content，jsdom
   事件循环就被同步占满**，全部定时器冻结；只看 anchor 或只看 content 都正常。
4. 换 `jest.useFakeTimers()` 后 CPU 从 10844ms 降到 52ms，用例全绿。

## 证据

探针（`render(<Popover open><PopoverAnchor asChild><input/></PopoverAnchor><PopoverContent>panel</PopoverContent></Popover>)` 后空转 300ms，测 `process.cpuUsage()`）：

| 变体 | 300ms 窗口内消耗 CPU |
|---|---|
| anchor + content（默认，即任何真实用法） | **10844ms** |
| anchor + content，不 `preventDefault` 自动聚焦 | **11942ms** |
| 只有 content（无 anchor） | 36ms |
| 只有 anchor | 2ms |
| 什么都没有（基线） | 2ms |
| anchor + content + `jest.useFakeTimers()` | **52ms** |

## 根因

jsdom 没有布局引擎：anchor 与 content 的尺寸恒为 0，Radix 的 Popper（`@floating-ui/react-dom`）
在这对零尺寸元素上持续重排，而这些重排由 **rAF / 定时器驱动**——于是它们不吃掉单次同步时间，
而是把定时器队列挤到无法前进（假定时器接管 rAF 与 `setTimeout` 后自旋即停止）。

`[INFERENCE]` 上游具体是 floating-ui 的哪一段循环未逐层确认；已确认的是：触发条件 = anchor + content
同时挂载，解除条件 = 假定时器（或卸载浮层）。这是环境特性，不是组件缺陷：上游 `ComboboxInput`
自带测试同样对该组合一律使用假定时器。

## 处置

给浮层交互的用例统一用假定时器推进防抖，参考写法（与上游 `ComboboxInput.test.tsx` 一致）：

```tsx
describe('...', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  async function settleDebounce() {
    await act(async () => { jest.advanceTimersByTime(250) })
  }

  it('...', async () => {
    const { container } = render(<LookupSelect value={null} onChange={() => {}} fetchItems={fetch} />)
    fireEvent.focus(getInput(container))
    await settleDebounce()
    expect(screen.getAllByRole('option')).toHaveLength(2)   // 假定时器下不要用 findBy*/waitFor
  })
})
```

要点：

- 假定时器下 `findBy*` / `waitFor` 会挂起，改用 `act` + `advanceTimersByTime` 后**同步查询**；
- 不开浮层的用例保持真实定时器即可（例如 `variant="inline"`、只校验选中摘要的用例）；
- 断言里不要依赖真实 220ms 防抖，否则同一坑会以「偶发超时」的形式复现。

## 如何避免

1. 本仓 jest 环境下，**凡是会挂载框架浮层（Popover / Select / CommandMenu）的用例，默认用假定时器**。
2. 写 UI 用例前先看同类组件的既有测试怎么处理时间（`node_modules/@open-mercato/ui/src/backend/inputs/__tests__/ComboboxInput.test.tsx`）。
3. 出现「用例很慢但不错、或 findBy 永远超时」时，先量 CPU：`/usr/bin/time -p node node_modules/jest/bin/jest.js ...`，
   `user` 时间 ≈ `real` 时间即为本坑。
4. 真实浏览器不受影响；不要在应用代码里为测试环境加补丁。
