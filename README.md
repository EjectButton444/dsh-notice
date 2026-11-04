# dsh-notice

把 DeepSeek Harness 会话里「需要人介入」的时刻变成 Windows 系统通知。

三类**注意力事件**（术语见 [GLOSSARY.md](./GLOSSARY.md)）：

- **授权请求**——工具/沙箱权限等你确认；
- **提问请求**——代理在等你回答；
- **回合完成**——本轮结束，等你下一条指令。

设计时参考了 OpenAI Codex 的通知行为（事件少而准、默认前台不打扰、按会话去重），设计决策记录在 [docs/adr/](./docs/adr/)。

## 状态

实现阶段：P0（最小客户端插件 + Windows Toast）已在真机跑通，P1 待开始。

- [x] 需求与设计访谈
- [x] 领域术语表、ADR-0001 / ADR-0002
- [x] P0：纯客户端插件跑通 Windows Toast
- [ ] P1：宿主半身补「点击唤起窗口 + 精确完成判定」
- [ ] 发布准备（README、文档、npm）

## 约束

- 仅支持 **Windows 桌面版 DSH**（v1）；
- 提醒渠道只有 Windows 系统通知（ADR-0001）；
- 配置走 DSH profile 的 `cordis.patch.yml`，v1 不做设置界面。

## 文档（本地优先）

规划与实施记录以仓库内文档为准，GitHub issue 只作公开路线图：

- 规格与设计：[docs/spec.md](docs/spec.md)、[docs/design-notes.md](docs/design-notes.md)
- 工单与验证结论：[docs/tickets/](docs/tickets/)、[docs/spikes/](docs/spikes/)
- 风险与决策：[docs/risks.md](docs/risks.md)、[docs/adr/](docs/adr/)

## 许可

MIT
