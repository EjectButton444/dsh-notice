# Spike #06：通知点击桥（宿主 focus 端点）实测结论

状态：**完成（2026-11-04）**。对应 ticket [06-click-bridge.md](../tickets/06-click-bridge.md)；实现设计见 [docs/design-notes.md](../design-notes.md) §5 P1，基线前提见 [spikes/03-tray-click-baseline.md](03-tray-click-baseline.md)。

本文件记录 #6 点击桥的**最终实现形态、真机验证结果与偏差**。一句话：客户端 `notification.onclick` → document-relative `POST /dsh-notice/focus` → 宿主 spawn `focus.ps1` → **优先借助 Electron 自身的托盘点击事件触发应用原生 `focusPrimaryWindow()`**（窗口恢复且可交互），Win32 消息与 `dsh://open` 作为兜底。

## 最终实现形态

| 半身 | 文件 | 职责 |
|---|---|---|
| 客户端 | `client.js` | `toast.onclick` 先保留 `window.focus()` 尽力聚焦，再 document-relative `fetch('dsh-notice/focus', { method: 'POST', headers: { 'x-dsh-notice-focus': '1' } })`；fire-and-forget，失败只 `console.warn`。 |
| 宿主 | `index.js` | `POST /dsh-notice/focus`：只接受带 `x-dsh-notice-focus: 1` 的 POST（其余 403/405），立即 204；spawn 随包 `focus.ps1`（`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <pkg>/focus.ps1`），`detached: false` + `stdio: 'ignore'` + `windowsHide` + 环境清洗 + `unref()`；所有 spawn 异常/子进程 `error` 静默。 |
| 宿主 | `focus.ps1`（新增，纯 ASCII） | 三段式恢复（见下）。 |

`focus.ps1` 的恢复顺序（每段失败才进入下一段，全程静默）：

1. **应用原生路径（主）**：向应用进程的 `Electron_NotifyIconHostWindow` 投递 Electron 的托盘回调消息（`WM_APP+1`，icon id 从 `kBaseIconId = 2` 起，`WM_LBUTTONDOWN` 为 lParam）。等价于用户点一次托盘图标 → DSH 自己的 `focusPrimaryWindow()` 执行 restore+show+focus。**这是唯一能让隐藏后的窗口恢复且可交互的路径**（原因见下）。
2. **Win32 兜底**：`PostMessage(WM_SYSCOMMAND, SC_RESTORE)` 唤醒（隐藏/最小化/移出屏幕），再 `ShowWindow(SW_RESTORE/SW_SHOW)`，`SetForegroundWindow`；被前台锁拒绝时用 `AttachThreadInput` 挂到当前前台线程再抬前。仅保证 HWND 回到屏幕，可能保留渲染冻结（见「已知限制」）。
3. **协议兜底（最后）**：窗口存在但前两段都抬不起来时 `Start-Process 'dsh://open'`（#3 基线路径）；窗口不存在时不触发。

失败为旁路：端点永远返回 204 且客户端不读响应；`focus.ps1` 全部错误 `SilentlyContinue`；宿主侧异常只 `console.warn`。

## 与 #3 结论的偏差（重要）

