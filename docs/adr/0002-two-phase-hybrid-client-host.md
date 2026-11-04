# 两阶段混合实现：客户端检测、宿主半身补强

DSH 的客户端插件能精确区分「授权 / 提问」并知道用户此刻是否在看某个会话（`uiSession.sessionStatus.pendingInteraction` 是活实例，`document.hasFocus()` 可用），但拿不到 `turn/end` 的原因、也无法从渲染进程唤起退到托盘的窗口（`dsh://open` 在渲染进程内被 `will-navigate` 吞掉，`window.open` 被拒）。宿主插件能拿到精确事件（`approval/request`、`user-questions/request`、`session/event` 的 `turn/end`）并可用 `Start-Process 'dsh://open'` 触发单实例唤起，但拿不到焦点状态。宿主→客户端没有可扩展的事件通道（`ctx.remote.$on` 是 29 项封闭白名单，Typert `$mount` 要构建产物），唯一免构建通道是 `ctx.webServer.register()` + SSE（`dsh-client-hmr` 同款做法）。

因此 v1 分两阶段：**P0 纯客户端插件**订阅注意力状态、用 Web Notification 发系统通知、用「窗口焦点 + 当前主视图会话」做前台抑制、按会话 tag 合并与消解；**P1 增加宿主半身**，把 `turn/end.reason.kind` 经 SSE 推给客户端以区分「完成 / 中止 / 报错」，并提供点击桥（客户端 POST 宿主端点 → 宿主 `Start-Process 'dsh://open'`）把托盘中的窗口拉回前台。先做 P0 是为了在 0.5–1 天内验掉两个最大未知数（AUMID/图标归属、Toast 点击行为），避免一边押注架构一边踩平台坑。

**实现注记（2026-11-04，#6）**：点击桥的最终形态与本 ADR 所述不同——真机实测本机宿主上下文无法完成 `dsh://open` 单实例握手（第二实例在握手前退出；agent 工具 shell 为 Low 完整性、宿主 spawn 的 helper 为 Medium，问题在启动/沙箱上下文）；且外部 Win32 显示（`SC_RESTORE`/`ShowWindow`）会让 Chromium 渲染器保持冻结（窗口可见但点不动、无渲染更新）。最终实现：客户端点击 → 带标记头 `POST /dsh-notice/focus` → 宿主 spawn `focus.ps1`，**主路径**向应用进程的 `Electron_NotifyIconHostWindow` 投递 Electron 托盘点击消息（`WM_APP+1` / icon id 2 / `WM_LBUTTONDOWN`），让 DSH 自己的 `focusPrimaryWindow()` 原生 restore+show+focus；Win32 消息与 `dsh://open` 仅兜底。两阶段分工与「宿主补强 P0 短板」的决策不变；偏差与证据见 [spikes/06-click-bridge.md](../spikes/06-click-bridge.md)。

**实现注记（2026-11-05，#8 发布核对）**：P1 宿主半身在 v1 只订阅 `session/event` 的 `turn/end`（经 SSE 下发精确完成原因）；本 ADR 正文提到的宿主 `approval/request`、`user-questions/request` 订阅 **v1 未实现**——P0 的 `pendingInteraction` 已覆盖审批/提问提醒，宿主侧细节对通知决策不是必需，留待 v2。两阶段分工与决策本身不变。

Status: accepted

## Considered Options

- **纯客户端**：最简单，但点击无法唤起托盘窗口、也无法区分「完成」与「用户按了 Stop / 报错」，达不到验收标准。
- **纯宿主**：事件最精确、点击最可靠，但拿不到焦点信号，会违背「前台不打扰」的默认提醒条件。
- **一次性做混合**：省一次迭代，但在 AUMID 等平台未知数未验证前就投入双半身与 SSE，风险前置过大。
