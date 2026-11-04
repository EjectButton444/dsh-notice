# Spike #05：通知规则与配置实测结论

状态：**完成（2026-11-04）**。对应 ticket [05-notification-rules.md](../tickets/05-notification-rules.md)；规格见 [docs/spec.md](../spec.md) §配置 / §通知决策引擎 / §通知行为，设计见 [docs/design-notes.md](../design-notes.md) §3–§5。实现提交见本文件末尾。

本文件记录 #5 的真机验证：**通知规则（合并/替换/消解/声音）+ 配置（events/condition/sound/mute）在真实 DSH 会话里的行为**，以及过程中发现并修复的一个 Windows/Electron 通知关闭缺陷。

## 实现形态

- **决策引擎升级为纯 reducer**（`client.engine.js`，仍是唯一自动化测试 seam）：
  - `reduce(state, observation, runtime, config, now) -> { state, actions }`；
  - observation 三类：`attention`（授权/提问/回合完成）、`pendingResolved`（待处理交互消失）、`viewed`（会话被打开 / 完成被看到）；
  - actions 三类：`show` / `replace` / `close`；
  - 规则全部在引擎：单条通知与原地替换、3 秒同类合并窗口、「另有 N 项」、消解关闭、子代理归并（tag=主会话、正文「来自子代理」）、zh/en 文案、标题兜底、`events`/`condition`/`sound`/`mute` 配置。
- **薄适配层**（`client.js`）：把 `uiSession.sessionStatus` + `sessions.list` 的状态迁移翻译成 observation，执行动作；不实现任何通知规则。
- **配置通路**：宿主半身（`index.js`）用 `ctx.webServer.register` 暴露只读路由 `GET /dsh-notice/config`（返回 loader 行 `config` 原文）；客户端半身加载时 document-relative `fetch('dsh-notice/config')`，交给引擎 `normalizeConfig` 补默认值。

## 配置生效路径（真机实测）

| 事实 | 结论 / 证据 |
|---|---|
| 改 profile `cordis.patch.yml` 的本插件行 `config` 是否需要重启 | **desktop profile 上不需要**：dsh-hmr 的 profile/patch 观察者（chokidar `awaitWriteFinish` 约 2s 稳定窗口 + 100ms debounce）从磁盘重读三层 patch → `recomposeProfile()` 活重组合并重跑该 loader 行插件。实测 patch 保存到路由反映新配置 **≈1.7–2.1s**（`config-activation-timeline.jsonl`，本地 gitignored） |
| 覆盖块的 loader 行 id | **重组合后行 id 是仓库 bundle patch 里的 `notice`**，不是安装时的 `dsh-notice`：写 `id: dsh-notice` 的覆盖会被判 "entry not found" **静默跳过**（路由仍 `{}`），写 `id: notice` 才生效（路由 `{"condition":"always"}`） |
| 客户端半身如何拿到新配置 | 重组合**不**改变 client graph rev、不发 `rebuilt` 帧；需 touch `client.js` mtime 触发客户端 HMR 重载（实测 +356ms 收到 `rebuilt`），重跑 `apply` 后才 fetch 新配置（打点 `config raw {...}` 可证） |
| 路由返回什么 | **宿主拿到的 raw row config**；无覆盖时 `{}`。默认值由客户端 `normalizeConfig` 填充。覆盖是整体替换（写部分键时该对象只剩这些键） |
| `@deepseek-ai/schemastery`（spec 原本的 Config 校验方案） | **第三方宿主 bundle 运行期不可解析**：从仓库目录用 DSH 自带 Electron node（`ELECTRON_RUN_AS_NODE=1`）与系统 node 实测均 `ERR_MODULE_NOT_FOUND`。因此 v1 不导出 `Config`：宿主透传配置，**校验与默认值由纯引擎 `normalizeConfig` 承担**（非法/缺失值回退默认，单测覆盖）。spec 中「由插件自带的 schemastery Config 校验」一句已加实现注记 |
| 声音 | `sound: false` → 动作 `silent: true`（单测覆盖）；Windows 侧声音是否实际静音未用音频探针逐项验收（`audio-peak.ps1` 可用，见 #8 清单） |

## 真机验收证据（干净构建，已移除全部调试打点与探针）

