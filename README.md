# dsh-notice

把 DeepSeek Harness 会话里「需要人介入」的时刻变成 Windows 系统通知。

三类**注意力事件**（术语见 [GLOSSARY.md](./GLOSSARY.md)）：

- **授权请求**——工具/沙箱权限等你确认；
- **提问请求**——代理在等你回答；
- **回合完成**——本轮结束，等你下一条指令。

提醒行为：

- 通知只显示**会话标题 + 事件类型**，不暴露工具命令、问题原文或用户消息内容（通知会出现在锁屏与通知中心，隐私优先）；
- 同一会话最多一条活跃通知，新事件替换内容；同时存在多个待处理项时追加「另有 N 项」；处理完（授权/回答/打开会话）自动关闭；
- 点击通知把 DSH 窗口带到前台，v1.1 起还会直接切到事件所属会话；
- 默认只在没看 DSH、或在看别的会话时提醒；可配置为总是提醒、全局静音、关闭提示音；文案跟随 DSH 界面语言（zh/en）。

设计时参考了 OpenAI Codex 的通知行为（事件少而准、默认前台不打扰、按会话去重），设计决策记录在 [docs/adr/](./docs/adr/)。

## 状态

实现阶段：全部功能完成（P0 客户端半身、P1 点击桥、v1.1 点击切会话、#7 精确回合完成）；发布验收进行中（#8），结论以 [docs/tickets/08-acceptance-release.md](docs/tickets/08-acceptance-release.md) 为准。

- [x] 需求与设计访谈
- [x] 领域术语表、ADR-0001 / ADR-0002
- [x] P0：纯客户端插件跑通 Windows Toast
- [x] P0：客户端注意力检测（授权 / 提问 / 回合完成）+ 通知决策引擎（前台抑制，含单测）
- [x] P0：通知规则补全（每会话单条 / 替换 / 3s 合并 / 另有 N 项 / 消解关闭 / 配置 / zh-en 文案）
- [x] P1：宿主点击桥——点击通知唤起 DSH 窗口（托盘隐藏 / 最小化 / 后台均实测通过，失败静默）
- [x] v1.1：点击通知自动切换到等待操作的会话（`uiWorkspace.openSession`，真机验收通过）
- [x] P1：宿主精确完成判定（宿主 `turn/end` + SSE；Stop 真机验收通过，报错/中断/fork/token 上限由同一宿主过滤分支的单测覆盖）
- [ ] 发布验收（#8）：真机清单收尾、文档定稿

## 安装

### 命令行（本地目录安装）

1. 退出 DSH（CLI 文档预期应用未运行；应用运行中安装也能生效，但那是 HMR 的附带能力，不是 CLI 契约）；
2. 运行（把路径换成**本仓库的绝对路径**）：

   ```powershell
   dsh plugin --profile desktop add "D:\AI区\dsh小插件\notice"
   ```

   该命令以 `link:` 依赖安装本地目录，并把本插件 bundle 追加到 profile 的 `dsh.profile.bundles`；宿主半身与客户端半身一起安装，不需要手动改 profile 文件；
3. 启动 DSH，Plugins → 已安装插件中出现「DSH 提醒」（`dsh-notice`）卡片，默认启用。

### 插件管理器（GUI）

Plugins → **Add plugin** → 选择「安装第三方插件」（install third-party plugin）→ 填入本仓库的绝对目录 → 勾选信任（trust）→ **Install**。安装后在已安装插件列表出现同一张卡片，可整行启用 / 禁用。

### 环境要求

- 仅 **Windows 桌面版 DSH**（v1）；实测基线 **DSH Desktop 0.2.1-rc.5 / Electron 44.7.0**；
- 插件声明 `engines.dsh: ">=0.2.1-rc.5 <0.3.0"`；版本不匹配时 DSH 会**静默跳过**本插件（不报错、也不加载）；
- v1 从本地目录安装，未发布 npm 包。

### 禁用 / 卸载

- 禁用：Plugins 插件页里本插件行的启用开关（相当于禁用该 loader 行）；
- 卸载：插件页 Remove，或运行 `dsh plugin --profile desktop remove dsh-notice`（改 profile；CLI 预期应用未运行）；
- 若曾在 profile 的 `cordis.patch.yml` 里写过本插件的配置覆盖，卸载后可删除对应的 `- id: notice` 块（见下方「配置」）。

### 更新

本插件以本地目录（`link:`）方式安装：`git pull` 更新仓库后，客户端半身由 HMR 约 450ms 热替换；宿主半身（`index.js` / `cordis.patch.yml`）不会自动热替换，需要一次 profile 重组合或重启 DSH 才会加载新代码。由于是 `link:` 安装，本仓库目录需要保持原位（移动 / 删除目录会让插件失效）。详见 [docs/dev-loop.md](docs/dev-loop.md)。

