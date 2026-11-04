# dsh-notice v1 实现设计笔记

状态：设计已确认（2026-11-04）；P0 客户端半身已完成：#2 插件/Toast、#4 注意力检测 + 决策引擎（[spikes/04](spikes/04-client-detection.md)）、#5 通知规则与配置（[spikes/05](spikes/05-notification-rules.md)）。宿主半身补强（点击桥、精确完成判定）待 #6–#7。
规格：[docs/spec.md](spec.md)。
决策记录：[ADR-0001 Windows 系统通知](adr/0001-windows-system-notifications.md)、[ADR-0002 两阶段混合](adr/0002-two-phase-hybrid-client-host.md)。
术语以 [GLOSSARY.md](../GLOSSARY.md) 为准。

## 1. 目标与非目标

**目标**：在 DSH 会话出现**注意力事件**（授权请求 / 提问请求 / 回合完成）时，向离开 DSH 的人发 Windows 系统通知，把人叫回来，并尽量一秒钟把人送到该处理的地方。

**非目标（v1 不做）**：

- 计划审批（`plan-review`）的通知——留作 v2；注意它是独立暂挂类型，v1 不提醒；
- 失败/报错事件的通知（`agent/error` 等）；
- 应用内角标、通知中心、未读列表（DSH 侧边栏已有角标）；
- 设置界面（配置走 `cordis.patch.yml`）；
- macOS / Linux / 浏览器版；
- 外部转发（手机/IM/邮件）；
- 通知内直接「允许/拒绝」。

## 2. 触发事件与检测

| 注意力事件 | P0（纯客户端） | P1（加宿主半身） |
|---|---|---|
| 授权请求 | `uiSession.sessionStatus` 中该会话 `pendingInteraction.kind === 'approval'` 出现 | 同 P0；宿主 `approval/request` 用于补全细节与审计 |
| 提问请求 | `pendingInteraction.kind === 'question'` 出现 | 同 P0；宿主 `user-questions/request` 补全 |
| 回合完成 | `running` 由 `true → false` 的边沿（主会话） | 宿主 `session/event` + `turn/end.reason.kind === 'completed'` 精确判定，经 SSE 下发 |

已知陷阱（实现时必须处理）：

1. **不要**用 `ctx.remote.$on('approval/request')`——客户端 waterfall 先到先得，官方 UI 插件先认领；用 `pendingInteraction` 状态。
2. **不要**把 `completionUnread` 当「回合完成」的触发信号：它只对「非主视图会话」置位，主视图正在显示的会话不会触发。要自己监听 `running` 边沿。**但**它可用于消解：清除（人已看到完成）是关闭「本轮已完成」通知的信号之一（见 §3.5）；焦点回到该会话也算看到（适配层监听 window focus）。
3. P0 的「完成」是近似判定（`running → false`），用户按 Stop、报错、中断都会触发；P1 用宿主 `turn/end` 原因过滤，只保留 `completed`（排除 `aborted / error / interrupted / forked / blocked / max-tokens`）。
4. 宿主半身订阅 `approval/request`、`user-questions/request` 必须 `{ prepend: true }` 且 `return next()`；监听器抛错会让审批 fail-closed 成 `unavailable`，与「只读旁路」原则冲突——所有钩子逻辑用 try/catch 包裹，永不阻塞。
5. 子代理会话行会被注入 `sessions.byId`（`origin === 'subagent' || parentId !== undefined`），必须靠 `parentId` 找到主会话并过滤/归并。

## 3. 提醒规则

### 3.1 提醒条件

- 默认 `unfocused`：只有「人类没在看」时才发系统通知。
- 可选 `always`：无论是否在看都发。
- 全局 `mute` 开关：为 true 时一条都不发（用于会议/专注）。

### 3.2 前台抑制粒度（按会话，不按窗口）

窗口聚焦（`document.hasFocus()`）**且**当前主视图会话正是事件所属会话时，不发通知。窗口聚焦但在看别的会话 → 仍然发。`condition: always` 时跳过整条规则。

### 3.3 内容与文案

标题 = 会话标题（`sessions.list` 的 `displayTitle`；为空时用「未命名会话」），正文 = 事件类型；跟随 DSH 界面语言（zh/en locale）：

| 事件 | zh 正文 | en 正文 |
|---|---|---|
| 授权请求 | 需要你确认权限 | Waiting for your approval |
| 提问请求 | 在等你回答 | Waiting for your answer |
| 回合完成 | 本轮已完成 | Turn completed |

