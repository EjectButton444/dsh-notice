# Changelog

本文件记录 `dsh-notice` 的所有重要变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [1.0.0] — 2026-11-05

首个公开发布：v1 功能集（含 v1.1 点击通知切会话）。同时通过 npm（`dsh-notice`）与
[DSH 插件市场索引](https://raw.githubusercontent.com/EjectButton444/dsh-notice/main/plugin-market-index.json) 分发。

### Added

- **三类注意力事件的 Windows 系统通知**：授权请求、提问请求、回合完成。通知只显示**会话标题 + 事件类型**，
  不暴露工具命令、问题原文或用户消息内容（通知会出现在锁屏与通知中心，隐私优先）。
- **通知决策引擎**（纯 reducer，单测覆盖）：前台抑制（`unfocused` / `always`）、按会话去重与替换、
  3 秒同类合并、「另有 N 项」计数、处理完（授权/回答/打开会话）自动关闭、子代理 pending 归并到主会话、
  zh/en 文案跟随 DSH 界面语言、空标题兜底。
- **配置**：profile `cordis.patch.yml` 的 `notice` 行支持 `events.approval` / `events.question` /
  `events.turnComplete`、`condition`（`unfocused` | `always`）、`sound`、`mute`；宿主以只读路由
  `GET /dsh-notice/config` 暴露配置原文，由纯引擎 `normalizeConfig` 校验并补默认值。
- **点击通知聚焦窗口**：渲染层 `POST /dsh-notice/focus`（带标记头）→ 宿主 spawn `focus.ps1`；
  三段式路径：Electron 托盘原生恢复（主路径）→ Win32 消息兜底 → `dsh://open` 最后兜底，失败静默。
- **v1.1 点击通知切换会话**：点击时先通过公开客户端服务 `uiWorkspace.openSession` 切到事件所属会话，再聚焦窗口；
  服务缺失或调用失败时静默退化为「只聚焦、不切会话」。
- **精确回合完成判定（#7）**：宿主订阅 `session/event` 的 `turn/end`，只有 `reason.kind === 'completed'`
  经 `GET /dsh-notice/events`（SSE）下发；用户 Stop（`aborted`）、报错、中断、fork、blocked、
  max-tokens 不再误报「本轮已完成」。客户端首次连通 SSE 后永久进入精确模式。
- **公开发布工程化**：npm 元数据（`dsh-notice@1.0.0`，MIT）、本文件、GitHub Actions CI
  （Node 22：语法检查 + 全量单测 + `npm pack --dry-run`）、维护者发布 runbook
  （[docs/release.md](docs/release.md)）、format-1 插件市场索引（`plugin-market-index.json`）。

### Fixed

- **HMR 重复实例导致重复通知（#8 验收发现）**：页面长期不重启、反复 HMR 重载后可能同时存活两个浏览器半身实例，
  同一事件弹出两条通知（一条中文、一条英文回退标题）。`client.js` 增加页面级单例锚点
  （`window.__dshNoticeActiveInstance`），新 `apply` 先 dispose 旧实例；存量旧实例需重启一次 DSH 清除。
- **P0 `running` 边沿误报**：精确完成通道上线前，用户按 Stop / 报错也会弹「本轮已完成」；现由 #7 的
  宿主精确判定取代，近似逻辑只在 SSE 首次连通前的极短过渡窗口内保留。
- **同名 tag 通知无法关闭**：Windows/Electron 下同名 tag 替换会破坏后续 `close()`；渲染层改用唯一 tag
  （`<tag>#<n>`）+ 显式关闭旧句柄，活跃横幅始终单条。

### Security

- 通知内容仅含会话标题与事件类型；锁屏时通知内容由系统隐藏。
- 插件是**只读旁路**：宿主钩子、路由、配置读取与点击桥全部 try/catch，任何失败只记 `console.warn`，
  绝不阻塞会话或影响审批链路。
- 插件市场索引由本仓库（第三方来源）提供，DSH 在添加索引与安装时提示信任；索引与 npm 包元数据
  （name/version/`engines.dsh`）由校验脚本守护一致。

### Known limitations

- 仅支持 **Windows 桌面版 DSH**（v1 实测基线 DSH Desktop 0.2.1-rc.5 / Electron 44.7.0）；`engines.dsh`
  不匹配时 DSH 会**静默跳过**本插件（表现为插件页没有这一行、也不报错）。
- v1 没有设置界面，配置只走 profile 文件；通知中心在快速连续事件时可能残留旧条目（Windows close/replace
  平台竞态）；DSH 重启/热重载前创建的旧通知点击只关闭、不跳转；SSE 断线期间完成的回合不补发（宁可漏、不可误）。

完整清单见 [README「已知限制」](README.md#已知限制) 与 [#8 发布验收记录](docs/spikes/08-acceptance-release.md)。
