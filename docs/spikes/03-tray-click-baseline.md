# Spike #03：托盘隐藏通知与点击唤起基线

状态：**完成（2026-11-04）**。对应 ticket [03-tray-click-baseline.md](../tickets/03-tray-click-baseline.md)；验证风险 R7（隐藏窗口时通知）与 R3（点击唤起），为 [#06 点击桥](../tickets/06-click-bridge.md) 定型。

环境同 [Spike #02](02-toast-spike.md)：DSH Desktop 0.2.1-rc.5 / Electron 44.7.0 / Windows 11 25H2 build 26200.7840 / 150% 缩放；系统通知默认开启、勿扰关闭。

## 方法

- 隐藏到托盘：向 DSH 主窗口发 `WM_CLOSE`，走应用自身的 close-to-tray 路径（background-close 确认标记已存在，无弹窗）；观测 `visible=false, on_screen=false`。
- 通知触发：改写 `client.js` 的 `BUILD_TAG` 触发 client HMR，重载后 `apply` 弹调试 Toast；用屏幕区域采样 + 像素差异测量"出现时刻"，并保存全屏证据。
- 点击：合成鼠标点击（`SetCursorPos` + `mouse_event`）与**真人点击**各测一次；用临时 `toast.onclick` 探针向本机 beacon（127.0.0.1:57123）打点，判断点击事件是否送达隐藏的渲染进程。
- `dsh://open`：`Start-Process 'dsh://open'` 并轮询窗口 `on_screen` / 前台状态；分别测隐藏与最小化两种起始状态；**先清理继承的 `ELECTRON_RUN_AS_NODE`**（见下方陷阱）。

## R7：隐藏窗口时通知照常弹出 —— 通过

- `WM_CLOSE` 后窗口在 ~20ms 内从屏幕消失（`on_screen=false`）。
- 隐藏状态下 HMR 仍能重载 client 插件并弹通知：从改写 `client.js` 到屏幕出现 Toast 约 **875ms**（含 HMR 轮询 ~500ms + 重载执行），未见后台节流造成的秒级延迟。
- 证据：`shots/r7-click-toast-evidence-*.png` —— 桌面由其他应用占据、DSH 不在屏幕时，Toast 正常显示且归属/标题/正文正确。
- 结论：验收标准 6（托盘隐藏仍能提醒）机制成立，无需为 Hidden 状态做额外改动。

## 点击通知的当前行为：事件有到、窗口不回来

- **合成鼠标点击无法激活 Windows Toast**：`mouse_event`/`SetCursorPos` 点击后 Toast 仍在、`onclick` 未触发（Windows Shell 对注入输入不响应）。因此点击行为必须用真人点击测。
- **真人点击（窗口隐藏）**：`onclick` 在隐藏的渲染进程内正常触发 —— beacon 收到 `/click`，时间戳比 Toast 弹出晚约 **1.26s**，说明点击事件送达、渲染器在隐藏状态下未被挂起。
- **但 DSH 窗口不会自己回到前台**（用户实测确认）：点击后窗口保持隐藏，最终用户可见行为是"点了没反应"。
- 结论：验收标准 2 不能依赖系统默认激活，**#6 点击桥是必需的**。

## `dsh://open` 唤起隐藏窗口 —— 可行，实测 0.16–0.23s

| 起始状态 | 成功 | 窗口 on-screen | 前台 | 单实例 |
|---|---|---|---|---|
| 隐藏到托盘（3 次） | 3/3 | **226 / 224 / 219 ms** | 同帧恢复 | hwnd 不变，无新窗口 |
| 最小化（2 次） | 2/2 | **179 / 162 ms** | 同帧恢复 | 同上 |

- **关键陷阱（#6 必须处理）**：DSH 宿主进程的环境里有 `ELECTRON_RUN_AS_NODE=1`。若从该环境直接 `Start-Process 'dsh://open'`，被启动的 `DeepSeek Harness.exe` 会按 **Node 模式**运行，约 50–140ms 内退出（exit code 1），不发送 `second-instance`，窗口不会恢复；看起来像 "dsh://open 不工作"。必须先**从子进程环境中删除 `ELECTRON_RUN_AS_NODE`**（或显式传入净化后的 env）再启动，恢复才生效。
- 冷启动成本远低于 spec 预估的 1–3s：本机二次实例在 **~0.16–0.23s** 内完成 restore + show + focus（同一窗口单实例）。
- 退路（未采用，仅记录）：宿主进程用 PowerShell 调 `ShowWindow(SW_RESTORE) + SetForegroundWindow` 直接操作窗口也可立即恢复（本机验证有效），但受 Windows 前台锁策略影响且绕过应用自身路径，只作 #6 兜底。

## #6 点击桥形态结论：**可行**，按「客户端 onclick → 宿主端点 → `dsh://open`」实现

- 数据流：client 的 `notification.onclick`（隐藏窗口仍触发）→ document-relative `fetch('plugins/notice/focus', { method: 'POST' })` → 宿主 `ctx.webServer.register` 端点 → 宿主 spawn `Start-Process 'dsh://open'`（**env 已净化**）→ 实测 **~0.16–0.23s** 恢复并聚焦。
- 宿主侧要求：spawn 前清除 `ELECTRON_RUN_AS_NODE` 等 Electron-as-node 开关；所有失败静默（通知是旁路）。
- 兜底方案：`dsh://open` 不可用时宿主直接 Win32 `ShowWindow + SetForegroundWindow`；仍失败则降级为「尽力聚焦」并在 README 记录。
- 验收标准 2 可按「点击后约 0.2–1s 窗口回到前台」验收。
- **#6 实现后修正（2026-11-04）**：上述协议结论的成立前提是**宿主进程能完成 `dsh://open` 单实例握手**。本机 #6 实测 DSH 宿主/工具进程为低完整性级别，协议第二实例在握手前退出（`0x80000003`），窗口不恢复；并且外部 Win32 显示虽然能把窗口“画”出来，却让 Chromium 渲染器保持冻结（点不动、无提问卡片）。最终实现改为**以应用原生路径为主**：向 Electron 的 `Electron_NotifyIconHostWindow` 投递托盘点击消息触发 `focusPrimaryWindow()`（窗口恢复且完全可交互），Win32 消息与 `dsh://open` 仅作兜底；另外发现 Node `detached:true` + `stdio:'ignore'` 会让 PowerShell 不执行脚本。偏差、耗时与真人点击证据见 [spikes/06-click-bridge.md](06-click-bridge.md)。

## 证据与产物（本地 `.scratch/verify/`，已 gitignore，未提交）

- 截图/JSON：`r7-click-toast-evidence-*.png`、`r7-click.json`、`click-beacon-*.png`、`click-beacon.json`、`beacon.jsonl`、`human-click-watch.jsonl`
- 计时：`dsh-open-hidden-cleanenv.json`（226/224/219ms）、`dsh-open-minimized-cleanenv.json`（179/162ms）
- 脚本：`dsh-tray-lib.ps1`、`tray-r7-click.ps1`、`tray-click-beacon.ps1`
