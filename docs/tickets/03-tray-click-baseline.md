Status: done (2026-11-04) — 结论与证据见 [docs/spikes/03-tray-click-baseline.md](../spikes/03-tray-click-baseline.md)。

## Parent

#1

## What to build

在最小插件（#2）基础上补齐两个 spike 结论：

1. **托盘隐藏行为**：DSH 窗口关闭 / 隐藏到托盘时，系统通知是否照常弹出（含是否有延迟）。
2. **点击基线**：点击当前通知会发生什么；手动 `Start-Process 'dsh://open'` 能否把隐藏窗口单实例唤起（restore + show + focus）、冷启动耗时多少。

据此确定 #6 点击桥的形态（可行 / 需降级），并把结论写回 issue 评论，作为后续实现的前提。

## Acceptance criteria

- [ ] 记录托盘隐藏状态下通知是否正常弹出、是否有延迟
- [ ] 记录点击通知的当前行为（无反应 / 聚焦 / 其它）
- [ ] 记录 `dsh://open` 唤起隐藏窗口的行为与耗时
- [ ] 给出 #6 点击桥的形态结论（可行 / 需降级方案）

## Blocked by

- #2
