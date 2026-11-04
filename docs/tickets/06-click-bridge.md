Status: in-progress (2026-11-04) — 实现完成（`client.js` 点击 POST → `index.js` 端点 → `focus.ps1` 两段式唤起）；自动化真机验证与偏差记录见 [docs/spikes/06-click-bridge.md](../spikes/06-click-bridge.md)。前台聚焦 + 真人点击验收待验证机解锁后补齐。

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
- [x] 宿主端点故障时点击静默失败，不影响会话（端点始终 204、客户端不读响应、spawn 异常/子进程 error 全吞；单测覆盖）
- [x] 若采用降级方案，偏差与原因记录在 issue 评论（见下方「实现偏差」与 [spikes/06](../spikes/06-click-bridge.md)；GitHub issue #6 只放一行指针）

## 实现偏差（#6 实测，来自 #3 结论的适用条件修正）

- #3 的「`Start-Process 'dsh://open'` 即可唤起隐藏窗口」在**低完整性宿主**下不成立：本机宿主半身/工具进程是 Low 完整性，第二实例在单实例握手前退出（退出码 `0x80000003`），窗口不恢复。
- 最终点击桥 = **直接 Win32 消息主路径**（`PostMessage(WM_SYSCOMMAND, SC_RESTORE)` + `SetForegroundWindow`，即 #3 记录的 Win32 退路）+ **`dsh://open` 兜底**；客户端仍只负责 document-relative `POST /dsh-notice/focus`，宿主 `focus.ps1` 执行恢复。
- 实现中还规避了两个陷阱：Node `detached: true` + `stdio: 'ignore'` 会让 `powershell.exe` 不执行脚本直接退出；`focus.ps1` 必须纯 ASCII（PowerShell 5.1 对无 BOM 脚本按 ANSI 解码）。

## Blocked by

- #5
