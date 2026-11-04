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
- **当前实现状态（#6/#7/#9 之后）**：客户端半身 = `client.js`（适配层）+ `client.engine.js`（纯决策引擎 chunk）；宿主半身 = `index.js`（只读配置路由 + 点击桥端点 + 精确完成 SSE 端点）+ `focus.ps1`（窗口恢复 helper，三段式：Electron 托盘点击原生路径 → Win32 兜底 → `dsh://open` 最后）。通知点击 = **先 `uiWorkspace.openSession(事件会话)` 切会话**（#9，v1.1）→ 再聚焦窗口（#6 点击桥，`POST /dsh-notice/focus`，标记头 `x-dsh-notice-focus: 1`）。回合完成自 #7 起由宿主 `session/event` 的 `turn/end.reason.kind === 'completed'` 经 SSE 下发给客户端；客户端在 SSE 首次 `open` 后进入精确模式并永久关闭 P0 `running` 近似（未连通时保留迁移回退）。以上均真机验收通过。
- **宿主路由（当前）**：`GET /dsh-notice/config`（#5，返回 profile 行 config 原文；无覆盖为 `{}`）、`POST /dsh-notice/focus`（#6，带标记头才接受；立即 204，spawn `focus.ps1`）、`GET /dsh-notice/events`（#7，`text/event-stream`；`HEAD` 只回响应头，其它方法 405；只下发 `reason.kind === 'completed'` 的归一化帧）。客户端都以 document-relative 路径调用，直接 curl 用 `http://127.0.0.1:<port>/...`。
- 卸载/禁用：插件页开关或 Remove，或 `dsh plugin --profile desktop remove dsh-notice`（改 profile；本机只有这一个 dev profile）。

## 开发环

- **客户端半身**（`client.js`）：`dsh-client-hmr` 以 500ms stat 轮询已 link 包，保存后约 **450ms** 热重载并重跑 `apply`（实测 449ms）。
- **纯决策引擎**（`client.engine.js`）：以 package-local client chunk 形式由 `client.js` 用 `require.async('./client.engine.js')` 加载。**HMR 只监视 `client.js` 的字节，改 `client.engine.js` 本身不会触发重载**（实测 graph rev 不变）——改引擎后保存一次 `client.js`（touch/加删空行均可）才会重载并拉新 chunk。若忘记这一步，会出现「新 `client.js` + 旧 engine chunk」混搭，新调用的引擎导出未定义、异常只进 `console.warn`，表现为**通知静默失效**（#4 实测踩过）。
- 客户端脚本会被 HMR **重新执行**：顶层 `const/let` 在第二次执行时抛 "already declared" 且静默失败 → 代码必须整体包在 IIFE 内（`client.js` 顶部有注释）。
- **#7 SSE 精确完成通道**：客户端 `new EventSource('dsh-notice/events')`（document-relative，与 `dsh-client-hmr` 的 `new EventSource('plugins/events')` 同款；Electron 的 `dsh-app://` 转发保证同源）。宿主重组合/重启会断开流，EventSource 原生重连；客户端首次 `open` 后永久进入精确模式。调 SSE 时可在宿主侧 `curl` 或跑 `.scratch/verify/07-sse-watch.mjs` 观察帧。
- **客户端切会话（#9 有用事实）**：DSH 客户端有公开服务方法 `ctx.uiWorkspace.openSession(target)`（`SessionTarget = SessionId | SubagentAddress`，官方 API catalog 描述 "Select a Session and show its Conversation as one UI navigation action"），官方 UI 插件都这样切主视图。第三方客户端插件用 **`ctx.get('uiWorkspace')` 惰性解析**（服务缺失返回 undefined；不要写进 `inject`，否则服务缺失时整个插件不激活），调用包 try/catch。验证方法：切会话会改变**窗口标题**（标题 = 当前会话标题 + `— DeepSeek Harness`），用 `06-title-timeline.ps1` 采样即可自动化观察主视图切换；或在临时 HMR 探针里 `openSession(另一个 sessionId)` 再切回。
- **宿主半身**（`index.js`、`cordis.patch.yml`、`focus.ps1`）：`index.js`/`cordis.patch.yml` 不会自动热替换；需要一次 profile 重组合（改动并保存 profile 的 `cordis.patch.yml`，或在插件页关/开一行）或重启 DSH。**重组合会替换「加载文件已变化」的 linked 包代码**（#6 实测：改 `index.js` → 保存 profile patch → ~2–4s 后新代码生效；可在响应里加临时头/日志确认）。**#7 实测补充**：宿主插件重组合会重载本插件 → 断开所有 `/dsh-notice/events` SSE 连接（客户端 EventSource 会原生自动重连，会话不受影响）。`focus.ps1` 是每次点击 spawn 时才读的文件，改它本身不需要重组合。
- 改 `package.json` 的 `exports`/`files`/`dsh` 字段后，需要重新安装或重启才被读取。
- **改插件配置（#5 起）**：配置在 profile `cordis.patch.yml` 的本插件 loader 行。注意**重组合后行 id 是 `notice`**（仓库 bundle patch 的值），写 `- id: dsh-notice` 的覆盖会被静默跳过；正确流程：
  1. 在 `C:\Users\19533\.dsh\profiles\desktop\cordis.patch.yml` 追加/修改 `- id: notice / name: dsh-notice / config: {...}`；
  2. 保存后约 2s 宿主活重组合（**无需重启**），`curl http://127.0.0.1:62809/dsh-notice/config` 应返回新配置（无覆盖时 `{}`）；
  3. 客户端不会自动重载：`(Get-Item client.js).LastWriteTime = Get-Date` 触发 HMR（约 400ms），客户端重跑 `apply` 并重新 fetch 配置；
  4. 验证完恢复 profile 原文件（改前备份；`Copy-Item` 回去后同样等 2s 重组合，再 touch 一次 client.js）。
  - 工具：`.scratch/verify/set-plugin-config.ps1`（可逆增改配置，自动探测行 id）、`probe-plugin-config.mjs`（`--expect` 断言路由）、`watch-notification-state.ps1`（通知生命周期时间线）；写真实 profile 需要 approval 通道（agent 沙箱对 profile 目录只读）。
