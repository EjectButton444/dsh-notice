# Spike #08：发布验收（7 条 spec 验收标准 + 顺延复核项）

状态：**进行中（2026-11-05，阶段一）**。对应 ticket [08-acceptance-release.md](../tickets/08-acceptance-release.md)；规格验收标准见 [docs/spec.md](../spec.md) §Acceptance Criteria，真机方法见 [docs/dev-loop.md](../dev-loop.md) 与 [spikes/02](02-toast-spike.md)…[spikes/07](07-precise-turn-completion.md)。

本文件是 #8 的真机验收记录。验收分两阶段：

- **阶段一（本文件已记录）**：仓库清理/打包/ADR/GLOSSARY/README 发布稿 + 第一轮真机行为验证（在当前页面实例上）。
- **阶段二（待续，需重启一次 DSH 应用）**：干净构建复核（重点：一条事件只产生一条通知；页面内 SSE 断线重连；sound/en/5 连事件），然后勾选 ticket #8 与 spec 7 条验收标准。

> 为什么必须重启：本机自 #2 起长期使用 HMR 联调，页面里可能残留**旧编译版本**的插件实例（见下「重复通知现象」）。阶段一宿主侧临时探针（`/dsh-notice/debug`，统计存活 SSE 连接）显示当前只剩 **1 个** SSE 实例，但旧实例可能不建 SSE、只留下订阅，仍会重复发通知；彻底清理由应用重启完成（渲染进程与宿主同时重建）。

## 环境

