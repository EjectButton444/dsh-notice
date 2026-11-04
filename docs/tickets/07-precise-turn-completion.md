Status: done (2026-11-05)

## Parent

#1

## What to build

宿主半身精确判定**回合完成**：只读订阅 `turn/end` 会话事件（整个钩子用 try/catch 包裹、永不抛错），只有 `reason.kind === 'completed'` 才经 SSE 下发给客户端触发完成通知；`aborted` / `error` / `interrupted` / `forked` / `blocked` / `max-tokens` 不再误弹。

SSE 使用免构建通道（宿主 webServer 注册 `text/event-stream` 端点，客户端 document-relative 消费），宿主只负责归一化事件，不重复实现通知规则。归一化逻辑进入与决策引擎相同的纯测试 seam。

**红线**：任何宿主钩子异常必须被吞掉——监听器抛错会让审批 fail-closed，比没有插件更糟。

**实现注记**：`turn/end` 通过 `session/event` 普通 emit 派发（不是 waterfall），`prepend` 只对 waterfall 有意义，故实现用普通 `ctx.on`（observe-only）；见 [spikes/07](../spikes/07-precise-turn-completion.md)。

## Acceptance criteria

- [x] 用户按 Stop 后不再弹「完成」通知（真机验收）
- [x] 真实回合完成仍能弹「完成」通知（真机验收）
- [x] 报错 / 中断不弹「完成」通知（`aborted` 真机覆盖；`error`/`interrupted`/`forked`/`blocked`/`max-tokens` 与 Stop 共用同一条宿主过滤，单测逐项覆盖）
- [x] 宿主钩子异常被吞掉，真实审批流程不受影响
- [x] `turn/end` 归一化有单测覆盖
- [x] SSE 断线/重连不影响会话（宿主断流/重连真机两轮通过；页面内 EventSource 原生重连未独立打点，并入 #8 复核）

## 记录

- 实现：`ce0ba6b`（feat）+ 评审修复提交（见 `git log`）；验收记录：[docs/spikes/07-precise-turn-completion.md](../spikes/07-precise-turn-completion.md)。
- 全量单测：`node --test --test-isolation=none "test/*.test.js"` = 73 pass / 0 fail。

## Blocked by

- #5（已完成）