- 自检：`node --test "test/*.test.js"`、`node --check index.js && node --check client.js && node --check client.engine.js`；npm 脚本用 `npm.cmd test` / `npm.cmd run check`（PowerShell 执行策略会挡 `npm.ps1`）。
  - **受限 shell 陷阱**：在 agent 沙箱等受限环境里，`node --test` 默认会为每个测试文件 spawn 子进程，可能报 `spawn EPERM`。此时改用 `node --test --test-isolation=none "test/*.test.js"`（单进程），或直接 `node test/*.test.js`。

## 真机验证工具链（本地 `.scratch/verify/`、`.scratch/notify-debug/`，已 gitignore，不进 git）

方法记录在 `docs/spikes/02-toast-spike.md`、`docs/spikes/03-tray-click-baseline.md`、`docs/spikes/04-client-detection.md`；工具丢失时按需重建。

- `capture.ps1` — DPI-aware 全屏/区域截图（物理像素 2560×1600）。
- `notification-history.ps1` — WinRT `UserNotificationListener` 读通知中心历史。**注意：本机该接口的 access 状态会变**（#2 时 Allowed，#4 实测变 `Denied`）；遇到 Denied 改用下面的数据库快照。
- `notification-db-read.mjs` — 读取 Windows 通知数据库（`%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db` 的 .db + .db-wal 快照）输出当前通知中心里的每条 Toast：AUMID、display、title、body、tag、created。**这是 #4 之后最可靠的通知存在性/内容证据通道**（WinRT 被拒时仍可用）。
- `watch-notifications.ps1` / `window-state.ps1` / `probe-host.mjs` — 通知轮询采集、DSH 窗口状态 JSON、host client graph 探针。
- `.scratch/verify/`（#5 新增）— `set-plugin-config.ps1`（可逆改 profile 配置、自动探测行 id `notice`、备份/恢复）、`probe-plugin-config.mjs`（断言 `/dsh-notice/config` 内容）、`watch-notification-state.ps1`（按 tag/title 轮询通知生命周期）、`05-config-notes.md`（配置生效路径的源码+实测证据、验收步骤）。
- `.scratch/verify/`（#6 新增）— `06-click-bridge.ps1`（隐藏到托盘 / 最小化 / 后台三场景：隐藏→POST `/dsh-notice/focus`→测量 on_screen/前台耗时，后台场景用自建的 backdrop 窗口）、`06-window-timeline.ps1`（100ms 采样窗口状态/前台窗口，供真人点击相关性分析）、`06-human-capture.ps1`（逐帧截通知区，验证 toast 是否弹出）、`06-backdrop-window.ps1`（可抢到前台的自建窗口，用于“可见但后台”场景）、`06-click-bridge.json`（最近一次测量结果）。
- `.scratch/verify/`（#7 新增）— `07-activate-host.ps1`（在 profile patch 追加注释触发一次活重组合，HEAD 探针轮询 `/dsh-notice/events` 200；`-Restore` 还原 profile）、`07-sse-watch.mjs`（订阅 `/dsh-notice/events` 逐帧打时间戳写 `07-sse-frames.jsonl`）、`07-always-config.ps1`（临时把配置改为 `condition: always` 便于前台观察，包一层 #5 的 `set-plugin-config.ps1`）、`07-profile-patch.original.yml`（profile 原始备份）、`07-sse-frames.jsonl` / `07-notification-timeline.jsonl` / `07-toasts-*.json`（#7 验收证据）。
  - **真人点击验收方法**：Windows toast 约 5 秒自动消失，且问题通知会在问题被回答时被插件 close。验证时临时在 `client.js` 的 Notification options 加 `requireInteraction: true`（仅验证期，提交前 `git checkout -- client.js` 还原），通知会停留到被点击；再用 `06-window-timeline.ps1` + `06-human-capture.ps1` 留证（首次失败即因 5 秒窗口错过）。
