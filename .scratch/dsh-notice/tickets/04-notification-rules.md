## Parent

#1

## What to build

把通知规则补全到 spec 要求，全部作为决策引擎的单测用例覆盖：

- 每会话单条通知 + 原地替换 + 3 秒同类合并窗口；
- 多个待处理时正文追加「另有 N 项」；
- 处理完（授权 / 回答 / 打开会话）后自动关闭通知；
- 提示音开关；
- zh / en 文案跟随 DSH 界面语言；
- 配置键：`events.approval` / `events.question` / `events.turnComplete`、`condition`（`unfocused` / `always`）、`sound`、`mute`；
- 子代理的待处理交互归并到所属主会话，子代理的回合完成不提醒。

## Acceptance criteria

- [ ] 同一会话连续 5 次事件最多只保留 1 条通知，内容为最新事件
- [ ] 多待处理时显示「另有 N 项」
- [ ] 授权 / 回答后通知自动关闭；打开会话后完成通知自动关闭
- [ ] 配置文件可分别开关三类事件、切换 `condition`、静音、关闭提示音
- [ ] 文案跟随 DSH 界面语言（zh / en）
- [ ] 子代理待处理交互归并到主会话，子代理完成不提醒
- [ ] 以上规则均有决策引擎单测覆盖

## Blocked by

- #4
