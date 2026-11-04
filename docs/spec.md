# Problem Statement

我经常在 DSH 里让代理跑长任务，然后切到别的应用或离开电脑。当代理需要我确认权限、需要我回答问题、或者这一轮工作已经结束时，DSH 窗口不在前台，我完全不知道——任务就停在那里等我，可能过了很久才被发现。

DSH 现有的应用内提示（审批弹窗、提问卡片、侧边栏角标）只有在我看着 DSH 时才有效，无法把我从其他应用叫回来。

# Solution

安装 `dsh-notice` 插件后，凡是会话里出现**注意力事件**（授权请求 / 提问请求 / 回合完成），只要我不在看那个会话，Windows 就会弹出一条系统通知（Toast）。

- 通知只包含**会话标题 + 事件类型**，不暴露工具命令、问题原文或用户消息内容（通知会出现在锁屏与通知中心）。
- 同一会话**只保留一条通知**并原地更新；同时存在多个待处理项时追加「另有 N 项」。
- 我处理完（授权、回答、或打开该会话）之后，通知自动关闭。
- 点击通知把 DSH 窗口带到前台；v1 无法直接定位到具体会话（DSH 没有会话深链）。
- 默认只在我不看 DSH 时提醒，可配置为「总是提醒」；支持全局静音与关闭提示音；文案跟随 DSH 界面语言。

# User Stories

1. 作为一名在 DSH 里跑长任务的用户，我希望当代理需要我确认权限时弹出 Windows 系统通知，以便我切到别的应用后也能立刻回来处理。
2. 作为一名用户，我希望当代理向我提问、等我回答时收到系统通知，以便我不用反复切回 DSH 检查。
3. 作为一名用户，我希望当代理结束本轮回合并进入等待状态时收到系统通知，以便我知道「轮到我了」。
4. 作为一名用户，我希望通知里能看出是哪个会话的哪类事件（会话标题 + 事件类型），以便判断要不要马上回去。
5. 作为一名用户，我希望通知里不显示工具命令、问题原文或我自己的消息内容，以便锁屏和通知中心不泄露敏感信息。
6. 作为一名用户，我希望 DSH 窗口在前台、并且我正看着那个会话时不弹通知，以便不被打扰。
7. 作为一名用户，我希望 DSH 窗口虽然在前台、但我在看别的会话时仍然收到通知，以便不错过后台会话。
8. 作为一名用户，我希望可以切换成「总是提醒」，以便在分屏/多显示器场景下也按我的意愿提醒。
9. 作为一名用户，我希望有一个全局静音开关，以便开会或专注时一条通知都不收。
10. 作为一名用户，我希望提示音默认开启但可以关闭，以便需要安静时只留视觉提醒。
11. 作为一名用户，我希望同一会话最多只有一条活跃通知，以便连续事件不堆叠成通知轰炸。
12. 作为一名用户，我希望同一会话的新事件原地替换旧通知内容，以便我看到的永远是最新状态。
13. 作为一名用户，我希望该会话同时存在多个待处理项时通知显示「另有 N 项」，以便既不轰炸又不丢信息。
14. 作为一名用户，我希望授权/提问被处理后对应通知自动关闭，以便我不会把已处理的通知误当成新提醒。
15. 作为一名用户，我希望打开会话后该会话的「回合完成」通知自动关闭，以便通知中心保持干净。
16. 作为一名用户，我希望点击通知能把 DSH 窗口拉到前台，以便一步回到工作中。
17. 作为一名用户，我希望 DSH 窗口被最小化或隐藏到托盘时仍然能收到通知，以便我不必为了收提醒而把窗口留在前台。
18. 作为一名用户，我希望 DSH 隐藏到托盘时点击通知也能把窗口唤回前台，以便不用手动找托盘图标。
19. 作为一名用户，我希望子代理卡住（例如其工具调用需要授权）时提醒归并到所属主会话，以便我知道主任务被卡住了。
20. 作为一名用户，我希望子代理自己的「完成」不触发通知，以便不被它们的噪音打扰。
21. 作为一名用户，我希望只收到主会话的「回合完成」通知，以便多代理并行时不混乱。
22. 作为一名用户，我希望可以通过配置文件分别开关三类事件（授权 / 提问 / 完成），以便只保留我关心的提醒。
23. 作为一名用户，我希望插件开箱即用、默认值合理，以便不配置任何东西也能正常工作。
24. 作为一名用户，我希望修改配置后知道需要重启 DSH 才生效，以便不困惑为什么改了没用。
25. 作为一名用户，我希望在 DSH 设置 → 插件列表里看到 `dsh-notice` 并能直接禁用整行，以便出问题时一键关掉。
26. 作为一名用户，我希望通知文案跟随 DSH 的界面语言（中文 / 英文），以便界面语言一致。
27. 作为一名用户，我希望会话标题为空时显示「未命名会话」加工作区信息作为兜底，以便通知不会出现空标题。
28. 作为一名用户，我希望计划审批、失败/报错、用户主动中止这些情况**不**触发「已完成」通知，以便不被误导。
29. 作为一名用户，我希望通知发送失败时不会影响代理继续工作，以便插件永远只是旁路。
30. 作为一名用户，我希望子代理/团队会话不产生单独的完成提醒，以便通知噪音可控。
31. 作为一名用户，我希望通过插件管理器以本地目录安装插件，以便开发和更新都简单。
32. 作为一名开发者，我希望修改客户端插件代码后能在约 500ms 内热更新，以便快速迭代。
33. 作为一名用户，我希望 DSH 升级后有一份检查清单判断插件是否仍工作，以便插件无声失效时能及时发现。
34. 作为一名用户，我希望连续 5 次注意力事件不会产生 5 条堆叠通知，而是最多每会话一条，以便极端情况下也不轰炸。
35. 作为一名用户，我希望了解系统级限制（Windows 专注助手/通知设置可能压制 Toast），以便插件「没响」时知道先检查哪里。
36. 作为一名用户，我希望通知能区分「是否需要我处理」和「只是通知我完成了」，以便我判断紧急程度。

