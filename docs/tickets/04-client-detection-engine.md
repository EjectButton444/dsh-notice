Status: done (2026-11-04) — 实现与单测已落地；三类事件与前台抑制的真机验收记录见 [docs/spikes/04-client-detection.md](../spikes/04-client-detection.md)。

## Parent

#1

## What to build

客户端订阅会话注意力状态，识别三类**注意力事件**（授权请求、提问请求、回合完成），并首次落地**通知决策引擎**（纯函数：归一化输入 + 配置 + 前台状态 → 通知动作）。

这一票完成 spec 中唯一的自动化测试 seam 的第一版，并带 `node --test` 单测，覆盖事件映射与「按会话的前台抑制」。完成后，真实触发三类事件时各弹一条系统通知（尚无合并 / 消解 / 配置等规则，那些在 #5）。

P0 的回合完成用 `running` 边沿近似判定（Stop / 报错也会触发），此近似需记录到实现说明 / `docs/spikes/`（本地优先，见 `AGENTS.md`），由 #7 收敛。

## Acceptance criteria

- [ ] 授权 / 提问 / 完成三类事件在真实会话中都能各自触发通知
- [ ] 决策引擎为纯函数，`node --test` 覆盖事件映射与前台抑制
- [ ] DSH 前台且正在看该会话时不弹；在看别的会话时仍然弹
- [ ] 回合完成的近似语义（Stop / 报错也会弹）已记录到文档

## 参考

- 规格 `docs/spec.md`（「注意力事件来源」「通知决策引擎（唯一自动化测试 seam）」「Testing Decisions」）
- 实现设计 `docs/design-notes.md` §2 触发与检测、§3 提醒规则、§8 测试策略
- 真机环境与触发方法 `docs/dev-loop.md`
- spike 结论 `docs/spikes/02-toast-spike.md`（client 加载/HMR/Toast）、`docs/spikes/03-tray-click-baseline.md`
- 客户端 API 研究（本机 gitignored）：`.scratch/research/report-client-plugin.md`（`uiSession.sessionStatus`、`pendingInteraction`、`running` 边沿、`sessions.list` 会话行字段）
- 术语 `GLOSSARY.md`（注意力事件 / 授权请求 / 提问请求 / 回合完成 / 前台抑制）

## Blocked by

- #2
- #3