说明：表中的「打点」证据来自验收过程中**临时 instrumented 构建**（beacon 打点，提交前已从源码移除，日志在本地 gitignored `.scratch/`）；通知中心/注册表/用户确认证据来自最终干净构建或全局观测通道。仓库内可复现的自动化证据只有 `node --test`（引擎单测）与 `node --check`；真机证据按 [AGENTS.md](../../AGENTS.md) 的本地优先约定不入库（与 #2/#3 相同）。

| 验收项 | 结果 | 证据 |
|---|---|---|
| 配置 `condition: always`（前台也提醒） | **通过**：配置下发后，DSH 在前台、正看着事件会话时提问仍弹通知，用户确认 | 配置路由 `{"condition":"always"}`；用户确认「看到了通知（前台也弹了）」；通知中心 id 56368 created 15:38:34.709 |
| 配置 `mute: true`（全静音） | **通过**：配置为 `condition: always + mute: true`（`always` 已绕过前台抑制，故 0 动作只能由 `mute` 解释；当时 `focused=true`、`viewedSessionId=事件会话`），提问事件 0 动作、无通知；用户确认「没有看到通知」 | 打点 `observe attention -> actions:[]`；注册表 `LastNotificationAddedTime` 不变 |
| 配置 `events.question: false` | **通过**：配置为 `condition: always + events.question: false`（抑制不参与判定），只关闭提问类通知；用户确认「没有看到通知」 | 打点 `observe attention → actions:[]`；注册表不变 |
| 配置 `events.turnComplete: false` | **通过**：`condition: always + events.turnComplete: false` 下，回合完成事件被判定 0 动作，无「本轮已完成」通知 | 打点 `observe attention turnComplete -> actions:[]`（15:46:56，registry 不变） |
| 配置 `sound`（silent 标记） | 单测覆盖（真机声音未逐项验收，列入 #8） | `test/client-engine.test.js`: sound=false → silent |
| 授权 / 回答后通知自动关闭 | **通过**：提问通知在回答后由 close 动作移除；用户确认「回答后自己消失了」。授权通知（真实升级权限审批事件）在批准后同样自动关闭 | 通知中心 56368 added 15:38:34.709 → removed 15:38:47.066；56370→15:39:13.9；56374→15:49:07.3；最终修复构建 56393 → 15:58:34.3 |
| 打开会话后「本轮已完成」通知关闭 | **通过（创建+移除观测）**：回合完成通知 15:49:54.368 出现、用户回到 DSH 后 15:49:56.572 移除；引擎 `viewed` 观测把「打开会话/焦点回来/完成未读清除」统一为 close 动作（单测覆盖） | 通知中心 id 56377 时间线；`test/client-engine.test.js` 的 viewed 关闭用例 |
| 同一会话单条通知 / 原地替换 | **通过（产品语义 + 单测）**：同会话连续事件在通知中心始终只有一条活跃提醒（适配层先关闭旧通知再创建新通知）；引擎单测覆盖 5 连事件只有一次 show、后续为 replace、内容为最新事件。注意：因 Windows 同名 tag 缺陷规避方案，每次替换在 OS 层是「关旧 + 新 toast」，可能重新弹 banner/提示音；不堆叠由显式关闭保证 | 通知中心 id 更替（56348→…→56393 期间同会话始终 ≤1 条）；`test/client-engine.test.js` |
| 「另有 N 项」 | **单测覆盖**；真机无法构造（见下） | 引擎单测：3 个 pending → 正文「另有 2 项」/`+2 more pending` |
| zh / en 文案 | zh 真机（全部通知均为中文）；en 单测覆盖（真机切语言未验，`docs/dev-loop.md` 已有切换方法） | `test/client-engine.test.js` |
| 子代理待处理归并 / 子代理完成不提醒 | **单测覆盖**；真机受限：本 harness 里子代理/teammate 无法发起人机交互（`human interaction is unavailable while the calling agent is owned by another live agent`），无法产生子代理 pending 事件 | 引擎单测：subagent pending → tag=主会话、正文「来自子代理」；subagent turnComplete → 无动作 |

