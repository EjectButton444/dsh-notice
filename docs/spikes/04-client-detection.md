# Spike #04：客户端注意力检测与通知决策引擎实测结论

状态：**完成（2026-11-04）**。对应 ticket [04-client-detection-engine.md](../tickets/04-client-detection-engine.md)；规格见 [docs/spec.md](../spec.md) §注意力事件来源 / 通知决策引擎，设计见 [docs/design-notes.md](../design-notes.md) §2–§3、§8。实现提交见本文件末尾。

本文件是 #4 的真机验证记录：**三类注意力事件能否在真实会话中被检测到、决策引擎是否正确抑制「正在看的会话」、通知内容是否符合「会话标题 + 事件类型」的隐私约定**，以及 **P0 回合完成近似的语义边界**（ticket #4 验收要求写进文档，由 #7 收敛）。

## 实现形态

- 客户端半身拆成两层：
  - **纯决策引擎** `client.engine.js`（package-local client chunk，无 DSH 运行时、无 `Notification`）：`normalizeEvent` + `decide`，覆盖事件映射、按会话前台抑制、标题兜底、`tag`、`silent`，`node --test` 表驱动单测（`test/client-engine.test.js`）。
  - **薄适配层** `client.js`：订阅 `uiSession.sessionStatus` 与 `sessions.list`，把 `pendingInteraction` 变化与 `running` 边沿归一化后交给引擎，发出 Web Notification；任何回调异常只 `console.warn`（旁路原则）。
- 事件检测：
  - 授权请求：`pendingInteraction.kind === 'approval'` 出现（或 kind 变化）；
  - 提问请求：`pendingInteraction.kind === 'question'` 出现；
  - 回合完成：主会话 `running: true → false` 边沿；
  - `plan-review`、子代理会话的回合完成不产生提醒；子代理的待处理交互按 `parentId` 归并到主会话（完整合并/关闭规则在 #5）。
- 引擎 chunk 由 `client.js` 以 `require.async('./client.engine.js')` 加载（`dsh-client-modules` 的 package-local chunk 机制，官方包同样使用）。加载失败只记日志，不抛进 DSH。

## 真机证据