# Implementation Decisions

## 架构

- 采用**两阶段混合**（ADR-0002）：P0 为纯客户端插件；P1 增加宿主半身补强。
- P0 客户端半身负责：订阅注意力状态、前台抑制判定、发出系统通知、通知合并与消解。
- P1 宿主半身负责：提供精确的回合结束原因（区分完成与中止）、提供点击通知唤起窗口的桥（渲染进程内无法唤起托盘窗口）。宿主半身不重复实现通知规则。
- 宿主与客户端之间使用**免构建的 SSE 通道**（`ctx.webServer.register` + `text/event-stream`，客户端 document-relative fetch），不引入 Typert 构建产物、不扩展 `ctx.remote.$on` 的封闭白名单。

## 插件包形态

- 单一 npm 包，同时导出宿主半身（`apply(ctx, config)`，P0 允许空实现）与客户端半身（`window.__ModuleLoader__.load({ id, factory })`）。
- `package.json` 声明 bundle 的 patch 文件与客户端模块（`dsh.client`：platform `web`、immediately、inject 需要的客户端服务）。
- 安装通过 DSH 插件管理器 `install_bundle` 以本地绝对目录安装（`link:`），两半身一起安装；文档化的本地开发方式，不手动改 profile 文件。

## 配置

- 配置位于 DSH profile 的 `cordis.patch.yml` 中本插件的 loader 行 `config`。**实现注记（2026-11-04，#5）**：原计划由插件自带的 schemastery `Config` 校验，但第三方宿主 bundle 运行期无法解析 DSH 内部共享包 `@deepseek-ai/schemastery`（实测 `ERR_MODULE_NOT_FOUND`），v1 改为宿主半身按只读路由 `GET /dsh-notice/config` 暴露配置、由纯决策引擎 `normalizeConfig` 校验并补默认值（单测覆盖）；见 [spikes/05](spikes/05-notification-rules.md)。行 id 以重组合后的 `notice` 为准。
- 配置键：
  - `events.approval` / `events.question` / `events.turnComplete`：布尔，默认全部 true；
  - `condition`：`unfocused`（默认）或 `always`；
  - `sound`：布尔，默认 true；
  - `mute`：布尔，默认 false。
- 覆盖语义为**整体替换**（不深合并），修改后需重启 DSH 生效（开发环 HMR 里 profile patch 保存即可活重组合，再重载客户端半身）。
- v1 不做设置界面；纯宿主半身只有「禁用整行」开关可用，这与「配置走文件」的决策一致（对齐 Codex 的 `notify` 机器本地配置思路）。

## 注意力事件来源

