## Agent skills

### Planning and implementation records (local-first)

规划与实施记录以本仓库的 `docs/` 为准，不写进 GitHub issue 评论：

- 规格：[docs/spec.md](docs/spec.md)；实现设计笔记：[docs/design-notes.md](docs/design-notes.md)；
- 工单：[docs/tickets/](docs/tickets/)（文件名前缀 = 对应的 GitHub 路线图 issue 号，如 `02-toast-spike.md` ↔ #2）；
- spike / 真机验证结论：[docs/spikes/](docs/spikes/)；
- 风险登记表：[docs/risks.md](docs/risks.md)；
- 变更约定见 [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)。

GitHub issues 只作**公开路线图**：不在 issue 里贴实施报告，完成时关闭并指向本地记录。

### Dev environment

真机环境事实、插件安装现状、HMR 开发环、验证工具链与平台陷阱：[docs/dev-loop.md](docs/dev-loop.md)。实现/验收前先读。

### Triage labels

仅用于 GitHub 路线图 issue；本地工单用 `Status:` 行。角色→标签映射见 [docs/agents/triage-labels.md](docs/agents/triage-labels.md)。

### Domain docs

Single-context layout: one [GLOSSARY.md](GLOSSARY.md) and [docs/adr/](docs/adr/) at the repo root. See [docs/agents/domain.md](docs/agents/domain.md).