同 [Spike #02](02-toast-spike.md)：DSH Desktop 0.2.1-rc.5 / Electron 44.7.0 / Windows 11 25H2 build 26200.7840 / zh-CN；宿主 `127.0.0.1:62809`；plugin 通过 `link:` 安装，profile 行 id `notice`。

## 阶段一：清理、打包与文档一致性（已完成）

| 检查项 | 结果 | 证据 |
|---|---|---|
| 仓库无残留调试代码 / 一次性触发 | **通过**：committed tree 无 `beacon`/`BUILD_TAG`/`dsh-notice-spike`/`console.log`/TODO/FIXME、无调试路由/临时头/一次性 Notification 触发；生产侧只有 3 条只读/旁路路由（config/focus/events）与 `console.warn` 旁路日志 | release-audit 的 `git archive HEAD` 审计 + `npm pack --dry-run`（恰好 11 个文件） |
| 验收期临时探针已移除 | **通过**：本轮诊断用的宿主 `/dsh-notice/debug` 计数路由与客户端 beacon 打点在提交前已删除；profile 已按原始备份还原（sha256 `2E11C87A…`） | `git diff` 无相关代码；host debug route 404（移除后） |
| 打包完整性 | **通过**：`npm pack --dry-run` 只打 11 个文件（含 README/LICENSE/locale/icon），`exports`（`.`, `./client`, `./locale/*.json`, `./icon`）完整；`client.engine.js`/`focus.ps1`/`cordis.patch.yml` 走路径/chunk 加载不是 exports | release-audit 报告 |
| `.gitignore` | **通过**：`.scratch/` 被忽略（`git check-ignore` 验证），另有 node_modules/dist/tgz/log/tmp/OS junk | release-audit |
| ADR / GLOSSARY 与实现一致 | **已更新**：ADR-0001 增加 AUMID 实测结论（无需 PowerShell 降级）；ADR-0002 增加 v1 宿主范围注记（只订阅 `session/event`，approval/question 宿主订阅未实现、P0 覆盖）；GLOSSARY「回合完成」明确 Stop/报错/中断不算、「子代理会话」明确归并规则 | [adr/0001](../adr/0001-windows-system-notifications.md)、[adr/0002](../adr/0002-two-phase-hybrid-client-host.md)、[GLOSSARY.md](../../GLOSSARY.md) |
| spec / design-notes / risks / spike06 陈旧表述 | **已更新**（与最终实现对齐：AUMID 无需降级、精确完成、v1.1 会话定位、点击桥最终形态、v1 无 waterfall 订阅） | docs commit（见 ticket #8 记录指针） |
| README 发布稿 | **已完成**：安装（CLI/GUI）、配置（含默认值表与生效路径）、升级后检查清单、AUMID/Toast 实测结论与降级结论、已知限制 | [README.md](../../README.md) |
| 单测 | **通过**：`node --test --test-isolation=none "test/*.test.js"` = **74 pass / 0 fail**（含新增的「重复实例被单例锚点清理」回归用例）；`node --check index.js client.js client.engine.js` 通过 | 本轮运行 |

## 阶段一：第一轮真机行为验证（已观察，含一个待干净构建复核的异常）

方法：Windows 通知数据库时间线（`watch-notification-state.ps1`，含 registry arrival 通道）+ 临时宿主 SSE 连接计数探针（仅本轮，已移除）+ 窗口状态采样（`window-state.ps1`）+ 用户人工操作。

| 验证项 | 结果 | 证据 |
|---|---|---|
| 宿主路由（干净版本） | **通过**：`GET /dsh-notice/config` 200 `{}`、`HEAD /dsh-notice/events` 200 | 02:02 状态采样 |
| 顺延项：「DSH 前台但看别的会话仍弹」（审批事件） | **通过**：用户切到另一会话后，本会话的审批请求产生「需要你确认权限」通知（标题=本会话） | 通知库 `id 56488/56489` created `02:01:54.681`（用户确认看到并点击） |
| 点击通知：切回事件会话 + 唤起窗口 | **通过**：点击后窗口被带回前台、主视图切回本会话（窗口标题 `Implement issue 7 — DeepSeek Harness`、`foreground=true`）；随后用户完成审批 | 窗口状态采样 `02:02:06.777`；审批探针命令在批准后执行成功 |
| 处理完通知自动关闭 | **通过**：审批完成后两条审批通知先后从通知中心移除（`02:01:57.740`、`02:02:00.174` removed） | 同上时间线 |
| 回合完成通知（顺带观测） | **通过**：用户另一会话于 `01:59:37` 正常完成，产生「本轮已完成」通知（标题=该会话），且未在 Stop 场景出现 | 通知库 `id 56483` created `01:59:37.613` |
| **重复通知现象（需干净构建复核）** | **观察到重复**：审批通知出现两条（同会话、3ms 内，一条 zh 带会话标题、一条 en 回退标题「Untitled session」）；同现象在 #7 验收期也出现过两次（提问/审批） | 通知库 `id 56488/56489`（en+zh 各一）；#7 记录见 [spikes/07](07-precise-turn-completion.md) 开发期观察 |

**重复通知的定位与处置（已修复，待干净构建复核）**：两条重复通知在**同一毫秒级窗口**内创建、内容形态不同（一条 zh 用当前会话标题，一条 en 用回退标题「Untitled session」），且各自带独立的 toast 自增计数——指向**页面里同时存活了两个浏览器半身实例**：一个是当前编译版本，另一个是先前 hot reload 遗留的旧副本（本机页面自 #2 起从未整体重启，经历大量 HMR 重载）。旧副本的 locale 快照/标题归属仍停留在旧状态，因此出现英文回退标题。临时宿主探针只看到 1 个 SSE 连接，正是因为旧副本是 `#7` 之前的编译版本（不建立 SSE），但它的状态订阅仍然生效、仍会发通知。

**修复**：`client.js` 增加页面级单例锚点（`window.__dshNoticeActiveInstance`）——每次 `apply` 先显式 dispose 上一个实例的 effect，不再只依赖宿主 loader 的 teardown；这样即使 hot reload 忘记清理，也只会有一个实例存活。`test/client-feed.test.js` 新增用例模拟「同一个页面里脚本再执行一次并 apply 第二个实例」：修复前该用例红（同一完成边沿产生 2 条通知），修复后绿（旧实例的 EventSource 被关闭、只剩 1 条通知）。**存量旧副本无法从新代码侧关闭**（它们没有注册锚点），需一次应用重启彻底清除；重启后的干净构建复核见阶段二。该问题**不是**配置或事件重复（同一事件只出现一次；同一时刻两条通知的多实例特征是关键证据）。

## 阶段二（待续）：干净构建复核清单

重启 DSH 应用（关闭并重新打开；session 历史持久化，重启后在本会话发「继续 #8」）后执行：

1. **一条事件一条通知**：提问 / 审批 / 完成各触发一次，通知中心每次只新增 1 条（清除历史后测）；同时复核「连续事件替换不残留」。
2. **页面内 SSE 断线重连**：在干净页面下触发一次宿主重组合（`07-activate-host.ps1`），页面 EventSource 自动重连后，另一会话的回合完成通知仍能送达（证明精确模式重连后仍工作）。
3. **sound: false 实际静音**：临时 profile 配置 `condition: always + sound: false`，在 `audio-peak.ps1` 采样下触发提问通知：toast 出现但默认播放设备峰值≈基线（对比 `sound: true` 的峰值 >0；#2 实测 peak_max=0.3239）。
4. **en 界面文案**：用户切 DSH 界面语言到 English 后触发提问/完成通知，通知库文本应为 `Waiting for your answer` / `Turn completed`；再切回中文。
5. **事件开关复核**（#5 已验过，重启后快速复验一条）：`condition: always + events.question: false` 下提问不弹；恢复配置。
6. **5 连事件不轰炸**：在干净构建上尽可能构造同一会话连续事件（若本机 harness 仍无法构造 5 连，则沿用引擎单测 + #5 的单条/替换证据，并在 ticket 记录限制原因）。
7. **同一会话前台抑制**：用户正看着本会话时触发提问，预期不弹（由用户在干净构建上确认一次）。
8. **隐藏/最小化仍提醒 + 点击恢复**：用户把 DSH 隐藏到托盘后，另一会话完成/审批触发通知，点击通知恢复窗口并定位会话。

证明限制（沿用）：同一主会话下多个并发待处理项（「另有 N 项」）与子代理 pending 的真实归并，本 harness 无法构造（子代理会话不能发起人机交互），维持引擎单测 + 代码审查覆盖，并在 ticket #8 注明。

## 阶段二完成后要做的收尾

- 勾选 ticket #8 的 Acceptance criteria 与顺延复核项；
- spec 7 条验收标准逐条记录结果（本文件「干净构建复核清单」表格改为结果表）；
- 最终 code review（`code-review` skill，Standards + Spec 两轴）；修复发现后重跑全量单测；
- README 状态行改为「发布验收通过」；GitHub issue #8 关闭并指向本文件；提交。
