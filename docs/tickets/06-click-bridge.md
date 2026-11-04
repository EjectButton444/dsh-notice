Status: pending

## Parent

#1

## What to build

宿主半身提供**点击桥**：用户点击通知时，客户端把点击意图送达宿主，宿主执行 `Start-Process 'dsh://open'`，把 DSH 窗口 restore + show + focus（含窗口隐藏到托盘的状态）。任何失败静默处理，不影响会话与通知主流程。

通道沿用 spec 的免构建方案（宿主 webServer 注册端点 + 客户端 document-relative 请求，与 `dsh-client-hmr` 同款）。点击桥的最终形态以 #3 的基线结论为准；若 #3 判定不可行，按其降级方案实现并在本 issue 记录偏差。

## 前置结论（来自 #3，可直接作为实现依据）

- 点击通知时，隐藏窗口的渲染进程仍会触发 `Notification.onclick`；但 DSH 窗口**不会自己回到前台** → 必须实现点击桥。
- `dsh://open` 从托盘隐藏 / 最小化状态恢复并聚焦：实测 **0.16–0.23s**，同一窗口单实例、无新窗口。
- 宿主 spawn 前**必须清理继承的 `ELECTRON_RUN_AS_NODE`**，否则 `DeepSeek Harness.exe` 以 Node 模式启动、约 50–140ms 退出，不触发单实例唤起。
- 兜底：宿主直接 Win32 `ShowWindow + SetForegroundWindow`（本机可行，但受前台锁策略影响）。
- 详见 [spikes/03-tray-click-baseline.md](../spikes/03-tray-click-baseline.md)。

## Acceptance criteria

- [ ] 点击通知能把 DSH 窗口带到前台（窗口在后台时）
- [ ] 窗口隐藏到托盘时，点击通知也能唤起窗口
- [ ] 宿主端点故障时点击静默失败，不影响会话
- [ ] 若采用降级方案，偏差与原因记录在 issue 评论

## Blocked by

- #5