- 同一会话存在多个待处理项时，正文追加「另有 N 项」（N = 除当前醒目项外仍待处理的项数，即总数−1；en: `+N more pending`）。
- 子代理归并来的提醒，正文追加「（来自子代理）」（en: `(from subagent)`）。
- 默认不显示工具命令、问题原文、用户消息内容（隐私；通知会进锁屏与通知中心）。

### 3.4 合并与去重（已实现，见 spike 05）

- 每个会话**最多一条**活跃通知：引擎状态按会话归并；`tag`（=会话 id）仍是状态键，但渲染层实际 toast 使用**每次递增的唯一 tag**（见 §5 的 Windows/Electron 关闭怪癖），替换 = 先关闭旧通知再创建新通知。
- 事件间隔 < 3 秒的同类事件视为同一波，合并为一次（不重复弹）；窗口随同波最后一个事件滚动。同波内若内容变化（例如新增了一个待处理项），仍以一次 `replace` 更新计数，不额外弹新 banner。
- 子代理的待处理交互归并到所属主会话的通知（正文追加「来自子代理」）；子代理的回合完成**不提醒**。
- 待处理计数只数未处理的授权/提问项（回合完成提醒不计入）；2 项待处理即正文追加「另有 1 项」。

### 3.5 消解（已实现）

- 授权/提问被处理（`pendingInteraction` 消失）→ 引擎返回 `close`，关闭对应通知。
- 回合完成的通知在该会话被打开/看完（成为主视图、焦点回到该会话、或 `completionUnread` 清除）→ `close`。
- 收到该会话的新事件 → `replace`：引擎更新状态，适配层关闭旧 toast 后以新内容重建。

### 3.6 声音

默认带 Windows 系统通知声音；`sound: false` 时动作 `silent: true`（Windows 侧实际静音列入 #8 真机清单逐项验收）。

## 4. 配置

配置位于 DSH profile 的 `cordis.patch.yml` 中本插件的 loader 行 `config`（**重组合后的行 id 是 `notice`**，见 spike 05），修改后重启 DSH 生效（开发环里写 profile patch ≈2s 即活重组合，再 touch `client.js` 让客户端重载即可）：

```yaml
- id: notice
  name: dsh-notice
  config:
    events: { approval: true, question: true, turnComplete: true }
    condition: unfocused   # unfocused | always
    sound: true
    mute: false
```

- 配置由宿主半身以只读路由 `GET /dsh-notice/config` 暴露（返回 loader 行 `config` 原文，无覆盖时为 `{}`），客户端加载时拉取一次。
- **`cordis.patch.yml` 的覆盖是整体替换**（不深合并）；写部分键时该块只剩这些键，客户端引擎会为缺失项补默认值，但建议重述整块。
- 校验与默认值由纯引擎 `normalizeConfig` 承担：第三方宿主 bundle 运行期无法解析 DSH 内部共享包 `@deepseek-ai/schemastery`（实测 `ERR_MODULE_NOT_FOUND`），因此 v1 不导出 schemastery `Config`（spec 对应句已加实现注记）。

## 5. 架构（两阶段）

### P0：纯客户端插件

- 包根：`package.json`（`exports: { ".": "./index.js", "./client": "./client.js", "./locale/*.json": ... }`、`dsh.bundle.patch: "./cordis.patch.yml"`、`dsh.client: { platform: "web", immediately: true, inject: [] }`）。注意 `dsh.client.inject` 是**模块加载顺序**（本包 `require()` 的平台包），不是 Cordis 服务注入；本包不 require 任何平台包，保持空数组。
- `index.js`：宿主半身只做一件只读的事——用 `ctx.webServer.register` 暴露 `GET /dsh-notice/config`（P1 会在这里加点击桥与 SSE）。
- `client.js`：`window.__ModuleLoader__.load({ id: 'dsh-notice', factory(require) {...} })`；factory 返回的插件对象用 **Cordis `inject: ['uiSession', 'sessions', 'locale']`** 声明服务依赖，`ctx.effect(() => subscribe(...))` 管理清理。
- 通知决策逻辑独立成纯 reducer 模块 `client.engine.js`（package-local client chunk，`require.async('./client.engine.js')` 加载；见 [spikes/04](spikes/04-client-detection.md)、[spikes/05](spikes/05-notification-rules.md)）：
  - `reduce(state, observation, runtime, config, now) -> { state, actions }`；observation = `attention` / `pendingResolved` / `viewed`；actions = `show` / `replace` / `close`；
  - 规则全在引擎：事件映射与 zh/en 文案、按会话前台抑制、`events`/`condition`/`sound`/`mute`、单条与原地替换、3 秒同类合并窗口、「另有 N 项」、消解、子代理归并、标题兜底、`tag`（会话 id）；
  - `node --test` 表驱动单测（`test/client-engine.test.js`）。