- `audio-peak.ps1` — CoreAudio 默认播放设备峰值采样，用于判断通知音是否播放（静音基线≈0）。
- `beacon-server.mjs` — `127.0.0.1:57123` 的临时打点接收器；client 侧 `fetch` 相对/绝对地址均可用，记录到 `beacon.jsonl`（隐藏窗口点击投递测试用过）。
- `.scratch/notify-debug/`（#4 新增）— `beacon.mjs`（127.0.0.1:57124，记录插件决策打点；打点代码已从源码移除）、`watch.ps1`（定时截图右下角 toast 区域 + 记录前台窗口）、`win.ps1`（最小化/恢复 DSH 窗口）、`graph-rev.mjs`（读 client graph rev，判断 HMR 是否生效）、`uia-session.ps1`（UIA 探针，本机 Electron 未暴露可用的 web UIA 树）。
- `dsh-tray-lib.ps1` — 窗口/托盘工具：`Get-DshState`、`Hide-DshToTray`（WM_CLOSE 走应用 close-to-tray；**沙箱 shell 下 WM_CLOSE 被拦，改用 `PostMessage(WM_SYSCOMMAND, SC_CLOSE)`，见 `06-click-bridge.ps1`**）、`Invoke-DshOpen`、`MouseClick`、`ScreenDiff`（#6 用屏幕差分证明「恢复后渲染冻结」）。
- `tray-r7-click.ps1`、`tray-click-beacon.ps1` — #3 的隐藏通知 / 点击基线脚本，可作为 #6 验证的底稿。
- `settings.ps1`、`toast-watch.ps1` — 通知设置采集 / toast 视觉检测。
- 执行策略：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File ...`，或命令内先 `Set-ExecutionPolicy -Scope Process Bypass -Force`。

## 陷阱

- **`ELECTRON_RUN_AS_NODE=1`**：DSH 宿主环境带此变量并传染给本会话 shell 与子进程。直接 `Start-Process 'dsh://open'` 时被启动的 `DeepSeek Harness.exe` 会以 **Node 模式**运行、约 50–140ms 退出（exit 1），不触发单实例唤起；需要时先从环境删除该变量再启动（#6 点击桥已处理）。**#6 补充**：工具 shell 是 **Low 完整性**、但宿主 spawn 的 helper 是 Medium；即便如此，从该上下文启动的桌面第二实例仍会在单实例握手前直接退出（实测退出码 `0x80000003`），即使 env 已清洗、加 `--no-sandbox` 也**无法用 `dsh://open` 唤起窗口**。结论：协议路径在本机不可用，只能作最后兜底。
- **低完整性/外部方式恢复窗口的两个坑（#6 实测）**：① 从沙箱 shell 对 DSH 窗口 `PostMessage(WM_SYSCOMMAND, SC_CLOSE)` 可走应用自身 close-to-tray 隐藏、`SC_RESTORE` 约 4ms 恢复显示，但 `WM_CLOSE` 与 `ShowWindow` API 被拦（`ShowWindow` 返回 False）；② **外部 Win32 显示后 Chromium 渲染器会保持冻结**——窗口 on-screen/foreground 但 4 秒内像素零变化、提问卡片不出现、点击无视觉反馈（`ScreenDiff` 可量化验证）。**唯一可靠的恢复路径是触发应用自己的原生 show**：向 `Electron_NotifyIconHostWindow` 投递 Electron 托盘点击消息（`WM_APP+1`、icon id 2、lParam `WM_LBUTTONDOWN`；Electron 44.7.0 `notify_icon_host.cc` 契约），即让 DSH 自己执行 `focusPrimaryWindow()`。
- **隐藏窗口会保留 `GetForegroundWindow()` 句柄**：`window.hide()` 后 OS 仍可能把该 HWND 当前台；判断“已聚焦/可跳过恢复”必须同时要求窗口 OnScreen（visible + 非最小化 + rect 不在 -32000），否则点击桥会直接 no-op。（#6 由真人点击暴露并修复。）
- **Node spawn 陷阱（#6 实测）**：`detached: true` + `stdio: 'ignore'` 在 Windows 会让 `powershell.exe` **立即退出（code 0）而完全不执行脚本**；需要跑 helper 时用普通子进程 + `unref()`（生产代码已如此并注释）。
- **`.ps1` 必须纯 ASCII 或 UTF-8 with BOM**：Windows PowerShell 5.1 对无 BOM 脚本按 ANSI 解码；`focus.ps1` 含中文会把路径/参数解码成乱码（曾误导排查）。脚本内注释一律英文、文档放 Markdown。
- **窗口标题会破坏基于标题的窗口查找**：`FindMainWindow` 依赖标题含 `DeepSeek Harness`；调试时若改过 `document.title`（例如临时把点击状态写到标题），窗口查找/状态采样都会失效，需先把标题改回（或重载页面）。
- **#7 精确完成的事实**：宿主侧在插件根 ctx `ctx.on('session/event', (session, event) => …)` 即可收到所有会话（含子代理）的事件（DSH 的 Cordis 事件总线在根 ctx 上共享，scope filter 对无 scope tag 的监听器放行；真机已验证）。`turn/end` 载荷为 `event.data.reason.kind ∈ completed | aborted | blocked | error | interrupted | forked | max-tokens`，其中 `interrupted`/`forked` 是崩溃恢复/fork 合成、`aborted` 是用户 Stop——只有 `completed` 才应提醒。`session/event` 是 post-commit 的 observe-only 派发（DSH 按监听器隔离异常），但仍强制整条链路 try/catch（红线见 #7）。
- **#7 SSE 观察/调试**：宿主路由是纯 `text/event-stream`，无心跳、无重放；`GET /dsh-notice/events` 用 `.scratch/verify/07-sse-watch.mjs` 或 `curl -N` 看帧。宿主重组合会断开流（EventSource 自动重连），断线期间完成的回合不补发（宁可漏、不可误）。
- **#7 客户端精确模式**：`EventSource` 首次 `open` 后 `preciseCompletion` 永久置真，P0 `running` 近似关闭——调试验证 Stop 行为时，若看到 Stop 仍弹通知，先确认客户端是否真的连上了 SSE（`07-sse-watch.mjs` 能连上不代表页面里也连上；可临时在客户端代码加 flag 打点或检查是否发生 HMR 重载）。
- **锁屏会污染窗口/聚焦类验证**：Windows 锁屏时 `GetForegroundWindow()` 是「Windows 默认锁屏界面」，任何 `SetForegroundWindow` 都失败；`on_screen`/隐藏恢复仍可测。做点击唤起验收前先确认已解锁（可全屏截图确认）。
- **合成鼠标点击不能激活 Windows Toast**（Shell 忽略注入输入）；点击相关验证必须真人操作一次（或 `onclick` 打点 + 人点）。
- **合成鼠标点击/键盘输入对本机 DSH 窗口整体无效**（#4 实测：`mouse_event` 点击侧边栏会话行无任何反应；推测 DSH 窗口以更高完整性运行，UIPI 丢弃注入输入）。并且 Electron 未启用渲染进程无障碍：UIA 树的 descendants 只有 `Chrome Legacy Window`，看不到 web 内容。⇒ **切换主视图、点插件页这类 UI 操作只能真人做**，agent 侧的可自动化观测限于窗口状态、截图、通知数据库、host HTTP/SSE。
- 子代理/teammate 会话里调用 `ask_user_question` 会被拒：`human interaction is unavailable while the calling agent is owned by another live agent`（#4 实测）。**提问/审批事件只能由 Lead 顶层会话或真人触发**；子代理会话不会产生可观测的 pending 事件。
- `WM_CLOSE` 关窗依赖 userData 下的 `background-close-confirmed` 标记（已存在）；没有时会先弹「后台运行」确认框。
- 隐藏窗口后 `IsWindowVisible` 不可靠：Chromium 可能保留 `WS_VISIBLE` 但窗口在屏幕外（rect 为 -32000/-21333），或变为 iconic。判断「在托盘」用“visible + 非最小化 + 非 DWM cloaked + 与屏幕相交”。
- 审批策略：runtime 的 approval policy 是 `ask` 时，把一次**被沙箱拒绝的操作**（如写工作区外路径）按工具约定用更宽 `sandbox_permissions` 重试一次，即会弹出真实的授权请求；批准后本会话的文件策略可能被提升为 `danger-full-access`，需要用户在权限预设里切回默认，否则后续不再触发授权事件。
- `Get-Process -Name 'DeepSeek Harness'` 有时拿不到主窗口句柄（`MainWindowHandle` 为 0，或窗口 pid 查不到进程）；用 `dsh-tray-lib.ps1` 的 `FindMainWindow`（`Chrome_WidgetWin_1` + 标题含 `DeepSeek Harness`）做 UI 自动化可达，但它对 UIA 只暴露 `Chrome Legacy Window`。
- **Windows/Electron 同名 tag 通知的关闭陷阱（#5 实测并已规避）**：通知中心里已存在同 `tag` 的通知时，再创建一个同 tag 的 Web Notification，平台会**立刻对新对象派发 `close`**；此后该对象的 `close()` 变成 no-op，通知中心条目清不掉。规避：渲染层实际 toast 用唯一 tag（`${会话 tag}#${n}`），替换/关闭前显式关闭旧句柄（`client.js` 已实现）。排查通知「关不掉」时先看这一点。
- **`@deepseek-ai/schemastery` 在第三方宿主 bundle 里不可解析**（#5 实测 `ERR_MODULE_NOT_FOUND`，系统 node 与 DSH 自带 Electron node 都是）；插件配置的校验/默认值由纯引擎 `normalizeConfig` 承担，不要试图在第三方 `index.js` 里静态 import DSH 内部共享包。

