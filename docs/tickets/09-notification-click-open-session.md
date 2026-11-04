Status: done (2026-11-04) — 真机验收通过（在别的会话时点通知会自动切到事件会话）；实现提交 $feat；验收证据见本文件与 docs/dev-loop.md。

## Parent

#1（v1.1 增强，来自 #6 点击桥的用户反馈）

## 背景

#6 的点击桥只负责把 DSH 窗口带回前台；当用户正在看**另一个会话**时，点击通知后窗口虽然回到前台，但主视图仍停在原来的会话，用户还要手动去找「在等我操作」的会话。

原 spec 把「通知点击定位到具体会话」列为 v1 范围外，理由是「DSH 无会话深链」。后续调研发现 DSH 客户端有**公开服务方法**可以做到，因此在 v1.1 补上。

## 实现（纯客户端，无需宿主改动）

- `client.js` 的 `toast.onclick` 顺序改为：**先选会话** → 再 `window.focus()` 尽力聚焦 → 再 `POST /dsh-notice/focus` 点击桥。
- 选会话通过公开客户端服务 `ctx.uiWorkspace.openSession(target)`：`SessionTarget = SessionId | SubagentAddress`，官方 API catalog 描述为 "Select a Session and show its Conversation as one UI navigation action"（`dsh-cordis-client-runner/lib/client.js` 的类型目录、`dsh-client-ui-workspace/lib/client.js` 的 `openSession` 实现）。
- 传入 `action.tag`：引擎里它就是**事件所属主会话 id**（子代理事件已归并到主会话），正好也是通知状态键。
- 服务解析是惰性的：`ctx.get('uiWorkspace')`（Cordis 的可选查找；服务缺失/裁剪版 UI 时返回 undefined，不把服务写进 `inject`，避免服务缺失导致整个插件不激活）；解析或导航抛错只 `console.warn`，点击桥照常执行。
- 观察到的副作用（符合预期）：切换主视图会把事件会话设为 `retainedBy.mainView`，引擎的 `viewed` 观测随后关闭该会话的「回合完成」通知。

## 验收

- [x] 在别的会话时点通知 → 自动切到等待操作的会话。真人验收结果「切过去了」；窗口标题时间线证据：19:09:07 为「计算机 AI 方向读研还是就业」，点击通知后 **19:09:11.600** 变为「Implement task 6 — DeepSeek Harness」。
- [x] 服务不可用/`openSession` 抛错时静默降级，不影响窗口聚焦点击桥（单测：`test/plugin-package.test.js` 的点击用例注入 fake `uiWorkspace`，断言调用与会话 id，并断言抛错后仍发 focus POST 且只 warn）。
- [x] 导航服务本身在真实渲染器可用（HMR 探针：临时调用 `openSession(另一个会话)`，窗口标题从「计算机 AI 方向读研还是就业」变为「404错误码为何归类为客户端错误」并在 2.5s 后切回；探针已移除）。

## 已知限制

- 依赖 `uiWorkspace.openSession` 这一 DSH 公开客户端服务（Electron/DSH 升级后需在 #8 的发布验收里复核；服务缺失时自动退回旧行为：只聚焦窗口不切会话）。
- 点击「子代理归并」通知时打开的是主会话（会话 id 取主会话；DSH 无稳定的子代理深链入口除外——`openSession` 也接受 `SubagentAddress`，但 v1.1 不构造它）。

## Blocked by

- #6（点击桥）
