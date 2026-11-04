# Issue tracker: local docs first, GitHub for the roadmap

规划与实施记录的唯一事实源是本仓库的 `docs/`，**不是** GitHub issues。GitHub 只承担公开路线图与发布。

## 本地结构

| 内容 | 路径 | 说明 |
|---|---|---|
| 规格 | `docs/spec.md` | 公开的 v1 spec（对应 GitHub #1 的内容快照） |
| 设计笔记 | `docs/design-notes.md` | 实现层面的设计细节（事件来源、通知规则、测试策略） |
| 工单 | `docs/tickets/<NN>-<slug>.md` | `NN` = 对应 GitHub 路线图 issue 号：`02` ↔ #2 … `08` ↔ #8 |
| spike / 验证结论 | `docs/spikes/<NN>-<slug>.md` | 真机实测记录、风险结论 |
| 风险 | `docs/risks.md` | 风险登记表（ticket 排序依据） |

## 工单约定

- 每个工单文件开头写一行状态：`Status: pending` / `Status: in-progress` / `Status: done (YYYY-MM-DD)`；完成时附上验证记录或提交的指针。
- 依赖写成 `Blocked by:` 列表（引用 issue 号或工单文件名）。
- 一个工单内不写实现流水账；spike/真机结论放 `docs/spikes/`。

## 技能术语映射

- **"fetch the relevant ticket"**：读对应的 `docs/tickets/<NN>-<slug>.md`（以及它引用的 spec / spike）。
- **"publish to the issue tracker"**：写或更新本地 `docs/` 文件并提交。
- **"claim a ticket"**：把 `Status:` 改为 `in-progress`；完成时改 `done (日期)`。
- **triage**：本地工单用 `Status:` 表达就绪状态；`needs-triage` 等标签只作用于 GitHub 路线图 issue。

## GitHub 路线图（只读镜像）

- [#1](https://github.com/EjectButton444/dsh-notice/issues/1) v1 spec（内容已归档进 `docs/spec.md`）；
- [#2](https://github.com/EjectButton444/dsh-notice/issues/2)–[#8](https://github.com/EjectButton444/dsh-notice/issues/8) 为公开路线图指针，细节与状态一律以 `docs/tickets/` 为准。
- 允许：创建/更新路线图 issue、应用 triage 标签、关闭已完成项、发布 release note。
- 禁止：把实施报告、测试结论或长评论写进 issue；在 issue 里维护与本地文档重复的计划。

## 常用操作（GitHub，路线图维护）

- 读取 issue：# 内容以本地文档为准，仅在需要确认路线图状态时用 `gh issue view <n>`。
- 关闭已完成项：`gh issue close <n> --comment "<一行：已完成，记录见 docs/...>"`；不要写长报告。
- 标签：`gh issue edit <n> --add-label "<label>"` / `--remove-label "<label>"`。
- 仓库从 `git remote -v` 推断；`gh` 在克隆目录内自动识别。
