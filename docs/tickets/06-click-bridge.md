Status: done (2026-11-04) — 真机验收通过；实现提交 `b03b19d` + 修复提交（托盘原生恢复）；验收记录见 [docs/spikes/06-click-bridge.md](../spikes/06-click-bridge.md)。

## Parent

#1

## What to build

宿主半身提供**点击桥**：用户点击通知时，客户端把点击意图送达宿主，宿主把 DSH 窗口 restore + show + focus（含窗口隐藏到托盘的状态）。任何失败静默处理，不影响会话与通知主流程。

通道沿用 spec 的免构建方案（宿主 webServer 注册端点 + 客户端 document-relative 请求，与 `dsh-client-hmr` 同款）。点击桥的最终形态以 #3 的基线结论为准；若 #3 判定不可行，按其降级方案实现并在本 issue 记录偏差。

## 前置结论（来自 #3，可直接作为实现依据）

- 点击通知时，隐藏窗口的渲染进程仍会触发 `Notification.onclick`；但 DSH 窗口**不会自己回到前台** → 必须实现点击桥。
- `dsh://open` 从托盘隐藏 / 最小化状态恢复并聚焦：实测 **0.16–0.23s**，同一窗口单实例、无新窗口。
- 宿主 spawn 前**必须清理继承的 `ELECTRON_RUN_AS_NODE`**，否则 `DeepSeek Harness.exe` 以 Node 模式启动、约 50–140ms 退出，不触发单实例唤起。
- 兜底：宿主直接 Win32 `ShowWindow + SetForegroundWindow`（本机可行，但受前台锁策略影响）。
- 详见 [spikes/03-tray-click-baseline.md](../spikes/03-tray-click-baseline.md)。

## Acceptance criteria

- [x] 点击通知能把 DSH 窗口带到前台（窗口在后台时）——自动化后台场景 + 真人点击（≈550ms，可正常操作）
- [x] 窗口隐藏到托盘时，点击通知也能唤起窗口——自动化隐藏场景 355–527ms + 渲染恢复验证；真人点击路径同一条
- [x] 宿主端点故障时点击静默失败，不影响会话——端点始终 204、客户端不读响应、spawn/子进程错误全吞（单测覆盖）
- [x] 若采用降级方案，偏差与原因记录在 issue 评论——见下方「实现偏差」，GitHub issue #6 只放一行指针

## 实现偏差（#6 实测，来自 #3 结论的适用条件修正）

- #3 的「`Start-Process 'dsh://open'` 即可唤起隐藏窗口」在**低完整性宿主**下不成立：本机宿主/工具进程是 Low 完整性，第二实例在单实例握手前退出（退出码 `0x80000003`），窗口不恢复。
- 更关键：**外部 Win32 恢复（`SC_RESTORE`/`ShowWindow`）只能把窗口“显示”出来，Chromium 渲染器仍处于冻结状态**（4 秒内窗口区域零像素变化、无提问卡片、点击无反馈）——用户实测「窗口回来了但不可操作」。
- 最终实现 = **应用原生路径为主**：向 Electron 的 `Electron_NotifyIconHostWindow` 投递托盘点击消息（`WM_APP+1` / icon id 2 / `WM_LBUTTONDOWN`），触发 DSH 自己的 `focusPrimaryWindow()` → 窗口恢复且**完全可交互**；其次是 Win32 消息兜底，最后才是 `dsh://open`。
- 实现中还规避了：Node `detached: true` + `stdio: 'ignore'` 会让 `powershell.exe` 不执行脚本直接退出（改普通子进程 + `unref()`）；`focus.ps1` 必须纯 ASCII（PowerShell 5.1 对无 BOM 脚本按 ANSI 解码）；隐藏窗口可能保留前台句柄导致“误判已聚焦”（`FocusedNow` 必须同时要求 OnScreen）。

## Blocked by

- #5
