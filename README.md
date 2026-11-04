# dsh-notice

把 DeepSeek Harness 会话里「需要人介入」的时刻变成 Windows 系统通知。

三类**注意力事件**（术语见 [GLOSSARY.md](./GLOSSARY.md)）：

- **授权请求**——工具/沙箱权限等你确认；
- **提问请求**——代理在等你回答；
- **回合完成**——本轮结束，等你下一条指令。

设计时参考了 OpenAI Codex 的通知行为（事件少而准、默认前台不打扰、按会话去重），设计决策记录在 [docs/adr/](./docs/adr/)。

## 状态

实现阶段：P0 客户端半身完成（最小插件 + Windows Toast + 注意力检测 + 通知规则/配置引擎），P1 点击桥完成（真机验收通过），v1.1 点击通知自动切换会话完成；P1 精确完成判定待 #7。

- [x] 需求与设计访谈
- [x] 领域术语表、ADR-0001 / ADR-0002
- [x] P0：纯客户端插件跑通 Windows Toast
- [x] P0：客户端注意力检测（授权 / 提问 / 回合完成）+ 通知决策引擎（前台抑制，含单测）
- [x] P0：通知规则补全（每会话单条 / 替换 / 3s 合并 / 另有 N 项 / 消解关闭 / 配置 / zh-en 文案）
- [x] P1：宿主点击桥——点击通知唤起 DSH 窗口（托盘隐藏 / 最小化 / 后台均实测通过，失败静默）
- [x] v1.1：点击通知自动切换到等待操作的会话（`uiWorkspace.openSession`，真机验收通过）
- [ ] P1：宿主精确完成判定（Stop / 报错 / 中断不再弹「本轮已完成」）
- [ ] 发布准备（README、文档、npm）

## 配置

在 DSH profile 的 `cordis.patch.yml` 中覆盖本插件的 loader 行配置（**行 id 为 `notice`**），修改后重启 DSH 生效：

```yaml
- id: notice
  name: dsh-notice
  config:
    events: { approval: true, question: true, turnComplete: true }
    condition: unfocused   # unfocused | always
    sound: true
    mute: false
```

覆盖是整体替换；缺失项回退默认值。配置生效路径与真机结论见 [docs/spikes/05-notification-rules.md](docs/spikes/05-notification-rules.md)。

## 已知限制

- **回合完成是近似判定**：客户端只能看到 `running: true → false`，无法区分正常完成与用户停止 / 报错 / 中断；P0 这些情况都会弹「本轮已完成」，由后续 ticket 用宿主 `turn/end.reason` 收敛（记录见 [docs/spikes/04-client-detection.md](docs/spikes/04-client-detection.md)）。
- **点击通知的窗口恢复**：P1 点击桥已实现并真机验收（隐藏到托盘 / 最小化 / 后台均能把窗口带回前台且可正常操作，失败静默）。特别地，本机宿主上下文无法完成 `dsh://open` 单实例握手（第二实例在握手前退出；agent 工具 shell 为 Low 完整性、宿主 spawn 的 helper 为 Medium，问题在启动/沙箱上下文），且外部 Win32 显示会让 Chromium 渲染器冻结——主路径改为触发应用自己的托盘点击（`focusPrimaryWindow()` 原生 restore+show+focus），详见 [docs/spikes/06-click-bridge.md](docs/spikes/06-click-bridge.md)。该主路径依赖 Electron 44.7.0 的托盘消息契约，DSH 升级后需按发布验收清单复核。Windows 锁屏时系统不允许任何程序抢前台，属预期行为。
- **点击通知会先切到对应会话**：v1.1 起点击通知会通过公开客户端服务 `uiWorkspace.openSession(target)` 选中事件所属会话，再聚焦窗口（在别的会话时也能一步跳回等待操作的会话，真机验收通过）。该服务缺失或调用失败时静默退回旧行为（只聚焦、不切会话，见 [docs/tickets/09-notification-click-open-session.md](docs/tickets/09-notification-click-open-session.md)）；点击子代理归并来的通知会打开其主会话。
- `sound: false` 的实际静音、`en` 界面文案、子代理并发提醒计数尚未在真机上逐项验收（归入发布验收清单）。
- 仅支持 Windows 桌面版 DSH；通知会跟随系统语言/界面语言显示中英文文案。

## 约束

- 仅支持 **Windows 桌面版 DSH**（v1）；
- 提醒渠道只有 Windows 系统通知（ADR-0001）；
- 配置走 DSH profile 的 `cordis.patch.yml`，v1 不做设置界面。

## 文档（本地优先）

规划与实施记录以仓库内文档为准，GitHub issue 只作公开路线图：

- 规格与设计：[docs/spec.md](docs/spec.md)、[docs/design-notes.md](docs/design-notes.md)
- 工单与验证结论：[docs/tickets/](docs/tickets/)、[docs/spikes/](docs/spikes/)
- 风险与决策：[docs/risks.md](docs/risks.md)、[docs/adr/](docs/adr/)
- 本机开发环：[docs/dev-loop.md](docs/dev-loop.md)

## 许可

MIT