## 配置

配置位于 DSH profile 的 `cordis.patch.yml` 中本插件的 loader 行。desktop profile 的 patch 文件一般形如 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`（以你机器上的 profile 路径为准）。

**行 id 必须是 `notice`**（bundle 插入的行 id），在 profile 的 `cordis.patch.yml` 中追加/修改本插件覆盖块：

```yaml
- id: notice
  name: dsh-notice
  config:
    events: { approval: true, question: true, turnComplete: true }
    condition: unfocused   # unfocused | always
    sound: true
    mute: false
```

| 键 | 默认值 | 说明 |
|---|---|---|
| `events.approval` | `true` | 授权请求提醒开关 |
| `events.question` | `true` | 提问请求提醒开关 |
| `events.turnComplete` | `true` | 回合完成提醒开关 |
| `condition` | `unfocused` | `unfocused` = 只在没看 DSH、或在看别的会话时提醒；`always` = 总是提醒 |
| `sound` | `true` | 是否带系统提示音 |
| `mute` | `false` | 全局静音；`true` 时一条通知都不发 |

- **整体替换，不深合并**：profile 里的 `config` 块会整体替换本插件该行的配置，缺失键回退默认值。**建议每次重述整块所有键**，避免只写部分键时把其余键重置为默认。
- **生效路径**：保存 profile patch 后，开发环里约 1.7–2.1s 完成宿主活重组合（见 [spike 05](docs/spikes/05-notification-rules.md)），但客户端半身不会自动重新读取配置；正式使用以**修改后重启 DSH** 为准。
- **v1 没有设置界面**：配置只走文件。宿主半身用只读路由 `GET /dsh-notice/config` 暴露该行配置原文（无覆盖时为 `{}`），校验与默认值由纯决策引擎 `normalizeConfig` 承担——非法/缺失值回退默认（单测覆盖）。
- 不配置任何东西即默认行为：三类事件全开、仅未聚焦提醒、有提示音、不静音。

## 升级后检查清单

DSH 升级（尤其是 DSH / Electron 大版本）后逐项自检。通知是旁路能力，失效时通常**不报错、只表现为「通知不再出现」**，所以升级后建议主动跑一遍：

1. **版本匹配**：新 DSH 版本是否仍落在 `engines.dsh` 范围（`>=0.2.1-rc.5 <0.3.0`）内。不匹配会被**静默跳过**——表现为插件页没有这一行、也不报错；需要放宽范围并重新验证后再使用。
2. **插件加载**：Plugins 插件页能看到 `dsh-notice` 行且处于启用状态；client graph（`GET /plugins/events`）里出现 `dsh-notice`（也可以直接看三类通知是否还会弹）。
3. **宿主路由**：浏览器 / curl 访问 `http://127.0.0.1:62809/dsh-notice/config` 应返回 200（本机当前端口，以 DSH 实际监听端口为准；无覆盖时响应 `{}`）；`curl -I http://127.0.0.1:62809/dsh-notice/events` 应返回 200（说明精确完成的 SSE 路由已挂载）。
4. **三类事件各触发一次**：切到其他应用后，分别制造授权、提问、回合完成，各应收到一条通知；用户按 Stop 不应弹「本轮已完成」。
5. **点击通知**：点击后 DSH 窗口回到前台且可正常操作（托盘隐藏 / 最小化 / 后台三种状态）；v1.1 还应先切到事件所属会话。
6. **依赖契约变化点**：本插件有两处依赖 DSH/Electron 内部契约，升级后重点复核：
   - 点击桥依赖 **Electron 44.7.0 的托盘消息契约**（`Electron_NotifyIconHostWindow` + `WM_APP+1` + icon id 2 + `WM_LBUTTONDOWN`），见 [spike 06](docs/spikes/06-click-bridge.md)；
   - 精确回合完成依赖 **`session/event` 的 `turn/end` 载荷**（只有 `reason.kind === 'completed'` 才提醒）与 Electron `dsh-app://` 同源转发，见 [spike 07](docs/spikes/07-precise-turn-completion.md)。
7. **系统侧检查**：Windows 专注助手/勿扰是否开启、系统通知总开关与「DeepSeek Harness」的应用通知设置是否被关掉。

## 已知限制

### AUMID 与 Toast 实测结论

Windows 11 25H2 + DSH Desktop 0.2.1-rc.5 / Electron 44.7.0 的实测结论（完整记录见 [docs/spikes/02-toast-spike.md](docs/spikes/02-toast-spike.md)）：

