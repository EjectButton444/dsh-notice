# Spike #06：通知点击桥（宿主 focus 端点）实测结论

状态：**进行中（2026-11-04）**。对应 ticket [06-click-bridge.md](../tickets/06-click-bridge.md)；实现设计见 [docs/design-notes.md](../design-notes.md) §5 P1，基线前提见 [spikes/03-tray-click-baseline.md](03-tray-click-baseline.md)。

本文件记录 #6 点击桥的**实现形态、真机验证与偏差**：客户端 `notification.onclick` → document-relative `POST /dsh-notice/focus` → 宿主 spawn `focus.ps1` → 直接 Win32 消息 `SC_RESTORE` + `SetForegroundWindow`（主路径）/ `dsh://open`（兜底）。

> 状态说明：自动化验证（路由契约、隐藏/最小化窗口恢复）已完成并记录；**窗口前台聚焦**与**真人点击通知**两项因验证时机器进入 Windows 锁屏而顺延，解锁后补齐（见文末「待补验收」）。

## 实现形态

| 半身 | 文件 | 职责 |
|---|---|---|
| 客户端 | `client.js` | `toast.onclick` 先保留原有 `window.focus()` 尽力聚焦，再 document-relative `fetch('dsh-notice/focus', { method: 'POST', headers: { 'x-dsh-notice-focus': '1' } })`；fire-and-forget，失败只 `console.warn`（`host focus request failed (silent)`）。 |
| 宿主 | `index.js` | `POST /dsh-notice/focus`：只接受带 `x-dsh-notice-focus: 1` 头的 POST（其余 403/405），立即返回 204；spawn 随包发布的 `focus.ps1`（`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <pkg>/focus.ps1`），`stdio: 'ignore'`、`windowsHide`、清洗后的环境、`unref()`；spawn 同步异常/子进程 `error` 事件全部吞掉。 |
| 宿主 | `focus.ps1`（新增，ASCII） | 前台恢复两段式：① 枚举 `Chrome_WidgetWin_1` + 标题含 `DeepSeek Harness` 的主窗口，隐藏/最小化/移出屏幕时 `PostMessage(WM_SYSCOMMAND, SC_RESTORE)` 唤醒；随后 `SetForegroundWindow`，若被前台锁拒绝则用 `AttachThreadInput` 挂到当前前台线程再 `BringWindowToTop + SetForegroundWindow`，最后再发一次 `SC_RESTORE` 尝试激活；② 窗口存在但仍未抬前才 `Start-Process 'dsh://open'`（#3 基线路径），轮询后再次直接尝试（窗口不存在时不触发协议，避免无谓的二次实例）。 |

- 通道沿用 #5 的免构建方案（`ctx.webServer.register` exact 路由 + 客户端 document-relative fetch），路由名与 `dsh-client-hmr` 同款。
- 环境清洗：spawn 前删除 `ELECTRON_RUN_AS_NODE` / `ELECTRON_NO_ATTACH_CONSOLE`（大小写不敏感）——否则 `dsh://open` 唤起的 `DeepSeek Harness.exe` 会以 Node 模式启动并退出（#3 陷阱）。
- 失败为旁路：端点永远返回 204，客户端不读响应；`focus.ps1` 全部错误 `SilentlyContinue`；宿主侧任何异常只 `console.warn`。

## 与 #3 结论的偏差（重要）

