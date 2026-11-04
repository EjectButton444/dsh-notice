# Spike #07：精确回合完成判定（宿主 `turn/end` + SSE）实测结论

状态：**完成（2026-11-05）**。对应 ticket [07-precise-turn-completion.md](../tickets/07-precise-turn-completion.md)；规格见 [docs/spec.md](../spec.md) §注意力事件来源 / §通知行为，设计见 [docs/design-notes.md](../design-notes.md) §2/§5。实现提交见文末。

本文件是 #7 的真机验证记录：**Stop / 报错 / 中断不再误弹「本轮已完成」**，同时**真实回合完成仍会弹**；宿主钩子异常被吞掉、不影响审批；以及免构建 SSE 通道在真机上的连通、断线/重连行为。

## 实现形态

- **宿主半身**（`index.js`）：
  - `toCompletionFrame(session, event)`：纯归一化函数，只有 `event.type === 'turn/end'` 且 `event.data.reason.kind === 'completed'` 才产出 `{ type:'turn/end', sessionId, reasonKind:'completed', turn?, origin?, parentSession? }`（`turn` 仅作观测装饰，决策不依赖）；`aborted / blocked / error / interrupted / forked / max-tokens` 与其它事件类型一律 `null`。整个函数 try/catch，恶意/畸形输入返回 `null`、永不抛错。
  - 订阅方式：普通 `ctx.on('session/event', …)`（observe-only）。`prepend` 只对 waterfall（审批/提问）有意义，`session/event` 是普通 emit、顺序无关，故不传。
  - `createCompletionFeed()`：SSE 广播器（`connect` / `publish` / `close`）。每个写操作独立 try/catch，单个坏连接被移除、不影响其它连接，也不会把异常带回 `session/event` 派发。
  - `apply()` 新增第三条 exact 路由 `GET /dsh-notice/events`（`HEAD` 只回响应头，其它方法 405），并在一个 `ctx.effect` 里 `ctx.on('session/event', (session, event) => feed.publish(session, event))`，清理时退订 + 关闭全部流。`inject` 仍只有 `webServer`，无新依赖。
- **客户端半身**（`client.js` / `client.engine.js`）：
  - 纯引擎新增 `classifyTurnEnd(reason)`（只认 `completed`）与 `normalizeTurnEndFrame(frame)`（SSE 帧 → 决策引擎的注意力事件输入，含 `isSubagent`/`mainSessionId` 归一化），与 `reduce()` 共用同一纯测试 seam。
  - 适配层在初始 priming 后用 document-relative `new EventSource('dsh-notice/events')` 订阅宿主（与 `dsh-client-hmr` 用 `new EventSource('plugins/events')` 同款；Electron 的 `dsh-app://` 协议把非静态资源请求转发给宿主，同源免鉴权）。
  - **精确模式**：SSE `open` 后把 `preciseCompletion` 置为 `true` **且永不回退**；此后只接受宿主 `turn/end` 帧作为「回合完成」信号，P0 的 `running: true → false` 近似永久关闭（因此 Stop / 报错 / 中断不可能再弹）。SSE 未连通前（例如旧版宿主没有该路由）保留 P0 近似作为迁移回退。
  - 断线只 `console.warn`，由 EventSource 原生自动重连；异常/畸形帧只记日志，不影响会话。卸载时退订 + 关闭 source。
- **通知规则不变**：宿主只做归一化与传输，不重复实现规则；子代理完成仍由引擎丢弃（通知归并、前台抑制、配置、合并/消解均沿用 #5 引擎）。

### SSE 帧协议

```
GET /dsh-notice/events   (document-relative: 'dsh-notice/events')
200 content-type: text/event-stream
cache-control: no-cache
connection: keep-alive

: connected

data: {"type":"turn/end","sessionId":"<session-id>","reasonKind":"completed","turn":1}
data: {"type":"turn/end","sessionId":"<subagent-session-id>","reasonKind":"completed","turn":1,"origin":"subagent","parentSession":"<main-session-id>"}
```

只有 `reason.kind === 'completed'` 会出现在流里；`turn` / `origin` / `parentSession` 是可选装饰字段。

