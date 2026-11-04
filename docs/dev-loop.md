# 本机开发环（真机）

写给需要在**这台 Windows 机器**上继续开发 / 验收 `dsh-notice` 的 agent。内容是与机器和 DSH 版本绑定的环境事实，不是产品行为；机器或 DSH 升级后若不符，更新本文件。

## 环境

- DSH Desktop **0.2.1-rc.5**；Electron **44.7.0**（`<install>\version` 文件）；Windows 11 25H2 build **26200.7840**，主屏 2560×1600 @150%，界面语言 zh-CN。
- 安装目录 `C:\Users\19533\AppData\Local\Programs\DeepSeek Harness`；userData `C:\Users\19533\AppData\Roaming\@deepseek-ai\dsh-desktop`；profile `C:\Users\19533\.dsh\profiles\desktop`。
- `gh` 不在 PATH：`C:\Program Files\GitHub CLI\gh.exe`；仓库 remote `EjectButton444/dsh-notice`（public）。
- 工具里的 `pwsh` 实际是 **Windows PowerShell 5.1**：含中文/非 ASCII 的 `.ps1` 必须存成 UTF-8 **with BOM**（否则按 ANSI 解码成乱码）；命令行内联的中文参数不受影响。

## 插件安装现状（已安装、已启用）

- 安装方式：`dsh plugin --profile desktop add "D:\AI区\dsh小插件\notice"`（与 `plugin_manager install_bundle` 共用 package operations，写入 `link:` 依赖并把 bundle 追加到 `dsh.profile.bundles`）。
- profile `package.json`：`"dsh-notice": "link:D:/AI区/dsh小插件/notice"`；`profiles/desktop/node_modules/dsh-notice` 是指向仓库的 junction。
- 安装时进程里激活的 host 行 id 是 `dsh-notice`；仓库 `cordis.patch.yml` 已按 spec 改为 `notice`，**下次 DSH 重启后生效**。判断当前激活状态以 client graph（`GET /plugins/events`）里是否存在 `dsh-notice` 为准。
- **当前实现状态（#4 之后）**：客户端半身已订阅注意力状态并发送真实通知，客户端半身拆成 `client.js`（适配层）+ `client.engine.js`（纯决策引擎 chunk）；#2 的一次性调试 Toast 已删除，客户端加载/热重载不再弹调试通知。
- 卸载/禁用：插件页开关或 Remove，或 `dsh plugin --profile desktop remove dsh-notice`（改 profile；本机只有这一个 dev profile）。

## 开发环

- **客户端半身**（`client.js`）：`dsh-client-hmr` 以 500ms stat 轮询已 link 包，保存后约 **450ms** 热重载并重跑 `apply`（实测 449ms）。
- **纯决策引擎**（`client.engine.js`）：以 package-local client chunk 形式由 `client.js` 用 `require.async('./client.engine.js')` 加载。**HMR 只监视 `client.js` 的字节，改 `client.engine.js` 本身不会触发重载**（实测 graph rev 不变）——改引擎后保存一次 `client.js`（touch/加删空行均可）才会重载并拉新 chunk。若忘记这一步，会出现「新 `client.js` + 旧 engine chunk」混搭，新调用的引擎导出未定义、异常只进 `console.warn`，表现为**通知静默失效**（#4 实测踩过）。
- 客户端脚本会被 HMR **重新执行**：顶层 `const/let` 在第二次执行时抛 "already declared" 且静默失败 → 代码必须整体包在 IIFE 内（`client.js` 顶部有注释）。
- **宿主半身**（`index.js`、`cordis.patch.yml`）：不会自动热替换；需要一次 profile 重组合（改动并保存 profile 的 `cordis.patch.yml`，或在插件页关/开一行）或重启 DSH。
- 改 `package.json` 的 `exports`/`files`/`dsh` 字段后，需要重新安装或重启才被读取。
- 自检：`node --test "test/*.test.js"`、`node --check index.js && node --check client.js && node --check client.engine.js`；npm 脚本用 `npm.cmd test` / `npm.cmd run check`（PowerShell 执行策略会挡 `npm.ps1`）。
  - **受限 shell 陷阱**：在 agent 沙箱等受限环境里，`node --test` 默认会为每个测试文件 spawn 子进程，可能报 `spawn EPERM`。此时改用 `node --test --test-isolation=none "test/*.test.js"`（单进程），或直接 `node test/*.test.js`。

## 真机验证工具链（本地 `.scratch/verify/`、`.scratch/notify-debug/`，已 gitignore，不进 git）

方法记录在 `docs/spikes/02-toast-spike.md`、`docs/spikes/03-tray-click-baseline.md`、`docs/spikes/04-client-detection.md`；工具丢失时按需重建。