[#3](03-tray-click-baseline.md) 结论是「宿主 `Start-Process 'dsh://open'` 恢复隐藏窗口，实测 0.16–0.23s」，并据此建议点击桥只走协议。**#6 真机实现时发现该结论依赖宿主进程的完整性级别**：

| 事实 | 证据 |
|---|---|
| 本机 agent 工具进程与 DSH 宿主半身处于 **Low 完整性级别**（`whoami /groups` 显示 `Mandatory Label\Low Mandatory Level`）；Desktop 窗口进程（pid 5724）从低完整性进程不可查询 | 低完整性 shell 中 `Get-Process` 只能看到同为低完整性的 DSH 进程 |
| 从低完整性环境启动 `dsh://open` 的第二个 Desktop 实例**在单实例握手前就退出**（实测退出码 `-2147483645` = `0x80000003`，<1s），窗口不恢复 | 直接 `Start-Process 'dsh://open'`、直接启动 exe、宿主端点 spawn 协议路径均无恢复 |
| 从低完整性 shell 发 **`WM_SYSCOMMAND`** 消息可用：`SC_CLOSE` 触发应用自身 close-to-tray（`visible=false`）、`SC_RESTORE` 约 **4ms** 让隐藏/最小化窗口回到屏幕并可聚焦；而 `ShowWindow` API 返回 False、`WM_CLOSE` 被 UIPI 拦下 | 手工消息实验（2026-11-04） |
| 因此点击桥最终形态 = **直接 Win32 消息为主路径 + `dsh://open` 兜底**；`SC_RESTORE` 正是 #3 记录的「宿主直接 Win32 ShowWindow + SetForegroundWindow」退路的更稳实现（消息不受 API 拦截影响） | 本文件 |

偏差已按 ticket 要求记录在 [06-click-bridge.md](../tickets/06-click-bridge.md) 的状态行与本节。

## 实现中发现的缺陷与陷阱（已在最终代码规避）

1. **Node `detached: true` + `stdio: 'ignore'` 会让 `powershell.exe` 立即退出（exit code 0）而不执行脚本**：Node 的 detached spawn 在 Windows 上带 `DETACHED_PROCESS`，配合被忽略的 stdio 时 PowerShell 直接退出。宿主诊断证实 `spawn ok pid=… → child exit code=0`（约 86ms）且脚本无任何副作用；改为**普通子进程 + `unref()`** 后同一端点 391ms 内恢复隐藏窗口、helper 正常执行。生产代码因此显式 `detached: false` 并加注释/单测。
2. **`focus.ps1` 必须保持纯 ASCII**：Windows PowerShell 5.1 对无 BOM 的 `.ps1` 按 ANSI 解码，脚本里的中文路径/注释会变成乱码（曾导致诊断路径写失败、排查被误导）。脚本现为纯 ASCII，中文文档留在 Markdown 里。
3. **隐藏窗口判定**：`IsWindowVisible` 不可靠的旧坑仍适用（Chromium 可能保留 `WS_VISIBLE` 但在屏幕外）；helper 的「在屏」= visible + 非最小化 + rect 不与 `-10000` 相交，与 `dsh-tray-lib.ps1` 一致。
4. **宿主代码重组合加载（验证方法）**：改写 linked 包 `index.js` 后，保存 profile `cordis.patch.yml`（任意字节变化）→ dsh-hmr 约 2–4s 活重组合并**替换包代码**；用临时响应头 `x-dsh-notice-build` 确认加载的是新代码。`focus.ps1` 每次 spawn 才读取，改脚本本身无需重组合。
5. **锁屏会污染聚焦判定**：验证中途机器进入 Windows 锁屏时，`GetForegroundWindow()` 为「Windows 默认锁屏界面」，`SetForegroundWindow` 必然失败；`on_screen`/隐藏恢复仍可观测。聚焦类验收必须在解锁状态做。

## 验证方法与已得证据（自动化，可在 `.scratch/verify/` 复现）

- 路由契约（真机 curl/Invoke-WebRequest）：`GET /dsh-notice/focus → 405`；无标记 `POST → 403`；带 `x-dsh-notice-focus: 1` 的 `POST → 204`（13–52ms 返回，不等待窗口）。
- 隐藏到托盘：`WM_SYSCOMMAND SC_CLOSE`（应用自身 close-to-tray）→ `visible=false, on_screen=false` → 端点 POST → 宿主 spawn helper → **on_screen 恢复 391ms**（此时锁屏，故 `foreground=false`，待解锁复验）。
- 直接运行 helper（与宿主同参数、低完整性 shell）：隐藏窗口 → helper **恢复 391–512ms**，日志显示 `add-type ok → find hwnd → direct reveal`。
- 单测：`node --test` 覆盖宿主路由契约（方法/标记头/204、spawn 参数与清洗环境、失败静默）、`focus.ps1` 两段式契约（ASCII/关键字）、客户端点击 POST 与失败静默。
- 工具（本地 gitignored）：`.scratch/verify/06-click-bridge.ps1`（隐藏/最小化/后台三场景测量）、`06-window-timeline.ps1`（窗口状态时间线，供真人点击相关性分析）、`dsh-tray-lib.ps1`、`set-plugin-config.ps1`。

## 待补验收（解锁后）

- [ ] 解锁后重跑 `06-click-bridge.ps1`：隐藏/最小化/后台三场景恢复 + 前台聚焦耗时
- [ ] 真人点击隐藏状态下的通知 → 窗口回到前台（`06-window-timeline.ps1` 记录 hidden→on-screen 时间戳 + 用户确认）
- [ ] 恢复 profile、生产构建复验

## 提交

- 实现（`index.js` / `client.js` / `focus.ps1` / 测试 / 文档）：随 #6 提交。