## 单测证据

`node --test --test-isolation=none "test/*.test.js"`：**73 tests / 73 pass / 0 fail**（改动前 39）。传输层契约测试的存在理由记录在 spec Testing Decisions 的 #7 注记（静默故障传输层无法只靠真机清单回归）。

| 测试文件 | 数量 | 覆盖 |
|---|---|---|
| `test/client-engine.test.js` | 36 | `classifyTurnEnd` 全 reason 表（completed → turnComplete，其余 6 种 → undefined）；`normalizeTurnEndFrame`（线上平铺 `reasonKind` 正常帧、缺 sessionId、错 type、非 completed、子代理 `origin`/`parentSession`、畸形输入）；完成的帧喂给 `reduce` → 「本轮已完成」show；子代理完成的帧 → 0 动作 |
| `test/host-feed.test.js` | 19 | `toCompletionFrame` 正常/6 种非完成/其它事件类型/畸形与恶意 accessor；`createCompletionFeed` 握手、广播、多客户端、坏客户端隔离（同步写失败 + 异步 `error` 事件）、关流；路由 GET 200+SSE 头+`: connected`、HEAD、405；`apply` 订阅只转发 completed；dispose 退订+关流；`ctx.on` 缺失/抛错时路由仍挂载、插件不炸 |
| `test/client-feed.test.js` | 9 | EventSource 用文档相对路径 `dsh-notice/events`；open 前 running 边沿仍按 P0 回退弹、open 后 running 边沿不再弹；completed 帧（宿主真实 `reasonKind` 形态）→ 一条「本轮已完成」通知（标题来自会话行）；非 completed 帧不弹；坏 JSON 只 warn、错误后仍能工作；dispose 关闭 source；无 EventSource 环境不炸、P0 回退可用；子代理帧不弹 |
| `test/plugin-package.test.js` | 9 | 宿主路由契约更新为 3 条（config/focus/events），原有打包/点击桥/seam 契约不回归 |

## 真机证据

