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

## 阶段二：干净构建复核结果（2026-11-05，重启后）

重启 DSH 应用后（新宿主端口 `65449`；profile 已还原默认 `{}`）执行。证据文件：`.scratch/verify/08b-*.jsonl`（本地 gitignored）。

| 复核项 | 结果 | 证据 |
|---|---|---|
| 干净构建加载 | **通过**：`GET /dsh-notice/config` 200 `{}`、`HEAD /dsh-notice/events` 200；插件正常发通知 | 重启后状态采样 |
| 页面内 SSE 断线重连 | **通过**：写入 profile 触发宿主重组合（页面未 reload），之后主会话完成帧仍送达并弹通知 → 页面 EventSource 已自动重连、精确模式继续工作 | 重组合后 SSE watcher 重新连接（`02:11:03.990`）；`02:12:12.767` 主会话 `turn/end` 帧 → `02:12:13.379` toast |
| 隐藏到托盘仍提醒 + 完成通知 + 点击恢复 | **通过**：用户在新会话发消息后隐藏窗口，回合完成时弹「本轮已完成」（标题=新会话），点击后通知约 0.6s 内移除、窗口恢复 | 通知库 `id 56499` created `02:12:13.379`；标题时间线 `02:29:25.466 → 02:29:28.151`（`Implement issue 7`）、`02:29:28.520` `foreground=true` |
| 点击通知切回事件会话 + 唤起窗口 | **通过**：新通知点击后主视图切到事件会话并前置窗口；**旧通知**（重启/热重载前创建，其 onclick 已随旧实例销毁）点击只关闭、不跳转——属预期行为 | 标题时间线；用户确认 |
| `condition: always`（前台也弹） | **通过**：焦点在本会话时仍弹出完成通知 | toast `id 56501` created `02:15:46.906`（用户在前台） |
| `sound: false` 实际静音 | **通过**：`audio-peak.ps1` 采样 170s、期间产生英文完成通知：`peak_max=0.0000 samples=10244 nonzero=0`；对照组 `sound: true` 时峰值 `0.3239`（#2 亦同） | 两轮音频采样输出 |
| en 界面文案 | **通过**：界面切 English 后通知正文为 `Turn completed` | 通知库 `id 56501` title `OK` / body `Turn completed` |
| 一条事件一条通知（en/zh 重复不再复现） | **通过（主路径）**：干净构建下提问/审批/完成均为单条；#7 期「一条中文一条英文」的双实例重复未再复现 | `08b` 通知时间线逐事件 id |
| 5 连事件不轰炸 | **部分通过**：同一会话 5 次连续完成（宿主 SSE `turn/end` turn 1–5）没有堆叠出 5 条横幅；但通知中心在快速替换下残留 1 条旧「本轮已完成」项（最终同时 2 条），属 Windows 通知中心 close/replace 竞态 | SSE frames `02:21:15–23`；通知库 `Greeting` id `56505/56506` |
| 同会话前台抑制 | **未拿到干净的一次性证据**：两次尝试时窗口焦点/主视图在事件瞬间无法确认（通知产生了），无法区分「未聚焦」与「抑制失败」。该分支 #4/#5 已由用户确认且引擎单测覆盖，列入已知限制/发布说明 | `08b` 时间线（窗口状态无法回放） |
| events 开关 | #5 真机验证（`events.question=false` / `events.turnComplete=false` 各一次）+ 本轮配置路由/默认值核对；本轮未再逐项复测（审批/时间成本） | [spikes/05](05-notification-rules.md) |

**重启后的重要结论与残留**：

- en/zh 双实例重复通知**已消失**（根因是重启前 HMR 遗留旧实例；单例锚点 + 重启双保险）。重启后宿主侧临时探针显示存活客户端实例数 = **1**。
- 仍观察到一次「同一事件 3ms 内成对出现、2s 后只剩一条」的瞬时重复（`02:28:50`，两个 id），以及上面 5 连事件后的通知中心残留——都发生在**快速替换/连续事件**场景，指向 Windows 通知中心的 close/replace 竞态（#5 已记录同名 tag 平台缺陷；当前实现用唯一 tag + 显式 close 规避，但非 OS 级原子更新）。活跃 banner 始终只有最新一条；通知中心可能残留旧条目，可手动清除。后续若要根治需 OS 级更新或关闭重试策略（建议单独 ticket）。
- 旧通知（重启/热重载前创建）点击不跳转属预期：旧实例的 onclick 已销毁；建议用户手动清除旧通知。
- 探针/临时配置都已移除：profile sha256 还原为原始 `2E11C87A…`；`/dsh-notice/debug` 探针不在提交代码中。

## 收尾（本轮完成）

- ticket #8 的 Acceptance criteria 与顺延复核项逐条记录（见 [ticket #8](../tickets/08-acceptance-release.md)）；
- README 状态与已知限制已更新（旧通知点击、通知中心残留、SSE 语义）；
- 最终 code review（Standards + Spec 两轴）与全量单测；
- GitHub issue #8 关闭并指向本文件；提交见 ticket 记录。

