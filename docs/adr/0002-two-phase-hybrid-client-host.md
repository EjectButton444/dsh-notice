# 两阶段混合实现：客户端检测、宿主半身补强

DSH 的客户端插件能精确区分「授权 / 提问」并知道用户此刻是否在看某个会话（`uiSession.sessionStatus.pendingInteraction` 是活实例，`document.hasFocus()` 可用），但拿不到 `turn/end` 的原因、也无法从渲染进程唤起退到托盘的窗口（`dsh://open` 在渲染进程内被 `will-navigate` 吞掉，`window.open` 被拒）。宿主插件能拿到精确事件（`approval/request`、`user-questions/request`、`session/event` 的 `turn/end`）并可用 `Start-Process 'dsh://open'` 触发单实例唤起，但拿不到焦点状态。宿主→客户端没有可扩展的事件通道（`ctx.remote.$on` 是 29 项封闭白名单，Typert `$mount` 要构建产物），唯一免构建通道是 `ctx.webServer.register()` + SSE（`dsh-client-hmr` 同款做法）。

因此 v1 分两阶段：**P0 纯客户端插件**订阅注意力状态、用 Web Notification 发系统通知、用「窗口焦点 + 当前主视图会话」做前台抑制、按会话 tag 合并与消解；**P1 增加宿主半身**，把 `turn/end.reason.kind` 经 SSE 推给客户端以区分「完成 / 中止 / 报错」，并提供点击桥（客户端 POST 宿主端点 → 宿主 `Start-Process 'dsh://open'`）把托盘中的窗口拉回前台。先做 P0 是为了在 0.5–1 天内验掉两个最大未知数（AUMID/图标归属、Toast 点击行为），避免一边押注架构一边踩平台坑。

Status: accepted

## Considered Options

- **纯客户端**：最简单，但点击无法唤起托盘窗口、也无法区分「完成」与「用户按了 Stop / 报错」，达不到验收标准。
- **纯宿主**：事件最精确、点击最可靠，但拿不到焦点信号，会违背「前台不打扰」的默认提醒条件。
- **一次性做混合**：省一次迭代，但在 AUMID 等平台未知数未验证前就投入双半身与 SSE，风险前置过大。