环境同 [Spike #02](02-toast-spike.md)：DSH Desktop 0.2.1-rc.5 / Electron 44.7.0 / Windows 11 25H2 / zh-CN；宿主端口 `127.0.0.1:62809`。

**激活方式**：宿主半身不会自动热替换，用 `07-activate-host.ps1` 在 profile `cordis.patch.yml` 追加一行 YAML 注释触发一次活重组合（~2–4s），无需重启 DSH；随后 `touch client.js` 让客户端半身 HMR 重载。激活后 `HEAD /dsh-notice/events` 返回 **200**（旧代码为 404），确认新宿主代码已加载。共两轮激活：`01:23`（首轮实现）与 `01:38`（评审修复后）。

| 验证项 | 结论 | 证据 |
|---|---|---|
| 宿主 `session/event` 订阅在真机生效 | **通过**：一次真实子代理回合完成产生了唯一的 `turn/end` 帧（含 `origin: subagent` / `parentSession`） | `.scratch/verify/07-sse-frames.jsonl` @ `2026-11-05T01:23:39.836`：`data: {"type":"turn/end","sessionId":"144596d5-…","reasonKind":"completed","turn":1,"origin":"subagent","parentSession":"session-d64ddf93-…"}` |
| 子代理完成不弹通知 | **通过**：该子代理帧之后通知中心无新增（`id` 集合 diff：new=0） | `07-toasts-before.json` / `07-toasts-after-subagent.json` |
| 真实回合完成仍弹「完成」通知（主会话） | **通过**：SSE 帧与通知库记录相隔 **87ms**（首轮）/ **646ms**（评审修复后复验），用户两次确认看到；标题=该会话标题，正文「本轮已完成」 | 首轮 SSE @ `01:25:55.118`（`session-4f22b151-…`, turn 1, 无 origin）；通知库 `id 56465` created `01:25:55.205`，title `确认收到回复`、body `本轮已完成`；复验见下节 |
| 用户按 Stop 不再弹「本轮已完成」 | **通过（首轮 + 复验）**：用户在另一会话发起长任务后按 Stop；无 SSE 帧、通知时间线无任何新增「本轮已完成」，用户确认未弹 | 首轮：`07-notification-timeline.jsonl` 最后一条为 `01:25:56.938` 的移除事件，之后至观测窗口结束无新增；复验见下节 |
| 报错 / 中断不弹「完成」通知 | **单测覆盖**（本机难以稳定制造 `error`/`interrupted`/`max-tokens` 真机事件；`aborted` 已由真机 Stop 用例覆盖，剩余 reason 共用同一条宿主过滤分支） | `toCompletionFrame` 表驱动：`aborted / blocked / error / interrupted / forked / max-tokens` → `null`；`classifyTurnEnd` 同表 |
| 宿主钩子异常被吞掉、审批流程不受影响 | **通过**：监听器是 `session/event` 的 observe-only post-commit 订阅（DSH 自身按监听器隔离异常），且整条链路 try/catch；单测覆盖恶意 accessor/坏连接/异步 socket error。激活后本会话的真实审批（写 profile 的提权请求）与提问（`ask_user_question`）均正常工作，验证期间审批/提问通知照常产生 | `test/host-feed.test.js` 的 hostile accessor / broken response / async error / throwing `ctx.on` 用例；真机：01:24:27 审批通过后命令执行、01:24:52 与 01:41:41 提问通知出现 |
| SSE 断线/重连不影响会话 | **通过（宿主侧；页面内重连未独立打点）**：profile 重组合使宿主插件重载，流在 `01:24:29.616` 以 `terminated` 结束；重连后 `01:24:42.463` 收到 `200 text/event-stream`，后续帧正常；复验轮同样在重组合后重新连上并收到帧。期间本会话与 DSH 均继续工作、无异常。客户端侧依赖 EventSource 原生重连（错误只 warn），精确模式标志一旦置位不回退；页面内自动重连是浏览器标准行为，本次未做独立断流实验，列入 #8 干净构建复核 | `.scratch/verify/07-sse-frames.jsonl` 的 `connected → frame → error(terminated) → connected → frame` 时间线；复验 `07-sse-frames-verify2.jsonl` / `07-sse-frames-round3.jsonl` |
| `condition: always` 下的通知路径（便于前台观察） | **通过**：验收临时把 profile 配置改为 `condition: always`（`07-always-config.ps1`），完成后已用 `07-activate-host.ps1 -Restore` 把 profile 还原到原始 sha256 | profile 原始/还原后 sha256 均为 `2E11C87A…`；`GET /dsh-notice/config` 还原后为 `{}` |

### 评审修复后的复验（2026-11-05 01:38–01:43）

Standards + Spec 两轴评审后修复了：宿主归一化函数命名与 `completed` 常量、客户端只接受线上平铺 `reasonKind`（去掉未发射的 `reason:{kind}` 形态）、复用归属 helper、SSE 响应增加异步 `error` 隔离，并按仓库规范更新了 Testing Decisions 与相关文档。修复后按同样流程复验（先 `touch client.js` 载入最终客户端代码、再触发 profile 重组合加载修复后的宿主；临时 `condition: always` 便于前台观察，结束后已还原 profile）：

| 验证项 | 结果 | 证据 |
|---|---|---|
| 修复后宿主 SSE 订阅与帧形态 | **通过**：一次真实子代理完成产生 `{type:'turn/end', sessionId, reasonKind:'completed', turn:1, origin:'subagent', parentSession:…}` 帧；通知中心无新增 | `07-sse-frames-verify2.jsonl` @ `01:39:06.763`；通知库快照 `07-toasts-verify2-after-subagent.json` |
| 修复后主会话完成 → 通知 | **通过**：SSE 帧与通知库 toast 相隔 **646ms**（帧 `01:42:19.841` → toast created `01:42:20.487`），toast `id 56478` 标题「收到确认回复」/正文「本轮已完成」；用户确认看到 | `07-sse-frames-round3.jsonl`、`07-notification-timeline-round3.jsonl` |
| 修复后 Stop 不弹 | **通过**：`01:42:19.841` 之后无任何 SSE 帧；`01:42:22.911` 的移除事件之后至观测窗口结束无新 toast（含 registry arrival 通道，可捕获即使立刻消失的 toast），用户确认未弹 | 同上 |
| `condition: always` 临时配置与还原 | **通过**：`-Set` 后 `GET /dsh-notice/config` 返回 `condition: always`；`-Restore` 后 profile sha256 `2E11C87A…` 与原始备份一致、config 路由回到 `{}` | `07-always-config.ps1`、`07-activate-host.ps1 -Restore` 输出 |

验收后状态：profile 文件已按原始备份逐字节还原（sha256 与备份一致），宿主新代码仍处于加载态（`/dsh-notice/config` 200 `{}`、`HEAD /dsh-notice/events` 200），下一次重启 / DSH 重组合会从仓库重新加载同一实现。

## 开发期观察（不属 #7 验收项，移交 #8）

- 验收与复验窗口内**两次复现**「一条提问产生两条通知」：`id 56463/56464`（`01:24:52`）与 `id 56476/56477`（`01:41:41`），均为同一会话 tag、3ms 内创建，一条 en 回退标题、一条 zh 会话标题。复现时两条通知的唯一 toast 后缀相同（均 `#5`），与「两个适配实例各自从 0 开始计数」一致，怀疑开发期多次 HMR 重载遗留了重复的客户端实例；提问链路 #7 未改动，同环境下完成通知只产生一条。已记入 #8 干净构建复核清单（干净页面重载后、无 HMR 差异时重复验证审批/提问/完成三类各只弹一条），不阻塞 #7。
- 宿主插件重组合会主动断开所有 SSE 流（本文件已作为断线证据）。无需心跳：EventSource 自动重连；半死 TCP 只会在下一次写/关流时被发现，v1 接受。

## 遗留与后续

- 精确模式在 **SSE 首次 open 之前**仍用 P0 `running` 边沿近似（迁移回退，窗口通常 <1s；配置 fetch 超时上限 3s）。一旦 open 即永久精确；客户端重新载入（含 HMR/刷新）会重新经历该窗口。
- 子代理归属依赖两个来源之一：宿主附带的 `session.header` 元数据（`origin`/`parentSession`）或客户端 `sessions.list` 行（`origin`/`parentId`）。两者同时读失败时，子代理完成可能降级成主会话通知（DSH session header 是持久化契约，实际概率极低；与 R8 同批观察）。
- 若未来 DSH 变更 `session/event` 的 `turn/end` 载荷形态或 `dsh-app://` 转发行为，属 R6 升级风险：升级后按发布验收清单复核（本文件的真机表格即该清单的 #7 部分）。
- 无心跳、无服务端重放：断线期间完成的回合不会补发（宁可漏提醒也不误提醒），v1 接受。

## 工具（本地 `.scratch/verify/`，已 gitignore）

| 文件 | 用途 |
|---|---|
| `07-activate-host.ps1` | 触发 profile 活重组合加载新宿主代码 / `-Restore` 还原 profile；HEAD 探针等待 `/dsh-notice/events` 200 |
| `07-sse-watch.mjs` | 订阅 `/dsh-notice/events`，逐帧打时间戳写 `07-sse-frames.jsonl` |
| `07-always-config.ps1` | 临时把 profile 配置改为 `condition: always` / `-Clear`（包一层 #5 的 `set-plugin-config.ps1`） |
| `07-profile-patch.original.yml` | profile 原始备份（sha256 `2E11C87A…`） |
| `07-parse-timeline.mjs` | 把通知时间线 JSONL 解析成可读行（核对 toast 的 id/标题/正文/标签） |
| `07-sse-frames*.jsonl`、`07-notification-timeline*.jsonl`、`07-toasts-*.json` | 上述证据文件（首轮 `…jsonl`、复验 `…-verify2.jsonl` / `…round3.jsonl`） |
| `watch-notification-state.ps1`（#5 工具） | 通知中心生命周期轮询（本票用 `-Aumid '*DeepSeek*'`；复验轮保留 registry arrival 通道以捕获瞬时 toast） |

## 提交

- 实现（宿主 + 客户端 + 单测）：`feat: precise turn completion via host turn/end and SSE (#7)`（见 `git log`）
- 验收记录与文档更新：随本文件所在提交。