- P0（客户端）：
  - 授权请求：会话的 `pendingInteraction.kind === 'approval'`；
  - 提问请求：`pendingInteraction.kind === 'question'`；
  - 回合完成：会话 `running` 由 `true → false` 的边沿（主会话）。
  - 不使用 `completionUnread` 作为触发信号（它只对非主视图会话置位，会漏掉主视图正在显示的会话）。
  - 不使用客户端 `ctx.remote.$on('approval/request')`（客户端 waterfall 先到先得，官方 UI 插件已认领）。
- P1（宿主）：
  - 订阅 `approval/request`、`user-questions/request`（必须 `prepend: true` 且 `return next()`）与 `session/event` 中 `turn/end`；
  - 只有 `turn/end.reason.kind === 'completed'` 才算**回合完成**；`aborted`、`error`、`interrupted`、`forked`、`blocked`、`max-tokens` 不通知；
  - 所有钩子逻辑用 try/catch 包裹，只读旁路，任何异常吞掉——绝不让监听器抛错（会让审批 fail-closed 成 `unavailable`）。
- 会话身份：用 `parentId`/`origin` 识别子代理会话，把其待处理交互归并到所属主会话；子代理的回合完成不提醒。

## 通知决策引擎（唯一自动化测试 seam）

- 纯函数/纯 reducer，不 import DSH 运行时、不接触 `Notification`：
  - 输入：持久化状态 + 单条观测 + 配置 + 运行态（窗口是否聚焦、当前主视图会话 id）；
  - 观测（normalize 侧）：`attention`（归一化后的注意力事件：会话 id、事件类型、主会话 id、是否子代理、标题、语言）、`pendingResolved`（待处理交互消失）、`viewed`（会话被打开 / 完成被看到）；
  - 输出：`{ state, actions }`，动作列表为 `show` / `replace` / `close`，`show`/`replace` 每条含 `title`、`body`、`tag`（= 会话 id）、`silent`。
- 规则全部住在引擎里：事件映射与 zh/en 文案、按会话的前台抑制、`condition` 覆盖、`events` 开关、静音、每会话单条合并与原地替换、3 秒同类合并窗口、「另有 N 项」计数、处理完消解、打开会话关闭完成提醒、子代理归并、标题兜底。
- 实现注记（#5）：第三方宿主 bundle 运行期无法解析 `@deepseek-ai/schemastery`，配置校验/默认值由本引擎承担（见「配置」的注记与 [spikes/05](spikes/05-notification-rules.md)）。

## 通知行为

- 默认 `unfocused`：仅当 DSH 窗口未聚焦、或聚焦但当前主视图会话 ≠ 事件会话时发通知；`always` 时跳过该判定。
- 声音：`silent` 由 `sound` 配置与静音状态决定。
- 消解：授权/提问的 `pendingInteraction` 消失，或回合完成的会话被打开（成为主视图 / 未读完成被清除）时关闭通知。
- 点击：P0 尽力聚焦；P1 由宿主执行点击桥（单实例 → `focusPrimaryWindow()` restore+show+focus），接受 1–3 秒冷启动。**实现注记（2026-11-04，#6）**：真机实测宿主半身运行在比 Desktop 窗口更低的完整性级别，从该环境启动 `dsh://open` 的第二实例在单实例握手前即退出；且外部 Win32 显示（`SC_RESTORE`/`ShowWindow`）会让 Chromium 渲染器保持冻结（窗口可见但点不动）。因此最终实现为「宿主端点 + `focus.ps1`」三段式：**主路径**向应用进程的 `Electron_NotifyIconHostWindow` 投递 Electron 托盘点击消息（`WM_APP+1` / icon id 2 / `WM_LBUTTONDOWN`），由应用自己的 `focusPrimaryWindow()` 原生 restore+show+focus（窗口完全可交互）；② Win32 消息兜底（`SC_RESTORE`/`ShowWindow`/`SetForegroundWindow` + `AttachThreadInput` 前台锁变通，只保证显示）；③ 最后才 `Start-Process 'dsh://open'`。客户端 `notification.onclick` 带标记头 document-relative `POST /dsh-notice/focus`，失败静默。偏差与证据见 [spikes/06](spikes/06-click-bridge.md)。

## 兼容与约束

- 仅 Windows 桌面版 DSH（Electron 44.7.0）；macOS/Linux/浏览器不支持。
- 声明 `engines.dsh` 兼容范围；不匹配时 DSH 会静默跳过 bundle。
- 不使用深路径 import、不写自定义 session 事件类型、不依赖 asar 路径。
- 通知是旁路能力：任何失败只记日志，不阻塞会话。

# Testing Decisions