## 三类注意力事件的真实触发（#4 验收用）

- **提问请求**：Lead 会话调用 `ask_user_question`（子代理会话不行，见「陷阱」）→ 会话出现 pending question。会话是当前主视图、窗口在前台时会被前台抑制，不弹通知。
- **授权请求**：审批策略为 `ask` 时，先做一次会被沙箱拒绝的操作，再按工具约定用更宽权限重试同一操作 → 弹出审批请求（见「陷阱」）。批准后注意把权限预设切回默认，否则文件策略会保持放宽。
- **回合完成**：agent 结束一轮回复；自 #7 起由宿主 `turn/end.reason.kind === 'completed'` 经 SSE 精确触发，**用户按 Stop / 报错 / 中断不再弹**（验收见 [spikes/07](spikes/07-precise-turn-completion.md)）；只有 SSE 尚未首次连通的迁移回退窗口内才用 P0 `running: true → false` 近似（旧记录见 [spikes/04](spikes/04-client-detection.md)）。
- **前台抑制**：DSH 聚焦且主视图正是事件会话 → 不弹；切到其他应用（`document.hasFocus()` 为 false）→ 弹；聚焦但看别的会话 → 弹（此分支只能真人切会话，自动化做不到）。
- 观察通道：屏幕截图 + `notification-db-read.mjs`（最可靠）；声音用 `audio-peak.ps1`。

## 参考

- `docs/spec.md`、`docs/design-notes.md`、`docs/adr/`
- `docs/spikes/02-toast-spike.md`（Toast 归属/图标/声音/锁屏、HMR、IIFE 陷阱）
- `docs/spikes/03-tray-click-baseline.md`（隐藏窗口通知、点击基线、`dsh://open` 计时与 env 陷阱）
- `docs/spikes/04-client-detection.md`（注意力检测、P0 回合完成近似、engine chunk HMR）
- `docs/spikes/05-notification-rules.md`（通知规则/配置真机结论、配置生效路径、同名 tag 关闭缺陷）
- `docs/spikes/06-click-bridge.md`（点击桥最终形态：Electron 托盘原生恢复 vs 外部 Win32 冻结、真人点击验收数据）
- `docs/spikes/07-precise-turn-completion.md`（精确完成：宿主 `session/event` + `turn/end.reason`、SSE 通道、精确模式/迁移回退、真机验收数据）
- 本机研究笔记（gitignored）：`.scratch/research/report-client-plugin.md`（#4 必读：`uiSession.sessionStatus`、`pendingInteraction`、`running` 边沿、会话行字段）、`report-plugin-api.md`、`report-events.md`