- **归属正确，无需降级**：DSH 没有显式调用 `app.setAppUserModelId`，但 Toast 横幅与通知中心实测归属安装包注册的 `electron.app.DeepSeek Harness`（显示名「DeepSeek Harness」），横幅使用 DSH 应用图标；通知设置里按 AUMID 正常归档、可单独开关。因此**不需要**采用原定的退路——宿主 PowerShell/WinRT Toast（见 [docs/risks.md](docs/risks.md) R1）。
- **提示音**：默认播放 Windows 系统通知音（CoreAudio 实测触发后峰值从 0 到 0.32）。
- **锁屏**：锁屏时通知可见，但内容被系统隐藏（不显示标题正文），与隐私目标一致。
- **系统可能压制**：专注助手/勿扰、通知总开关或按应用的通知设置都会让 Toast 不出现；「没弹」时先查系统侧。
- **仅 Windows**：v1 只支持 Windows 桌面版 DSH，macOS / Linux / 浏览器不支持。

结论：ADR-0001 维持——v1 的提醒渠道仍只用 Windows 系统通知。

### 回合完成与提醒传输

- **回合完成是精确判定**：宿主订阅 DSH `session/event` 的 `turn/end`，只有 `reason.kind === 'completed'` 才提醒；用户按 Stop（`aborted`）、报错、中断、fork、blocked、max-tokens 都不弹「本轮已完成」。客户端 SSE 首次连通后永久进入精确模式；首次连通前的极短过渡窗口（页面载入后通常 <1s）才用 `running` 边沿近似，之后即永久精确。
- **SSE 无心跳、无重放**：断线期间完成的回合**不补发**（宁可漏提醒也不误提醒），EventSource 会自动重连；宿主重组合会主动断开流并触发重连。
- 子代理的待处理交互归并到主会话（正文标注「来自子代理」）；子代理自己的回合完成不提醒。

### 点击通知与窗口

- 点击主路径是**触发 DSH 自己的托盘点击**（`focusPrimaryWindow()` 原生 restore+show+focus）：托盘隐藏 / 最小化 / 后台均能把窗口带回前台且可操作。实测恢复显示约 0.3–0.6s，前台聚焦受系统前台锁与负载影响（实测最慢约 2.6s）；失败静默，不影响会话。
- **依赖 Electron 44.7.0 托盘消息契约**：外部 Win32 强制显示虽然能把窗口画出来，但 Chromium 渲染器会保持冻结（窗口可见却不可操作），所以只能走应用原生路径；DSH 升级 Electron 后需按上面的检查清单复核。
- Windows 锁屏时系统不允许任何程序抢前台，点击不会（也不应）穿透锁屏。
- 点击会先通过公开客户端服务 `uiWorkspace.openSession` 切到事件所属会话，再聚焦窗口；该服务缺失或调用失败时静默退化为「只聚焦、不切会话」（见 [ticket 09](docs/tickets/09-notification-click-open-session.md)）。点击子代理归并来的通知会打开其主会话。
- **DSH 完全退出后不再有提醒**：提醒依赖 DSH 桌面进程/窗口存活；窗口关闭默认是隐藏到托盘，隐藏期间渲染进程与插件状态存活、通知照常工作。

### 其他

- **v1 没有设置界面**，配置只走 `cordis.patch.yml`，仅「禁用整行」开关可用。
- 计划审批（`plan-review`）与失败/报错事件 v1 **不提醒**（范围外）。
- 同一会话的新事件是「先关闭旧通知、再弹新通知」（为规避 Windows/Electron 同名 tag 无法关闭的平台缺陷），替换时**可能重新出现一次横幅/提示音**；不堆叠由插件显式关闭保证。
- **极少数「开发期热重载」场景可能出现重复通知**：页面长期不重启、反复 HMR 重载后可能残留旧版浏览器半身实例——同一条事件会弹两条（一条中文带会话标题、一条英文回退标题「Untitled session」）。`client.js` 已加页面级单例清理（新加载会先 dispose 旧实例，含回归单测）；**存量旧实例需要重启一次 DSH 应用清除**，发布验收在重启后的干净构建上复核。
- 以下各项目前由单测覆盖、尚未在真机逐项验收（列入 [#8 真机清单](docs/tickets/08-acceptance-release.md)）：`sound: false` 的实际静音、英文界面文案、「另有 N 项」计数、子代理归并与子代理完成不提醒、多显示器 / 虚拟桌面下的窗口恢复。

## 文档（本地优先）

规划与实施记录以仓库内文档为准，GitHub issue 只作公开路线图：

- 规格与设计：[docs/spec.md](docs/spec.md)、[docs/design-notes.md](docs/design-notes.md)
- 工单与验证结论：[docs/tickets/](docs/tickets/)、[docs/spikes/](docs/spikes/)
- 风险与决策：[docs/risks.md](docs/risks.md)、[docs/adr/](docs/adr/)
- 本机开发环：[docs/dev-loop.md](docs/dev-loop.md)
- 术语表：[GLOSSARY.md](./GLOSSARY.md)

## 许可

[MIT](LICENSE)