- **只有一个自动化 seam：通知决策管线（normalize → reduce）。** 它是纯 reducer，外部行为可观察（输入状态/观测/配置/焦点 → 输出新状态与通知动作），不依赖 DSH 运行时与 Windows。
- 测试框架用 `node --test`，表驱动用例，覆盖：
  - 三类事件 → 对应通知动作与文案；
  - 前台抑制：窗口聚焦 + 同一会话 / 窗口聚焦 + 不同会话 / 窗口未聚焦；
  - `condition: always` 覆盖抑制；`mute` 全抑制；
  - 每会话单条：replace 语义、3 秒合并窗口；
  - 多待处理 → 「另有 N 项」计数；
  - 消解 → close 动作；
  - 子代理归并到主会话、子代理完成不通知；
  - 语言选择（zh/en）与标题兜底；
  - 标题为空 → 「未命名会话」+ 工作区兜底。
- 适配器薄层（DSH 状态源、通知发送器、locale）不写单测，由真机清单覆盖。
- P1 的宿主事件归一化（把 `approval/request`、`user-questions/request`、`turn/end` 转成引擎输入）仍走同一个纯管线，属于同一 seam 的输入侧，可一并单测。
- **最高验收 seam 是真机手动清单**（Toast 本身无法自动化）：通知出现、归属/图标/声音、锁屏内容、托盘隐藏时仍弹、点击唤起、连续事件不堆叠、处理后关闭。
- 无既有测试先例（greenfield），测试命名使用 `GLOSSARY.md` 术语。

# Out of Scope

- 计划审批（`plan-review`）的通知——v1 明确不提醒；
- 失败/报错事件的通知（`agent/error` 等）；
- 应用内角标、通知中心、未读列表（DSH 侧边栏已有角标）；
- 插件设置界面；
- macOS / Linux / 浏览器版 DSH；
- 外部转发（手机 / IM / Webhook）；
- 通知内的快捷操作（直接允许/拒绝、回复）；
- 通知点击定位到具体会话（DSH 无会话深链）；
- npm 发布与插件市场上架；
- 对 `/to-tickets` 产出的 ticket 再做 triage。

# Acceptance Criteria

1. 切到其他应用后，授权 / 提问 / 回合完成三类事件各能收到一次 Windows 系统通知；
2. 点击通知能把 DSH 带到前台；托盘隐藏状态下也有效（P1 点击桥）；
3. DSH 在前台且正在看该会话时不弹；在看别的会话时仍然弹；
4. 配置文件能分别开关三类事件、切换 `condition`、开关声音；
5. 同一会话的通知去重合并（含「另有 N 项」），处理完自动关闭；
6. DSH 最小化/隐藏到托盘时仍能提醒；
7. 连续 5 次事件不出现通知轰炸（每会话最多一条）。

# Further Notes

- **风险优先**：风险登记表（[docs/risks.md](risks.md)，11 条）是 ticket 排序依据。R1（Toast 归属/图标）、R2（客户端插件加载）、R3（点击唤起）是架构级风险，必须先以 spike 形式验证并**阻塞**依赖它们的实现 ticket；R4（宿主钩子让审批 fail-closed）是「比没有插件更糟」的红线，实现时强制代码审查 + try/catch + 只读旁路。
- **风险优先阶段**（对应 ticket 排序建议）：S0 环境就绪 → S1 最小客户端插件弹 Toast（R1/R2）→ S2 隐藏窗口 + `dsh://open` 基线与点击行为（R3/R7）→ S3 注意力检测 + 决策引擎（R5 近似接受）→ S4 通知规则（R9/R10）→ S5 宿主半身（R3/R4/R5）→ S6 真机验收与升级兼容（R6/R10/R11）。
- **已知平台陷阱**：客户端只见 `api-session/status(bool)`，P0 的「完成」是近似（Stop/报错也会弹，P1 收敛）；宿主 waterfall 不加 `prepend` 会漏事件；`ctx.remote.$on` 白名单封闭；渲染进程无法唤起托盘窗口；AUMID 未设置导致 Toast 归属/图标需真机实测（异常时退化为宿主 PowerShell Toast）。
- 相关文档：`GLOSSARY.md`、`docs/adr/0001-windows-system-notifications.md`、`docs/adr/0002-two-phase-hybrid-client-host.md`、仓库设计笔记（[docs/design-notes.md](design-notes.md)）。
- 本 spec 来自 `/grill-with-docs` 的设计会话（3 轮访谈 + 4 份内部研究报告），术语与决策均已与用户确认。
