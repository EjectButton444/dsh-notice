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
- 插件当前带 #2 留下的一次性调试 Toast：**每次 client 加载/热重载都会弹一条**；由 #8 清理。
- 卸载/禁用：插件页开关或 Remove，或 `dsh plugin --profile desktop remove dsh-notice`（改 profile；本机只有这一个 dev profile）。

## 开发环

- **客户端半身**（`client.js`）：`dsh-client-hmr` 以 500ms stat 轮询已 link 包，保存后约 **450ms** 热重载并重跑 `apply`（实测 449ms）。
- 客户端脚本会被 HMR **重新执行**：顶层 `const/let` 在第二次执行时抛 "already declared" 且静默失败 → 代码必须整体包在 IIFE 内（`client.js` 顶部有注释）。
- **宿主半身**（`index.js`、`cordis.patch.yml`）：不会自动热替换；需要一次 profile 重组合（改动并保存 profile 的 `cordis.patch.yml`，或在插件页关/开一行）或重启 DSH。
- 改 `package.json` 的 `exports`/`files`/`dsh` 字段后，需要重新安装或重启才被读取。
- 自检：`node --test "test/*.test.js"`、`node --check index.js && node --check client.js`；npm 脚本用 `npm.cmd test` / `npm.cmd run check`（PowerShell 执行策略会挡 `npm.ps1`）。

## 真机验证工具链（本地 `.scratch/verify/`，已 gitignore，不进 git）

方法记录在 `docs/spikes/02-toast-spike.md`、`docs/spikes/03-tray-click-baseline.md`；工具丢失时按需重建。

- `capture.ps1` — DPI-aware 全屏/区域截图（物理像素 2560×1600）。
- `notification-history.ps1` — WinRT `UserNotificationListener` 读通知中心历史（本机 access=Allowed），输出 AUMID / display name / 文本 / 创建时间。
- `audio-peak.ps1` — CoreAudio 默认播放设备峰值采样，用于判断通知音是否播放（静音基线≈0）。
- `beacon-server.mjs` — `127.0.0.1:57123` 的临时打点接收器；client 侧 `fetch` 相对/绝对地址均可用，记录到 `beacon.jsonl`（隐藏窗口点击投递测试用过）。
- `dsh-tray-lib.ps1` — 窗口/托盘工具：`Get-DshState`、`Hide-DshToTray`（WM_CLOSE 走应用 close-to-tray）、`Invoke-DshOpen`、`MouseClick`、`ScreenDiff`。
- `tray-r7-click.ps1`、`tray-click-beacon.ps1` — #3 的隐藏通知 / 点击基线脚本，可作为 #4/#6 验证的底稿。
- `settings.ps1`、`toast-watch.ps1` — 通知设置采集 / toast 视觉检测。
- 执行策略：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File ...`，或命令内先 `Set-ExecutionPolicy -Scope Process Bypass -Force`。

## 陷阱

- **`ELECTRON_RUN_AS_NODE=1`**：DSH 宿主环境带此变量并传染给本会话 shell 与子进程。直接 `Start-Process 'dsh://open'` 时被启动的 `DeepSeek Harness.exe` 会以 **Node 模式**运行、约 50–140ms 退出（exit 1），不触发单实例唤起；需要时先从环境删除该变量再启动（#6 点击桥必须处理）。
- **合成鼠标点击不能激活 Windows Toast**（Shell 忽略注入输入）；点击相关验证必须真人操作一次（或 `onclick` 打点 + 人点）。
- `WM_CLOSE` 关窗依赖 userData 下的 `background-close-confirmed` 标记（已存在）；没有时会先弹「后台运行」确认框。
- 隐藏窗口后 `IsWindowVisible` 不可靠：Chromium 可能保留 `WS_VISIBLE` 但窗口在屏幕外（rect 为 -32000/-21333），或变为 iconic。判断「在托盘」用“visible + 非最小化 + 非 DWM cloaked + 与屏幕相交”。
- 本会话当前 approval policy 是 `never`（需要审批的操作会被直接拒绝）；要测**授权请求**事件，需要把审批策略调回 `ask`，或由用户触发一次需要审批的工具调用。

## 三类注意力事件的真实触发（#4 验收用）

- **提问请求**：agent 调用 `ask_user_question`（或正常向用户提问）→ 会话出现 pending question。
- **授权请求**：审批策略为 `ask` 时，触发一次需要审批的工具调用（workspace-write / danger-full-access 下多数操作不会弹；可切回 `ask` 再访问工作区外路径等）。
- **回合完成**：agent 正常结束一轮回复（不是 Stop / 报错；P0 只能用 running 边沿近似）。
- **前台抑制**：DSH 聚焦且主视图正是事件会话 → 不弹；切到其他应用或看别的会话 → 弹。
- 观察通道：屏幕截图 + `notification-history.ps1` 最可靠；声音用 `audio-peak.ps1`。

## 参考

- `docs/spec.md`、`docs/design-notes.md`、`docs/adr/`
- `docs/spikes/02-toast-spike.md`（Toast 归属/图标/声音/锁屏、HMR、IIFE 陷阱）
- `docs/spikes/03-tray-click-baseline.md`（隐藏窗口通知、点击基线、`dsh://open` 计时与 env 陷阱）
- 本机研究笔记（gitignored）：`.scratch/research/report-client-plugin.md`（#4 必读：`uiSession.sessionStatus`、`pendingInteraction`、`running` 边沿、会话行字段）、`report-plugin-api.md`、`report-events.md`
