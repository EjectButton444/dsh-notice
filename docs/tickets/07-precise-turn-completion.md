Status: pending

## Parent

#1

## What to build

宿主半身精确判定**回合完成**：以 `prepend` 只读订阅 `turn/end` 会话事件（整个钩子用 try/catch 包裹、永不抛错），只有 `reason.kind === 'completed'` 才经 SSE 下发给客户端触发完成通知；`aborted` / `error` / `interrupted` / `forked` / `blocked` / `max-tokens` 不再误弹。

SSE 使用免构建通道（宿主 webServer 注册 `text/event-stream` 端点，客户端 document-relative 消费），宿主只负责归一化事件，不重复实现通知规则。归一化逻辑进入与决策引擎相同的纯测试 seam。

**红线**：任何宿主钩子异常必须被吞掉——监听器抛错会让审批 fail-closed，比没有插件更糟。

## Acceptance criteria

- [ ] 用户按 Stop 后不再弹「完成」通知
- [ ] 真实回合完成仍能弹「完成」通知
- [ ] 报错 / 中断不弹「完成」通知
- [ ] 宿主钩子异常被吞掉，真实审批流程不受影响
- [ ] `turn/end` 归一化有单测覆盖
- [ ] SSE 断线/重连不影响会话

## Blocked by

- #5