[#3](03-tray-click-baseline.md) 的结论是「宿主 `Start-Process 'dsh://open'` 恢复隐藏窗口，实测 0.16–0.23s」，#6 实测发现该结论依赖**宿主进程的启动/沙箱上下文**（完整性级别只是其中一个可观测差异，不是完整解释），并进一步发现「窗口显示出来」≠「窗口可用」：

| 事实 | 证据 |
|---|---|
| 工具 shell 是 **Low 完整性**（`whoami /groups` = `Mandatory Label\Low`）；DSH 宿主 spawn 的 helper 是 **Medium**（helper 日志实测 `Mandatory Label\Medium`），但 Desktop 窗口进程（pid 5724）对低完整性 shell 不可查询 | 进程/权限实测 |
| 从工具 shell（Low）或宿主 spawn 的 helper（Medium）启动的 `dsh://open` 第二实例**在单实例握手前退出**（退出码 `0x80000003`，<1s），窗口不恢复；helper 的协议兜底实测同样无效。⇒ 问题在启动/沙箱上下文，而非单纯完整性级别（两处上下文不同却同样失败） | 直接启动 exe、`dsh://open`、helper 协议段日志 |
| 从 Low 完整性 shell 发 `WM_SYSCOMMAND` 可用（`SC_CLOSE` 走应用 close-to-tray；`SC_RESTORE` 约 4ms 恢复显示），但 `WM_CLOSE`、`ShowWindow` API 被拦 | 消息实验 |
| **外部 Win32 恢复后 Chromium 渲染器仍冻结**：窗口 on-screen/focused，但 4 秒内窗口区域像素零变化（DSH UI 有每秒更新的计时文本），提问卡片不出现、点击无视觉反馈——用户实测「窗口回来了但不可操作」 | 屏幕差分 + 两次真人点击 |
| 改走 **Electron 托盘点击事件**后：窗口恢复（~350–550ms）且**渲染恢复**（屏幕差分出现大面积变化），用户确认真人点击通知后「回来了，可正常操作」 | 屏幕差分 + 真人验收（18:47:41） |

因此最终实现 = **应用原生托盘点击（主）+ Win32（兜底）+ `dsh://open`（最后）**，而不是 #3 建议的「只走协议」。偏差已记录在 ticket 与 ADR-0002 的实现注记里。

## 验证过程中发现并修复的缺陷 / 陷阱（均已进入最终代码或 dev-loop 文档）

1. **隐藏窗口会保留 `GetForegroundWindow()`**：应用 `window.hide()` 后，Windows 仍可能把该 HWND 当“前台窗口”。旧 helper 见 `GetForegroundWindow()==h` 就判定“已聚焦”直接返回 → 点击无任何效果。修复：`FocusedNow`/`Reveal` 都要求窗口 **OnScreen**（visible + 非最小化 + rect 不在 -32000）才算聚焦。此缺陷由第一次真人点击暴露。
2. **外部 Win32 显示会让 Chromium 渲染器冻结**（见上表）。修复：主路径改为执行应用自己的托盘点击事件（Electron `focusPrimaryWindow()` 原生 show/focus）。
3. **Node `detached: true` + `stdio: 'ignore'` 会让 `powershell.exe` 立即退出（exit 0）而不执行脚本**：Windows 上 detached spawn 带 `DETACHED_PROCESS`，配合被忽略的 stdio 时 PowerShell 直接退出。修复：普通子进程 + `unref()`（宿主诊断实测 `spawn ok pid=… → child exit code=0`（86ms），改后同一端点 391ms 恢复窗口）。
4. **`focus.ps1` 必须纯 ASCII**：Windows PowerShell 5.1 对无 BOM 的 `.ps1` 按 ANSI 解码，中文路径/注释会乱码（曾导致诊断路径写失败、误导排查）。已加单测锁定 ASCII。
5. **宿主代码重组合加载验证方法**：改 linked 包 `index.js` 后，保存 profile `cordis.patch.yml`（任意字节变化）→ dsh-hmr 约 2–4s 活重组合并替换包代码；用临时响应头/日志确认新代码生效。`focus.ps1` 每次 spawn 才读，改脚本无需重组合。
6. **锁屏会污染窗口/聚焦验证**：锁屏时 `GetForegroundWindow()` 是锁屏界面，任何 `SetForegroundWindow` 都失败；做点击唤起验收前必须确认已解锁（可全屏截图确认）。
7. **真人点击验证的时序陷阱**：Windows toast 约 5 秒自动消失，且问题通知会在“问题被回答”时自动 close。验证时临时给 toast 加 `requireInteraction`（仅验证期，提交前已还原）保证通知停留到被点击，否则用户经常来不及看到。

## 真机验收结果（最终生产构建）

修复后自动化三场景（`.scratch/verify/06-click-bridge.ps1`，2026-11-04 18:48，本机 2560×1600 @150%，DSH 0.2.1-rc.5 / Electron 44.7.0）：

| 场景 | 结果 | 键数据 |
|---|---|---|
| 窗口隐藏到托盘 | **通过** | 隐藏确认后端点 POST 204；on_screen **355–527ms**，前台 **338–2623ms**（受负载/前台锁影响）；同 hwnd，无新窗口；恢复后屏幕差分确认**渲染恢复** |
| 窗口最小化 | **通过** | on_screen+foreground **317–361ms** |
| 窗口可见但在后台（另一应用前台） | **通过** | 后台态有效建立后 POST；DSH 前台 **383–643ms** |
| 端点契约 | **通过** | `GET → 405`、无标记 `POST → 403`、带标记 `POST → 204`（13–59ms 返回，不等待恢复） |
| 真人点击通知（后台→前台） | **通过** | 通知 18:47:40.607 出现 → 窗口 18:47:41.150 到前台（**≈550ms**）；helper 日志：`tray click posted=True → after tray: onscreen=True focused=True`（约 100ms）；用户确认「回来了，可正常操作」 |
| 端点故障静默 | **通过（单测）** | 端点始终 204、客户端不读响应、spawn 同步异常/子进程 error 均被吞（`test/plugin-package.test.js`） |
| 恢复 profile 后插件仍工作 | **通过** | 撤销临时 probe 配置（profile sha256 回到原始 `2E11C87A…`）并重组合后，隐藏→端点恢复 **421ms** |

手工复现路径与脚本见 `.scratch/verify/`（gitignored）：`06-click-bridge.ps1`（三场景 + 端点契约）、`06-window-timeline.ps1` / `06-title-timeline.ps1`（窗口状态时间线）、`06-human-capture.ps1`（通知区逐帧截图）、`06-backdrop-window.ps1`（后台焦点场景）、`dsh-tray-lib.ps1`、`set-plugin-config.ps1`。

## 验收标准对照（ticket #6）

- [x] 点击通知能把 DSH 窗口带到前台（窗口在后台时）——自动化后台场景 + 真人点击（≈550ms，可正常操作）
- [x] 窗口隐藏到托盘时，点击通知也能唤起窗口——自动化隐藏场景 355–527ms + 渲染恢复验证；真人点击路径同一条
- [x] 宿主端点故障时点击静默失败，不影响会话——端点 204/silent 契约单测
- [x] 若采用降级方案，偏差与原因记录在 issue 评论——见本文件「与 #3 结论的偏差」，GitHub issue #6 只放一行指针

## 已知限制

- **依赖 Electron 内部托盘消息契约**（`Electron_NotifyIconHostWindow` + `WM_APP+1` + icon id 2 + `WM_LBUTTONDOWN`，Electron 44.7.0 源码实测）。DSH 升级到行为不同的 Electron 版本时该路径可能失效；届时 Win32 兜底仍能把窗口显示出来，但可能保留渲染冻结，需安装/升级后跑真机清单（#8）。
- 兜底路径（Win32）可能「窗口可见但渲染冻结」——不作为正常路径，仅托盘原生路径不可用时的降级。
- Windows 锁屏时系统不允许任何程序抢前台，点击不会（也不应）穿透锁屏。
- 前台抬升受 Windows 前台锁策略影响；本机实测正常，极端策略下可能只恢复不聚焦（会重试 `AttachThreadInput`/`SC_RESTORE`）。
- 点击不定位到具体会话（DSH 无会话深链，v1 范围外）。
- 多显示器/虚拟桌面：恢复在窗口所在位置/桌面；若在其它虚拟桌面，`SC_RESTORE` 不切桌面（未验收，列入 #8 观察项）。

## 提交

- 实现（`index.js` / `client.js` / `focus.ps1` / 测试）：`b03b19d` + 本次修复提交。
- 真机验收记录与文档更新：随本文件所在提交。