- `capture.ps1` — DPI-aware 全屏/区域截图（物理像素 2560×1600）。
- `notification-history.ps1` — WinRT `UserNotificationListener` 读通知中心历史。**注意：本机该接口的 access 状态会变**（#2 时 Allowed，#4 实测变 `Denied`）；遇到 Denied 改用下面的数据库快照。
- `notification-db-read.mjs` — 读取 Windows 通知数据库（`%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db` 的 .db + .db-wal 快照）输出当前通知中心里的每条 Toast：AUMID、display、title、body、tag、created。**这是 #4 之后最可靠的通知存在性/内容证据通道**（WinRT 被拒时仍可用）。
- `watch-notifications.ps1` / `window-state.ps1` / `probe-host.mjs` — 通知轮询采集、DSH 窗口状态 JSON、host client graph 探针。
- `audio-peak.ps1` — CoreAudio 默认播放设备峰值采样，用于判断通知音是否播放（静音基线≈0）。
- `beacon-server.mjs` — `127.0.0.1:57123` 的临时打点接收器；client 侧 `fetch` 相对/绝对地址均可用，记录到 `beacon.jsonl`（隐藏窗口点击投递测试用过）。
- `.scratch/notify-debug/`（#4 新增）— `beacon.mjs`（127.0.0.1:57124，记录插件决策打点；打点代码已从源码移除）、`watch.ps1`（定时截图右下角 toast 区域 + 记录前台窗口）、`win.ps1`（最小化/恢复 DSH 窗口）、`graph-rev.mjs`（读 client graph rev，判断 HMR 是否生效）、`uia-session.ps1`（UIA 探针，本机 Electron 未暴露可用的 web UIA 树）。
- `dsh-tray-lib.ps1` — 窗口/托盘工具：`Get-DshState`、`Hide-DshToTray`（WM_CLOSE 走应用 close-to-tray）、`Invoke-DshOpen`、`MouseClick`、`ScreenDiff`。
- `tray-r7-click.ps1`、`tray-click-beacon.ps1` — #3 的隐藏通知 / 点击基线脚本，可作为 #6 验证的底稿。
- `settings.ps1`、`toast-watch.ps1` — 通知设置采集 / toast 视觉检测。
- 执行策略：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File ...`，或命令内先 `Set-ExecutionPolicy -Scope Process Bypass -Force`。

## 陷阱

- **`ELECTRON_RUN_AS_NODE=1`**：DSH 宿主环境带此变量并传染给本会话 shell 与子进程。直接 `Start-Process 'dsh://open'` 时被启动的 `DeepSeek Harness.exe` 会以 **Node 模式**运行、约 50–140ms 退出（exit 1），不触发单实例唤起；需要时先从环境删除该变量再启动（#6 点击桥必须处理）。
- **合成鼠标点击不能激活 Windows Toast**（Shell 忽略注入输入）；点击相关验证必须真人操作一次（或 `onclick` 打点 + 人点）。
- **合成鼠标点击/键盘输入对本机 DSH 窗口整体无效**（#4 实测：`mouse_event` 点击侧边栏会话行无任何反应；推测 DSH 窗口以更高完整性运行，UIPI 丢弃注入输入）。并且 Electron 未启用渲染进程无障碍：UIA 树的 descendants 只有 `Chrome Legacy Window`，看不到 web 内容。⇒ **切换主视图、点插件页这类 UI 操作只能真人做**，agent 侧的可自动化观测限于窗口状态、截图、通知数据库、host HTTP/SSE。
- 子代理/teammate 会话里调用 `ask_user_question` 会被拒：`human interaction is unavailable while the calling agent is owned by another live agent`（#4 实测）。**提问/审批事件只能由 Lead 顶层会话或真人触发**；子代理会话不会产生可观测的 pending 事件。
- `WM_CLOSE` 关窗依赖 userData 下的 `background-close-confirmed` 标记（已存在）；没有时会先弹「后台运行」确认框。
- 隐藏窗口后 `IsWindowVisible` 不可靠：Chromium 可能保留 `WS_VISIBLE` 但窗口在屏幕外（rect 为 -32000/-21333），或变为 iconic。判断「在托盘」用“visible + 非最小化 + 非 DWM cloaked + 与屏幕相交”。
- 审批策略：runtime 的 approval policy 是 `ask` 时，把一次**被沙箱拒绝的操作**（如写工作区外路径）按工具约定用更宽 `sandbox_permissions` 重试一次，即会弹出真实的授权请求；批准后本会话的文件策略可能被提升为 `danger-full-access`，需要用户在权限预设里切回默认，否则后续不再触发授权事件。
- `Get-Process -Name 'DeepSeek Harness'` 有时拿不到主窗口句柄（`MainWindowHandle` 为 0，或窗口 pid 查不到进程）；用 `dsh-tray-lib.ps1` 的 `FindMainWindow`（`Chrome_WidgetWin_1` + 标题含 `DeepSeek Harness`）做 UI 自动化可达，但它对 UIA 只暴露 `Chrome Legacy Window`。

## 三类注意力事件的真实触发（#4 验收用）

- **提问请求**：Lead 会话调用 `ask_user_question`（子代理会话不行，见「陷阱」）→ 会话出现 pending question。会话是当前主视图、窗口在前台时会被前台抑制，不弹通知。
- **授权请求**：审批策略为 `ask` 时，先做一次会被沙箱拒绝的操作，再按工具约定用更宽权限重试同一操作 → 弹出审批请求（见「陷阱」）。批准后注意把权限预设切回默认，否则文件策略会保持放宽。
- **回合完成**：agent 结束一轮回复；P0 用 `running: true → false` 近似，**用户按 Stop / 报错 / 中断也会触发「本轮已完成」通知**（见 [spikes/04](spikes/04-client-detection.md) 的近似语义记录，#7 收敛）。
- **前台抑制**：DSH 聚焦且主视图正是事件会话 → 不弹；切到其他应用（`document.hasFocus()` 为 false）→ 弹；聚焦但看别的会话 → 弹（此分支只能真人切会话，自动化做不到）。
- 观察通道：屏幕截图 + `notification-db-read.mjs`（最可靠）；声音用 `audio-peak.ps1`。

## 参考

- `docs/spec.md`、`docs/design-notes.md`、`docs/adr/`
- `docs/spikes/02-toast-spike.md`（Toast 归属/图标/声音/锁屏、HMR、IIFE 陷阱）
- `docs/spikes/03-tray-click-baseline.md`（隐藏窗口通知、点击基线、`dsh://open` 计时与 env 陷阱）
- 本机研究笔记（gitignored）：`.scratch/research/report-client-plugin.md`（#4 必读：`uiSession.sessionStatus`、`pendingInteraction`、`running` 边沿、会话行字段）、`report-plugin-api.md`、`report-events.md`