- 发送：`new Notification()`（权限已被主进程放行）；**Windows/Electron 同 tag 替换会让新对象的 `close()` 失效**（实测），故渲染层 toast 用 `${会话 tag}#${n}` 唯一 tag，替换/消解都由适配层显式关闭当前句柄；点击暂为尽力聚焦（见 P1）。


### P1：宿主半身补强

- 宿主半身订阅 `issue/request` 类事件（`prepend: true` + `next()`）与 `session/event` 的 `turn/end`，把「精确完成原因」通过 **SSE** 推给客户端（免构建通道：`ctx.webServer.register()`，客户端 document-relative `fetch('plugins/notice/events')`，与 `dsh-client-hmr` 同款）。
- 点击桥：客户端通知点击 → `POST` 宿主端点 → 宿主执行 `Start-Process 'dsh://open'`（单实例 → `focusPrimaryWindow()` restore+show+focus）。渲染进程内无法直接唤起托盘窗口，故必须走宿主。
- 宿主仍只做旁路：任何失败只记日志，绝不阻塞会话。

## 6. 约束与兼容

- 仅 Windows 桌面版 DSH；Electron 44.7.0。
- 窗口关闭 = 隐藏到托盘，渲染进程与插件状态存活，隐藏期间通知照常工作；重开不重载。
- 无会话深链：点击最多把 DSH 拉回前台，无法定位到具体会话（v1 接受）。
- 兼容声明以 `engines.dsh`（或 peer 匹配）为准；不匹配时 bundle 会被静默跳过。
- 不使用深路径 import、不写自定义 session 事件类型、不依赖 `asar` 路径。

## 7. 验收标准

1. 切到其他应用后，授权 / 提问 / 回合完成三类事件各能收到一次 Windows 系统通知。
2. 点击通知能把 DSH 带到前台；托盘隐藏状态下也有效（P1 点击桥）。
3. DSH 在前台且正在看该会话时**不**弹；在看别的会话时仍然弹。
4. 配置文件能分别开关三类事件、切换 `condition`、开关声音。
5. 同一会话的通知去重合并（含「另有 N 项」），处理完自动关闭。
6. DSH 最小化/隐藏到托盘时仍能提醒。
7. 连续 5 次事件不出现通知轰炸（每会话最多一条）。

## 8. 测试策略

- **单测**：通知决策纯函数（事件过滤、前台抑制、合并计数、消解、静音、子代理归并），`node --test`。
- **真机验证清单**：Toast 是否出现、归属名/AUMID 与图标、隐藏窗口时是否弹、点击是否拉前、连续事件是否替换。
- **安装路径验证**：通过 plugin manager `install_bundle` 以本地目录（`link:`）安装，确认 bundle 被激活、`client.js` 被服务。
- 开发环：link 安装后编辑 `client.js` 约 500ms 热替换（`dsh-client-hmr` 轮询），改完即见。

## 9. 风险与待实测

| 风险 | 说明 | 处理 |
|---|---|---|
| AUMID / Toast 归属 | `app.setAppUserModelId` 未被调用，Toast 可能显示为其它归属、图标缺失 | P0 第一件事真机实测；必要时退化为宿主 PowerShell Toast |
| 点击唤起 | 渲染进程内不可行；宿主 `dsh://open` 有 1–3 秒冷启动 | P1 点击桥，接受延迟 |
| 客户端 `running` 近似 | Stop/报错也会触发完成提醒 | P1 用宿主 `turn/end` 原因收敛 |
| 宿主 waterfall 顺序 | 不 `prepend` 会漏事件 | 代码中固定 `{ prepend: true }` 并加注释 |
| DSH 升级 | 内部服务形态可能变化 | 只用公开服务与文档化 API，升级后跑真机清单 |

## 10. 里程碑

- **P0**（0.5–1 天）：包骨架 + 客户端半身 + 单测 + 真机验证 Toast/AUMID/点击行为。
- **P1**（1–2 天）：宿主半身 + SSE + 点击桥 + 精确完成判定 + 验收清单全过。
- **收尾**：README 完善、locale 补全、首次发布准备（npm 可选）。

## 11. 参考

- 本地研究笔记（不提交）：`.scratch/research/report-plugin-api.md`、`report-events.md`、`report-client-plugin.md`、`report-codex.md`