环境同 [Spike #02](02-toast-spike.md)：DSH Desktop 0.2.1-rc.5 / Electron 44.7.0 / Windows 11 25H2 / zh-CN 界面。渲染进程 `dsh-app://app/`，`Notification.permission === 'granted'`，client graph 中 `dsh-notice` 为 `immediately: true`（76 个条目）。

验证用工具（本地 `.scratch/`，已 gitignore）：临时 `fetch` beacon 打点（已从源码移除）、弹窗区域定时截图 + 前台窗口观测、Windows 通知数据库快照读取（`wpndatabase.db`）。**注意**：本机 WinRT `UserNotificationListener` 本次实测 `GetAccessStatus()` 变为 `Denied`（#2 spike 时是 `Allowed`），因此通知中心内容改用数据库快照读取；AUMID / display name / 标题 / 正文 / tag / created 均可读出。

| 验证项 | 结论 | 证据 |
|---|---|---|
| engine chunk 真机加载 | **通过**：渲染进程内 `require.async('./client.engine.js')` 成功，引擎导出三事件类型，观察订阅建立（1079 个会话状态） | 打点 `engine-loaded` / `watching`（含 `href=dsh-app://app/`、`permission=granted`） |
| 提问请求 → 通知 | **通过**：真实 `ask_user_question` 事件触发，窗口不在前台 → 生成通知；用户确认看到 | 打点 `kind=question` + 通知（标题 `Implement plan step 4`、正文「在等你回答」、tag=会话 id）；通知中心记录 `AUMID=electron.app.DeepSeek Harness`、`created 15:03:10.346` |
| 授权请求 → 通知 | **检测与动作通过**：真实审批请求（桌面写操作升级权限）触发，窗口不在前台（当时锁屏）→ 生成「需要你确认权限」通知；用户当时锁屏未注意，最终在干净构建上复验（见下方） | 打点 `kind=approval`，action=`show` + toast |
| 回合完成（正向） | **通过**：DSH 不在前台时结束一轮 → 「本轮已完成」通知（干净构建复验） | 见下方「干净构建复验」 |
| 前台抑制（同一会话） | **通过**：DSH 在前台、主视图正是事件会话时，回合完成事件 → 引擎返回 **0 个动作**，不弹通知 | 打点 `kind=turnComplete`、`runtime.focused=true`、`viewedSessionId=事件会话`、`actions=[]` |
| 前台抑制（别的会话） | **引擎单测通过；真机不复现**：真机需要人把主视图切到另一个会话，自动化不可行（本机 UIA 树只有 `Chrome Legacy Window`，合成鼠标输入被忽略）。列入 #8 真机清单，由真人按场景复核 | `test/client-engine.test.js`：focused + 其它会话 → 通知；focused + 同会话 → 不通知 |
| 通知内容隐私 | **通过**：标题只有会话标题，正文只有事件类型；不带工具名、问题原文、用户消息 | 通知中心记录 + 弹窗截图 |
| 同会话多条 → 原地替换 | **附带通过**（OS 的 `tag` 语义，#5 才实现规则）：同一会话先后两条通知在通知中心只保留最新一条，`created` 被更新，`tag = n#dsh-app://app#<sessionId>` | 通知中心数据库：15:01 的提问通知被 15:03 的提问通知替换 |

## P0 回合完成近似语义（ticket #4 要求记录的已知近似）

- 客户端能拿到的只有 `uiSession.sessionStatus` 的 `running: boolean`（桥接自宿主 `api-session/status(id, bool)`），**拿不到 `turn/end.reason.kind`**，也没有可靠的方法区分「正常完成」与「用户按 Stop / 报错 / 中断 / max-tokens」。
- 因此 P0 的规则是：**主会话 `running` 由 `true → false` 的边沿即视为回合完成并通知**。这意味着：
  - 正常结束一轮 → 弹「本轮已完成」（期望行为）；
  - 用户主动停止 → 也会弹「本轮已完成」；
  - 本轮报错 / 中断 / 达到 token 上限 → 也会弹「本轮已完成」；
  - 计划审批等其它结束原因同样无法区分。
- **不用** `completionUnread` 作为触发信号：它只对「不在主视图」的会话置位，主视图正在显示的会话永远不会置位，会漏掉最常见的那次通知。
- 语义收敛在 [#7](../tickets/07-precise-turn-completion.md)：宿主半身订阅 `session/event` 的 `turn/end`，只有 `reason.kind === 'completed'` 才经 SSE 下发给客户端，客户端半身改用该信号。
- 子代理会话的 `running` 边沿在客户端侧直接过滤，不提醒（#5 再补完整子代理规则）。

## 干净构建复验（移除全部调试打点后）

复验在最终构建上执行（`client.js` + `client.engine.js` 均为提交版本，无 beacon、无调试触发；client graph rev `363143435259`、`dsh-notice` rev `c0bb306c6a27`）。观测通道：Windows 通知数据库快照（`notification-db-read.mjs`）、注册表 `LastNotificationAddedTime`、`watch-notifications.ps1` 轮询（`.scratch/verify/notify-cleanbuild.jsonl`，本地 gitignored）与用户确认。

| 验证项 | 结果 | 证据 |
|---|---|---|
| 提问请求（窗口不在前台） | **通过**：两次真实提问各弹一条「在等你回答」，用户两次确认看到 | 通知库 `created 15:13:48.502`、`15:14:30.195`；AUMID `electron.app.DeepSeek Harness`、标题 `Implement plan step 4`、tag `n#dsh-app://app#<session>` |
| 授权请求（窗口不在前台） | **通过**：真实审批请求弹「需要你确认权限」，用户确认看到 | 通知库 `created 15:14:46.670`；注册表 `LastNotificationAddedTime` 同步 |
| 回合完成（窗口不在前台） | **通过**：回合结束时弹「本轮已完成」 | 通知库 `created 15:18:27.484`；注册表 `15:18:27.496`（±12ms） |
| 前台抑制（聚焦 + 看别的会话仍弹） | **通过**：主视图切到另一会话（`mattpocock skill 功能与用法`）、DSH 在前台，本会话提问仍弹通知，用户确认 | 当时的窗口标题/前台状态记录 + 用户确认；引擎单测 `still notifies while DSH is focused on a different session` |
| 前台抑制（聚焦 + 看本会话不弹） | **运行期证据**（instrumented 构建）：回合完成事件在 `focused=true`、`viewedSessionId=事件会话` 时决策为 **0 动作**；最终构建的抑制判断是同一纯函数（`decideEvent`），由单测锁定 | 打点 `runtime.focused=true, actions=[]`（15:06:10）；`test/client-engine.test.js` 的「no notification while DSH is focused on the event session」 |
| 通知内容隐私 | **通过**：所有记录只有「会话标题 + 事件类型」 | 通知库文本（无工具名 / 问题原文 / 用户消息） |
| 同 tag 原地替换 | **通过**（OS 语义）：连续事件在通知中心只保留最新一条 | 通知库 id `56348 → 56349 → 56350 → 56351 → 56354` 依次替换（同一 tag） |

说明：通知被点击或处理后 Windows 会从通知中心移除，数据库快照只反映当前中心内容，因此逐条证据以轮询捕获的 JSONL 为准；`notification-history.ps1` 的 WinRT 通道在受限 shell 下 `access=Denied`，不属于插件问题。

## 开发环新增结论

- `client.engine.js` 是 **package-local client chunk**，`dsh-client-hmr` 只以 `client.js` 的字节为重建基线：**只改 `client.engine.js` 不会触发 HMR**（实测 graph rev 不变）；改引擎后需要再保存一次 `client.js`（或重启）才重载。
- **踩坑记录**：改 `client.engine.js` 后若忘记保存 `client.js`，渲染进程会「新 `client.js` + 旧 engine chunk」混搭；新的适配层调用引擎新增导出（如 `classifyPending`）会抛出的 TypeError 只会进 `console.warn`（旁路原则），表现是**通知静默失效**且无其他症状。排查时先看 HMR 是否重建，再看 chunk 是否随 rev 重取。
- 客户端半身在 HMR 重载时会清理订阅并关闭本插件创建的 Toast（`ctx.effect` 的清理函数）。
- 测试自检：沙箱/受限 shell 下 `node --test "test/*.test.js"` 会因 test runner 的进程隔离而 `spawn EPERM`，用 `node --test --test-isolation=none "test/*.test.js"`；普通终端用 `npm.cmd test` 即可。

## 遗留与后续

- `docs/design-notes.md` §3.4/§3.5 的合并、消解、声音、配置、i18n 完整规则在 [#5](../tickets/05-notification-rules.md) 实现；本票只落地默认行为（前台抑制 + 事件映射 + 标题兜底 + `tag`）。
- 点击通知聚焦仍是 P0 尽力而为（渲染进程 `window.focus()`），托盘隐藏时无效；[#6](../tickets/06-click-bridge.md) 的宿主点击桥负责。
- 回合完成的精确语义（Stop/报错不再弹）在 [#7](../tickets/07-precise-turn-completion.md)。
- 「前台但看别的会话仍弹」的真机复核归入 [#8](../tickets/08-acceptance-release.md) 真机清单。

## 提交

- 实现与单测：`857b862`（`feat: client attention detection and notification decision engine (#4)`）
- 验收记录与文档更新：随本文件所在提交。
