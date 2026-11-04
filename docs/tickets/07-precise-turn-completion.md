Status: done (2026-11-05)

## Parent

#1

## What to build

宿主半身精确判定**回合完成**：以 `prepend` 只读订阅 `turn/end` 会话事件（整个钩子用 try/catch 包裹、永不抛错），只有 `reason.kind === 'completed'` 才经 SSE 下发给客户端触发完成通知；`aborted` / `error` / `interrupted` / `forked` / `blocked` / `max-tokens` 不再误弹。

SSE 使用免构建通道（宿主 webServer 注册 `text/event-stream` 端点，客户端 document-relative 消费），宿主只负责归一化事件，不重复实现通知规则。归一化逻辑进入与决策引擎相同的纯测试 seam。

**红线**：任何宿主钩子异常必须被吞掉——监听器抛错会让审批 fail-closed，比没有插件更糟。

## Acceptance criteria

- [x] 用户按 Stop 后不再弹「完成」通知
- [x] 真实回合完成仍能弹「完成」通知
- [x] 报错 / 中断不弹「完成」通知
- [x] 宿主钩子异常被吞掉，真实审批流程不受影响
- [x] `turn/end` 归一化有单测覆盖
- [x] SSE 断线/重连不影响会话

## 实现与验证记录

- 宿主：`index.js` 新增 `normalizeTurnEnd`（纯函数，只放行 `reason.kind === 'completed'`）、`createCompletionFeed`（SSE 广播，单连接故障隔离）、`GET /dsh-notice/events` 路由与 `ctx.on('session/event', …)` observe-only 订阅（`ctx.effect` 可清理）；`inject` 仍只有 `webServer`，无新依赖。
- 客户端：`client.engine.js` 新增纯归一化 `classifyTurnEnd` / `normalizeTurnEndFrame`；`client.js` 以 document-relative `EventSource('dsh-notice/events')` 消费，首次 `open` 后进入**精确模式**并永久关闭 P0 `running` 边沿近似（SSE 未连通前保留迁移回退）；断线只 warn、由 EventSource 原生重连。
- 单测：`test/host-feed.test.js`（18）、`test/client-feed.test.js`（9）、`test/client-engine.test.js`（36，含 #7 新增）、`test/plugin-package.test.js`（9）；全量 `node --test --test-isolation=none "test/*.test.js"` = **72 pass / 0 fail**。
- 真机：宿主重组合后 `GET /dsh-notice/events` 200；真实主会话完成 → SSE 帧 + 通知库 toast 相隔 87ms（用户确认）；Stop → 无帧、无通知（用户确认）；子代理完成帧不弹；profile 重组合断流后自动重连、会话不受影响。详见 [docs/spikes/07-precise-turn-completion.md](../spikes/07-precise-turn-completion.md)。
- 提交：`feat: precise turn completion via host turn/end and SSE (#7)`（实现）、`docs: record #7 precise turn completion (#7)`（记录）。

## Blocked by

- #5（已完成）