**真机无法覆盖的项**（单测 + 代码审查兜底，列入 [#8](../tickets/08-acceptance-release.md) 真机清单）：
- 「另有 N 项」需要同一主会话下多个并发待处理项；`uiSession.sessionStatus` 每会话只保留优先级最高的一条 pending，子代理会话又无法产生人机交互，本机构造不出。
- 子代理 pending 的真实归并、子代理回合完成不提醒。
- `sound: false` 的实际静音与 `en` 界面文案。

## 发现并修复的缺陷：Windows/Electron 同名 tag 通知无法关闭

**症状**：真实事件的通知在「回答/处理完」后，通知中心条目不消失（close 动作已发出、`Notification.close()` 已调用，但条目残留）。

**诊断**（临时打点 + 独立探针，打点已从源码移除）：
1. `pendingResolved` observation 正常到达，引擎正常返回 `close` 动作。
2. 但 `close` 时适配层的 toast Map 里已经没有句柄：`toast.onclose` 在通知创建后 **2–23ms** 就被触发并删除了句柄。
3. 独立探针复现根因：**当通知中心里已存在同名 `tag` 的通知时，再创建一个同 tag 的 Web Notification，Electron/Windows 会立刻对新对象派发 `close` 事件；此后对该对象调用 `close()` 变成 no-op**，条目永久残留。
   - 探针 A→B（同 tag）：A、B 的 `onclose` 都立即触发，B.close() 后中心仍有 B。
   - 对照：先 close A，等待 250ms 再用同 tag 创建 B → 无提前 onclose，B.close() 后中心清空。
4. 这解释了「替换/连续事件后关闭失效」：任一替换都制造了同 tag 碰撞，随后该 tag 的关闭全部失效。

**修复**（`client.js`）：
- 引擎的 `tag`（=会话 id）继续作为**状态键**；
- 渲染层实际通知使用**每次递增的唯一 tag**（`${tag}#${n}`），从根上避免同 tag 碰撞；
- 替换 = 先关闭该会话当前通知，再用新唯一 tag 创建；close 动作关闭当前句柄；
- 真机复验：修复后通知 `...session-…#1` 在回答后由 close 移除（通知中心 recorded: appeared 15:58:28.944 → removed 15:58:34.322），用户确认「看到通知了，回答后自动消失」。

**残留说明**：验证过程中 buggy 构建在通知中心留下一条无法再被程序关闭的旧条目（旧 tag），属验证机历史残留；修复后的新会话不会再进入该状态（每次创建前要么无同 tag、要么先 close 旧通知）。用户手动「清除全部」即可。

## 已知限制与影响

- 由于规避 Windows 同名 tag 缺陷，**替换不是 OS 级「原地更新」**：适配层先关闭旧通知再创建新通知（唯一 tag），因此同一会话的新事件可能重新弹一次 banner/提示音；产品语义上的「每会话一条不堆叠」由显式关闭保证。若后续找到 Electron 侧更好的方式可恢复 OS 原地替换。
- 早期 buggy 构建可能在通知中心留下一条无法程序关闭的旧条目（旧 tag）；修复后不会再产生。用户手动「清除全部」即可。
- `sound: false` 的实际静音、`en` 文案、子代理归并与多待处理计数需在 #8 真机清单复核。
- 点击通知唤起仍是 P0 尽力聚焦，托盘隐藏时无效；#6 的宿主点击桥负责。
- P0 回合完成近似（Stop/报错也会弹）仍由 #7 收敛。

## 影响与后续

- [docs/design-notes.md](../design-notes.md) §3–§5 已更新为实现后的规则与配置通路；[docs/dev-loop.md](../dev-loop.md) 增加了配置覆盖/重载的完整流程与行 id 陷阱。
- 点击唤起仍是 P0 尽力聚焦（[#6](../tickets/06-click-bridge.md)）；回合完成精确语义（Stop/报错不弹）仍由 [#7](../tickets/07-precise-turn-completion.md) 收敛。
- `sound` 实际静音、`en` 文案、子代理归并、多待处理计数列入 [#8](../tickets/08-acceptance-release.md) 真机清单。
## 提交

- 实现与单测：`6eed54e`（`feat: notification rules, close-on-resolve and config wiring (#5)`）
- 验收记录与文档更新：随本文件所在提交。
